use std::sync::Mutex;
use tauri::State;

use crate::storage::Database;
use crate::storage::models::FavoriteQuery;

#[tauri::command]
pub async fn save_favorite_query(
    name: String,
    description: Option<String>,
    connection_id: Option<String>,
    database_name: Option<String>,
    query: String,
    folder_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<FavoriteQuery, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.save_favorite_query(
        &name,
        description.as_deref(),
        connection_id.as_deref(),
        database_name.as_deref(),
        &query,
        folder_id.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_favorite_queries(
    connection_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Vec<FavoriteQuery>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_favorite_queries(connection_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_favorite_query(
    id: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.delete_favorite_query(&id)
        .map_err(|e| e.to_string())
}
