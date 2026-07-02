use crate::db::driver::{DatabaseDriver, DriverError};
use crate::transfer::dialect::{format_value, quote_ident};
use crate::transfer::type_map::parse;
use crate::transfer::{
    ddl, plan, ConflictMode, Dialect, ErrorPolicy, TableResult, TablePreview, TransferJob,
    TransferOptions, TransferProgress, TransferReport,
};

/// A connected driver paired with its dialect.
pub struct Endpoint<'a> {
    pub driver: &'a (dyn DatabaseDriver + Send),
    pub dialect: Dialect,
    pub database: String,
}

/// Qualify an identifier with optional schema for the given dialect.
fn qualified(dialect: Dialect, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(s) if !s.is_empty() => {
            format!("{}.{}", quote_ident(dialect, s), quote_ident(dialect, table))
        }
        _ => quote_ident(dialect, table),
    }
}

/// The FROM-region for a job's source: a wrapped subquery when `source_query`
/// is set, otherwise the qualified source table.
fn source_from(dialect: Dialect, job: &TransferJob) -> String {
    match &job.source_query {
        Some(sql) => format!("({}) AS _src", sql),
        None => qualified(dialect, job.source_schema.as_deref(), &job.source_table),
    }
}

/// True when this job copies from an arbitrary query (no metadata catalog).
fn is_query_source(job: &TransferJob) -> bool {
    job.source_query.is_some()
}

/// Build a minimal ColumnDefinition from a query-result column (query sources
/// have no catalog metadata, so PK/unique/auto-increment are unknown → false).
fn col_def_from_info(c: &crate::db::driver::ColumnInfo) -> crate::db::driver::ColumnDefinition {
    crate::db::driver::ColumnDefinition {
        name: c.name.clone(),
        data_type: c.data_type.clone(),
        full_type: None,
        nullable: c.nullable,
        default_value: None,
        is_primary_key: false,
        is_unique: false,
        is_auto_increment: false,
        comment: None,
    }
}

/// Build the multi-row INSERT statements for one table's rows, batched.
fn build_inserts(
    target: Dialect,
    table: &str,
    schema: Option<&str>,
    columns: &[crate::db::driver::ColumnInfo],
    coltypes: &[crate::transfer::type_map::CanonicalType],
    rows: &[serde_json::Map<String, serde_json::Value>],
    batch_size: usize,
) -> Vec<String> {
    if rows.is_empty() {
        return Vec::new();
    }
    let col_list: Vec<String> = columns.iter().map(|c| quote_ident(target, &c.name)).collect();
    let header = format!(
        "INSERT INTO {} ({}) VALUES ",
        qualified(target, schema, table),
        col_list.join(", ")
    );
    let mut stmts = Vec::new();
    for chunk in rows.chunks(batch_size.max(1)) {
        let mut tuples = Vec::with_capacity(chunk.len());
        for row in chunk {
            let vals: Vec<String> = columns
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    let v = row.get(&c.name).unwrap_or(&serde_json::Value::Null);
                    format_value(target, v, &coltypes[i])
                })
                .collect();
            tuples.push(format!("({})", vals.join(", ")));
        }
        stmts.push(format!("{}{};", header, tuples.join(", ")));
    }
    stmts
}

/// Build DDL + a sample INSERT for each job without executing anything.
pub async fn preview_jobs(
    source: &Endpoint<'_>,
    target: &Endpoint<'_>,
    jobs: &[TransferJob],
    options: &TransferOptions,
) -> Result<Vec<TablePreview>, DriverError> {
    let mut previews = Vec::new();
    for job in jobs {
        // Columns: from the catalog for tables, from a sample row for queries.
        let sample = source
            .driver
            .execute(&format!("SELECT * FROM {} LIMIT 1", source_from(source.dialect, job)))
            .await?;

        let cols: Vec<crate::db::driver::ColumnDefinition> = if is_query_source(job) {
            sample.columns.iter().map(col_def_from_info).collect()
        } else {
            source
                .driver
                .get_columns(&source.database, &job.source_table, job.source_schema.as_deref())
                .await?
        };

        if cols.is_empty() {
            return Err(crate::db::driver::DriverError::QueryError(
                "Query source returned no columns (empty result or driver limitation)".into(),
            ));
        }

        let mut ddl_parts = Vec::new();
        if options.copy_structure {
            let out = ddl::generate_create_table(
                source.dialect,
                target.dialect,
                &job.target_table,
                job.target_schema.as_deref(),
                &cols,
            );
            ddl_parts.extend(out.statements);
        }

        let coltypes: Vec<_> = sample
            .columns
            .iter()
            .map(|c| parse(source.dialect, &c.data_type))
            .collect();
        let inserts = build_inserts(
            target.dialect,
            &job.target_table,
            job.target_schema.as_deref(),
            &sample.columns,
            &coltypes,
            &sample.rows,
            options.batch_size,
        );

        previews.push(TablePreview {
            table: job.target_table.clone(),
            ddl: ddl_parts.join("\n"),
            sample_insert: inserts.first().cloned().unwrap_or_default(),
        });
    }
    Ok(previews)
}

/// Execute all jobs. `emit` is called with progress updates.
pub async fn run_jobs<F: Fn(TransferProgress)>(
    source: &Endpoint<'_>,
    target: &Endpoint<'_>,
    jobs: &[TransferJob],
    options: &TransferOptions,
    emit: F,
) -> TransferReport {
    let mut report = TransferReport::default();

    // TODO: true per-table BEGIN/COMMIT transactions are deferred — the driver's
    // execute() runs each statement on a pooled connection, so TableAtomicContinue
    // currently governs continue-vs-stop and row-skip behavior rather than
    // statement-level rollback.

    let mut deps = std::collections::HashMap::new();
    if options.copy_fks {
        for job in jobs {
            if is_query_source(job) {
                continue;
            }
            if let Ok(fks) = source
                .driver
                .get_foreign_keys(&source.database, &job.source_table, job.source_schema.as_deref())
                .await
            {
                deps.insert(
                    job.target_table.clone(),
                    fks.into_iter().map(|f| f.referenced_table).collect(),
                );
            }
        }
    }
    let names: Vec<String> = jobs.iter().map(|j| j.target_table.clone()).collect();
    let (ordered_names, warnings) = plan::order_by_dependencies(&names, &deps);
    report.warnings.extend(warnings);

    if target.dialect == Dialect::MySql && options.copy_structure {
        report
            .warnings
            .push("MySQL target: DDL (DROP/CREATE) auto-commits and cannot be rolled back".into());
    }

    'outer: for name in &ordered_names {
        let job = jobs.iter().find(|j| &j.target_table == name).unwrap();
        let tq = qualified(target.dialect, job.target_schema.as_deref(), &job.target_table);

        if job.conflict == ConflictMode::Skip {
            report.tables.push(TableResult {
                table: job.target_table.clone(),
                status: "skipped".into(),
                rows_copied: 0,
                skipped: 0,
                error: None,
            });
            continue;
        }

        let mut result = TableResult {
            table: job.target_table.clone(),
            status: "success".into(),
            rows_copied: 0,
            skipped: 0,
            error: None,
        };

        emit(TransferProgress {
            table: job.target_table.clone(),
            phase: "structure".into(),
            rows_done: 0,
            rows_total: 0,
        });

        let cols = if is_query_source(job) {
            match source
                .driver
                .execute(&format!("SELECT * FROM {} LIMIT 1", source_from(source.dialect, job)))
                .await
            {
                Ok(sample) => sample.columns.iter().map(col_def_from_info).collect(),
                Err(e) => {
                    result.status = "failed".into();
                    result.error = Some(e.to_string());
                    report.tables.push(result);
                    if options.error_policy == ErrorPolicy::StopOnError {
                        break 'outer;
                    }
                    continue;
                }
            }
        } else {
            match source
                .driver
                .get_columns(&source.database, &job.source_table, job.source_schema.as_deref())
                .await
            {
                Ok(c) => c,
                Err(e) => {
                    result.status = "failed".into();
                    result.error = Some(e.to_string());
                    report.tables.push(result);
                    if options.error_policy == ErrorPolicy::StopOnError {
                        break 'outer;
                    }
                    continue;
                }
            }
        };

        if cols.is_empty() {
            result.status = "failed".into();
            result.error = Some(
                "Query source returned no columns (empty result or driver limitation)".into(),
            );
            report.tables.push(result);
            if options.error_policy == ErrorPolicy::StopOnError {
                break 'outer;
            }
            continue;
        }

        // v1 limitation: binary/BLOB values are not re-encoded into dialect-correct
        // binary literals, so copying them may store incorrect data. Warn rather
        // than corrupt silently.
        if options.copy_data {
            for c in &cols {
                if parse(source.dialect, &c.data_type) == crate::transfer::type_map::CanonicalType::Blob {
                    report.warnings.push(format!(
                        "{}.{}: BLOB/binary data may not transfer correctly in this version",
                        job.target_table, c.name
                    ));
                }
            }
        }

        let mut ddl_stmts: Vec<String> = Vec::new();
        match job.conflict {
            ConflictMode::Drop => {
                ddl_stmts.push(format!("DROP TABLE IF EXISTS {};", tq));
                if options.copy_structure {
                    let out = ddl::generate_create_table(
                        source.dialect,
                        target.dialect,
                        &job.target_table,
                        job.target_schema.as_deref(),
                        &cols,
                    );
                    report.warnings.extend(out.warnings);
                    ddl_stmts.extend(out.statements);
                }
            }
            ConflictMode::Truncate => ddl_stmts.push(format!("DELETE FROM {};", tq)),
            ConflictMode::Append => {}
            ConflictMode::Skip => unreachable!(),
        }

        if let Err(e) = exec_all(target.driver, &ddl_stmts).await {
            result.status = "failed".into();
            result.error = Some(e.to_string());
            report.tables.push(result);
            if options.error_policy == ErrorPolicy::StopOnError {
                break 'outer;
            }
            continue;
        }

        if options.copy_data {
            match copy_data(source, target, job, options, &emit).await {
                Ok((copied, skipped)) => {
                    result.rows_copied = copied;
                    result.skipped = skipped;
                }
                Err(e) => {
                    result.status = "failed".into();
                    result.error = Some(e.to_string());
                    report.tables.push(result);
                    if options.error_policy == ErrorPolicy::StopOnError {
                        break 'outer;
                    }
                    continue;
                }
            }
        }

        if options.copy_indexes && !is_query_source(job) {
            if let Ok(idx) = source
                .driver
                .get_indexes(&source.database, &job.source_table, job.source_schema.as_deref())
                .await
            {
                let stmts = ddl::generate_indexes(
                    target.dialect,
                    &job.target_table,
                    job.target_schema.as_deref(),
                    &idx,
                );
                let _ = exec_all(target.driver, &stmts).await;
            }
        }

        report.tables.push(result);
    }

    if options.copy_fks {
        for name in &ordered_names {
            let job = jobs.iter().find(|j| &j.target_table == name).unwrap();
            if job.conflict == ConflictMode::Skip {
                continue;
            }
            if is_query_source(job) {
                continue;
            }
            if let Ok(fks) = source
                .driver
                .get_foreign_keys(&source.database, &job.source_table, job.source_schema.as_deref())
                .await
            {
                let stmts = ddl::generate_foreign_keys(
                    target.dialect,
                    &job.target_table,
                    job.target_schema.as_deref(),
                    &fks,
                );
                if let Err(e) = exec_all(target.driver, &stmts).await {
                    report.warnings.push(format!("FK on {}: {}", job.target_table, e));
                }
            }
        }
    }

    report
}

async fn exec_all(
    driver: &(dyn DatabaseDriver + Send),
    stmts: &[String],
) -> Result<(), DriverError> {
    for s in stmts {
        driver.execute(s).await?;
    }
    Ok(())
}

/// Copy rows in chunks using LIMIT/OFFSET paging. Returns (copied, skipped).
async fn copy_data<F: Fn(TransferProgress)>(
    source: &Endpoint<'_>,
    target: &Endpoint<'_>,
    job: &TransferJob,
    options: &TransferOptions,
    emit: &F,
) -> Result<(u64, u64), DriverError> {
    let src_q = source_from(source.dialect, job);

    let total = source
        .driver
        .execute(&format!("SELECT COUNT(*) AS c FROM {}", src_q))
        .await?
        .rows
        .first()
        .and_then(|r| r.get("c").and_then(|v| v.as_i64()))
        .unwrap_or(0) as u64;

    let page = options.batch_size.max(1);
    let mut offset: u64 = 0;
    let mut copied: u64 = 0;
    let mut skipped: u64 = 0;

    loop {
        let batch = source
            .driver
            .execute(&format!(
                "SELECT * FROM {} LIMIT {} OFFSET {}",
                src_q, page, offset
            ))
            .await?;
        if batch.rows.is_empty() {
            break;
        }
        let coltypes: Vec<_> = batch
            .columns
            .iter()
            .map(|c| parse(source.dialect, &c.data_type))
            .collect();
        let inserts = build_inserts(
            target.dialect,
            &job.target_table,
            job.target_schema.as_deref(),
            &batch.columns,
            &coltypes,
            &batch.rows,
            page,
        );

        // `build_inserts(.., page)` over a page-sized fetch yields exactly one
        // statement covering all `batch.rows`, so each `stmt` accounts for the
        // whole batch. Count successes inline so every error policy reports
        // `rows_copied` correctly (not just the SkipRowContinue retry path).
        for stmt in &inserts {
            match target.driver.execute(stmt).await {
                Ok(_) => copied += batch.rows.len() as u64,
                Err(e) => {
                    if options.error_policy == ErrorPolicy::SkipRowContinue {
                        let row_stmts = build_inserts(
                            target.dialect,
                            &job.target_table,
                            job.target_schema.as_deref(),
                            &batch.columns,
                            &coltypes,
                            &batch.rows,
                            1,
                        );
                        for rs in &row_stmts {
                            match target.driver.execute(rs).await {
                                Ok(_) => copied += 1,
                                Err(_) => skipped += 1,
                            }
                        }
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        emit(TransferProgress {
            table: job.target_table.clone(),
            phase: "data".into(),
            rows_done: copied,
            rows_total: total,
        });

        offset += batch.rows.len() as u64;
        if (batch.rows.len() as usize) < page {
            break;
        }
    }

    Ok((copied, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SqliteDriver;

    fn opts() -> TransferOptions {
        TransferOptions {
            copy_structure: true,
            copy_data: true,
            copy_indexes: false,
            copy_fks: false,
            batch_size: 500,
            error_policy: ErrorPolicy::TableAtomicContinue,
        }
    }

    #[tokio::test]
    async fn transfers_sqlite_to_sqlite() {
        let src_path = std::env::temp_dir().join(format!("ansql_src_{}.db", uuid::Uuid::new_v4()));
        let dst_path = std::env::temp_dir().join(format!("ansql_dst_{}.db", uuid::Uuid::new_v4()));
        let src_file = src_path.to_string_lossy().to_string();
        let dst_file = dst_path.to_string_lossy().to_string();

        let mut src = SqliteDriver::new(src_file.clone()).create_if_missing(true);
        src.connect().await.unwrap();
        src.execute("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)").await.unwrap();
        src.execute("INSERT INTO people (id, name) VALUES (1, 'Ann'), (2, 'O''Brien')").await.unwrap();

        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let source_ep = Endpoint { driver: &src, dialect: Dialect::Sqlite, database: src_file.clone() };
        let target_ep = Endpoint { driver: &dst, dialect: Dialect::Sqlite, database: dst_file.clone() };

        let jobs = vec![TransferJob {
            source_table: "people".into(),
            source_schema: None,
            target_db: dst_file.clone(),
            target_schema: None,
            target_table: "people".into(),
            conflict: ConflictMode::Drop,
            source_query: None,
        }];

        let report = run_jobs(&source_ep, &target_ep, &jobs, &opts(), |_p| {}).await;

        assert_eq!(report.tables.len(), 1);
        assert_eq!(report.tables[0].status, "success");
        assert_eq!(report.tables[0].rows_copied, 2);

        let check = dst.execute("SELECT COUNT(*) AS c FROM people").await.unwrap();
        let count = check.rows[0].get("c").and_then(|v| v.as_i64()).unwrap();
        assert_eq!(count, 2);

        let names = dst.execute("SELECT name FROM people WHERE id = 2").await.unwrap();
        assert_eq!(names.rows[0].get("name").unwrap().as_str().unwrap(), "O'Brien");

        let _ = std::fs::remove_file(&src_path);
        let _ = std::fs::remove_file(&dst_path);
    }

    #[tokio::test]
    async fn transfers_from_query_source() {
        let src_path = std::env::temp_dir().join(format!("ansql_q_src_{}.db", uuid::Uuid::new_v4()));
        let dst_path = std::env::temp_dir().join(format!("ansql_q_dst_{}.db", uuid::Uuid::new_v4()));
        let src_file = src_path.to_string_lossy().to_string();
        let dst_file = dst_path.to_string_lossy().to_string();

        let mut src = SqliteDriver::new(src_file.clone()).create_if_missing(true);
        src.connect().await.unwrap();
        src.execute("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)").await.unwrap();
        src.execute("INSERT INTO people (id, name, age) VALUES (1, 'Ann', 30), (2, 'Bob', 17)").await.unwrap();

        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let source_ep = Endpoint { driver: &src, dialect: Dialect::Sqlite, database: src_file.clone() };
        let target_ep = Endpoint { driver: &dst, dialect: Dialect::Sqlite, database: dst_file.clone() };

        let jobs = vec![TransferJob {
            source_table: "adults".into(),
            source_schema: None,
            target_db: dst_file.clone(),
            target_schema: None,
            target_table: "adults".into(),
            conflict: ConflictMode::Drop,
            source_query: Some("SELECT id, name FROM people WHERE age >= 18".into()),
        }];

        let report = run_jobs(&source_ep, &target_ep, &jobs, &opts(), |_p| {}).await;
        assert_eq!(report.tables[0].status, "success");
        assert_eq!(report.tables[0].rows_copied, 1);

        let check = dst.execute("SELECT name FROM adults").await.unwrap();
        assert_eq!(check.rows.len(), 1);
        assert_eq!(check.rows[0].get("name").unwrap().as_str().unwrap(), "Ann");

        let _ = std::fs::remove_file(&src_path);
        let _ = std::fs::remove_file(&dst_path);
    }

    #[tokio::test]
    async fn skip_row_continue_reports_rows_copied_on_success() {
        // Regression: under SkipRowContinue, a fully-successful batch must still
        // report the rows it copied (previously reported 0).
        let src_path = std::env::temp_dir().join(format!("ansql_srcS_{}.db", uuid::Uuid::new_v4()));
        let dst_path = std::env::temp_dir().join(format!("ansql_dstS_{}.db", uuid::Uuid::new_v4()));
        let src_file = src_path.to_string_lossy().to_string();
        let dst_file = dst_path.to_string_lossy().to_string();

        let mut src = SqliteDriver::new(src_file.clone()).create_if_missing(true);
        src.connect().await.unwrap();
        src.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)").await.unwrap();
        src.execute("INSERT INTO t (id, n) VALUES (1, 10), (2, 20), (3, 30)").await.unwrap();

        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let source_ep = Endpoint { driver: &src, dialect: Dialect::Sqlite, database: src_file.clone() };
        let target_ep = Endpoint { driver: &dst, dialect: Dialect::Sqlite, database: dst_file.clone() };

        let jobs = vec![TransferJob {
            source_table: "t".into(),
            source_schema: None,
            target_db: dst_file.clone(),
            target_schema: None,
            target_table: "t".into(),
            conflict: ConflictMode::Drop,
            source_query: None,
        }];

        let mut o = opts();
        o.error_policy = ErrorPolicy::SkipRowContinue;
        let report = run_jobs(&source_ep, &target_ep, &jobs, &o, |_p| {}).await;

        assert_eq!(report.tables[0].status, "success");
        assert_eq!(report.tables[0].rows_copied, 3);
        assert_eq!(report.tables[0].skipped, 0);

        let _ = std::fs::remove_file(&src_path);
        let _ = std::fs::remove_file(&dst_path);
    }

    #[tokio::test]
    async fn query_source_with_no_columns_fails_cleanly() {
        // The SQLite driver (via sqlx) does NOT return column metadata when the
        // LIMIT 1 sample returns zero rows (empty table + WHERE 1=0 yields an
        // empty ColumnInfo vec). The empty-columns guard therefore fires and the
        // job is reported as "failed" rather than generating an invalid
        // `CREATE TABLE foo ()`.
        let src_path = std::env::temp_dir().join(format!("ansql_qe_{}.db", uuid::Uuid::new_v4()));
        let dst_path = std::env::temp_dir().join(format!("ansql_qed_{}.db", uuid::Uuid::new_v4()));
        let src_file = src_path.to_string_lossy().to_string();
        let dst_file = dst_path.to_string_lossy().to_string();
        let mut src = SqliteDriver::new(src_file.clone()).create_if_missing(true);
        src.connect().await.unwrap();
        src.execute("CREATE TABLE people (id INTEGER, name TEXT)").await.unwrap();
        let mut dst = SqliteDriver::new(dst_file.clone()).create_if_missing(true);
        dst.connect().await.unwrap();

        let source_ep = Endpoint { driver: &src, dialect: Dialect::Sqlite, database: src_file.clone() };
        let target_ep = Endpoint { driver: &dst, dialect: Dialect::Sqlite, database: dst_file.clone() };
        let jobs = vec![TransferJob {
            source_table: "empty".into(),
            source_schema: None,
            target_db: dst_file.clone(),
            target_schema: None,
            target_table: "empty".into(),
            conflict: ConflictMode::Drop,
            source_query: Some("SELECT id, name FROM people WHERE 1 = 0".into()),
        }];
        let report = run_jobs(&source_ep, &target_ep, &jobs, &opts(), |_p| {}).await;
        assert_eq!(report.tables[0].status, "failed");

        let _ = std::fs::remove_file(&src_path);
        let _ = std::fs::remove_file(&dst_path);
    }
}
