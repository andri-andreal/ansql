use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;

use crate::storage::Database;
use crate::db::DatabaseDriver;
use crate::db::factory::{build_driver_with_tunnel, parse_connection_options};
use crate::crypto::vault::CredentialVault;
use crate::ssh::SshTunnel;

// Session info returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub connected_at: String,
}

// Simple in-memory session store
// In production, you might want to use a more sophisticated approach
pub struct SessionStore {
    sessions: std::collections::HashMap<String, ActiveSession>,
}

/// In-memory active session. Returned by `remove_session` so the caller can
/// close the driver pool before the SSH tunnel drops (see `disconnect`).
pub struct ActiveSession {
    info: SessionInfo,
    driver: Arc<TokioMutex<Box<dyn DatabaseDriver + Send>>>,
    // SSH tunnel that the driver's pool dials through, if any. It MUST outlive
    // the pool: dropping the tunnel tears down the loopback forward, so the
    // pool must be closed (driver `disconnect()`) BEFORE this field drops. See
    // `disconnect` / the field ordering note there.
    _tunnel: Option<SshTunnel>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: std::collections::HashMap::new(),
        }
    }

    pub fn add_session(
        &mut self,
        session_id: String,
        info: SessionInfo,
        driver: Box<dyn DatabaseDriver + Send>,
        tunnel: Option<SshTunnel>,
    ) {
        self.sessions.insert(session_id, ActiveSession {
            info,
            driver: Arc::new(TokioMutex::new(driver)),
            _tunnel: tunnel,
        });
    }

    pub fn get_driver(&self, session_id: &str) -> Option<Arc<TokioMutex<Box<dyn DatabaseDriver + Send>>>> {
        self.sessions.get(session_id).map(|s| Arc::clone(&s.driver))
    }

    /// The `SessionInfo` for a session (connection id + database), for callers
    /// that need to attribute work to the underlying connection (e.g. query
    /// history).
    pub fn get_session_info(&self, session_id: &str) -> Option<SessionInfo> {
        self.sessions.get(session_id).map(|s| s.info.clone())
    }

    pub fn remove_session(&mut self, session_id: &str) -> Option<ActiveSession> {
        self.sessions.remove(session_id)
    }

    pub fn get_all_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Decrypt a vault credential to a UTF-8 string by id.
///
/// Returns `Ok(None)` when `credential_id` is `None` (nothing to decrypt).
/// Errors if the vault is locked, the credential is missing, or decryption /
/// UTF-8 decoding fails. This is the SAME vault path used for the DB password,
/// reused for the SSH password and key passphrase.
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
pub async fn connect(
    app: AppHandle,
    connection_id: String,
    database: Option<String>,
    db: State<'_, Mutex<Option<Database>>>,
    _sessions: State<'_, Mutex<SessionStore>>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<SessionInfo, String> {
    // Extract connection info while holding the lock, then release it
    let (driver_type, host, port, username, db_name, conn_name, credential_id, options_json) = {
        let db_guard = db.lock().map_err(|e| e.to_string())?;
        let db_ref = db_guard.as_ref().ok_or("Database not initialized")?;

        let connection = db_ref
            .get_connection(&connection_id)
            .map_err(|e| e.to_string())?
            .ok_or("Connection not found")?;

        (
            connection.driver.clone(),
            connection.host.clone(),
            connection.port,
            connection.username.clone(),
            connection.database_name.clone(),
            connection.name.clone(),
            connection.credential_id.clone(),
            connection.options.clone(),
        )
    }; // db_guard is dropped here

    // Parse transport options (SSL/SSH). Absent/invalid -> plain driver.
    let options = parse_connection_options(options_json.as_deref());

    // Get password from credential vault if credential_id exists
    let password = decrypt_credential(&db, &vault, credential_id.as_deref())?
        .unwrap_or_default();

    // When an SSH tunnel is requested, decrypt its secrets from the SAME vault
    // path as the DB password. Each ref is optional -> `None` when absent.
    let (ssh_password, ssh_passphrase) = match &options.ssh {
        Some(ssh) if ssh.enabled => {
            let pwd = decrypt_credential(&db, &vault, ssh.password_credential_id.as_deref())?;
            let pass = decrypt_credential(&db, &vault, ssh.passphrase_credential_id.as_deref())?;
            (pwd, pass)
        }
        _ => (None, None),
    };

    // Prefer the database parameter over db_name if db_name is empty
    let effective_database = database.clone()
        .or_else(|| db_name.clone().filter(|s| !s.is_empty()));

    tracing::info!("Creating driver with database: {:?}, from db_name: {:?}, from parameter: {:?}",
                   effective_database, db_name, database);

    // Build through the factory so SSL/SSH are folded in. SQLite ignores host/port.
    let effective_host = host.unwrap_or_else(|| "localhost".to_string());
    let effective_port = port.unwrap_or(match driver_type.as_str() {
        "postgres" => 5432,
        _ => 3306,
    }) as u16;

    let (mut driver, tunnel) = build_driver_with_tunnel(
        &driver_type,
        &effective_host,
        effective_port,
        &username.unwrap_or_default(),
        &password,
        effective_database.as_deref(),
        &options,
        ssh_password.as_deref(),
        ssh_passphrase.as_deref(),
        crate::ssh::known_hosts_path(&app),
    )
    .await
    .map_err(|e| format!("Failed to build driver: {}", e))?;

    // Factory does not connect; the pool dials through the (now-open) tunnel.
    driver.connect().await.map_err(|e| e.to_string())?;

    // Create session
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let session_info = SessionInfo {
        id: session_id.clone(),
        connection_id: connection_id.clone(),
        database,
        connected_at: now,
    };

    // Store the session, driver, and tunnel (the tunnel must live as long as
    // the driver's pool; the session owns both).
    let mut sessions_guard = _sessions.lock().map_err(|e| e.to_string())?;
    sessions_guard.add_session(session_id.clone(), session_info.clone(), driver, tunnel);

    tracing::info!("Connected to {} (session: {})", conn_name, session_id);

    Ok(session_info)
}

#[tauri::command]
pub async fn disconnect(
    session_id: String,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<(), String> {
    // Remove the whole session (driver + tunnel) under the lock, then release
    // it before awaiting. We hold the entire `ActiveSession` here rather than
    // just `s.driver` so the SSH tunnel does NOT drop yet.
    let session = {
        let mut sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard.remove_session(&session_id)
    };

    if let Some(session) = session {
        // ORDERING MATTERS: close the driver's pool FIRST, while the tunnel in
        // `session._tunnel` is still alive (the pool dials through it). Only
        // after this returns do we drop `session`, which tears down the tunnel.
        {
            let mut driver_guard = session.driver.lock().await;
            driver_guard.disconnect().await.map_err(|e| e.to_string())?;
        }
        // `session` (and thus `_tunnel`) drops here, after the pool is closed.
        drop(session);
        tracing::info!("Disconnected session: {}", session_id);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_sessions(
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<SessionInfo>, String> {
    let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions_guard.get_all_sessions())
}

#[tauri::command]
pub async fn get_databases(
    session_id: String,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<String>, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    driver_guard.get_databases().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    session_id: String,
    database: String,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<TableInfo>, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    let tables = driver_guard
        .get_tables(&database, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // Convert from driver TableInfo to our TableInfo
    Ok(tables.iter().map(|t| TableInfo {
        name: t.name.clone(),
        schema: t.schema.clone(),
        table_type: t.table_type.clone(),
        row_count: t.row_count,
    }).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub table_type: String,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub full_type: Option<String>,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

/// Batched ERD payload (one table's columns + FKs); the wire shape the
/// `get_schema_graph` command returns so the ER diagram fetches a whole schema
/// in a couple of round-trips instead of two per table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableGraph {
    pub name: String,
    pub schema: Option<String>,
    pub columns: Vec<ColumnDefinition>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[tauri::command]
pub async fn get_columns(
    session_id: String,
    database: String,
    table: String,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<ColumnDefinition>, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    let columns = driver_guard
        .get_columns(&database, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // Convert from driver ColumnDefinition to our ColumnDefinition
    Ok(columns.iter().map(|c| ColumnDefinition {
        name: c.name.clone(),
        data_type: c.data_type.clone(),
        full_type: c.full_type.clone(),
        nullable: c.nullable,
        default_value: c.default_value.clone(),
        is_primary_key: c.is_primary_key,
        is_unique: c.is_unique,
        is_auto_increment: c.is_auto_increment,
        comment: c.comment.clone(),
    }).collect())
}

#[tauri::command]
pub async fn get_view_definition(
    session_id: String,
    database: String,
    view: String,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<String, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    driver_guard
        .get_view_definition(&database, &view, schema.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_indexes(
    session_id: String,
    database: String,
    table: String,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<IndexInfo>, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    let indexes = driver_guard
        .get_indexes(&database, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // Convert from driver IndexInfo to our IndexInfo
    Ok(indexes.iter().map(|i| IndexInfo {
        name: i.name.clone(),
        columns: i.columns.clone(),
        is_unique: i.is_unique,
        is_primary: i.is_primary,
        index_type: i.index_type.clone(),
    }).collect())
}

#[tauri::command]
pub async fn get_foreign_keys(
    session_id: String,
    database: String,
    table: String,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<ForeignKeyInfo>, String> {
    // Get the driver Arc, then drop the sessions lock
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    // Now we can await without holding the sessions lock
    let driver_guard = driver.lock().await;
    let fks = driver_guard
        .get_foreign_keys(&database, &table, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // Convert from driver ForeignKeyInfo to our ForeignKeyInfo
    Ok(fks.iter().map(|fk| ForeignKeyInfo {
        name: fk.name.clone(),
        columns: fk.columns.clone(),
        referenced_table: fk.referenced_table.clone(),
        referenced_columns: fk.referenced_columns.clone(),
        on_delete: fk.on_delete.clone(),
        on_update: fk.on_update.clone(),
    }).collect())
}

/// Batched ERD introspection — columns + foreign keys for every requested table
/// in one call. Backed by the driver's `get_schema_graph` (single-pass query on
/// MySQL/Postgres; per-table fallback elsewhere). Replaces the ER diagram's old
/// N+1 fan-out of `get_columns` + `get_foreign_keys` per table.
#[tauri::command]
pub async fn get_schema_graph(
    session_id: String,
    database: String,
    schema: Option<String>,
    tables: Vec<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<TableGraph>, String> {
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    let driver_guard = driver.lock().await;
    let graph = driver_guard
        .get_schema_graph(&database, schema.as_deref(), &tables)
        .await
        .map_err(|e| e.to_string())?;

    Ok(graph
        .into_iter()
        .map(|g| TableGraph {
            name: g.name,
            schema: g.schema,
            columns: g
                .columns
                .into_iter()
                .map(|c| ColumnDefinition {
                    name: c.name,
                    data_type: c.data_type,
                    full_type: c.full_type,
                    nullable: c.nullable,
                    default_value: c.default_value,
                    is_primary_key: c.is_primary_key,
                    is_unique: c.is_unique,
                    is_auto_increment: c.is_auto_increment,
                    comment: c.comment,
                })
                .collect(),
            indexes: g
                .indexes
                .into_iter()
                .map(|i| IndexInfo {
                    name: i.name,
                    columns: i.columns,
                    is_unique: i.is_unique,
                    is_primary: i.is_primary,
                    index_type: i.index_type,
                })
                .collect(),
            foreign_keys: g
                .foreign_keys
                .into_iter()
                .map(|fk| ForeignKeyInfo {
                    name: fk.name,
                    columns: fk.columns,
                    referenced_table: fk.referenced_table,
                    referenced_columns: fk.referenced_columns,
                    on_delete: fk.on_delete,
                    on_update: fk.on_update,
                })
                .collect(),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub table: String,
    pub timing: Option<String>,
    pub event: Option<String>,
    pub statement: String,
    pub schema: Option<String>,
}

#[tauri::command]
pub async fn get_triggers(
    session_id: String,
    database: String,
    table: Option<String>,
    schema: Option<String>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<TriggerInfo>, String> {
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    let driver_guard = driver.lock().await;
    let triggers = driver_guard
        .get_triggers(&database, table.as_deref(), schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    Ok(triggers.into_iter().map(|t| TriggerInfo {
        name: t.name,
        table: t.table,
        timing: t.timing,
        event: t.event,
        statement: t.statement,
        schema: t.schema,
    }).collect())
}

/// Lookup distinct (value, label...) rows from a referenced table for the
/// data-grid FK dropdown. The query is parameterized; identifiers are quoted
/// per dialect by the driver. `limit` defaults to 50 and is capped at 500.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_fk_lookup(
    session_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    value_column: String,
    label_columns: Vec<String>,
    search: Option<String>,
    limit: Option<i64>,
    sessions: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    let driver = {
        let sessions_guard = sessions.lock().map_err(|e| e.to_string())?;
        sessions_guard
            .get_driver(&session_id)
            .ok_or("Session not found")?
    };

    let effective_limit = limit.unwrap_or(50).clamp(1, 500);

    let driver_guard = driver.lock().await;
    driver_guard
        .get_fk_lookup(
            &database,
            schema.as_deref(),
            &table,
            &value_column,
            &label_columns,
            search.as_deref(),
            effective_limit,
        )
        .await
        .map_err(|e| e.to_string())
}
