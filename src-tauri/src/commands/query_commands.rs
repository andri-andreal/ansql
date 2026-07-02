use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tokio::task::AbortHandle;

use super::session_commands::SessionStore;
use crate::storage::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Map<String, serde_json::Value>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

/// A single parameterized statement sent from the frontend mutation builder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

/// Registry of in-flight queries, so they can be cancelled (best-effort) by id.
#[derive(Default)]
pub struct RunningQueries(pub Mutex<HashMap<String, AbortHandle>>);

/// Map a driver result into the IPC-facing result shape.
fn to_cmd_result(result: crate::db::driver::QueryResult) -> QueryResult {
    QueryResult {
        columns: result
            .columns
            .iter()
            .map(|c| ColumnInfo {
                name: c.name.clone(),
                data_type: c.data_type.clone(),
                nullable: c.nullable,
            })
            .collect(),
        rows: result.rows,
        affected_rows: result.affected_rows,
        execution_time_ms: result.execution_time_ms,
    }
}

#[tauri::command]
pub async fn execute_query(
    request_id: String,
    session_id: String,
    query: String,
    sessions: State<'_, Mutex<SessionStore>>,
    running: State<'_, RunningQueries>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<QueryResult, String> {
    tracing::debug!("execute_query session={}", session_id);

    // Resolve the driver Arc + the session's connection attribution, then drop
    // the sessions lock before awaiting.
    let (driver, session_info) = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        let driver = sessions_guard
            .get_driver(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        let info = sessions_guard.get_session_info(&session_id);
        (driver, info)
    };

    // Run the query in a spawned task so it can be aborted by `cancel_query`.
    let q = query.clone();
    let handle = tokio::spawn(async move {
        let guard = driver.lock().await;
        guard.execute(&q).await.map(to_cmd_result).map_err(|e| e.to_string())
    });

    // Register the abort handle for the lifetime of the query.
    if let Ok(mut map) = running.0.lock() {
        map.insert(request_id.clone(), handle.abort_handle());
    }

    let outcome = handle.await;

    // Always clean up the registry entry.
    if let Ok(mut map) = running.0.lock() {
        map.remove(&request_id);
    }

    let result = match outcome {
        Ok(result) => result,
        Err(join_err) if join_err.is_cancelled() => Err("Query cancelled".to_string()),
        Err(join_err) => Err(format!("Query task failed: {}", join_err)),
    };

    // Record the query in history (both success and failure). Best-effort:
    // never block or fail query execution if the history insert fails.
    if let Some(info) = session_info {
        let (exec_ms, row_count, success, error_message): (
            Option<i32>,
            Option<i32>,
            bool,
            Option<String>,
        ) = match &result {
            Ok(r) => (
                Some(r.execution_time_ms as i32),
                Some(r.rows.len() as i32),
                true,
                None,
            ),
            Err(e) => (None, None, false, Some(e.clone())),
        };

        if let Ok(db_guard) = db.lock() {
            if let Some(db_ref) = db_guard.as_ref() {
                if let Err(e) = db_ref.save_query_history(
                    &info.connection_id,
                    info.database.as_deref(),
                    &query,
                    exec_ms,
                    row_count,
                    success,
                    error_message.as_deref(),
                ) {
                    tracing::warn!("Failed to record query history: {}", e);
                }
            }
        }
    }

    result
}

/// Execute a single parameterized mutation (INSERT/UPDATE/DELETE).
#[tauri::command]
pub async fn execute_mutation(
    session_id: String,
    sql: String,
    params: Vec<serde_json::Value>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<QueryResult, String> {
    let driver = {
        let g = sessions.lock().map_err(|e| e.to_string())?;
        g.get_driver(&session_id)
            .ok_or_else(|| "Session not found".to_string())?
    };
    let guard = driver.lock().await;
    let r = guard
        .execute_with_params(&sql, &params)
        .await
        .map_err(|e| e.to_string())?;
    Ok(to_cmd_result(r))
}

/// Commit a batch of parameterized statements atomically (single transaction).
#[tauri::command]
pub async fn commit_changes(
    session_id: String,
    statements: Vec<ParamStatement>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<QueryResult>, String> {
    let driver = {
        let g = sessions.lock().map_err(|e| e.to_string())?;
        g.get_driver(&session_id)
            .ok_or_else(|| "Session not found".to_string())?
    };
    let batch: Vec<(String, Vec<serde_json::Value>)> =
        statements.into_iter().map(|s| (s.sql, s.params)).collect();

    let guard = driver.lock().await;
    let rows = guard
        .commit_batch(&batch)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_cmd_result).collect())
}

/// Best-effort cancellation: abort the in-flight task for `request_id`.
#[tauri::command]
pub async fn cancel_query(
    request_id: String,
    running: State<'_, RunningQueries>,
) -> Result<(), String> {
    if let Some(handle) = running
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&request_id)
    {
        handle.abort();
        tracing::debug!("Aborted query {}", request_id);
    }
    Ok(())
}
