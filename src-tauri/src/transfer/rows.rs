//! Row-snapshot transfer: insert an explicit set of clipboard rows into a target
//! table using parameterized statements (never literal-escaped), with optional
//! "create table from inferred types" when the target table is missing.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::driver::{DatabaseDriver, DriverError};
use crate::transfer::dialect::quote_ident;
use crate::transfer::type_map::{self, CanonicalType};
use crate::transfer::{ConflictMode, Dialect, TableResult, TransferReport};

/// A source column carried from the frontend clipboard. `data_type` is the
/// best-effort source type string (empty when the source is a typeless snapshot).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotColumn {
    pub name: String,
    #[serde(default)]
    pub data_type: String,
    #[serde(default)]
    pub nullable: bool,
}

/// One source→target column mapping entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMap {
    pub source: String,
    pub target: String,
}

/// A complete row-snapshot transfer request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowTransfer {
    pub source_dialect: Dialect,
    pub target_schema: Option<String>,
    pub target_table: String,
    pub columns: Vec<SnapshotColumn>,
    /// Row-major values aligned to `columns` (index i ↔ columns[i]).
    pub rows: Vec<Vec<Value>>,
    pub mapping: Vec<ColumnMap>,
    pub conflict: ConflictMode,
    /// Create the target table (inferred types) when it does not exist.
    pub create_if_missing: bool,
    pub batch_size: usize,
}

/// Qualify an identifier with an optional schema for the given dialect.
fn qualified(dialect: Dialect, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(s) if !s.is_empty() => {
            format!("{}.{}", quote_ident(dialect, s), quote_ident(dialect, table))
        }
        _ => quote_ident(dialect, table),
    }
}

/// Dialect-correct placeholder for the n-th (1-based) bound parameter.
fn placeholder(dialect: Dialect, n: usize) -> String {
    match dialect {
        Dialect::Postgres => format!("${}", n),
        _ => "?".to_string(),
    }
}

/// Map source-column name → its index in `columns` / each row.
fn column_index(columns: &[SnapshotColumn]) -> HashMap<String, usize> {
    columns
        .iter()
        .enumerate()
        .map(|(i, c)| (c.name.clone(), i))
        .collect()
}

/// Build one parameterized multi-row INSERT for `chunk`. Returns `(sql, params)`.
/// `params` is flattened row-major; Postgres placeholders run `$1..$N` across
/// the whole statement. A mapped source column missing from a row binds NULL.
pub fn build_insert_chunk(
    dialect: Dialect,
    schema: Option<&str>,
    table: &str,
    mapping: &[ColumnMap],
    col_index: &HashMap<String, usize>,
    chunk: &[Vec<Value>],
) -> (String, Vec<Value>) {
    let target_cols: Vec<String> =
        mapping.iter().map(|m| quote_ident(dialect, &m.target)).collect();
    let mut params: Vec<Value> = Vec::with_capacity(chunk.len() * mapping.len());
    let mut tuples: Vec<String> = Vec::with_capacity(chunk.len());
    let mut n = 0usize;
    for row in chunk {
        let mut phs = Vec::with_capacity(mapping.len());
        for m in mapping {
            let val = col_index
                .get(&m.source)
                .and_then(|&i| row.get(i))
                .cloned()
                .unwrap_or(Value::Null);
            n += 1;
            phs.push(placeholder(dialect, n));
            params.push(val);
        }
        tuples.push(format!("({})", phs.join(", ")));
    }
    let sql = format!(
        "INSERT INTO {} ({}) VALUES {}",
        qualified(dialect, schema, table),
        target_cols.join(", "),
        tuples.join(", ")
    );
    (sql, params)
}

/// First non-null value in the source column `idx` across all rows.
fn first_sample<'a>(rows: &'a [Vec<Value>], idx: usize) -> Option<&'a Value> {
    rows.iter()
        .filter_map(|r| r.get(idx))
        .find(|v| !v.is_null())
}

/// Resolve the canonical type for a mapped column: parse the declared source
/// type if present, else infer from a sample value, else fall back to Text.
fn canonical_for(
    source_dialect: Dialect,
    col: &SnapshotColumn,
    sample: Option<&Value>,
) -> CanonicalType {
    if !col.data_type.trim().is_empty() {
        type_map::parse(source_dialect, &col.data_type)
    } else if let Some(v) = sample {
        type_map::infer_from_value(v)
    } else {
        CanonicalType::Text
    }
}

/// Build `CREATE TABLE IF NOT EXISTS` for the target columns (mapping order).
/// All columns are nullable in v1 (no PK/constraints inferred). Returns
/// `(sql, warnings)`; a warning is added per column whose type maps lossily.
pub fn build_create_table(
    source_dialect: Dialect,
    target_dialect: Dialect,
    schema: Option<&str>,
    table: &str,
    columns: &[SnapshotColumn],
    mapping: &[ColumnMap],
    rows: &[Vec<Value>],
) -> (String, Vec<String>) {
    let idx = column_index(columns);
    let mut defs = Vec::with_capacity(mapping.len());
    let mut warnings = Vec::new();
    for m in mapping {
        let src_pos = idx.get(&m.source).copied();
        let src_col = src_pos.and_then(|i| columns.get(i));
        let sample = src_pos.and_then(|i| first_sample(rows, i));
        let canonical = match src_col {
            Some(c) => canonical_for(source_dialect, c, sample),
            None => CanonicalType::Text,
        };
        if type_map::is_lossy(&canonical) {
            warnings.push(format!(
                "{}.{}: {} → TEXT (lossy)",
                table,
                m.target,
                src_col.map(|c| c.data_type.as_str()).unwrap_or("?")
            ));
        }
        let rendered = type_map::render(&canonical, target_dialect);
        defs.push(format!("{} {}", quote_ident(target_dialect, &m.target), rendered));
    }
    let sql = format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        qualified(target_dialect, schema, table),
        defs.join(", ")
    );
    (sql, warnings)
}

/// Execute a row-snapshot transfer against a connected target driver.
/// DDL (CREATE/DELETE) runs via `execute`; data inserts run via `commit_batch`
/// so all inserted rows are atomic on engines with transactional DML.
pub async fn apply_row_transfer(
    target: &(dyn DatabaseDriver + Send + Sync),
    target_dialect: Dialect,
    t: &RowTransfer,
) -> TransferReport {
    let mut report = TransferReport::default();
    let mut result = TableResult {
        table: t.target_table.clone(),
        status: "success".into(),
        rows_copied: 0,
        skipped: 0,
        error: None,
    };

    if t.mapping.is_empty() {
        result.status = "failed".into();
        result.error = Some("No columns mapped".into());
        report.tables.push(result);
        return report;
    }

    let schema = t.target_schema.as_deref();

    // 1. Optional CREATE TABLE (inferred types).
    if t.create_if_missing {
        let (create_sql, warnings) = build_create_table(
            t.source_dialect,
            target_dialect,
            schema,
            &t.target_table,
            &t.columns,
            &t.mapping,
            &t.rows,
        );
        report.warnings.extend(warnings);
        if let Err(e) = target.execute(&create_sql).await {
            result.status = "failed".into();
            result.error = Some(format!("CREATE TABLE: {}", e));
            report.tables.push(result);
            return report;
        }
        if target_dialect == crate::transfer::Dialect::MySql {
            report.warnings.push(
                "MySQL target: CREATE TABLE auto-commits and cannot be rolled back if inserts fail"
                    .into(),
            );
        }
    }

    // 2. Conflict handling before insert.
    if t.conflict == ConflictMode::Truncate {
        let del = format!("DELETE FROM {}", qualified(target_dialect, schema, &t.target_table));
        if let Err(e) = target.execute(&del).await {
            result.status = "failed".into();
            result.error = Some(format!("TRUNCATE: {}", e));
            report.tables.push(result);
            return report;
        }
    }
    if matches!(t.conflict, ConflictMode::Drop) {
        report.warnings.push(
            "Row-snapshot transfer does not recreate structure; treated as truncate+insert".into(),
        );
        let del = format!("DELETE FROM {}", qualified(target_dialect, schema, &t.target_table));
        if let Err(e) = target.execute(&del).await {
            result.status = "failed".into();
            result.error = Some(format!("DELETE (drop-mode): {}", e));
            report.tables.push(result);
            return report;
        }
    }

    // 3. Build batched parameterized INSERTs and commit them atomically.
    let idx = column_index(&t.columns);
    let batch_size = t.batch_size.max(1);
    let statements: Vec<(String, Vec<Value>)> = t
        .rows
        .chunks(batch_size)
        .map(|chunk| {
            build_insert_chunk(target_dialect, schema, &t.target_table, &t.mapping, &idx, chunk)
        })
        .collect();

    if statements.is_empty() {
        report.tables.push(result);
        return report;
    }

    match target.commit_batch(&statements).await {
        Ok(results) => {
            let affected: u64 = results.iter().filter_map(|r| r.affected_rows).sum();
            result.rows_copied = if affected > 0 { affected } else { t.rows.len() as u64 };
        }
        Err(DriverError::QueryError(e)) | Err(DriverError::ConnectionError(e)) => {
            result.status = "failed".into();
            result.error = Some(e);
        }
        Err(e) => {
            result.status = "failed".into();
            result.error = Some(e.to_string());
        }
    }

    report.tables.push(result);
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cols() -> Vec<SnapshotColumn> {
        vec![
            SnapshotColumn { name: "id".into(), data_type: "int".into(), nullable: false },
            SnapshotColumn { name: "name".into(), data_type: "text".into(), nullable: true },
        ]
    }

    fn mapping() -> Vec<ColumnMap> {
        vec![
            ColumnMap { source: "id".into(), target: "id".into() },
            ColumnMap { source: "name".into(), target: "full_name".into() },
        ]
    }

    #[test]
    fn builds_mysql_insert_with_question_marks() {
        let idx = column_index(&cols());
        let chunk = vec![vec![json!(1), json!("Ann")], vec![json!(2), json!("Bob")]];
        let (sql, params) =
            build_insert_chunk(Dialect::MySql, None, "people", &mapping(), &idx, &chunk);
        assert_eq!(
            sql,
            "INSERT INTO `people` (`id`, `full_name`) VALUES (?, ?), (?, ?)"
        );
        assert_eq!(params, vec![json!(1), json!("Ann"), json!(2), json!("Bob")]);
    }

    #[test]
    fn builds_postgres_insert_with_dollar_placeholders() {
        let idx = column_index(&cols());
        let chunk = vec![vec![json!(1), json!("Ann")]];
        let (sql, _params) = build_insert_chunk(
            Dialect::Postgres,
            Some("public"),
            "people",
            &mapping(),
            &idx,
            &chunk,
        );
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"people\" (\"id\", \"full_name\") VALUES ($1, $2)"
        );
    }

    #[test]
    fn missing_source_column_binds_null() {
        let idx = column_index(&cols());
        let map = vec![ColumnMap { source: "nope".into(), target: "x".into() }];
        let chunk = vec![vec![json!(1), json!("Ann")]];
        let (_sql, params) =
            build_insert_chunk(Dialect::Sqlite, None, "t", &map, &idx, &chunk);
        assert_eq!(params, vec![Value::Null]);
    }

    #[test]
    fn builds_create_table_from_types_and_samples() {
        // First column declares a type; second is typeless and inferred from a value.
        let columns = vec![
            SnapshotColumn { name: "id".into(), data_type: "int".into(), nullable: false },
            SnapshotColumn { name: "amount".into(), data_type: "".into(), nullable: true },
        ];
        let map = vec![
            ColumnMap { source: "id".into(), target: "id".into() },
            ColumnMap { source: "amount".into(), target: "amount".into() },
        ];
        let rows = vec![vec![json!(1), json!(9.5)]];
        let (sql, warnings) = build_create_table(
            Dialect::Sqlite,
            Dialect::Sqlite,
            None,
            "t",
            &columns,
            &map,
            &rows,
        );
        assert_eq!(
            sql,
            "CREATE TABLE IF NOT EXISTS \"t\" (\"id\" INTEGER, \"amount\" DOUBLE PRECISION)"
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn create_table_warns_on_lossy_unknown_type() {
        let columns = vec![SnapshotColumn {
            name: "geom".into(),
            data_type: "geometry".into(),
            nullable: true,
        }];
        let map = vec![ColumnMap { source: "geom".into(), target: "geom".into() }];
        let rows: Vec<Vec<Value>> = vec![];
        let (sql, warnings) =
            build_create_table(Dialect::Postgres, Dialect::Sqlite, None, "t", &columns, &map, &rows);
        assert_eq!(sql, "CREATE TABLE IF NOT EXISTS \"t\" (\"geom\" TEXT)");
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("geom"));
    }

    use crate::db::SqliteDriver;

    #[tokio::test]
    async fn appends_rows_creating_table_when_missing() {
        let dst_path =
            std::env::temp_dir().join(format!("ansql_rows_{}.db", uuid::Uuid::new_v4()));
        let dst_file = dst_path.to_string_lossy().to_string();
        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let transfer = RowTransfer {
            source_dialect: Dialect::Sqlite,
            target_schema: None,
            target_table: "people".into(),
            columns: vec![
                SnapshotColumn { name: "id".into(), data_type: "integer".into(), nullable: false },
                SnapshotColumn { name: "name".into(), data_type: "text".into(), nullable: true },
            ],
            rows: vec![
                vec![json!(1), json!("Ann")],
                vec![json!(2), json!("O'Brien")],
            ],
            mapping: vec![
                ColumnMap { source: "id".into(), target: "id".into() },
                ColumnMap { source: "name".into(), target: "name".into() },
            ],
            conflict: ConflictMode::Append,
            create_if_missing: true,
            batch_size: 500,
        };

        let report = apply_row_transfer(&dst, Dialect::Sqlite, &transfer).await;
        assert_eq!(report.tables.len(), 1);
        assert_eq!(report.tables[0].status, "success");
        assert_eq!(report.tables[0].rows_copied, 2);

        let check = dst.execute("SELECT COUNT(*) AS c FROM people").await.unwrap();
        assert_eq!(check.rows[0].get("c").and_then(|v| v.as_i64()).unwrap(), 2);
        let names = dst.execute("SELECT name FROM people WHERE id = 2").await.unwrap();
        assert_eq!(names.rows[0].get("name").unwrap().as_str().unwrap(), "O'Brien");

        let _ = std::fs::remove_file(&dst_path);
    }

    #[tokio::test]
    async fn truncate_replaces_existing_rows() {
        let dst_path =
            std::env::temp_dir().join(format!("ansql_rowsT_{}.db", uuid::Uuid::new_v4()));
        let dst_file = dst_path.to_string_lossy().to_string();
        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();
        dst.execute("CREATE TABLE t (id INTEGER, n INTEGER)").await.unwrap();
        dst.execute("INSERT INTO t (id, n) VALUES (9, 9)").await.unwrap();

        let transfer = RowTransfer {
            source_dialect: Dialect::Sqlite,
            target_schema: None,
            target_table: "t".into(),
            columns: vec![
                SnapshotColumn { name: "id".into(), data_type: "integer".into(), nullable: false },
                SnapshotColumn { name: "n".into(), data_type: "integer".into(), nullable: false },
            ],
            rows: vec![vec![json!(1), json!(10)]],
            mapping: vec![
                ColumnMap { source: "id".into(), target: "id".into() },
                ColumnMap { source: "n".into(), target: "n".into() },
            ],
            conflict: ConflictMode::Truncate,
            create_if_missing: false,
            batch_size: 500,
        };

        let report = apply_row_transfer(&dst, Dialect::Sqlite, &transfer).await;
        assert_eq!(report.tables[0].rows_copied, 1);
        let check = dst.execute("SELECT COUNT(*) AS c FROM t").await.unwrap();
        assert_eq!(check.rows[0].get("c").and_then(|v| v.as_i64()).unwrap(), 1);

        let _ = std::fs::remove_file(&dst_path);
    }

    #[tokio::test]
    async fn drop_mode_without_table_reports_failure() {
        let dst_path =
            std::env::temp_dir().join(format!("ansql_rowsD_{}.db", uuid::Uuid::new_v4()));
        let dst_file = dst_path.to_string_lossy().to_string();
        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let transfer = RowTransfer {
            source_dialect: Dialect::Sqlite,
            target_schema: None,
            target_table: "nope".into(),
            columns: vec![SnapshotColumn { name: "id".into(), data_type: "integer".into(), nullable: false }],
            rows: vec![vec![json!(1)]],
            mapping: vec![ColumnMap { source: "id".into(), target: "id".into() }],
            conflict: ConflictMode::Drop,
            create_if_missing: false,
            batch_size: 500,
        };

        let report = apply_row_transfer(&dst, Dialect::Sqlite, &transfer).await;
        assert_eq!(report.tables[0].status, "failed");
        assert!(report.tables[0].error.is_some());

        let _ = std::fs::remove_file(&dst_path);
    }
}
