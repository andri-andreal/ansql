use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: String,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    /// The sized/declared form of the type when the driver can determine it,
    /// e.g. `varchar(500)`, `decimal(18,4)`, `int unsigned`. Unlike `data_type`
    /// (kept as a bare type for transfer-engine compatibility), this preserves
    /// length/precision/scale so callers like the Table Designer don't truncate.
    #[serde(default)]
    pub full_type: Option<String>,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

/// Batched ERD payload: one table with its columns + foreign keys, fetched in a
/// single pass so the ER diagram doesn't issue N+1 introspection round-trips
/// (one `get_columns` + one `get_foreign_keys` per table) on large schemas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableGraph {
    pub name: String,
    pub schema: Option<String>,
    pub columns: Vec<ColumnDefinition>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub table: String,
    /// BEFORE / AFTER / INSTEAD OF (best-effort for SQLite).
    pub timing: Option<String>,
    /// INSERT / UPDATE / DELETE (may be a merged list, e.g. "INSERT, UPDATE").
    pub event: Option<String>,
    /// The trigger body / action statement (full CREATE TRIGGER sql for SQLite).
    pub statement: String,
    pub schema: Option<String>,
}

/// SSL/TLS connection options shared by the MySQL and Postgres drivers.
/// `mode` accepts the cross-engine vocabulary `disable|prefer|require|verify-ca|verify-full`;
/// each driver maps it onto its own sqlx ssl-mode enum.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SslOptions {
    pub mode: Option<String>, // disable|prefer|require|verify-ca|verify-full
    pub ca_path: Option<String>,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum DriverError {
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("Query error: {0}")]
    QueryError(String),
    #[error("Not connected")]
    NotConnected,
    /// Reserved for engines to reject unsupported operations. Part of the
    /// `DriverError` API surface; not yet raised by any driver.
    #[allow(dead_code)]
    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Connect to the database
    async fn connect(&mut self) -> Result<(), DriverError>;

    /// Disconnect from the database
    async fn disconnect(&mut self) -> Result<(), DriverError>;

    /// Test the connection
    async fn test_connection(&self) -> Result<bool, DriverError>;

    /// Execute a query and return results
    async fn execute(&self, query: &str) -> Result<QueryResult, DriverError>;

    /// Execute a single parameterized statement. Values are bound (never
    /// string-interpolated); NULLs are passed as SQL literals by the caller.
    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<QueryResult, DriverError>;

    /// Execute many `(sql, params)` statements inside a single transaction.
    /// Any error rolls the whole batch back. Returns one affected-row result
    /// per statement.
    async fn commit_batch(
        &self,
        statements: &[(String, Vec<serde_json::Value>)],
    ) -> Result<Vec<QueryResult>, DriverError>;

    /// Get list of databases
    async fn get_databases(&self) -> Result<Vec<String>, DriverError>;

    /// Get list of schemas in a database
    #[allow(dead_code)]
    async fn get_schemas(&self, database: &str) -> Result<Vec<String>, DriverError>;

    /// Get list of tables in a database/schema
    async fn get_tables(&self, database: &str, schema: Option<&str>) -> Result<Vec<TableInfo>, DriverError>;

    /// Get column definitions for a table
    async fn get_columns(&self, database: &str, table: &str, schema: Option<&str>) -> Result<Vec<ColumnDefinition>, DriverError>;

    /// Get indexes for a table
    async fn get_indexes(&self, database: &str, table: &str, schema: Option<&str>) -> Result<Vec<IndexInfo>, DriverError>;

    /// Get foreign keys for a table
    async fn get_foreign_keys(&self, database: &str, table: &str, schema: Option<&str>) -> Result<Vec<ForeignKeyInfo>, DriverError>;

    /// Batched introspection for the ER diagram + schema-snapshot/sync/export:
    /// returns columns, indexes and foreign keys for the given `tables` (bare
    /// names) in `database`/`schema`. The default implementation falls back to
    /// per-table `get_columns`/`get_indexes`/`get_foreign_keys` calls; drivers
    /// override it with a few schema-wide queries so a 100-table schema costs a
    /// handful of round-trips instead of ~300.
    async fn get_schema_graph(
        &self,
        database: &str,
        schema: Option<&str>,
        tables: &[String],
    ) -> Result<Vec<TableGraph>, DriverError> {
        let mut out = Vec::with_capacity(tables.len());
        for name in tables {
            let columns = self.get_columns(database, name, schema).await?;
            let indexes = self.get_indexes(database, name, schema).await?;
            let foreign_keys = self.get_foreign_keys(database, name, schema).await?;
            out.push(TableGraph {
                name: name.clone(),
                schema: schema.map(|s| s.to_string()),
                columns,
                indexes,
                foreign_keys,
            });
        }
        Ok(out)
    }

    /// Get the SELECT definition (or full CREATE VIEW, per dialect) for a view
    async fn get_view_definition(&self, database: &str, view: &str, schema: Option<&str>) -> Result<String, DriverError>;

    /// Get triggers for a database (optionally narrowed to a single table).
    /// Defaults to an empty list so a driver without trigger support never
    /// breaks the explorer.
    async fn get_triggers(
        &self,
        _database: &str,
        _table: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<TriggerInfo>, DriverError> {
        Ok(vec![])
    }

    /// Lookup distinct (value, label...) rows from a referenced table, for the
    /// data-grid foreign-key dropdown. `search` filters case-insensitively
    /// across the label columns. Defaults to an empty list.
    async fn get_fk_lookup(
        &self,
        _database: &str,
        _schema: Option<&str>,
        _table: &str,
        _value_column: &str,
        _label_columns: &[String],
        _search: Option<&str>,
        _limit: i64,
    ) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, DriverError> {
        Ok(vec![])
    }
}
