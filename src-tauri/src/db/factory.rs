//! Connection options model + driver factory.
//!
//! This module centralizes how a [`DatabaseDriver`] is *built* for a stored
//! connection, folding in the two optional transport concerns:
//!
//! * **SSL/TLS** — carried by [`SslOptions`] and applied by the MySQL/Postgres
//!   drivers' `new(..., ssl)`.
//! * **SSH tunnel** — carried by [`SshOptions`]. When enabled, an [`SshTunnel`]
//!   is opened first and the driver is pointed at the loopback port the tunnel
//!   listens on, so the pool connects *through* the tunnel.
//!
//! Both option sets are persisted as JSON in the connection's existing
//! `options` TEXT column. Secrets (DB password, SSH password, key passphrase)
//! are NOT stored here — they live in the vault and are passed in decrypted.
//!
//! The factory does NOT call `.connect()` on the returned driver; the caller
//! does that afterwards (so the pool dials through the already-open tunnel).
//!
//! NOTE: command handlers are wired to this in a later task (T4).

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde::{Deserialize, Serialize};

use super::driver::{DatabaseDriver, SslOptions};
use super::{MySqlDriver, PostgresDriver, SqliteDriver};
use crate::ssh::{SshAuth, SshTunnel, TunnelConfig};

/// Default SSH port (`22`) for `#[serde(default = ...)]`.
fn default_ssh_port() -> u16 {
    22
}

/// Per-connection transport options, persisted as JSON in the connection's
/// `options` TEXT column. Both fields are optional and default to "off".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectionOptions {
    #[serde(default)]
    pub ssl: Option<SslOptions>,
    #[serde(default)]
    pub ssh: Option<SshOptions>,
}

/// SSH-tunnel configuration for a connection. Secrets (the SSH password and any
/// key passphrase) are stored in the vault and passed to the factory decrypted,
/// NOT held here.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SshOptions {
    #[serde(default)]
    pub enabled: bool,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub user: String,
    /// `"password"` | `"key"`.
    pub auth: String,
    /// Path to the private key on disk (used when `auth == "key"`).
    #[serde(default)]
    pub key_path: Option<String>,
    /// Vault credential id holding the SSH password (used when
    /// `auth == "password"`). The secret itself lives in the vault; only this
    /// reference is persisted in the connection's `options` JSON.
    #[serde(default)]
    pub password_credential_id: Option<String>,
    /// Vault credential id holding the private-key passphrase (used when
    /// `auth == "key"`, optional). The secret lives in the vault; only this
    /// reference is persisted.
    #[serde(default)]
    pub passphrase_credential_id: Option<String>,
}

/// Parse the connection's `options` JSON into [`ConnectionOptions`].
///
/// `None`, empty/whitespace, and *invalid* JSON all degrade to the default
/// (no SSL, no SSH) rather than erroring — a malformed `options` blob should
/// never make a connection un-openable.
pub fn parse_connection_options(options_json: Option<&str>) -> ConnectionOptions {
    match options_json {
        Some(s) if !s.trim().is_empty() => {
            serde_json::from_str(s).unwrap_or_default()
        }
        _ => ConnectionOptions::default(),
    }
}

/// Errors surfaced while building a driver (tunnel setup, key-file read, or an
/// unrecognized driver kind). Driver *connection* errors are not produced here
/// because the factory does not connect.
#[derive(Debug)]
pub enum FactoryError {
    /// Opening the SSH tunnel failed.
    Tunnel(crate::ssh::TunnelError),
    /// Reading the SSH private-key file from disk failed.
    KeyRead { path: String, source: std::io::Error },
    /// The driver string did not match any registered engine (built in:
    /// `mysql` | `postgres` | `sqlite`; more may be added via `register_driver`).
    UnknownDriver(String),
}

impl std::fmt::Display for FactoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FactoryError::Tunnel(e) => write!(f, "failed to open SSH tunnel: {e}"),
            FactoryError::KeyRead { path, source } => {
                write!(f, "failed to read SSH private key '{path}': {source}")
            }
            FactoryError::UnknownDriver(d) => write!(f, "unsupported driver: {d}"),
        }
    }
}

impl std::error::Error for FactoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FactoryError::Tunnel(e) => Some(e),
            FactoryError::KeyRead { source, .. } => Some(source),
            FactoryError::UnknownDriver(_) => None,
        }
    }
}

impl From<crate::ssh::TunnelError> for FactoryError {
    fn from(e: crate::ssh::TunnelError) -> Self {
        FactoryError::Tunnel(e)
    }
}

// ---------------------------------------------------------------------------
// SQL driver registry — the extension seam for additional engines.
//
// The Community core registers its built-in networked engines below. A
// non-Community edition (e.g. ANSQL Pro) can add engines that live outside the
// open-source core by calling `register_driver(...)` once at startup — no edit
// to this file is required. SQLite is handled separately (file-based, never
// tunneled) and is intentionally NOT in the registry.
// ---------------------------------------------------------------------------

/// Constructs a not-yet-connected SQL driver from a resolved endpoint and
/// decrypted credentials. Arguments, in order: `host`, `port`, `username`,
/// `password`, `database` (catalog), and optional [`SslOptions`].
pub type DriverConstructor =
    fn(String, u16, String, String, Option<String>, Option<SslOptions>) -> Box<dyn DatabaseDriver + Send>;

fn driver_registry() -> &'static RwLock<HashMap<String, DriverConstructor>> {
    static REGISTRY: OnceLock<RwLock<HashMap<String, DriverConstructor>>> = OnceLock::new();
    REGISTRY.get_or_init(|| RwLock::new(builtin_drivers()))
}

/// The networked SQL engines built into the Community core.
fn builtin_drivers() -> HashMap<String, DriverConstructor> {
    let mut m: HashMap<String, DriverConstructor> = HashMap::new();
    m.insert("mysql".to_string(), construct_mysql as DriverConstructor);
    m.insert("postgres".to_string(), construct_postgres as DriverConstructor);
    m
}

/// Register (or override) the driver constructor for `name`. Intended to be
/// called once at startup by a non-Community edition to add engines that live
/// outside the open-source core.
pub fn register_driver(name: impl Into<String>, constructor: DriverConstructor) {
    driver_registry()
        .write()
        .expect("driver registry lock poisoned")
        .insert(name.into(), constructor);
}

/// Look up a registered driver constructor by `name` (`None` when unregistered;
/// `"sqlite"` is handled out of band and is never in the registry).
fn driver_constructor(name: &str) -> Option<DriverConstructor> {
    driver_registry()
        .read()
        .expect("driver registry lock poisoned")
        .get(name)
        .copied()
}

fn construct_mysql(
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    ssl: Option<SslOptions>,
) -> Box<dyn DatabaseDriver + Send> {
    Box::new(MySqlDriver::new(host, port, username, password, database, ssl))
}

fn construct_postgres(
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
    ssl: Option<SslOptions>,
) -> Box<dyn DatabaseDriver + Send> {
    Box::new(PostgresDriver::new(host, port, username, password, database, ssl))
}

/// Build a driver for the given connection, opening an SSH tunnel first when
/// the options request one.
///
/// Returns the (NOT-yet-connected) driver and the tunnel, if any. The caller
/// must keep the returned [`SshTunnel`] alive for as long as the driver's pool
/// is in use — dropping it tears the forward down.
///
/// * `driver` — a registered engine name (`"mysql"` | `"postgres"` | `"sqlite"`
///   are built in; others may be registered via `register_driver`).
/// * `host`/`port` — the *real* DB endpoint (as reachable directly, or as
///   resolvable from the bastion when tunneling).
/// * `username`/`password` — decrypted DB credentials.
/// * `database` — optional default database/catalog (for SQLite this is the
///   file path).
/// * `ssh_password` — decrypted SSH password (when `ssh.auth == "password"`).
/// * `ssh_passphrase` — decrypted key passphrase (when `ssh.auth == "key"`,
///   optional).
#[allow(clippy::too_many_arguments)]
pub async fn build_driver_with_tunnel(
    driver: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    options: &ConnectionOptions,
    ssh_password: Option<&str>,
    ssh_passphrase: Option<&str>,
    known_hosts_path: Option<std::path::PathBuf>,
) -> Result<(Box<dyn DatabaseDriver + Send>, Option<SshTunnel>), FactoryError> {
    // SQLite is file-based: SSH/SSL never apply. Mirror `session_commands::connect`
    // (file path + `create_if_missing` left at its default).
    if driver == "sqlite" {
        let path = database.unwrap_or_default().to_string();
        let sqlite = SqliteDriver::new(path);
        return Ok((Box::new(sqlite), None));
    }

    // Resolve the engine against the registry BEFORE opening a tunnel, so an
    // unknown driver fails fast instead of dialing a bastion for nothing.
    let constructor =
        driver_constructor(driver).ok_or_else(|| FactoryError::UnknownDriver(driver.to_string()))?;

    // Determine the effective endpoint, opening a tunnel if requested.
    let mut tunnel: Option<SshTunnel> = None;
    let (effective_host, effective_port) = match &options.ssh {
        Some(ssh) if ssh.enabled => {
            let auth = if ssh.auth == "password" {
                SshAuth::Password(ssh_password.unwrap_or_default().to_string())
            } else {
                let key_path = ssh.key_path.clone().unwrap_or_default();
                let pem = std::fs::read(&key_path).map_err(|source| FactoryError::KeyRead {
                    path: key_path.clone(),
                    source,
                })?;
                SshAuth::Key {
                    pem,
                    passphrase: ssh_passphrase.map(|s| s.to_string()),
                }
            };

            let cfg = TunnelConfig {
                ssh_host: ssh.host.clone(),
                ssh_port: ssh.port,
                ssh_user: ssh.user.clone(),
                auth,
                remote_host: host.to_string(),
                remote_port: port,
                known_hosts_path: known_hosts_path.clone(),
            };

            let opened = SshTunnel::open(cfg).await?;
            let local_port = opened.local_port;
            tunnel = Some(opened);
            ("127.0.0.1".to_string(), local_port)
        }
        _ => (host.to_string(), port),
    };

    let database = database.map(|s| s.to_string());
    let built = constructor(
        effective_host,
        effective_port,
        username.to_string(),
        password.to_string(),
        database,
        options.ssl.clone(),
    );

    Ok((built, tunnel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_options_none_is_default() {
        let opts = parse_connection_options(None);
        assert!(opts.ssl.is_none());
        assert!(opts.ssh.is_none());
    }

    #[test]
    fn parse_options_empty_is_default() {
        assert!(parse_connection_options(Some("")).ssl.is_none());
        assert!(parse_connection_options(Some("   ")).ssh.is_none());
    }

    #[test]
    fn parse_options_invalid_json_is_default_no_panic() {
        let opts = parse_connection_options(Some("{not valid json"));
        assert!(opts.ssl.is_none());
        assert!(opts.ssh.is_none());
    }

    #[test]
    fn parse_options_valid_json_roundtrips() {
        let json = serde_json::json!({
            "ssl": { "mode": "require", "ca_path": "/etc/ca.pem" },
            "ssh": {
                "enabled": true,
                "host": "bastion.example.com",
                "port": 2222,
                "user": "deploy",
                "auth": "key",
                "key_path": "/home/u/.ssh/id_ed25519"
            }
        })
        .to_string();

        let opts = parse_connection_options(Some(&json));

        let ssl = opts.ssl.expect("ssl present");
        assert_eq!(ssl.mode.as_deref(), Some("require"));
        assert_eq!(ssl.ca_path.as_deref(), Some("/etc/ca.pem"));

        let ssh = opts.ssh.expect("ssh present");
        assert!(ssh.enabled);
        assert_eq!(ssh.host, "bastion.example.com");
        assert_eq!(ssh.port, 2222);
        assert_eq!(ssh.user, "deploy");
        assert_eq!(ssh.auth, "key");
        assert_eq!(ssh.key_path.as_deref(), Some("/home/u/.ssh/id_ed25519"));
    }

    #[test]
    fn ssh_port_defaults_to_22_when_absent() {
        let json = serde_json::json!({
            "ssh": { "host": "b", "user": "u", "auth": "password" }
        })
        .to_string();
        let opts = parse_connection_options(Some(&json));
        let ssh = opts.ssh.expect("ssh present");
        assert_eq!(ssh.port, 22);
        assert!(!ssh.enabled); // `enabled` defaults to false
    }

    #[tokio::test]
    async fn sqlite_builds_without_tunnel_and_connects() {
        // SQLite must ignore ssh/ssl entirely and return no tunnel. Use an
        // in-memory db (no server / filesystem) and prove the returned driver
        // actually works end-to-end via the non-network path.
        let opts = ConnectionOptions::default();
        // `SshTunnel` (the `Ok` payload) is not `Debug`, so unwrap via `match`
        // rather than `.expect(...)`, which would require formatting it.
        let (mut driver, tunnel) = match build_driver_with_tunnel(
            "sqlite",
            "ignored-host",
            0,
            "",
            "",
            Some(":memory:"),
            &opts,
            None,
            None,
            None,
        )
        .await
        {
            Ok(pair) => pair,
            Err(e) => panic!("build sqlite driver: {e}"),
        };

        assert!(tunnel.is_none(), "sqlite must not open a tunnel");

        // Factory does not connect; the caller does.
        driver.connect().await.expect("connect sqlite");
        assert!(driver.test_connection().await.expect("test connection"));
    }

    #[tokio::test]
    async fn unknown_driver_errors() {
        let opts = ConnectionOptions::default();
        // The `Ok` payload isn't `Debug`, so avoid `.expect_err(...)`.
        let err = match build_driver_with_tunnel(
            "oracle", "h", 1521, "u", "p", None, &opts, None, None, None,
        )
        .await
        {
            Ok(_) => panic!("unknown driver should error"),
            Err(e) => e,
        };
        assert!(matches!(err, FactoryError::UnknownDriver(d) if d == "oracle"));
    }
}
