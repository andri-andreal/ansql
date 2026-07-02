use std::sync::Mutex;
use tauri::State;

use crate::storage::Database;
use crate::storage::models::QueryHistory;

#[tauri::command]
pub async fn get_query_history(
    connection_id: Option<String>,
    limit: Option<i32>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Vec<QueryHistory>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_query_history(
        connection_id.as_deref(),
        limit,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_query_history(
    connection_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.clear_query_history(connection_id.as_deref())
        .map_err(|e| e.to_string())
}
