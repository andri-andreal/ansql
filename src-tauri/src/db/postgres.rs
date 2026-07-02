use async_trait::async_trait;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::{Column, PgPool, Row};
use chrono;

use super::driver::{
    ColumnDefinition, ColumnInfo, DatabaseDriver, DriverError, ForeignKeyInfo, IndexInfo, TableGraph,
    QueryResult, SslOptions, TableInfo, TriggerInfo,
};
use super::mysql::build_fk_lookup_sql;
use crate::transfer::Dialect;

pub struct PostgresDriver {
    pool: Option<PgPool>,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    ssl: Option<SslOptions>,
}

impl PostgresDriver {
    pub fn new(
        host: String,
        port: u16,
        username: String,
        password: String,
        database: Option<String>,
        ssl: Option<SslOptions>,
    ) -> Self {
        Self {
            pool: None,
            host,
            port,
            username,
            password,
            database,
            ssl,
        }
    }

    /// Build typed connect-options from the stored fields, applying SSL when present.
    /// Defaults to `Prefer` when no SSL mode is given, matching the previous
    /// URL-based connect (so existing non-SSL connections behave identically).
    fn connect_options(&self) -> PgConnectOptions {
        let mut opts = PgConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .username(&self.username)
            .password(&self.password);

        if let Some(db) = &self.database {
            opts = opts.database(db);
        }

        if let Some(ssl) = &self.ssl {
            let mode = match ssl.mode.as_deref() {
                Some("disable") => PgSslMode::Disable,
                Some("prefer") => PgSslMode::Prefer,
                Some("require") => PgSslMode::Require,
                Some("verify-ca") => PgSslMode::VerifyCa,
                Some("verify-full") => PgSslMode::VerifyFull,
                _ => PgSslMode::Prefer,
            };
            opts = opts.ssl_mode(mode);

            if let Some(ca) = &ssl.ca_path {
                opts = opts.ssl_root_cert(ca);
            }
            if let Some(cert) = &ssl.cert_path {
                opts = opts.ssl_client_cert(cert);
            }
            if let Some(key) = &ssl.key_path {
                opts = opts.ssl_client_key(key);
            }
        }

        opts
    }
}

// NB: the legacy `connection_string()` helper was removed when `connect()` moved
// to typed `PgConnectOptions` (so SSL settings can be applied). SQLite still uses
// a URL string; only the networked drivers switched to connect-options.

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn connect(&mut self) -> Result<(), DriverError> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(self.connect_options())
            .await
            .map_err(|e| DriverError::ConnectionError(e.to_string()))?;

        self.pool = Some(pool);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), DriverError> {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
        Ok(())
    }

    async fn test_connection(&self) -> Result<bool, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        sqlx::query("SELECT 1")
            .fetch_one(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        Ok(true)
    }

    async fn execute(&self, query: &str) -> Result<QueryResult, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let start = std::time::Instant::now();

        let rows = sqlx::query(query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        let columns: Vec<ColumnInfo> = if !rows.is_empty() {
            rows[0]
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: col.type_info().to_string(),
                    nullable: true,
                })
                .collect()
        } else {
            vec![]
        };

        let result_rows: Vec<serde_json::Map<String, serde_json::Value>> = rows
            .iter()
            .map(|row| {
                let mut obj = serde_json::Map::new();
                for (i, col) in columns.iter().enumerate() {
                    let type_name = col.data_type.to_lowercase();
                    let value = if type_name == "uuid" {
                        if let Ok(v) = row.try_get::<Option<uuid::Uuid>, _>(i) {
                            v.map(|u| serde_json::Value::String(u.to_string())).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name.contains("json") {
                        if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                            v
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name == "bool" {
                        if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                            v.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name.contains("int") {
                        if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                            v.map(|n| serde_json::Value::Number(n.into())).unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<Option<i32>, _>(i) {
                            v.map(|n| serde_json::Value::Number(n.into())).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name.contains("float") || type_name.contains("numeric") || type_name.contains("decimal") || type_name == "real" {
                        // float4/float8/real decode as f64. NUMERIC/DECIMAL are NOT
                        // f64-compatible in sqlx, so that try_get fails and we must
                        // decode them as BigDecimal — otherwise the value silently
                        // becomes NULL (corrupting data / breaking NOT NULL targets on
                        // transfer). Keep the exact text to preserve precision (money).
                        if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                            v.and_then(|n| serde_json::Number::from_f64(n).map(serde_json::Value::Number))
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(i) {
                            v.map(|d| serde_json::Value::String(d.to_string()))
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                            v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name.contains("timestamp") {
                        if let Ok(v) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(i) {
                            v.map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
                            v.map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                            v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if type_name.contains("bytea") {
                        if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
                            match String::from_utf8(bytes) {
                                Ok(s) => serde_json::Value::String(s),
                                Err(_) => serde_json::Value::Null,
                            }
                        } else {
                            serde_json::Value::Null
                        }
                    } else {
                        // Default: try as String
                        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                            v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    };
                    obj.insert(col.name.clone(), value);
                }
                obj
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            affected_rows: None,
            execution_time_ms,
        })
    }

    /// Run a single parameterized statement (mutation). Returns affected rows.
    /// Postgres placeholders are `$1..$n` (emitted by the caller).
    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let start = std::time::Instant::now();

        let mut q = sqlx::query(sql);
        for p in params {
            q = crate::db::bind::bind_postgres(q, p);
        }
        let res = q
            .execute(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: Some(res.rows_affected()),
            execution_time_ms,
        })
    }

    async fn commit_batch(
        &self,
        statements: &[(String, Vec<serde_json::Value>)],
    ) -> Result<Vec<QueryResult>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut results = Vec::with_capacity(statements.len());
        for (sql, params) in statements {
            let mut q = sqlx::query(sql);
            for p in params {
                q = crate::db::bind::bind_postgres(q, p);
            }
            let res = q
                .execute(&mut *tx)
                .await
                .map_err(|e| DriverError::QueryError(e.to_string()))?;
            results.push(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: Some(res.rows_affected()),
                execution_time_ms: 0,
            });
        }

        tx.commit()
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;
        Ok(results)
    }

    async fn get_databases(&self) -> Result<Vec<String>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let rows = sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false")
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let databases: Vec<String> = rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>(0).ok())
            .collect();

        Ok(databases)
    }

    async fn get_schemas(&self, _database: &str) -> Result<Vec<String>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata
             WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
             ORDER BY schema_name",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let schemas: Vec<String> = rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>(0).ok())
            .collect();

        Ok(schemas)
    }

    async fn get_tables(
        &self,
        _database: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        // reltuples is the planner's approximate row estimate (kept current by
        // ANALYZE / autovacuum). Fast and never a full scan; -1 means "unknown",
        // which we surface as None.
        let rows = sqlx::query(
            "SELECT t.table_name, t.table_type, c.reltuples::bigint AS row_count
             FROM information_schema.tables t
             LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
             LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
             WHERE t.table_schema = $1
             ORDER BY t.table_name",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let tables: Vec<TableInfo> = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get("table_name").ok()?;
                let table_type: String = row.try_get("table_type").ok()?;
                let row_count: Option<i64> = row
                    .try_get::<Option<i64>, _>("row_count")
                    .ok()
                    .flatten()
                    .filter(|&n| n >= 0);
                Some(TableInfo {
                    name,
                    schema: Some(schema.to_string()),
                    table_type,
                    row_count,
                })
            })
            .collect();

        Ok(tables)
    }

    async fn get_columns(
        &self,
        _database: &str,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<ColumnDefinition>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        let query = format!(
            "SELECT
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary,
                CASE WHEN u.column_name IS NOT NULL THEN true ELSE false END as is_unique,
                CASE WHEN c.column_default LIKE 'nextval%' THEN true ELSE false END as is_auto_increment,
                pgd.description as comment,
                c.character_maximum_length,
                c.numeric_precision,
                c.numeric_scale
             FROM information_schema.columns c
             LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = '{}' AND tc.table_schema = '{}'
             ) pk ON c.column_name = pk.column_name
             LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = '{}' AND tc.table_schema = '{}'
             ) u ON c.column_name = u.column_name
             LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.relname = c.table_name
             LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
             WHERE c.table_name = '{}' AND c.table_schema = '{}'
             ORDER BY c.ordinal_position",
            table, schema, table, schema, table, schema
        );

        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let columns: Vec<ColumnDefinition> = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get(0).ok()?;
                let data_type: String = row.try_get(1).ok()?;
                let nullable: String = row.try_get(2).ok()?;
                let default_value: Option<String> = row.try_get(3).ok();
                let is_primary_key: bool = row.try_get(4).unwrap_or(false);
                let is_unique: bool = row.try_get(5).unwrap_or(false);
                let is_auto_increment: bool = row.try_get(6).unwrap_or(false);
                let comment: Option<String> = row.try_get(7).ok();
                let char_max_length: Option<i32> = row.try_get(8).ok().flatten();
                let numeric_precision: Option<i32> = row.try_get(9).ok().flatten();
                let numeric_scale: Option<i32> = row.try_get(10).ok().flatten();

                // Re-assemble the sized form Postgres' information_schema splits
                // across separate columns (it leaves `data_type` bare, e.g.
                // `character varying` / `numeric`).
                let full_type = match char_max_length {
                    Some(len) => Some(format!("{}({})", data_type, len)),
                    None => match numeric_precision {
                        Some(precision) if matches!(data_type.as_str(), "numeric" | "decimal") => {
                            Some(format!("{}({},{})", data_type, precision, numeric_scale.unwrap_or(0)))
                        }
                        _ => Some(data_type.clone()),
                    },
                };

                Some(ColumnDefinition {
                    name,
                    data_type,
                    full_type,
                    nullable: nullable == "YES",
                    default_value,
                    is_primary_key,
                    is_unique,
                    is_auto_increment,
                    comment,
                })
            })
            .collect();

        Ok(columns)
    }

    async fn get_view_definition(
        &self,
        _database: &str,
        view: &str,
        schema: Option<&str>,
    ) -> Result<String, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        // pg_get_viewdef on the regclass returns the formatted SELECT body.
        // format('%I.%I', ...) quotes identifiers safely against the regclass cast.
        let row = sqlx::query(
            "SELECT pg_get_viewdef(format('%I.%I', $1, $2)::regclass, true)",
        )
        .bind(schema)
        .bind(view)
        .fetch_optional(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        match row {
            Some(row) => row
                .try_get::<String, _>(0)
                .map_err(|e| DriverError::QueryError(e.to_string())),
            None => Err(DriverError::QueryError(format!(
                "View '{}' not found in schema '{}'",
                view, schema
            ))),
        }
    }

    async fn get_indexes(
        &self,
        _database: &str,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<IndexInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        let query = format!(
            "SELECT
                i.relname as index_name,
                array_agg(a.attname ORDER BY c.ordinality) as columns,
                ix.indisunique as is_unique,
                ix.indisprimary as is_primary,
                am.amname as index_type
             FROM pg_index ix
             JOIN pg_class t ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_am am ON am.oid = i.relam
             CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS c(colnum, ordinality)
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.colnum
             WHERE t.relname = '{}' AND n.nspname = '{}'
             GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname",
            table, schema
        );

        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let indexes: Vec<IndexInfo> = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get(0).ok()?;
                let columns: Vec<String> = row.try_get(1).ok()?;
                let is_unique: bool = row.try_get(2).ok()?;
                let is_primary: bool = row.try_get(3).ok()?;
                let index_type: Option<String> = row.try_get(4).ok();

                Some(IndexInfo {
                    name,
                    columns,
                    is_unique,
                    is_primary,
                    index_type,
                })
            })
            .collect();

        Ok(indexes)
    }

    async fn get_foreign_keys(
        &self,
        _database: &str,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<ForeignKeyInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        let query = format!(
            "SELECT
                tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS referenced_table,
                ccu.column_name AS referenced_column,
                rc.delete_rule,
                rc.update_rule
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
             JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '{}' AND tc.table_schema = '{}'
             ORDER BY tc.constraint_name, kcu.ordinal_position",
            table, schema
        );

        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut fk_map: std::collections::HashMap<String, ForeignKeyInfo> =
            std::collections::HashMap::new();

        for row in rows.iter() {
            let constraint_name: String = row.try_get(0).unwrap_or_default();
            let column_name: String = row.try_get(1).unwrap_or_default();
            let ref_table: String = row.try_get(2).unwrap_or_default();
            let ref_column: String = row.try_get(3).unwrap_or_default();
            let on_delete: Option<String> = row.try_get(4).ok();
            let on_update: Option<String> = row.try_get(5).ok();

            let entry = fk_map
                .entry(constraint_name.clone())
                .or_insert(ForeignKeyInfo {
                    name: constraint_name,
                    columns: vec![],
                    referenced_table: ref_table,
                    referenced_columns: vec![],
                    on_delete,
                    on_update,
                });
            entry.columns.push(column_name);
            entry.referenced_columns.push(ref_column);
        }

        Ok(fk_map.into_values().collect())
    }

    /// Batched ERD introspection: three schema-wide queries (columns, PK/UNIQUE
    /// key sets, FKs) grouped in Rust, instead of the per-table column query
    /// (which carries two correlated subqueries) plus an FK query for every
    /// table. Collapses ~2N round-trips into 3.
    async fn get_schema_graph(
        &self,
        _database: &str,
        schema: Option<&str>,
        tables: &[String],
    ) -> Result<Vec<TableGraph>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");
        let want: std::collections::HashSet<&str> = tables.iter().map(|s| s.as_str()).collect();

        // 1) PK / UNIQUE column sets for the whole schema, keyed by (table, column).
        let key_rows = sqlx::query(
            "SELECT tc.table_name, ku.column_name, tc.constraint_type
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage ku
                ON tc.constraint_name = ku.constraint_name
                AND tc.table_schema = ku.table_schema
             WHERE tc.table_schema = $1
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut pk_set: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        let mut uniq_set: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        for row in key_rows.iter() {
            let table: String = row.try_get(0).unwrap_or_default();
            let column: String = row.try_get(1).unwrap_or_default();
            let ctype: String = row.try_get(2).unwrap_or_default();
            if ctype == "PRIMARY KEY" {
                pk_set.insert((table, column));
            } else {
                uniq_set.insert((table, column));
            }
        }

        // 2) Every column in the schema, in one pass.
        let col_rows = sqlx::query(
            "SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
                    c.column_default, c.character_maximum_length,
                    c.numeric_precision, c.numeric_scale, pgd.description
             FROM information_schema.columns c
             LEFT JOIN pg_catalog.pg_statio_all_tables st
                ON st.relname = c.table_name AND st.schemaname = c.table_schema
             LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
             WHERE c.table_schema = $1
             ORDER BY c.table_name, c.ordinal_position",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut columns_by_table: std::collections::HashMap<String, Vec<ColumnDefinition>> =
            std::collections::HashMap::new();
        for row in col_rows.iter() {
            let table: String = row.try_get(0).unwrap_or_default();
            if !want.contains(table.as_str()) {
                continue;
            }
            let name: String = match row.try_get(1) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let data_type: String = row.try_get(2).unwrap_or_default();
            let nullable: String = row.try_get(3).unwrap_or_default();
            let default_value: Option<String> = row.try_get(4).ok();
            let char_max_length: Option<i32> = row.try_get(5).ok().flatten();
            let numeric_precision: Option<i32> = row.try_get(6).ok().flatten();
            let numeric_scale: Option<i32> = row.try_get(7).ok().flatten();
            let comment: Option<String> = row.try_get(8).ok();

            // Re-assemble the sized form Postgres' information_schema splits apart.
            let full_type = match char_max_length {
                Some(len) => Some(format!("{}({})", data_type, len)),
                None => match numeric_precision {
                    Some(precision) if matches!(data_type.as_str(), "numeric" | "decimal") => {
                        Some(format!("{}({},{})", data_type, precision, numeric_scale.unwrap_or(0)))
                    }
                    _ => Some(data_type.clone()),
                },
            };

            let is_auto_increment = default_value
                .as_deref()
                .map(|d| d.starts_with("nextval"))
                .unwrap_or(false);
            let key = (table.clone(), name.clone());

            columns_by_table
                .entry(table)
                .or_default()
                .push(ColumnDefinition {
                    name,
                    data_type,
                    full_type,
                    nullable: nullable == "YES",
                    default_value,
                    is_primary_key: pk_set.contains(&key),
                    is_unique: uniq_set.contains(&key),
                    is_auto_increment,
                    comment,
                });
        }

        // 3) Every foreign key in the schema (single pass).
        let fk_rows = sqlx::query(
            "SELECT tc.table_name, tc.constraint_name, kcu.column_name,
                    ccu.table_name AS referenced_table,
                    ccu.column_name AS referenced_column,
                    rc.delete_rule, rc.update_rule
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.constraint_schema = tc.table_schema
             JOIN information_schema.referential_constraints rc
                ON rc.constraint_name = tc.constraint_name
                AND rc.constraint_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
             ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut fks_by_table: std::collections::HashMap<
            String,
            std::collections::HashMap<String, ForeignKeyInfo>,
        > = std::collections::HashMap::new();
        for row in fk_rows.iter() {
            let table: String = row.try_get(0).unwrap_or_default();
            if !want.contains(table.as_str()) {
                continue;
            }
            let constraint_name: String = row.try_get(1).unwrap_or_default();
            let column_name: String = row.try_get(2).unwrap_or_default();
            let ref_table: String = row.try_get(3).unwrap_or_default();
            let ref_column: String = row.try_get(4).unwrap_or_default();
            let on_delete: Option<String> = row.try_get(5).ok();
            let on_update: Option<String> = row.try_get(6).ok();

            let entry = fks_by_table
                .entry(table)
                .or_default()
                .entry(constraint_name.clone())
                .or_insert(ForeignKeyInfo {
                    name: constraint_name,
                    columns: vec![],
                    referenced_table: ref_table,
                    referenced_columns: vec![],
                    on_delete,
                    on_update,
                });
            entry.columns.push(column_name);
            entry.referenced_columns.push(ref_column);
        }

        // 4) Every index in the schema (single pg_index pass; columns aggregated).
        let idx_rows = sqlx::query(
            "SELECT t.relname AS table_name,
                    i.relname AS index_name,
                    array_agg(a.attname ORDER BY c.ordinality) AS columns,
                    ix.indisunique AS is_unique,
                    ix.indisprimary AS is_primary,
                    am.amname AS index_type
             FROM pg_index ix
             JOIN pg_class t ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_am am ON am.oid = i.relam
             CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS c(colnum, ordinality)
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.colnum
             WHERE n.nspname = $1
             GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary, am.amname",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut idx_by_table: std::collections::HashMap<String, Vec<IndexInfo>> =
            std::collections::HashMap::new();
        for row in idx_rows.iter() {
            let table: String = row.try_get(0).unwrap_or_default();
            if !want.contains(table.as_str()) {
                continue;
            }
            let name: String = match row.try_get(1) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let columns: Vec<String> = row.try_get(2).unwrap_or_default();
            let is_unique: bool = row.try_get(3).unwrap_or(false);
            let is_primary: bool = row.try_get(4).unwrap_or(false);
            let index_type: Option<String> = row.try_get(5).ok();
            idx_by_table.entry(table).or_default().push(IndexInfo {
                name,
                columns,
                is_unique,
                is_primary,
                index_type,
            });
        }

        let out = tables
            .iter()
            .map(|name| TableGraph {
                name: name.clone(),
                schema: Some(schema.to_string()),
                columns: columns_by_table.remove(name).unwrap_or_default(),
                indexes: idx_by_table.remove(name).unwrap_or_default(),
                foreign_keys: fks_by_table
                    .remove(name)
                    .map(|m| m.into_values().collect())
                    .unwrap_or_default(),
            })
            .collect();

        Ok(out)
    }

    async fn get_triggers(
        &self,
        _database: &str,
        table: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let schema = schema.unwrap_or("public");

        // Postgres lists one row per (trigger, event), so we group by
        // trigger_name + table and merge the events (e.g. "INSERT, UPDATE").
        let rows = match table {
            Some(t) => sqlx::query(
                "SELECT trigger_name, event_object_table, action_timing,
                        event_manipulation, action_statement
                 FROM information_schema.triggers
                 WHERE trigger_schema = $1 AND event_object_table = $2
                 ORDER BY trigger_name, event_manipulation",
            )
            .bind(schema)
            .bind(t)
            .fetch_all(pool)
            .await,
            None => sqlx::query(
                "SELECT trigger_name, event_object_table, action_timing,
                        event_manipulation, action_statement
                 FROM information_schema.triggers
                 WHERE trigger_schema = $1
                 ORDER BY trigger_name, event_manipulation",
            )
            .bind(schema)
            .fetch_all(pool)
            .await,
        }
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // Preserve first-seen order while merging events.
        let mut order: Vec<String> = Vec::new();
        let mut map: std::collections::HashMap<String, TriggerInfo> =
            std::collections::HashMap::new();

        for row in rows.iter() {
            let name: String = row.try_get("trigger_name").unwrap_or_default();
            let tbl: String = row.try_get("event_object_table").unwrap_or_default();
            let timing: Option<String> = row.try_get("action_timing").ok();
            let event: Option<String> = row.try_get("event_manipulation").ok();
            let statement: String = row.try_get("action_statement").unwrap_or_default();

            let key = format!("{}::{}", name, tbl);
            match map.get_mut(&key) {
                Some(existing) => {
                    if let Some(ev) = event {
                        match &mut existing.event {
                            Some(e) if !e.split(", ").any(|x| x == ev) => {
                                e.push_str(", ");
                                e.push_str(&ev);
                            }
                            Some(_) => {}
                            None => existing.event = Some(ev),
                        }
                    }
                }
                None => {
                    order.push(key.clone());
                    map.insert(
                        key,
                        TriggerInfo {
                            name,
                            table: tbl,
                            timing,
                            event,
                            statement,
                            schema: Some(schema.to_string()),
                        },
                    );
                }
            }
        }

        Ok(order.into_iter().filter_map(|k| map.remove(&k)).collect())
    }

    async fn get_fk_lookup(
        &self,
        _database: &str,
        _schema: Option<&str>,
        table: &str,
        value_column: &str,
        label_columns: &[String],
        search: Option<&str>,
        limit: i64,
    ) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let sql = build_fk_lookup_sql(
            Dialect::Postgres,
            table,
            value_column,
            label_columns,
            search.is_some(),
            limit,
        );

        let mut q = sqlx::query(&sql);
        if let Some(s) = search {
            let pattern = format!("%{}%", s);
            for _ in label_columns {
                q = q.bind(pattern.clone());
            }
        }

        let rows = q
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        Ok(rows.iter().map(pg_row_to_json).collect())
    }
}

/// Best-effort scalar conversion of a Postgres row to a JSON map, for the FK
/// lookup (value/label display columns).
fn pg_row_to_json(row: &sqlx::postgres::PgRow) -> serde_json::Map<String, serde_json::Value> {
    let mut obj = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let value = if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            v.map(|n| serde_json::Value::Number(n.into()))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<i32>, _>(i) {
            v.map(|n| serde_json::Value::Number(n.into()))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            v.and_then(serde_json::Number::from_f64)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
            v.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<uuid::Uuid>, _>(i) {
            v.map(|u| serde_json::Value::String(u.to_string()))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };
        obj.insert(name, value);
    }
    obj
}

#[cfg(test)]
mod tests {
    use super::PostgresDriver;
    use crate::db::driver::DatabaseDriver;

    // Integration regression test for the NUMERIC/DECIMAL-decoded-as-NULL bug.
    // Requires a live Postgres; skips (passes) unless ANSQL_TEST_PG_HOST is set, so
    // the SQLite-only default test run is unaffected. Run with, e.g.:
    //   ANSQL_TEST_PG_HOST=127.0.0.1 ANSQL_TEST_PG_PORT=55432 \
    //   ANSQL_TEST_PG_USER=testuser ANSQL_TEST_PG_PASS=testpass ANSQL_TEST_PG_DB=testdb \
    //   cargo test -p ansql numeric_not_null_column_reads_back_as_value -- --nocapture
    #[tokio::test]
    async fn numeric_not_null_column_reads_back_as_value() {
        let host = match std::env::var("ANSQL_TEST_PG_HOST") {
            Ok(h) => h,
            Err(_) => {
                eprintln!("skipping: ANSQL_TEST_PG_HOST not set");
                return;
            }
        };
        let port: u16 = std::env::var("ANSQL_TEST_PG_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(5432);
        let user = std::env::var("ANSQL_TEST_PG_USER").unwrap_or_else(|_| "postgres".into());
        let pass = std::env::var("ANSQL_TEST_PG_PASS").unwrap_or_default();
        let db = std::env::var("ANSQL_TEST_PG_DB").unwrap_or_else(|_| "postgres".into());

        let mut drv = PostgresDriver::new(host, port, user, pass, Some(db), None);
        drv.connect().await.expect("connect to test Postgres");

        drv.execute("DROP TABLE IF EXISTS ansql_numtest").await.unwrap();
        drv.execute(
            "CREATE TABLE ansql_numtest (id INT PRIMARY KEY, amount NUMERIC(20,4) NOT NULL)",
        )
        .await
        .unwrap();
        // A fractional, high-magnitude value that f64 would round — proves the
        // decode is exact (BigDecimal), not lossy.
        drv.execute("INSERT INTO ansql_numtest (id, amount) VALUES (1, 1234567890.1234)")
            .await
            .unwrap();

        let res = drv
            .execute("SELECT id, amount FROM ansql_numtest WHERE id = 1")
            .await
            .unwrap();

        assert_eq!(res.rows.len(), 1);
        let amount = res.rows[0].get("amount").expect("amount column present");
        // The bug decoded NUMERIC as JSON null, which then violated NOT NULL on transfer.
        assert!(
            !amount.is_null(),
            "NUMERIC column decoded as NULL (the bug); got {amount:?}"
        );
        // Exact decimal string — every significant digit preserved (no f64 rounding).
        assert_eq!(
            amount,
            &serde_json::Value::String("1234567890.1234".to_string()),
            "expected exact decimal string, got {amount:?}"
        );

        drv.execute("DROP TABLE IF EXISTS ansql_numtest").await.ok();
    }
}
