use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Column, MySql, Pool, Row};
use chrono::{DateTime, Utc};

use super::driver::{
    ColumnDefinition, ColumnInfo, DatabaseDriver, DriverError, ForeignKeyInfo, IndexInfo,
    QueryResult, SslOptions, TableGraph, TableInfo, TriggerInfo,
};
use crate::transfer::dialect::quote_ident;
use crate::transfer::Dialect;

pub struct MySqlDriver {
    pool: Option<Pool<MySql>>,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    ssl: Option<SslOptions>,
}

impl MySqlDriver {
    pub fn new(
        host: String,
        port: u16,
        username: String,
        password: String,
        database: Option<String>,
        ssl: Option<SslOptions>,
    ) -> Self {
        tracing::info!("Creating MySqlDriver with host: {}, port: {}, database: {:?}", host, port, database);
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
    /// Defaults to `Preferred` when no SSL mode is given, matching the previous
    /// URL-based connect (so existing non-SSL connections behave identically).
    fn connect_options(&self) -> MySqlConnectOptions {
        let mut opts = MySqlConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .username(&self.username)
            .password(&self.password);

        if let Some(db) = &self.database {
            opts = opts.database(db);
        }

        if let Some(ssl) = &self.ssl {
            // Map the cross-engine vocabulary onto MySQL's ssl-mode enum.
            // `prefer` -> Preferred, `verify-full` -> VerifyIdentity (host-name check).
            let mode = match ssl.mode.as_deref() {
                Some("disable") => MySqlSslMode::Disabled,
                Some("prefer") => MySqlSslMode::Preferred,
                Some("require") => MySqlSslMode::Required,
                Some("verify-ca") => MySqlSslMode::VerifyCa,
                Some("verify-full") => MySqlSslMode::VerifyIdentity,
                _ => MySqlSslMode::Preferred,
            };
            opts = opts.ssl_mode(mode);

            if let Some(ca) = &ssl.ca_path {
                opts = opts.ssl_ca(ca);
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

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    async fn connect(&mut self) -> Result<(), DriverError> {
        let pool = MySqlPoolOptions::new()
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

        // Extract column info from first row if available
        let columns: Vec<ColumnInfo> = if !rows.is_empty() {
            rows[0]
                .columns()
                .iter()
                .map(|col| ColumnInfo {
                    name: col.name().to_string(),
                    data_type: col.type_info().to_string(),
                    nullable: true, // MySQL doesn't expose this easily
                })
                .collect()
        } else {
            vec![]
        };

        // Convert rows to JSON objects (maps)
        let result_rows: Vec<serde_json::Map<String, serde_json::Value>> = rows
            .iter()
            .enumerate()
            .map(|(row_idx, row)| {
                let mut obj = serde_json::Map::new();
                for (i, col) in columns.iter().enumerate() {
                    // Check column data type to avoid incorrect boolean conversion
                    let col_type_lower = col.data_type.to_lowercase();
                    let is_bool_type = col_type_lower.contains("bool") || col_type_lower == "bit" || col_type_lower == "bit(1)";
                    let is_unsigned = col_type_lower.contains("unsigned");
                    let is_timestamp = col_type_lower.contains("timestamp") ||
                                      col_type_lower.contains("datetime") ||
                                      col_type_lower.contains("date") ||
                                      col_type_lower.contains("time");

                    // Debug logging for timestamp columns (only first row to avoid spam)
                    if is_timestamp && row_idx == 0 {
                        tracing::info!("Row 0: Column '{}' detected as timestamp type: {}", col.name, col.data_type);
                    }

                    let is_json_type = col_type_lower == "json";

                    // Try different types based on column type
                    let value = if is_json_type {
                        // JSON columns: try serde_json::Value first, then bytes fallback
                        if let Ok(val) = row.try_get::<serde_json::Value, _>(i) {
                            val
                        } else if let Ok(Some(val)) = row.try_get::<Option<Vec<u8>>, _>(i) {
                            match String::from_utf8(val) {
                                Ok(s) => serde_json::Value::String(s),
                                Err(_) => serde_json::Value::Null,
                            }
                        } else {
                            serde_json::Value::Null
                        }
                    } else if is_timestamp {
                        // Check if it's TIMESTAMP (needs DateTime<Utc>) or DATETIME/DATE (needs NaiveDateTime)
                        let is_mysql_timestamp = col_type_lower == "timestamp";

                        if is_mysql_timestamp {
                            // For MySQL TIMESTAMP columns, use DateTime<Utc>
                            match row.try_get::<Option<DateTime<Utc>>, _>(i) {
                                Ok(Some(val)) => {
                                    if row_idx == 0 {
                                        tracing::info!("Row 0: Successfully decoded '{}' as DateTime<Utc>: {}", col.name, val);
                                    }
                                    serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
                                }
                                Ok(None) => {
                                    if row_idx == 0 {
                                        tracing::info!("Row 0: Column '{}' is NULL", col.name);
                                    }
                                    serde_json::Value::Null
                                }
                                Err(e) => {
                                    if row_idx == 0 {
                                        tracing::warn!("Row 0: Failed to decode '{}' as Option<DateTime<Utc>>: {}, trying String", col.name, e);
                                    }
                                    // Try as Option<String>
                                    if let Ok(Some(val)) = row.try_get::<Option<String>, _>(i) {
                                        if row_idx == 0 {
                                            tracing::info!("Row 0: Decoded '{}' as String: {}", col.name, val);
                                        }
                                        serde_json::Value::String(val)
                                    } else {
                                        if row_idx == 0 {
                                            tracing::info!("Row 0: Column '{}' is NULL (as String)", col.name);
                                        }
                                        serde_json::Value::Null
                                    }
                                }
                            }
                        } else {
                            // For DATETIME/DATE/TIME columns, use NaiveDateTime
                            match row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
                                Ok(Some(val)) => {
                                    if row_idx == 0 {
                                        tracing::info!("Row 0: Successfully decoded '{}' as NaiveDateTime: {}", col.name, val);
                                    }
                                    serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
                                }
                                Ok(None) => {
                                    if row_idx == 0 {
                                        tracing::info!("Row 0: Column '{}' is NULL", col.name);
                                    }
                                    serde_json::Value::Null
                                }
                                Err(e) => {
                                    if row_idx == 0 {
                                        tracing::warn!("Row 0: Failed to decode '{}' as Option<NaiveDateTime>: {}, trying String", col.name, e);
                                    }
                                    // Try as Option<String>
                                    if let Ok(Some(val)) = row.try_get::<Option<String>, _>(i) {
                                        if row_idx == 0 {
                                            tracing::info!("Row 0: Decoded '{}' as String: {}", col.name, val);
                                        }
                                        serde_json::Value::String(val)
                                    } else {
                                        if row_idx == 0 {
                                            tracing::info!("Row 0: Column '{}' is NULL (as String)", col.name);
                                        }
                                        serde_json::Value::Null
                                    }
                                }
                            }
                        }
                    } else if col_type_lower.contains("decimal") || col_type_lower.contains("numeric") {
                        // DECIMAL/NUMERIC: decode exactly as BigDecimal and keep the
                        // text. sqlx won't decode these as i64/f64/String/bytes, so
                        // before this they silently became NULL — corrupting data and
                        // breaking NOT NULL targets on transfer. Exact string preserves
                        // precision (money must not round through f64).
                        if let Ok(val) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(i) {
                            val.map(|d| serde_json::Value::String(d.to_string()))
                                .unwrap_or(serde_json::Value::Null)
                        } else if let Ok(val) = row.try_get::<Option<String>, _>(i) {
                            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
                        } else {
                            serde_json::Value::Null
                        }
                    } else if !is_bool_type {
                        // For non-boolean columns, try numeric types first
                        // Try unsigned first if the column is UNSIGNED
                        if is_unsigned {
                            if let Ok(val) = row.try_get::<u64, _>(i) {
                                serde_json::Value::Number(val.into())
                            } else if let Ok(val) = row.try_get::<u32, _>(i) {
                                serde_json::Value::Number(val.into())
                            } else if let Ok(val) = row.try_get::<String, _>(i) {
                                serde_json::Value::String(val)
                            } else {
                                serde_json::Value::Null
                            }
                        } else {
                            // Try signed integers and floats
                            if let Ok(val) = row.try_get::<i64, _>(i) {
                                serde_json::Value::Number(val.into())
                            } else if let Ok(val) = row.try_get::<i32, _>(i) {
                                serde_json::Value::Number(val.into())
                            } else if let Ok(val) = row.try_get::<f64, _>(i) {
                                serde_json::Value::Number(
                                    serde_json::Number::from_f64(val).unwrap_or(serde_json::Number::from(0))
                                )
                            } else if let Ok(val) = row.try_get::<String, _>(i) {
                                serde_json::Value::String(val)
                            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
                                match String::from_utf8(bytes) {
                                    Ok(s) => serde_json::Value::String(s),
                                    Err(_) => serde_json::Value::Null,
                                }
                            } else {
                                serde_json::Value::Null
                            }
                        }
                    } else {
                        // For boolean columns only
                        if let Ok(val) = row.try_get::<bool, _>(i) {
                            serde_json::Value::Bool(val)
                        } else {
                            serde_json::Value::Null
                        }
                    };
                    obj.insert(col.name.clone(), value.clone());

                    // Log first column of first row to help identify the row
                    if row_idx == 0 && i == 0 {
                        tracing::info!("Row 0: First column '{}' = {:?}", col.name, value);
                    }
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
    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let start = std::time::Instant::now();

        let mut q = sqlx::query(sql);
        for p in params {
            q = crate::db::bind::bind_mysql(q, p);
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
                q = crate::db::bind::bind_mysql(q, p);
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

        let rows = sqlx::query("SHOW DATABASES")
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
        // MySQL doesn't have schemas like PostgreSQL
        // Return empty or the database name itself
        Ok(vec![])
    }

    async fn get_tables(
        &self,
        database: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        // TABLE_ROWS is information_schema's fast/approximate row estimate for
        // InnoDB (exact for MyISAM). Good enough for the explorer; never a slow
        // COUNT(*) scan.
        let rows = sqlx::query(
            "SELECT CAST(TABLE_NAME AS CHAR) AS TABLE_NAME,
                    CAST(TABLE_TYPE AS CHAR) AS TABLE_TYPE,
                    TABLE_ROWS AS TABLE_ROWS
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?",
        )
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            tracing::error!("Query error: {}", e);
            DriverError::QueryError(e.to_string())
        })?;

        tracing::info!("Got {} rows from query", rows.len());

        let tables: Vec<TableInfo> = rows
            .iter()
            .filter_map(|row| {
                match (row.try_get::<String, _>("TABLE_NAME"), row.try_get::<String, _>("TABLE_TYPE")) {
                    (Ok(name), Ok(table_type)) => {
                        tracing::info!("Found table: {} ({})", name, table_type);
                        let row_count: Option<i64> = row.try_get::<Option<i64>, _>("TABLE_ROWS").ok().flatten();
                        Some(TableInfo {
                            name,
                            schema: None,
                            table_type,
                            row_count,
                        })
                    }
                    (Err(e1), _) => {
                        tracing::error!("Failed to get TABLE_NAME: {}", e1);
                        None
                    }
                    (_, Err(e2)) => {
                        tracing::error!("Failed to get TABLE_TYPE: {}", e2);
                        None
                    }
                }
            })
            .collect();

        tracing::info!("Returning {} tables", tables.len());
        Ok(tables)
    }

    async fn get_columns(
        &self,
        database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<ColumnDefinition>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let query = format!(
            "SELECT CAST(COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    CAST(DATA_TYPE AS CHAR) AS DATA_TYPE,
                    CAST(COLUMN_TYPE AS CHAR) AS COLUMN_TYPE,
                    CAST(IS_NULLABLE AS CHAR) AS IS_NULLABLE,
                    CAST(COLUMN_DEFAULT AS CHAR) AS COLUMN_DEFAULT,
                    CAST(COLUMN_KEY AS CHAR) AS COLUMN_KEY,
                    CAST(EXTRA AS CHAR) AS EXTRA,
                    CAST(COLUMN_COMMENT AS CHAR) AS COLUMN_COMMENT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'
             ORDER BY ORDINAL_POSITION",
            database, table
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
                let column_type: String = row.try_get(2).ok()?;
                let nullable: String = row.try_get(3).ok()?;
                let default_value: Option<String> = row.try_get(4).ok();
                let column_key: String = row.try_get(5).ok()?;
                let extra: String = row.try_get(6).ok()?;
                let comment: Option<String> = row.try_get(7).ok();

                Some(ColumnDefinition {
                    name,
                    data_type,
                    full_type: Some(column_type),
                    nullable: nullable == "YES",
                    default_value,
                    is_primary_key: column_key == "PRI",
                    is_unique: column_key == "UNI",
                    is_auto_increment: extra.contains("auto_increment"),
                    comment,
                })
            })
            .collect();

        Ok(columns)
    }

    async fn get_view_definition(
        &self,
        database: &str,
        view: &str,
        _schema: Option<&str>,
    ) -> Result<String, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        // MySQL's "schema" is the database; information_schema.VIEWS gives the
        // bare SELECT body without needing to parse SHOW CREATE VIEW output.
        let row = sqlx::query(
            "SELECT CAST(VIEW_DEFINITION AS CHAR) AS VIEW_DEFINITION
             FROM information_schema.VIEWS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(database)
        .bind(view)
        .fetch_optional(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        match row {
            Some(row) => row
                .try_get::<String, _>(0)
                .map_err(|e| DriverError::QueryError(e.to_string())),
            None => Err(DriverError::QueryError(format!(
                "View '{}' not found in database '{}'",
                view, database
            ))),
        }
    }

    async fn get_indexes(
        &self,
        database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<IndexInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let query = format!(
            "SELECT CAST(INDEX_NAME AS CHAR) AS INDEX_NAME,
                    CAST(COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    NON_UNIQUE,
                    CAST(INDEX_TYPE AS CHAR) AS INDEX_TYPE
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'
             ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            database, table
        );

        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // Group by index name
        let mut index_map: std::collections::HashMap<String, IndexInfo> =
            std::collections::HashMap::new();

        for row in rows.iter() {
            let index_name: String = row.try_get(0).unwrap_or_default();
            let column_name: String = row.try_get(1).unwrap_or_default();
            let non_unique: i32 = row.try_get(2).unwrap_or(1);
            let index_type: String = row.try_get(3).unwrap_or_default();

            let entry = index_map.entry(index_name.clone()).or_insert(IndexInfo {
                name: index_name.clone(),
                columns: vec![],
                is_unique: non_unique == 0,
                is_primary: index_name == "PRIMARY",
                index_type: Some(index_type),
            });
            entry.columns.push(column_name);
        }

        Ok(index_map.into_values().collect())
    }

    async fn get_foreign_keys(
        &self,
        database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<ForeignKeyInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let query = format!(
            "SELECT CAST(kcu.CONSTRAINT_NAME AS CHAR) AS CONSTRAINT_NAME,
                    CAST(kcu.COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    CAST(kcu.REFERENCED_TABLE_NAME AS CHAR) AS REFERENCED_TABLE_NAME,
                    CAST(kcu.REFERENCED_COLUMN_NAME AS CHAR) AS REFERENCED_COLUMN_NAME,
                    CAST(rc.DELETE_RULE AS CHAR) AS DELETE_RULE,
                    CAST(rc.UPDATE_RULE AS CHAR) AS UPDATE_RULE
             FROM information_schema.KEY_COLUMN_USAGE kcu
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
             WHERE kcu.TABLE_SCHEMA = '{}' AND kcu.TABLE_NAME = '{}'
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
            database, table
        );

        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // Group by constraint name
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

    /// Batched ERD introspection: two database-wide queries (all columns, all
    /// FKs) grouped in Rust, instead of 2 round-trips per table. The
    /// `information_schema.KEY_COLUMN_USAGE`/`REFERENTIAL_CONSTRAINTS` join is
    /// expensive in MySQL, so collapsing 2N of them into 2 is the bulk of the
    /// ERD-generate speedup on large schemas.
    async fn get_schema_graph(
        &self,
        database: &str,
        _schema: Option<&str>,
        tables: &[String],
    ) -> Result<Vec<TableGraph>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let want: std::collections::HashSet<&str> = tables.iter().map(|s| s.as_str()).collect();

        // 1) Every column in the database, ordered so each table's columns stay
        //    in ordinal order; we group + filter to the requested tables below.
        let col_rows = sqlx::query(
            "SELECT CAST(TABLE_NAME AS CHAR) AS TABLE_NAME,
                    CAST(COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    CAST(DATA_TYPE AS CHAR) AS DATA_TYPE,
                    CAST(COLUMN_TYPE AS CHAR) AS COLUMN_TYPE,
                    CAST(IS_NULLABLE AS CHAR) AS IS_NULLABLE,
                    CAST(COLUMN_DEFAULT AS CHAR) AS COLUMN_DEFAULT,
                    CAST(COLUMN_KEY AS CHAR) AS COLUMN_KEY,
                    CAST(EXTRA AS CHAR) AS EXTRA,
                    CAST(COLUMN_COMMENT AS CHAR) AS COLUMN_COMMENT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ?
             ORDER BY TABLE_NAME, ORDINAL_POSITION",
        )
        .bind(database)
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
            let column_type: String = row.try_get(3).unwrap_or_default();
            let nullable: String = row.try_get(4).unwrap_or_default();
            let default_value: Option<String> = row.try_get(5).ok();
            let column_key: String = row.try_get(6).unwrap_or_default();
            let extra: String = row.try_get(7).unwrap_or_default();
            let comment: Option<String> = row.try_get(8).ok();

            columns_by_table
                .entry(table)
                .or_default()
                .push(ColumnDefinition {
                    name,
                    data_type,
                    full_type: Some(column_type),
                    nullable: nullable == "YES",
                    default_value,
                    is_primary_key: column_key == "PRI",
                    is_unique: column_key == "UNI",
                    is_auto_increment: extra.contains("auto_increment"),
                    comment,
                });
        }

        // 2) Every index in the database (single STATISTICS pass).
        let idx_rows = sqlx::query(
            "SELECT CAST(TABLE_NAME AS CHAR) AS TABLE_NAME,
                    CAST(INDEX_NAME AS CHAR) AS INDEX_NAME,
                    CAST(COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    NON_UNIQUE,
                    CAST(INDEX_TYPE AS CHAR) AS INDEX_TYPE
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = ?
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        )
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // table -> (index_name -> IndexInfo), so multi-column indexes accumulate.
        let mut idx_by_table: std::collections::HashMap<
            String,
            std::collections::HashMap<String, IndexInfo>,
        > = std::collections::HashMap::new();
        for row in idx_rows.iter() {
            let table: String = row.try_get(0).unwrap_or_default();
            if !want.contains(table.as_str()) {
                continue;
            }
            let index_name: String = row.try_get(1).unwrap_or_default();
            let column_name: String = row.try_get(2).unwrap_or_default();
            let non_unique: i32 = row.try_get(3).unwrap_or(1);
            let index_type: String = row.try_get(4).unwrap_or_default();

            let entry = idx_by_table
                .entry(table)
                .or_default()
                .entry(index_name.clone())
                .or_insert(IndexInfo {
                    name: index_name.clone(),
                    columns: vec![],
                    is_unique: non_unique == 0,
                    is_primary: index_name == "PRIMARY",
                    index_type: Some(index_type),
                });
            entry.columns.push(column_name);
        }

        // 3) Every foreign key in the database (single KCU⨝RC pass).
        let fk_rows = sqlx::query(
            "SELECT CAST(kcu.TABLE_NAME AS CHAR) AS TABLE_NAME,
                    CAST(kcu.CONSTRAINT_NAME AS CHAR) AS CONSTRAINT_NAME,
                    CAST(kcu.COLUMN_NAME AS CHAR) AS COLUMN_NAME,
                    CAST(kcu.REFERENCED_TABLE_NAME AS CHAR) AS REFERENCED_TABLE_NAME,
                    CAST(kcu.REFERENCED_COLUMN_NAME AS CHAR) AS REFERENCED_COLUMN_NAME,
                    CAST(rc.DELETE_RULE AS CHAR) AS DELETE_RULE,
                    CAST(rc.UPDATE_RULE AS CHAR) AS UPDATE_RULE
             FROM information_schema.KEY_COLUMN_USAGE kcu
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
             WHERE kcu.TABLE_SCHEMA = ?
               AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        )
        .bind(database)
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // table -> (constraint_name -> FK), so multi-column FKs accumulate.
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

        // Assemble in the caller's requested order.
        let out = tables
            .iter()
            .map(|name| TableGraph {
                name: name.clone(),
                schema: None,
                columns: columns_by_table.remove(name).unwrap_or_default(),
                indexes: idx_by_table
                    .remove(name)
                    .map(|m| m.into_values().collect())
                    .unwrap_or_default(),
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
        database: &str,
        table: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        // information_schema.TRIGGERS holds one row per trigger (timing+event are
        // single-valued in MySQL, so no merging is needed).
        let rows = match table {
            Some(t) => sqlx::query(
                "SELECT CAST(TRIGGER_NAME AS CHAR) AS TRIGGER_NAME,
                        CAST(EVENT_OBJECT_TABLE AS CHAR) AS EVENT_OBJECT_TABLE,
                        CAST(ACTION_TIMING AS CHAR) AS ACTION_TIMING,
                        CAST(EVENT_MANIPULATION AS CHAR) AS EVENT_MANIPULATION,
                        CAST(ACTION_STATEMENT AS CHAR) AS ACTION_STATEMENT
                 FROM information_schema.TRIGGERS
                 WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
                 ORDER BY TRIGGER_NAME",
            )
            .bind(database)
            .bind(t)
            .fetch_all(pool)
            .await,
            None => sqlx::query(
                "SELECT CAST(TRIGGER_NAME AS CHAR) AS TRIGGER_NAME,
                        CAST(EVENT_OBJECT_TABLE AS CHAR) AS EVENT_OBJECT_TABLE,
                        CAST(ACTION_TIMING AS CHAR) AS ACTION_TIMING,
                        CAST(EVENT_MANIPULATION AS CHAR) AS EVENT_MANIPULATION,
                        CAST(ACTION_STATEMENT AS CHAR) AS ACTION_STATEMENT
                 FROM information_schema.TRIGGERS
                 WHERE TRIGGER_SCHEMA = ?
                 ORDER BY TRIGGER_NAME",
            )
            .bind(database)
            .fetch_all(pool)
            .await,
        }
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let triggers = rows
            .iter()
            .filter_map(|row| {
                Some(TriggerInfo {
                    name: row.try_get::<String, _>("TRIGGER_NAME").ok()?,
                    table: row.try_get::<String, _>("EVENT_OBJECT_TABLE").ok()?,
                    timing: row.try_get::<String, _>("ACTION_TIMING").ok(),
                    event: row.try_get::<String, _>("EVENT_MANIPULATION").ok(),
                    statement: row
                        .try_get::<String, _>("ACTION_STATEMENT")
                        .unwrap_or_default(),
                    schema: Some(database.to_string()),
                })
            })
            .collect();

        Ok(triggers)
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
            Dialect::MySql,
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

        Ok(rows.iter().map(mysql_row_to_json).collect())
    }
}

/// Best-effort scalar conversion of a MySQL row to a JSON map. Used by the FK
/// lookup, whose value/label columns are simple display columns.
fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow) -> serde_json::Map<String, serde_json::Value> {
    let mut obj = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let value = if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            v.map(|n| serde_json::Value::Number(n.into()))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            v.and_then(serde_json::Number::from_f64)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
            String::from_utf8(bytes)
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };
        obj.insert(name, value);
    }
    obj
}

/// Build a parameterized DISTINCT lookup SELECT for the FK dropdown.
/// Identifiers are quoted via `quote_ident`; the search value is bound (one
/// placeholder per label column), never interpolated. Postgres uses `$1..`,
/// MySQL/SQLite use `?`.
pub(crate) fn build_fk_lookup_sql(
    dialect: Dialect,
    table: &str,
    value_column: &str,
    label_columns: &[String],
    has_search: bool,
    limit: i64,
) -> String {
    let q = |n: &str| quote_ident(dialect, n);

    let mut select_cols = vec![q(value_column)];
    for l in label_columns {
        if l != value_column {
            select_cols.push(q(l));
        }
    }

    let mut sql = format!(
        "SELECT DISTINCT {} FROM {}",
        select_cols.join(", "),
        q(table)
    );

    if has_search && !label_columns.is_empty() {
        let mut idx = 1;
        let conds: Vec<String> = label_columns
            .iter()
            .map(|l| {
                let placeholder = match dialect {
                    Dialect::Postgres => {
                        let p = format!("${}", idx);
                        idx += 1;
                        p
                    }
                    _ => "?".to_string(),
                };
                // CAST so non-text label columns still match a LIKE pattern.
                match dialect {
                    Dialect::MySql => format!("CAST({} AS CHAR) LIKE {}", q(l), placeholder),
                    Dialect::Postgres => format!("CAST({} AS text) LIKE {}", q(l), placeholder),
                    Dialect::Sqlite => format!("CAST({} AS TEXT) LIKE {}", q(l), placeholder),
                }
            })
            .collect();
        sql.push_str(&format!(" WHERE ({})", conds.join(" OR ")));
    }

    sql.push_str(&format!(" ORDER BY {} LIMIT {}", q(value_column), limit));
    sql
}

#[cfg(test)]
mod tests {
    use super::MySqlDriver;
    use crate::db::driver::DatabaseDriver;

    // Integration regression test for the DECIMAL-decoded-as-NULL bug.
    // Requires a live MySQL; skips (passes) unless ANSQL_TEST_MYSQL_HOST is set, so
    // the SQLite-only default test run is unaffected. Run with, e.g.:
    //   ANSQL_TEST_MYSQL_HOST=127.0.0.1 ANSQL_TEST_MYSQL_PORT=33306 \
    //   ANSQL_TEST_MYSQL_USER=testuser ANSQL_TEST_MYSQL_PASS=testpass ANSQL_TEST_MYSQL_DB=testdb \
    //   cargo test -p ansql decimal_not_null_column_reads_back_as_value -- --nocapture
    #[tokio::test]
    async fn decimal_not_null_column_reads_back_as_value() {
        let host = match std::env::var("ANSQL_TEST_MYSQL_HOST") {
            Ok(h) => h,
            Err(_) => {
                eprintln!("skipping: ANSQL_TEST_MYSQL_HOST not set");
                return;
            }
        };
        let port: u16 = std::env::var("ANSQL_TEST_MYSQL_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3306);
        let user = std::env::var("ANSQL_TEST_MYSQL_USER").unwrap_or_else(|_| "root".into());
        let pass = std::env::var("ANSQL_TEST_MYSQL_PASS").unwrap_or_default();
        let db = std::env::var("ANSQL_TEST_MYSQL_DB").unwrap_or_else(|_| "test".into());

        let mut drv = MySqlDriver::new(host, port, user, pass, Some(db), None);
        drv.connect().await.expect("connect to test MySQL");

        drv.execute("DROP TABLE IF EXISTS ansql_numtest").await.unwrap();
        drv.execute(
            "CREATE TABLE ansql_numtest (id INT PRIMARY KEY, amount DECIMAL(20,4) NOT NULL)",
        )
        .await
        .unwrap();
        // Fractional, high-magnitude value f64 would round — proves exact decode.
        drv.execute("INSERT INTO ansql_numtest (id, amount) VALUES (1, 1234567890.1234)")
            .await
            .unwrap();

        let res = drv
            .execute("SELECT id, amount FROM ansql_numtest WHERE id = 1")
            .await
            .unwrap();

        assert_eq!(res.rows.len(), 1);
        let amount = res.rows[0].get("amount").expect("amount column present");
        assert!(
            !amount.is_null(),
            "DECIMAL column decoded as NULL (the bug); got {amount:?}"
        );
        assert_eq!(
            amount,
            &serde_json::Value::String("1234567890.1234".to_string()),
            "expected exact decimal string, got {amount:?}"
        );

        drv.execute("DROP TABLE IF EXISTS ansql_numtest").await.ok();
    }
}
