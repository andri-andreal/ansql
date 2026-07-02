use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::commands::session_commands::SessionStore;
use crate::storage::Database;
use crate::transfer::engine::{preview_jobs, run_jobs, Endpoint};
use crate::transfer::rows::{apply_row_transfer, RowTransfer};
use crate::transfer::{Dialect, TablePreview, TransferJob, TransferOptions, TransferReport};

/// Resolve the dialect + database name for a session by looking up its connection.
fn session_dialect(
    session_id: &str,
    sessions: &SessionStore,
    db: &Database,
) -> Result<(Dialect, String), String> {
    let info = sessions
        .get_all_sessions()
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or("Session not found")?;
    let conn = db
        .get_connection(&info.connection_id)
        .map_err(|e| e.to_string())?
        .ok_or("Connection not found")?;
    let dialect = Dialect::from_driver(&conn.driver).ok_or("Unsupported driver")?;
    let database = info
        .database
        .or_else(|| conn.database_name.clone())
        .unwrap_or_default();
    Ok((dialect, database))
}

/// Reject duplicate (schema, table) targets. The engine orders tables by name and
/// would otherwise silently process only the first job for a colliding target.
fn check_unique_targets(jobs: &[TransferJob]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for job in jobs {
        let key = (job.target_schema.clone(), job.target_table.clone());
        if !seen.insert(key) {
            return Err(format!(
                "Duplicate target table '{}' — each target table must be unique",
                job.target_table
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_transfer(
    source_session: String,
    target_session: String,
    jobs: Vec<TransferJob>,
    options: TransferOptions,
    db: State<'_, Mutex<Option<Database>>>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<TablePreview>, String> {
    if source_session == target_session {
        return Err("Source and target must be different sessions".into());
    }
    check_unique_targets(&jobs)?;
    let (src_driver, dst_driver, src_meta, dst_meta) = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        let db_guard = db.lock().map_err(|e| e.to_string())?;
        let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
        let src_meta = session_dialect(&source_session, &sessions_guard, db_ref)?;
        let dst_meta = session_dialect(&target_session, &sessions_guard, db_ref)?;
        let src = sessions_guard
            .get_driver(&source_session)
            .ok_or("Source session not found")?;
        let dst = sessions_guard
            .get_driver(&target_session)
            .ok_or("Target session not found")?;
        (src, dst, src_meta, dst_meta)
    };

    // These driver locks are held for the whole operation, serializing other work
    // on the same sessions until it finishes (intended connection-safety behavior).
    // The source==target guard above prevents locking one Mutex twice.
    let src_lock = src_driver.lock().await;
    let dst_lock = dst_driver.lock().await;
    let source_ep = Endpoint {
        driver: &**src_lock,
        dialect: src_meta.0,
        database: src_meta.1,
    };
    let target_ep = Endpoint {
        driver: &**dst_lock,
        dialect: dst_meta.0,
        database: dst_meta.1,
    };

    preview_jobs(&source_ep, &target_ep, &jobs, &options)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn run_transfer(
    app: AppHandle,
    source_session: String,
    target_session: String,
    jobs: Vec<TransferJob>,
    options: TransferOptions,
    db: State<'_, Mutex<Option<Database>>>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<TransferReport, String> {
    if source_session == target_session {
        return Err("Source and target must be different sessions".into());
    }
    check_unique_targets(&jobs)?;
    let (src_driver, dst_driver, src_meta, dst_meta) = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        let db_guard = db.lock().map_err(|e| e.to_string())?;
        let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
        let src_meta = session_dialect(&source_session, &sessions_guard, db_ref)?;
        let dst_meta = session_dialect(&target_session, &sessions_guard, db_ref)?;
        let src = sessions_guard
            .get_driver(&source_session)
            .ok_or("Source session not found")?;
        let dst = sessions_guard
            .get_driver(&target_session)
            .ok_or("Target session not found")?;
        (src, dst, src_meta, dst_meta)
    };

    // These driver locks are held for the whole operation, serializing other work
    // on the same sessions until it finishes (intended connection-safety behavior).
    // The source==target guard above prevents locking one Mutex twice.
    let src_lock = src_driver.lock().await;
    let dst_lock = dst_driver.lock().await;
    let source_ep = Endpoint {
        driver: &**src_lock,
        dialect: src_meta.0,
        database: src_meta.1,
    };
    let target_ep = Endpoint {
        driver: &**dst_lock,
        dialect: dst_meta.0,
        database: dst_meta.1,
    };

    let report = run_jobs(&source_ep, &target_ep, &jobs, &options, |progress| {
        let _ = app.emit("transfer://progress", &progress);
    })
    .await;

    let _ = app.emit("transfer://done", &report);
    Ok(report)
}

/// Insert an explicit set of clipboard rows into a target table (row-snapshot
/// paste). Uses the parameterized path; no source session is required.
#[tauri::command]
pub async fn transfer_rows(
    target_session: String,
    transfer: RowTransfer,
    db: State<'_, Mutex<Option<Database>>>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<TransferReport, String> {
    let (driver, dialect) = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        let db_guard = db.lock().map_err(|e| e.to_string())?;
        let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
        let (dialect, _database) = session_dialect(&target_session, &sessions_guard, db_ref)?;
        let driver = sessions_guard
            .get_driver(&target_session)
            .ok_or("Target session not found")?;
        (driver, dialect)
    };

    let guard = driver.lock().await;
    Ok(apply_row_transfer(&**guard, dialect, &transfer).await)
}
