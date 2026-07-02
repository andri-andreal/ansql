use std::sync::Mutex;
use tauri::State;

use crate::crypto::vault::CredentialVault;
use crate::storage::Database;

#[tauri::command]
pub async fn save_credential(
    name: String,
    password: String,
    // Credential kind: `"password"` (default) or `"ssh_key"`. Optional for
    // back-compat with existing callers that only pass `name`/`password`.
    credential_type: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<String, String> {
    let credential_type = credential_type.unwrap_or_else(|| "password".to_string());

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

    let vault_guard = vault.lock().map_err(|e| e.to_string())?;

    // Check if vault is unlocked
    if !vault_guard.is_unlocked() {
        return Err("Vault is locked. Please unlock it first.".to_string());
    }

    // Encrypt the password
    let encrypted_data = vault_guard.encrypt(password.as_bytes())
        .map_err(|e| e.to_string())?;

    // Save to database
    let credential = db_ref.save_credential(&name, &credential_type, &encrypted_data)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    tracing::info!("Credential saved: {}", credential.id);
    Ok(credential.id)
}

#[tauri::command]
pub async fn get_credential(
    credential_id: String,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<String, String> {
    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

    let vault_guard = vault.lock().map_err(|e| e.to_string())?;

    // Check if vault is unlocked
    if !vault_guard.is_unlocked() {
        return Err("Vault is locked. Please unlock it first.".to_string());
    }

    // Get credential from database
    let credential = db_ref.get_credential(&credential_id)
        .map_err(|e: rusqlite::Error| e.to_string())?
        .ok_or("Credential not found")?;

    // Decrypt the password
    let decrypted_data = vault_guard.decrypt(&credential.encrypted_data)
        .map_err(|e| e.to_string())?;

    let password = String::from_utf8(decrypted_data)
        .map_err(|e| format!("Failed to decode password: {}", e))?;

    Ok(password)
}

#[tauri::command]
pub async fn update_credential(
    credential_id: String,
    password: String,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

    let vault_guard = vault.lock().map_err(|e| e.to_string())?;

    // Check if vault is unlocked
    if !vault_guard.is_unlocked() {
        return Err("Vault is locked. Please unlock it first.".to_string());
    }

    // Encrypt the new password
    let encrypted_data = vault_guard.encrypt(password.as_bytes())
        .map_err(|e| e.to_string())?;

    // Update in database
    db_ref.update_credential(&credential_id, &encrypted_data)
        .map_err(|e: rusqlite::Error| e.to_string())?;

    tracing::info!("Credential updated: {}", credential_id);
    Ok(())
}

#[tauri::command]
pub async fn delete_credential(
    credential_id: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

    db_ref.delete_credential(&credential_id)
        .map_err(|e| e.to_string())?;

    tracing::info!("Credential deleted: {}", credential_id);
    Ok(())
}
