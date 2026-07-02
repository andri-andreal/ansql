use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::crypto::vault::{self, CredentialVault};
use crate::storage::Database;

/// Resolve the on-disk `vault.key` path from the app handle, mirroring the
/// path used by `auto_unlock_vault` at startup.
fn vault_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(dir.join("vault.key"))
}

/// Generate a fresh random device key string (base64), matching the format
/// `auto_unlock_vault` writes/reads.
fn generate_device_key() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut key_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key_bytes);
    base64::engine::general_purpose::STANDARD.encode(key_bytes)
}

#[tauri::command]
pub async fn is_vault_initialized(
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<bool, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    let metadata = db.get_vault_metadata().map_err(|e| e.to_string())?;
    Ok(metadata.is_some())
}

#[tauri::command]
pub async fn initialize_vault(
    master_password: String,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    // Check if vault is already initialized
    if db.get_vault_metadata().map_err(|e| e.to_string())?.is_some() {
        return Err("Vault already initialized".to_string());
    }

    // Hash the master password
    let (password_hash, _) = vault::hash_password(&master_password)
        .map_err(|e| e.to_string())?;

    // Generate salts
    let salt = vault::generate_salt();
    let db_salt = vault::generate_salt();

    // Save vault metadata
    db.save_vault_metadata(&password_hash, &salt, &db_salt)
        .map_err(|e| e.to_string())?;

    // Unlock the vault
    let mut vault = vault.lock().map_err(|e| e.to_string())?;
    vault.unlock(&master_password, &db_salt)
        .map_err(|e| e.to_string())?;

    tracing::info!("Vault initialized successfully");
    Ok(())
}

#[tauri::command]
pub async fn unlock_vault(
    master_password: String,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<bool, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    // Get vault metadata
    let metadata = db.get_vault_metadata()
        .map_err(|e| e.to_string())?
        .ok_or("Vault not initialized")?;

    // Verify password
    let is_valid = vault::verify_password(&master_password, &metadata.master_password_hash)
        .map_err(|e| e.to_string())?;

    if !is_valid {
        return Ok(false);
    }

    // Unlock the vault
    let mut vault = vault.lock().map_err(|e| e.to_string())?;
    vault.unlock(&master_password, &metadata.db_salt)
        .map_err(|e| e.to_string())?;

    tracing::info!("Vault unlocked successfully");
    Ok(true)
}

#[tauri::command]
pub async fn lock_vault(
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    let mut vault = vault.lock().map_err(|e| e.to_string())?;
    vault.lock();
    tracing::info!("Vault locked");
    Ok(())
}

#[tauri::command]
pub async fn is_vault_locked(
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<bool, String> {
    let vault = vault.lock().map_err(|e| e.to_string())?;
    Ok(!vault.is_unlocked())
}

/// Re-key every stored credential from the current (unlocked) vault key to a
/// key derived from `new_secret` using the EXISTING `db_salt` (which stays
/// constant). Verify-before-commit: all credential blobs are re-encrypted and
/// each verified to round-trip BEFORE anything is written. On success, the new
/// blobs + updated `master_password_hash` are committed in ONE DB transaction
/// and the in-memory vault key is swapped to `K_new`. On any failure nothing is
/// written (no data loss).
fn rekey_vault(
    new_secret: &str,
    db: &Database,
    vault: &mut CredentialVault,
) -> Result<(), String> {
    if !vault.is_unlocked() {
        return Err("Vault is locked. Please unlock it first.".to_string());
    }

    let metadata = db
        .get_vault_metadata()
        .map_err(|e| e.to_string())?
        .ok_or("Vault not initialized")?;

    // K_old = current in-memory key; K_new = derive_key(new_secret, db_salt).
    let old_key = vault.get_encryption_key().map_err(|e| e.to_string())?;
    let new_key = vault::derive_key(new_secret, &metadata.db_salt).map_err(|e| e.to_string())?;

    // Re-encrypt + verify every credential blob BEFORE committing.
    let blobs = db.list_credential_blobs().map_err(|e| e.to_string())?;
    let new_blobs = vault::rekey_blobs(&old_key, &new_key, &blobs).map_err(|e| e.to_string())?;

    // New password hash (db_salt unchanged across the re-key).
    let (new_hash, _) = vault::hash_password(new_secret).map_err(|e| e.to_string())?;

    // Commit all blobs + the new hash atomically.
    db.rekey_credentials(&new_blobs, &new_hash, &metadata.db_salt)
        .map_err(|e| e.to_string())?;

    // Swap the in-memory key to K_new.
    vault
        .unlock(new_secret, &metadata.db_salt)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Enable a master password: re-key from the device key to the user's password,
/// then DELETE `vault.key` so the next launch detects MASTER mode (vault.key
/// absent + initialized). Requires the vault to be unlocked.
#[tauri::command]
pub async fn set_master_password(
    new_password: String,
    app: AppHandle,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    if new_password.is_empty() {
        return Err("Master password must not be empty".to_string());
    }

    let key_path = vault_key_path(&app)?;

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
    let mut vault_guard = vault.lock().map_err(|e| e.to_string())?;

    rekey_vault(&new_password, db_ref, &mut vault_guard)?;

    // Re-key committed and verified — now drop the device key file so the app
    // starts in MASTER mode. If removal fails the vault is still consistent
    // (data is already encrypted under the password); surface the error.
    if key_path.exists() {
        std::fs::remove_file(&key_path)
            .map_err(|e| format!("Failed to delete vault key file: {}", e))?;
    }

    tracing::info!("Master password enabled; vault re-keyed and device key removed");
    Ok(())
}

/// Disable the master password: re-key back to a fresh device key and recreate
/// `vault.key` so the app auto-unlocks again. Requires the vault to be unlocked.
#[tauri::command]
pub async fn disable_master_password(
    app: AppHandle,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    let key_path = vault_key_path(&app)?;
    let device_key = generate_device_key();

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
    let mut vault_guard = vault.lock().map_err(|e| e.to_string())?;

    rekey_vault(&device_key, db_ref, &mut vault_guard)?;

    // Re-key committed — recreate the device key file so the next launch
    // auto-unlocks (DEVICE mode).
    crate::write_device_key_file(&key_path, &device_key)
        .map_err(|e| format!("Failed to write vault key file: {}", e))?;

    tracing::info!("Master password disabled; vault re-keyed to a fresh device key");
    Ok(())
}

/// Reset the vault (forgotten-password escape): wipe all credentials +
/// vault_metadata + `vault.key`, then re-initialize a fresh device-mode vault.
/// Connections survive (they only reference credential ids); saved secrets are
/// lost and must be re-entered. Caller must confirm with the user first.
#[tauri::command]
pub async fn reset_vault(
    app: AppHandle,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    let key_path = vault_key_path(&app)?;

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
    let mut vault_guard = vault.lock().map_err(|e| e.to_string())?;

    // Wipe stored secrets + metadata (connections untouched).
    db_ref.reset_vault_storage().map_err(|e| e.to_string())?;

    // Remove any existing device key file.
    if key_path.exists() {
        std::fs::remove_file(&key_path)
            .map_err(|e| format!("Failed to delete vault key file: {}", e))?;
    }

    // Re-initialize a fresh device-mode vault.
    let device_key = generate_device_key();
    let (password_hash, _) = vault::hash_password(&device_key).map_err(|e| e.to_string())?;
    let salt = vault::generate_salt();
    let db_salt = vault::generate_salt();
    db_ref
        .save_vault_metadata(&password_hash, &salt, &db_salt)
        .map_err(|e| e.to_string())?;
    crate::write_device_key_file(&key_path, &device_key)
        .map_err(|e| format!("Failed to write vault key file: {}", e))?;

    vault_guard
        .unlock(&device_key, &db_salt)
        .map_err(|e| e.to_string())?;

    tracing::info!("Vault reset to a fresh device-mode vault");
    Ok(())
}

/// Report the current vault mode based on `vault.key` presence + initialization:
/// - "device": vault.key present (auto-unlock).
/// - "master": vault.key absent + vault initialized (user must enter password).
/// - "uninitialized": vault.key absent + not initialized (first run).
#[tauri::command]
pub async fn vault_mode(
    app: AppHandle,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<String, String> {
    let key_path = vault_key_path(&app)?;

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;
    let is_initialized = db_ref.get_vault_metadata().map_err(|e| e.to_string())?.is_some();

    let mode = if key_path.exists() {
        "device"
    } else if is_initialized {
        "master"
    } else {
        "uninitialized"
    };

    Ok(mode.to_string())
}
