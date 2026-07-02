use async_trait::async_trait;
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Column, Row, SqlitePool};
use std::str::FromStr;

use super::driver::{
    ColumnDefinition, ColumnInfo, DatabaseDriver, DriverError, ForeignKeyInfo, IndexInfo,
    QueryResult, TableInfo, TriggerInfo,
};
use super::mysql::build_fk_lookup_sql;
use crate::transfer::dialect::quote_ident;
use crate::transfer::Dialect;

pub struct SqliteDriver {
    pool: Option<SqlitePool>,
    database_path: String,
    create_if_missing: bool,
}

impl SqliteDriver {
    pub fn new(database_path: String) -> Self {
        Self {
            pool: None,
            database_path,
            create_if_missing: false,
        }
    }

    /// Allow `connect` to create the database file if it does not exist. Off by
    /// default so the interactive "open database" flow still errors on a bad path;
    /// exercised by the data-transfer engine's tests when materializing a fresh
    /// target file.
    #[allow(dead_code)]
    pub fn create_if_missing(mut self, yes: bool) -> Self {
        self.create_if_missing = yes;
        self
    }

    fn connection_string(&self) -> String {
        format!("sqlite:{}", self.database_path)
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn connect(&mut self) -> Result<(), DriverError> {
        let connect_opts = SqliteConnectOptions::from_str(&self.connection_string())
            .map_err(|e| DriverError::ConnectionError(e.to_string()))?
            .create_if_missing(self.create_if_missing);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(connect_opts)
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
        Ok(rows_to_result(rows, execution_time_ms))
    }

    /// Run a single parameterized statement. Intended for mutations
    /// (INSERT/UPDATE/DELETE) — returns affected rows, not a result set.
    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;
        let start = std::time::Instant::now();

        let mut q = sqlx::query(sql);
        for p in params {
            q = crate::db::bind::bind_sqlite(q, p);
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
                q = crate::db::bind::bind_sqlite(q, p);
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
        // SQLite is a single-file database, so return the database path as the only "database"
        Ok(vec![self.database_path.clone()])
    }

    async fn get_schemas(&self, _database: &str) -> Result<Vec<String>, DriverError> {
        // SQLite doesn't have schemas
        Ok(vec!["main".to_string()])
    }

    async fn get_tables(
        &self,
        _database: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<TableInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let rows = sqlx::query(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut tables: Vec<TableInfo> = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get(0).ok()?;
                let table_type: String = row.try_get(1).ok()?;
                Some(TableInfo {
                    name,
                    schema: Some("main".to_string()),
                    table_type: table_type.to_uppercase(),
                    row_count: None,
                })
            })
            .collect();

        // SQLite is a local file, so an exact COUNT(*) is cheap. Best-effort:
        // a failure on any one table leaves its row_count as None rather than
        // failing the whole listing. Views are skipped.
        for table in tables.iter_mut() {
            if table.table_type == "VIEW" {
                continue;
            }
            let count_sql = format!("SELECT COUNT(*) FROM {}", quote_ident(Dialect::Sqlite, &table.name));
            if let Ok(row) = sqlx::query(&count_sql).fetch_one(pool).await {
                if let Ok(c) = row.try_get::<i64, _>(0) {
                    table.row_count = Some(c);
                }
            }
        }

        Ok(tables)
    }

    async fn get_columns(
        &self,
        _database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<ColumnDefinition>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let query = format!("PRAGMA table_info('{}')", table.replace('\'', "''"));
        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let columns: Vec<ColumnDefinition> = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get(1).ok()?;
                let data_type: String = row.try_get(2).ok()?;
                let notnull: i32 = row.try_get(3).unwrap_or(0);
                let default_value: Option<String> = row.try_get(4).ok();
                let pk: i32 = row.try_get(5).unwrap_or(0);
                let is_auto_increment = pk > 0 && data_type.to_uppercase() == "INTEGER";

                Some(ColumnDefinition {
                    name,
                    // PRAGMA table_info's `type` is the declared (sized) type,
                    // e.g. `VARCHAR(500)` / `DECIMAL(18,4)`.
                    full_type: Some(data_type.clone()),
                    data_type,
                    nullable: notnull == 0,
                    default_value,
                    is_primary_key: pk > 0,
                    is_unique: false, // Would need separate query
                    is_auto_increment,
                    comment: None,
                })
            })
            .collect();

        Ok(columns)
    }

    async fn get_view_definition(
        &self,
        _database: &str,
        view: &str,
        _schema: Option<&str>,
    ) -> Result<String, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        // SQLite stores the full `CREATE VIEW ...` statement; return it as-is.
        let row = sqlx::query(
            "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?",
        )
        .bind(view)
        .fetch_optional(pool)
        .await
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        match row {
            Some(row) => row
                .try_get::<String, _>(0)
                .map_err(|e| DriverError::QueryError(e.to_string())),
            None => Err(DriverError::QueryError(format!(
                "View '{}' not found",
                view
            ))),
        }
    }

    async fn get_indexes(
        &self,
        _database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<IndexInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        // Get index list
        let query = format!("PRAGMA index_list('{}')", table.replace('\'', "''"));
        let index_rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let mut indexes = Vec::new();

        for index_row in index_rows.iter() {
            let index_name: String = index_row.try_get(1).unwrap_or_default();
            let is_unique: i32 = index_row.try_get(2).unwrap_or(0);
            let origin: String = index_row.try_get(3).unwrap_or_default();

            // Get columns for this index
            let col_query = format!("PRAGMA index_info('{}')", index_name.replace('\'', "''"));
            let col_rows = sqlx::query(&col_query)
                .fetch_all(pool)
                .await
                .map_err(|e| DriverError::QueryError(e.to_string()))?;

            let columns: Vec<String> = col_rows
                .iter()
                .filter_map(|row| row.try_get::<String, _>(2).ok())
                .collect();

            indexes.push(IndexInfo {
                name: index_name,
                columns,
                is_unique: is_unique == 1,
                is_primary: origin == "pk",
                index_type: None,
            });
        }

        Ok(indexes)
    }

    async fn get_foreign_keys(
        &self,
        _database: &str,
        table: &str,
        _schema: Option<&str>,
    ) -> Result<Vec<ForeignKeyInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let query = format!("PRAGMA foreign_key_list('{}')", table.replace('\'', "''"));
        let rows = sqlx::query(&query)
            .fetch_all(pool)
            .await
            .map_err(|e| DriverError::QueryError(e.to_string()))?;

        // Group by id (foreign key id)
        let mut fk_map: std::collections::HashMap<i32, ForeignKeyInfo> =
            std::collections::HashMap::new();

        for row in rows.iter() {
            let id: i32 = row.try_get(0).unwrap_or(0);
            let ref_table: String = row.try_get(2).unwrap_or_default();
            let from_col: String = row.try_get(3).unwrap_or_default();
            let to_col: String = row.try_get(4).unwrap_or_default();
            let on_update: String = row.try_get(5).unwrap_or_default();
            let on_delete: String = row.try_get(6).unwrap_or_default();

            let entry = fk_map.entry(id).or_insert(ForeignKeyInfo {
                name: format!("fk_{}_{}", table, id),
                columns: vec![],
                referenced_table: ref_table,
                referenced_columns: vec![],
                on_delete: Some(on_delete),
                on_update: Some(on_update),
            });
            entry.columns.push(from_col);
            entry.referenced_columns.push(to_col);
        }

        Ok(fk_map.into_values().collect())
    }

    async fn get_triggers(
        &self,
        _database: &str,
        table: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, DriverError> {
        let pool = self.pool.as_ref().ok_or(DriverError::NotConnected)?;

        let rows = match table {
            Some(t) => sqlx::query(
                "SELECT name, tbl_name, sql FROM sqlite_master
                 WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
            )
            .bind(t)
            .fetch_all(pool)
            .await,
            None => sqlx::query(
                "SELECT name, tbl_name, sql FROM sqlite_master
                 WHERE type = 'trigger' ORDER BY name",
            )
            .fetch_all(pool)
            .await,
        }
        .map_err(|e| DriverError::QueryError(e.to_string()))?;

        let triggers = rows
            .iter()
            .filter_map(|row| {
                let name: String = row.try_get(0).ok()?;
                let tbl: String = row.try_get(1).ok()?;
                let sql: String = row.try_get::<Option<String>, _>(2).ok().flatten().unwrap_or_default();
                let (timing, event) = parse_sqlite_trigger(&sql);
                Some(TriggerInfo {
                    name,
                    table: tbl,
                    timing,
                    event,
                    statement: sql,
                    schema: Some("main".to_string()),
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
            Dialect::Sqlite,
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

        let result = rows_to_result(rows, 0);
        Ok(result.rows)
    }
}

/// Best-effort parse of a SQLite `CREATE TRIGGER` statement to extract the
/// timing (BEFORE/AFTER/INSTEAD OF) and event (INSERT/UPDATE/DELETE). SQLite
/// doesn't expose these as columns, so we scan the stored sql text.
fn parse_sqlite_trigger(sql: &str) -> (Option<String>, Option<String>) {
    let upper = sql.to_uppercase();
    let timing = if upper.contains("INSTEAD OF") {
        Some("INSTEAD OF".to_string())
    } else if upper.contains("BEFORE") {
        Some("BEFORE".to_string())
    } else if upper.contains("AFTER") {
        Some("AFTER".to_string())
    } else {
        None
    };
    let event = if upper.contains("INSERT") {
        Some("INSERT".to_string())
    } else if upper.contains("UPDATE") {
        Some("UPDATE".to_string())
    } else if upper.contains("DELETE") {
        Some("DELETE".to_string())
    } else {
        None
    };
    (timing, event)
}

/// Build a `QueryResult` from fetched SQLite rows. Shared by `execute` and
/// `execute_with_params`.
fn rows_to_result(rows: Vec<sqlx::sqlite::SqliteRow>, execution_time_ms: u64) -> QueryResult {
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
                obj.insert(col.name.clone(), sqlite_value_to_json(row, i));
            }
            obj
        })
        .collect();

    QueryResult {
        columns,
        rows: result_rows,
        affected_rows: None,
        execution_time_ms,
    }
}

/// Convert a SQLite column value to a `serde_json::Value`.
/// SQLite's type affinity means a column may hold NULL, INTEGER, REAL, TEXT, or BLOB.
fn sqlite_value_to_json(row: &sqlx::sqlite::SqliteRow, i: usize) -> serde_json::Value {
    use sqlx::{Row as _, TypeInfo as _};
    use sqlx::ValueRef as _;

    let raw = match row.try_get_raw(i) {
        Ok(v) => v,
        Err(_) => return serde_json::Value::Null,
    };

    if raw.is_null() {
        return serde_json::Value::Null;
    }

    let type_info = raw.type_info();
    let type_name = type_info.name();
    match type_name {
        "INTEGER" | "INT" | "BIGINT" | "SMALLINT" | "TINYINT" => {
            if let Ok(v) = row.try_get::<i64, _>(i) {
                serde_json::Value::Number(v.into())
            } else {
                serde_json::Value::Null
            }
        }
        "REAL" | "FLOAT" | "DOUBLE" | "NUMERIC" | "DECIMAL" => {
            if let Ok(v) = row.try_get::<f64, _>(i) {
                serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            }
        }
        "BOOLEAN" | "BOOL" => {
            if let Ok(v) = row.try_get::<bool, _>(i) {
                serde_json::Value::Bool(v)
            } else {
                serde_json::Value::Null
            }
        }
        "BLOB" => {
            if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                // Encode blobs as base64 strings for JSON transport.
                use base64::Engine as _;
                serde_json::Value::String(base64::engine::general_purpose::STANDARD.encode(&v))
            } else {
                serde_json::Value::Null
            }
        }
        _ => {
            // TEXT and all other affinities: fall back to a string, with numeric
            // attempts first in case a driver reports an unexpected affinity name.
            if let Ok(v) = row.try_get::<i64, _>(i) {
                serde_json::Value::Number(v.into())
            } else if let Ok(v) = row.try_get::<f64, _>(i) {
                serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null)
            } else if let Ok(v) = row.try_get::<String, _>(i) {
                serde_json::Value::String(v)
            } else {
                serde_json::Value::Null
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn mem_driver() -> SqliteDriver {
        let mut d = SqliteDriver::new(":memory:".into());
        d.connect().await.unwrap();
        d.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, ok BOOLEAN)")
            .await
            .unwrap();
        d
    }

    #[tokio::test]
    async fn params_bind_by_type_and_escape_safely() {
        let d = mem_driver().await;
        // A value with a quote + backslash that would break naive string SQL.
        d.execute_with_params(
            "INSERT INTO t (id, name, qty, ok) VALUES (?, ?, ?, ?)",
            &[json!(1), json!("O'Brien \\ x"), json!(7), json!(true)],
        )
        .await
        .unwrap();
        let r = d
            .execute("SELECT name, qty FROM t WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(r.rows[0]["name"], json!("O'Brien \\ x"));
        assert_eq!(r.rows[0]["qty"], json!(7));
    }

    #[tokio::test]
    async fn commit_batch_rolls_back_on_error() {
        let d = mem_driver().await;
        d.execute("INSERT INTO t (id, name) VALUES (1, 'a')")
            .await
            .unwrap();
        let res = d
            .commit_batch(&[
                (
                    "UPDATE t SET name = ? WHERE id = ?".into(),
                    vec![json!("b"), json!(1)],
                ),
                ("INSERT INTO t (id) VALUES (1)".into(), vec![]), // PK conflict -> error
            ])
            .await;
        assert!(res.is_err());
        // First update must have been rolled back.
        let r = d
            .execute("SELECT name FROM t WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(r.rows[0]["name"], json!("a"));
    }

    #[tokio::test]
    async fn commit_batch_commits_all_on_success() {
        let d = mem_driver().await;
        let res = d
            .commit_batch(&[
                (
                    "INSERT INTO t (id, name, qty) VALUES (?, ?, ?)".into(),
                    vec![json!(1), json!("a"), json!(10)],
                ),
                (
                    "INSERT INTO t (id, name, qty) VALUES (?, ?, ?)".into(),
                    vec![json!(2), json!("b"), json!(20)],
                ),
            ])
            .await
            .unwrap();
        assert_eq!(res.len(), 2);
        assert_eq!(res[0].affected_rows, Some(1));
        let r = d.execute("SELECT COUNT(*) AS c FROM t").await.unwrap();
        assert_eq!(r.rows[0]["c"], json!(2));
    }
}
