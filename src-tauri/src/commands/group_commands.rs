use std::sync::Mutex;
use tauri::State;

use crate::storage::{ConnectionGroup, Database};

#[tauri::command]
pub async fn get_groups(
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Vec<ConnectionGroup>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_group(
    name: String,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<ConnectionGroup, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.create_group(
        &name,
        description.as_deref(),
        color.as_deref(),
        icon.as_deref(),
        parent_id.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_group(
    id: String,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<ConnectionGroup, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.update_group(
        &id,
        name.as_deref(),
        description.as_deref(),
        color.as_deref(),
        icon.as_deref(),
        parent_id.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_group(
    id: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.delete_group(&id).map_err(|e| e.to_string())
}
