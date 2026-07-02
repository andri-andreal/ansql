pub mod type_map;
pub mod dialect;
pub mod ddl;
pub mod plan;
pub mod engine;
pub mod rows;

use serde::{Deserialize, Serialize};

/// SQL dialect of a database engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dialect {
    MySql,
    Postgres,
    Sqlite,
}

impl Dialect {
    /// Map a connection `driver` string (as stored in connections) to a Dialect.
    pub fn from_driver(driver: &str) -> Option<Dialect> {
        match driver {
            "mysql" => Some(Dialect::MySql),
            "postgres" => Some(Dialect::Postgres),
            "sqlite" => Some(Dialect::Sqlite),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictMode {
    Drop,
    Truncate,
    Append,
    Skip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorPolicy {
    StopOnError,
    TableAtomicContinue,
    SkipRowContinue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferJob {
    pub source_table: String,
    pub source_schema: Option<String>,
    pub target_db: String,
    pub target_schema: Option<String>,
    pub target_table: String,
    pub conflict: ConflictMode,
    /// When set, rows come from this SELECT instead of `source_table`.
    /// Indexes/FKs are skipped for query sources.
    #[serde(default)]
    pub source_query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferOptions {
    pub copy_structure: bool,
    pub copy_data: bool,
    pub copy_indexes: bool,
    pub copy_fks: bool,
    pub batch_size: usize,
    pub error_policy: ErrorPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableResult {
    pub table: String,
    pub status: String, // "success" | "failed" | "skipped"
    pub rows_copied: u64,
    pub skipped: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransferReport {
    pub tables: Vec<TableResult>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TablePreview {
    pub table: String,
    pub ddl: String,
    pub sample_insert: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub table: String,
    pub phase: String, // "structure" | "data" | "indexes" | "fks" | "done"
    pub rows_done: u64,
    pub rows_total: u64,
}
