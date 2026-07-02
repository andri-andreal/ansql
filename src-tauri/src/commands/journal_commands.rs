use std::sync::Mutex;
use tauri::State;

use crate::storage::Database;
use crate::storage::models::ActionJournalEntry;

/// A new reversible action to record in the journal. `forward_sql`/`inverse_sql`
/// are JSON-encoded `Statement[]` produced on the frontend.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJournalEntry {
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub table: Option<String>,
    pub kind: String,
    pub label: String,
    pub forward_sql: String,
    pub inverse_sql: String,
    pub tier: i32,
    pub affected_rows: Option<i32>,
}

#[tauri::command]
pub async fn journal_record(
    entry: NewJournalEntry,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<ActionJournalEntry, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.record_action(
        entry.connection_id.as_deref(),
        entry.database.as_deref(),
        entry.table.as_deref(),
        &entry.kind,
        &entry.label,
        &entry.forward_sql,
        &entry.inverse_sql,
        entry.tier,
        entry.affected_rows,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn journal_list(
    connection_id: Option<String>,
    limit: Option<i32>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Vec<ActionJournalEntry>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_action_journal(connection_id.as_deref(), limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn journal_set_status(
    id: String,
    status: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.set_action_status(&id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn journal_clear(
    connection_id: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.clear_action_journal(connection_id.as_deref())
        .map_err(|e| e.to_string())
}
