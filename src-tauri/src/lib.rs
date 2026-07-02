mod commands;
mod crypto;
// `db` is public: it's the extension surface for non-Community editions —
// `db::factory::register_driver` plus the `DatabaseDriver` trait and option
// types let a Pro crate add engines on top of the core. See `db/factory.rs`.
pub mod db;
mod ssh;
mod storage;
mod transfer;

use std::sync::Mutex;

use tauri::Manager;
// Re-exported (pub) so Pro command modules (the Redis/Mongo plugins) can build
// on the core types as `ansql_lib::{Database, CredentialVault}`.
pub use storage::Database;
pub use crypto::vault::CredentialVault;
use commands::session_commands::SessionStore;

fn auto_unlock_vault(app_data_dir: &std::path::Path, db: &Database, vault: &Mutex<CredentialVault>) {
    let key_path = app_data_dir.join("vault.key");

    let is_initialized = db.get_vault_metadata()
        .map(|m| m.is_some())
        .unwrap_or(false);

    if key_path.exists() {
        // DEVICE mode: read the device key and auto-unlock (or first-init below
        // if metadata is somehow missing).
        let master_password = match std::fs::read_to_string(&key_path) {
            Ok(key) => key.trim().to_string(),
            Err(e) => {
                tracing::error!("Failed to read vault key: {}", e);
                return;
            }
        };

        if is_initialized {
            if let Ok(Some(metadata)) = db.get_vault_metadata() {
                let mut vault_guard = vault.lock().unwrap();
                if let Err(e) = vault_guard.unlock(&master_password, &metadata.db_salt) {
                    tracing::error!("Failed to unlock vault: {}", e);
                } else {
                    tracing::info!("Vault unlocked automatically (device mode)");
                }
            }
        } else {
            init_device_vault(db, vault, &master_password);
        }
    } else if is_initialized {
        // MASTER mode: vault.key absent + vault initialized. Do NOT auto-unlock
        // and do NOT create a key — the user must enter their master password.
        tracing::info!("Vault is in master-password mode; leaving locked until unlocked by the user");
    } else {
        // FIRST RUN: vault.key absent + not initialized. Create a fresh device
        // key, initialize and auto-unlock.
        use rand::RngCore;
        use base64::Engine;
        let mut key_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key_bytes);
        let master_password = base64::engine::general_purpose::STANDARD.encode(key_bytes);
        // The device key decrypts every stored credential — create it owner-only
        // (0600) so it's never world-readable, not even for the umask window of a
        // plain write.
        if let Err(e) = write_device_key_file(&key_path, &master_password) {
            tracing::error!("Failed to write vault key: {}", e);
            return;
        }
        init_device_vault(db, vault, &master_password);
    }
}

/// Write the device-key file with owner-only (0600) permissions.
///
/// On Unix the file is created directly as 0600 — this closes the umask window
/// in which a plain `write` then `chmod` would leave the key briefly
/// world-readable — and the mode is re-asserted afterwards so overwriting a
/// pre-existing, looser-permissioned key tightens it too. On Windows the
/// per-user AppData ACL already restricts the file to the owning user (an
/// explicit owner-only ACL is a future hardening TODO).
///
/// Shared by every write site (first-run here, plus `disable_master_password`
/// and `reset_vault` in `vault_commands`) so the key is never left world-readable.
pub(crate) fn write_device_key_file(
    path: &std::path::Path,
    contents: &str,
) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(contents.as_bytes())?;
        // `.mode()` only applies when the file is freshly created; re-assert
        // 0600 in case it already existed with looser permissions.
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents)
    }
}

/// Initialize fresh vault metadata for a device key and unlock the vault.
fn init_device_vault(db: &Database, vault: &Mutex<CredentialVault>, master_password: &str) {
    match crypto::vault::hash_password(master_password) {
        Ok((password_hash, _)) => {
            let salt = crypto::vault::generate_salt();
            let db_salt = crypto::vault::generate_salt();
            if let Err(e) = db.save_vault_metadata(&password_hash, &salt, &db_salt) {
                tracing::error!("Failed to save vault metadata: {}", e);
                return;
            }
            let mut vault_guard = vault.lock().unwrap();
            if let Err(e) = vault_guard.unlock(master_password, &db_salt) {
                tracing::error!("Failed to unlock new vault: {}", e);
            } else {
                tracing::info!("Vault initialized and unlocked automatically (device mode)");
            }
        }
        Err(e) => tracing::error!("Failed to hash vault key: {}", e),
    }
}

/// Build the core ANSQL Tauri app — plugins, managed state, the startup setup
/// hook, and all Community command handlers — i.e. everything except the final
/// `.run(...)`. Returned so an edition binary (e.g. ANSQL Pro) can layer extra
/// plugins/commands on top before running. The Community binary is [`run`].
pub fn create_builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(None::<Database>))
        .manage(Mutex::new(CredentialVault::new()))
        .manage(Mutex::new(SessionStore::new()))
        .manage(commands::query_commands::RunningQueries::default())
        .setup(|app| {
            // Initialize database on app start
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            let db_path = app_data_dir.join("ansql.db");
            let db = Database::new(&db_path).expect("Failed to initialize database");

            // Auto-initialize and unlock vault using device key
            let vault_state = app.state::<Mutex<CredentialVault>>();
            auto_unlock_vault(&app_data_dir, &db, &vault_state);

            let db_state = app.state::<Mutex<Option<Database>>>();
            *db_state.lock().unwrap() = Some(db);

            tracing::info!("ANSQL initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Vault commands
            commands::vault_commands::is_vault_initialized,
            commands::vault_commands::initialize_vault,
            commands::vault_commands::unlock_vault,
            commands::vault_commands::lock_vault,
            commands::vault_commands::is_vault_locked,
            commands::vault_commands::set_master_password,
            commands::vault_commands::disable_master_password,
            commands::vault_commands::reset_vault,
            commands::vault_commands::vault_mode,
            // Credential commands
            commands::credential_commands::save_credential,
            commands::credential_commands::get_credential,
            commands::credential_commands::update_credential,
            commands::credential_commands::delete_credential,
            // Connection commands
            commands::connection_commands::get_connections,
            commands::connection_commands::get_connection,
            commands::connection_commands::create_connection,
            commands::connection_commands::update_connection,
            commands::connection_commands::delete_connection,
            commands::connection_commands::test_connection,
            commands::connection_commands::test_connection_params,
            // Group commands
            commands::group_commands::get_groups,
            commands::group_commands::create_group,
            commands::group_commands::update_group,
            commands::group_commands::delete_group,
            // Session commands
            commands::session_commands::connect,
            commands::session_commands::disconnect,
            commands::session_commands::get_sessions,
            commands::session_commands::get_databases,
            commands::session_commands::get_tables,
            commands::session_commands::get_columns,
            commands::session_commands::get_view_definition,
            commands::session_commands::get_indexes,
            commands::session_commands::get_foreign_keys,
            commands::session_commands::get_schema_graph,
            commands::session_commands::get_triggers,
            commands::session_commands::get_fk_lookup,
            // Query commands
            commands::query_commands::execute_query,
            commands::query_commands::execute_mutation,
            commands::query_commands::commit_changes,
            commands::query_commands::cancel_query,
            // Transfer commands
            commands::transfer_commands::preview_transfer,
            commands::transfer_commands::run_transfer,
            commands::transfer_commands::transfer_rows,
            // Export commands
            commands::export_commands::export_to_csv,
            commands::export_commands::export_to_json,
            // History commands
            commands::history_commands::get_query_history,
            commands::history_commands::clear_query_history,
            // Action journal (Time Machine) commands
            commands::journal_commands::journal_record,
            commands::journal_commands::journal_list,
            commands::journal_commands::journal_set_status,
            commands::journal_commands::journal_clear,
            // Favorites commands
            commands::favorites_commands::save_favorite_query,
            commands::favorites_commands::get_favorite_queries,
            commands::favorites_commands::delete_favorite_query,
        ])
}

/// Run the Community edition: initialize logging, then build and launch the
/// core app. A Pro binary calls [`create_builder`] instead and attaches its own
/// plugin (extra commands + driver registrations) before `.run(...)`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing for logging
    tracing_subscriber::fmt::init();

    create_builder()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
