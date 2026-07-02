use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::storage::{Connection, Database};
use crate::db::factory::{build_driver_with_tunnel, parse_connection_options, ConnectionOptions};
use crate::crypto::vault::CredentialVault;

#[tauri::command]
pub async fn get_connections(
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Vec<Connection>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection(
    id: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Option<Connection>, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.get_connection(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_connection(
    name: String,
    driver: String,
    host: Option<String>,
    port: Option<i32>,
    database: Option<String>,
    username: Option<String>,
    credential_id: Option<String>,
    group_id: Option<String>,
    options: Option<String>,
    color: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Connection, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.create_connection(
        &name,
        &driver,
        host.as_deref(),
        port,
        database.as_deref(),
        username.as_deref(),
        credential_id.as_deref(),
        group_id.as_deref(),
        options.as_deref(),
        color.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_connection(
    id: String,
    name: Option<String>,
    driver: Option<String>,
    host: Option<String>,
    port: Option<i32>,
    database: Option<String>,
    username: Option<String>,
    credential_id: Option<String>,
    group_id: Option<String>,
    options: Option<String>,
    color: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<Connection, String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.update_connection(
        &id,
        name.as_deref(),
        driver.as_deref(),
        host.as_deref(),
        port,
        database.as_deref(),
        username.as_deref(),
        credential_id.as_deref(),
        group_id.as_deref(),
        options.as_deref(),
        color.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(
    id: String,
    db: State<'_, Mutex<Option<Database>>>,
) -> Result<(), String> {
    let db = db.lock().map_err(|e| e.to_string())?;
    let db = db.as_ref().ok_or("Database not initialized")?;

    db.delete_connection(&id).map_err(|e| e.to_string())
}

/// Decrypt a vault credential to a UTF-8 string by id. Returns `Ok(None)` when
/// `credential_id` is `None`. Same vault path used for the DB password, reused
/// for the SSH password and key passphrase.
fn decrypt_credential(
    db: &State<'_, Mutex<Option<Database>>>,
    vault: &State<'_, Mutex<CredentialVault>>,
    credential_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(cred_id) = credential_id else {
        return Ok(None);
    };

    let db_guard = db.lock().map_err(|e| e.to_string())?;
    let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

    let vault_guard = vault.lock().map_err(|e| e.to_string())?;

    if !vault_guard.is_unlocked() {
        return Err("Vault is locked. Please unlock it first.".to_string());
    }

    let credential = db_ref
        .get_credential(cred_id)
        .map_err(|e: rusqlite::Error| e.to_string())?
        .ok_or("Credential not found")?;

    let decrypted_data = vault_guard
        .decrypt(&credential.encrypted_data)
        .map_err(|e| e.to_string())?;

    let secret = String::from_utf8(decrypted_data)
        .map_err(|e| format!("Failed to decode credential: {}", e))?;

    Ok(Some(secret))
}

#[tauri::command]
pub async fn test_connection(
    app: AppHandle,
    id: String,
    db: State<'_, Mutex<Option<Database>>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<bool, String> {
    // Get connection details while holding the lock, then release it
    let (driver_type, host, port, database, username, credential_id, conn_name, options_json) = {
        let db_guard = db.lock().map_err(|e| e.to_string())?;
        let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

        let connection = db_ref.get_connection(&id)
            .map_err(|e: rusqlite::Error| e.to_string())?
            .ok_or("Connection not found")?;

        (
            connection.driver.clone(),
            connection.host.clone(),
            connection.port,
            connection.database_name.clone(),
            connection.username.clone(),
            connection.credential_id.clone(),
            connection.name.clone(),
            connection.options.clone(),
        )
    }; // db_guard is dropped here

    tracing::info!("Testing connection: {} ({})", conn_name, driver_type);

    // Parse transport options (SSL/SSH). Absent/invalid -> plain driver.
    let options = parse_connection_options(options_json.as_deref());

    // Get DB password and (if a tunnel is requested) SSH secrets from the vault.
    let password = decrypt_credential(&db, &vault, credential_id.as_deref())?
        .unwrap_or_default();

    let (ssh_password, ssh_passphrase) = match &options.ssh {
        Some(ssh) if ssh.enabled => {
            let pwd = decrypt_credential(&db, &vault, ssh.password_credential_id.as_deref())?;
            let pass = decrypt_credential(&db, &vault, ssh.passphrase_credential_id.as_deref())?;
            (pwd, pass)
        }
        _ => (None, None),
    };

    let effective_host = host.unwrap_or_else(|| "localhost".to_string());
    let effective_port = port.unwrap_or(match driver_type.as_str() {
        "postgres" => 5432,
        "sqlserver" => 1433,
        _ => 3306,
    }) as u16;

    // Build a transient driver (+ tunnel) via the factory; both drop at the end
    // of this function, after the test, in the correct order (driver before
    // tunnel: `driver_instance` is declared before `_tunnel` below).
    let build = build_driver_with_tunnel(
        &driver_type,
        &effective_host,
        effective_port,
        &username.unwrap_or_default(),
        &password,
        database.as_deref(),
        &options,
        ssh_password.as_deref(),
        ssh_passphrase.as_deref(),
        crate::ssh::known_hosts_path(&app),
    )
    .await
    .map_err(|e| format!("Failed to build driver: {}", e))?;
    // Bind the tunnel FIRST so it drops LAST (Rust drops locals in reverse
    // declaration order): the driver/pool tears down before the SSH forward at
    // scope end, on every return path (including the connect-error path below).
    let _tunnel = build.1;
    let mut driver_instance = build.0;

    // Try to connect to the database with timeout
    match driver_instance.connect().await {
        Ok(_) => {
            tracing::info!("Successfully connected to database: {}", conn_name);

            // Test the connection
            match driver_instance.test_connection().await {
                Ok(result) => {
                    tracing::info!("Connection test successful for: {}", conn_name);

                    // Clean up - disconnect
                    if let Err(e) = driver_instance.disconnect().await {
                        tracing::warn!("Failed to disconnect from {}: {}", conn_name, e);
                    }

                    Ok(result)
                }
                Err(e) => {
                    tracing::error!("Connection test failed for {}: {}", conn_name, e);

                    // Try to disconnect even if test failed
                    let _ = driver_instance.disconnect().await;

                    Err(format!("Connection test failed: {}", e))
                }
            }
        }
        Err(e) => {
            tracing::error!("Failed to connect to {}: {}", conn_name, e);
            Err(format!("Failed to connect: {}", e))
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn test_connection_params(
    app: AppHandle,
    driver: String,
    host: Option<String>,
    port: Option<i32>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    // Transport options (SSL/SSH) as the same JSON blob stored in a
    // connection's `options` column. Optional/defaulted for back-compat: when
    // absent or invalid, a plain (non-SSL/non-SSH) driver is built.
    options: Option<String>,
    // For an UNSAVED form there is nothing in the vault yet, so the raw SSH
    // secrets are passed directly. Used only when `options.ssh.enabled`.
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<bool, String> {
    tracing::info!(
        "Testing connection with params: driver={}, host={:?}, port={:?}, database={:?}, username={:?}, ssh={}",
        driver, host, port, database, username,
        options.is_some()
    );

    // Parse transport options; absent/invalid -> plain driver.
    let options: ConnectionOptions = match options.as_deref() {
        Some(s) => parse_connection_options(Some(s)),
        None => ConnectionOptions::default(),
    };

    let effective_host = host.unwrap_or_else(|| "localhost".to_string());
    let effective_port = port.unwrap_or(match driver.as_str() {
        "postgres" => 5432,
        "sqlserver" => 1433,
        _ => 3306,
    }) as u16;

    // Build a transient driver (+ tunnel) via the factory, using the raw secrets
    // the form provided. Both drop at function end (driver before tunnel).
    let build = build_driver_with_tunnel(
        &driver,
        &effective_host,
        effective_port,
        &username.unwrap_or_default(),
        &password.unwrap_or_default(),
        database.as_deref(),
        &options,
        ssh_password.as_deref(),
        ssh_passphrase.as_deref(),
        crate::ssh::known_hosts_path(&app),
    )
    .await
    .map_err(|e| format!("Failed to build driver: {}", e))?;
    // Bind the tunnel FIRST so it drops LAST: pool torn down before forward.
    let _tunnel = build.1;
    let mut driver_instance = build.0;

    // Try to connect to the database
    match driver_instance.connect().await {
        Ok(_) => {
            tracing::info!("Successfully connected to database");

            // Test the connection
            match driver_instance.test_connection().await {
                Ok(result) => {
                    tracing::info!("Connection test successful: {}", result);

                    // Clean up - disconnect
                    if let Err(e) = driver_instance.disconnect().await {
                        tracing::warn!("Failed to disconnect: {}", e);
                    }

                    Ok(result)
                }
                Err(e) => {
                    tracing::error!("Connection test failed: {}", e);

                    // Try to disconnect even if test failed
                    let _ = driver_instance.disconnect().await;

                    Err(format!("Connection test failed: {}", e))
                }
            }
        }
        Err(e) => {
            tracing::error!("Failed to connect to database: {}", e);
            Err(format!("Failed to connect: {}", e))
        }
    }
}
