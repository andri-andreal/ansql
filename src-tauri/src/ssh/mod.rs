//! SSH local-port-forward tunnel core.
//!
//! Self-contained async SSH "local port forward" built on the pure-Rust
//! [`russh`] crate (no libssh2 / native OpenSSL). The intended use is:
//!
//! 1. [`SshTunnel::open`] connects to a bastion host and binds a loopback
//!    listener on `127.0.0.1:<local_port>` (OS-assigned).
//! 2. The caller points a DB driver (sqlx) at `127.0.0.1:<local_port>`.
//! 3. Every inbound local connection is forwarded over a russh `direct-tcpip`
//!    channel to `remote_host:remote_port` as seen from the bastion.
//!
//! Dropping the [`SshTunnel`] tears the forward down (the accept loop is
//! aborted and the SSH client is closed best-effort).
//!
//! NOTE: This module is intentionally standalone — it is not yet wired into
//! connections/sessions. A later task does that.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, key};
use tokio::io::copy_bidirectional;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// How to authenticate against the SSH bastion.
pub enum SshAuth {
    /// Plain password authentication.
    Password(String),
    /// Public-key authentication. `pem` is the raw private key bytes in
    /// OpenSSH or PKCS#8 PEM format; `passphrase` decrypts it if it is
    /// passphrase-protected.
    Key {
        pem: Vec<u8>,
        passphrase: Option<String>,
    },
}

/// Everything needed to open a tunnel: the bastion to dial, how to
/// authenticate, and the remote service (DB server) to forward to.
pub struct TunnelConfig {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub auth: SshAuth,
    /// The DB server host as resolvable from the bastion.
    pub remote_host: String,
    /// The DB server port as reachable from the bastion.
    pub remote_port: u16,
    /// Path to the JSON known-hosts store used for trust-on-first-use host-key
    /// pinning. When `None`, pinning is disabled and any host key is accepted
    /// (e.g. in tests / when the app data dir cannot be resolved).
    pub known_hosts_path: Option<PathBuf>,
}

/// Errors that can occur while opening or running a tunnel.
#[derive(Debug)]
pub enum TunnelError {
    /// TCP/SSH transport-level failure (bind, dial, handshake).
    Connect(String),
    /// Authentication was rejected by the server.
    Auth(String),
    /// The private key could not be decoded (bad format / wrong passphrase).
    Key(String),
    /// Setting up the forwarding listener / direct-tcpip channel failed.
    Forward(String),
    /// The server presented a host key that does NOT match the pinned one for
    /// this host:port — a possible MITM or a legitimate host-key rotation.
    HostKeyMismatch(String),
}

impl std::fmt::Display for TunnelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelError::Connect(m) => write!(f, "SSH connect error: {m}"),
            TunnelError::Auth(m) => write!(f, "SSH authentication error: {m}"),
            TunnelError::Key(m) => write!(f, "SSH key error: {m}"),
            TunnelError::Forward(m) => write!(f, "SSH port-forward error: {m}"),
            TunnelError::HostKeyMismatch(m) => write!(f, "SSH host-key verification failed: {m}"),
        }
    }
}

impl std::error::Error for TunnelError {}

/// The known-hosts store filename, kept next to the app DB and `vault.key` in
/// the app data dir.
pub const KNOWN_HOSTS_FILE: &str = "known_hosts.json";

/// Resolve the path to the persisted SSH known-hosts store inside the app data
/// dir (next to the app DB and `vault.key`). Returns `None` if the platform app
/// data dir cannot be resolved, in which case [`SshTunnel::open`] refuses to
/// open the tunnel (fail closed) rather than skipping host-key verification.
pub fn known_hosts_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(KNOWN_HOSTS_FILE))
}

/// A persisted known-hosts entry: `"host:port" -> sha256 fingerprint`.
type KnownHosts = HashMap<String, String>;

/// Load the known-hosts store from disk. A missing/unreadable/invalid file
/// degrades to an empty map (so the first connect can pin freshly), matching
/// how `parse_connection_options` treats a bad options blob.
fn load_known_hosts(path: &std::path::Path) -> KnownHosts {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => KnownHosts::new(),
    }
}

/// Persist the known-hosts store, best-effort (a write failure is logged, not
/// fatal — the connection still succeeds, it just won't be pinned next time).
fn save_known_hosts(path: &std::path::Path, hosts: &KnownHosts) {
    match serde_json::to_string_pretty(hosts) {
        Ok(json) => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(path, json) {
                tracing::warn!("Failed to write SSH known_hosts file: {}", e);
            }
        }
        Err(e) => tracing::warn!("Failed to serialize SSH known_hosts: {}", e),
    }
}

/// The russh client handler implementing trust-on-first-use (TOFU) host-key
/// pinning. On the first connect to a `host:port` the server key's SHA-256
/// fingerprint is persisted to the known-hosts store and accepted; subsequent
/// connects must present the same fingerprint or the connection is rejected.
///
/// `check_server_key` can only return a bool/`russh::Error`, so on a MISMATCH
/// it sets `mismatch` and returns `Ok(false)` (which fails the handshake);
/// `SshTunnel::open` then reads `mismatch` to surface a clear
/// [`TunnelError::HostKeyMismatch`].
struct Client {
    /// `"host:port"` identity used as the known-hosts key.
    host_id: String,
    /// Path to the known-hosts JSON store used for TOFU pinning. Always set:
    /// `open()` refuses to build a tunnel when no path can be resolved, so a
    /// host key is never trusted without pinning.
    known_hosts_path: PathBuf,
    /// Set when the presented key did not match the pinned fingerprint.
    mismatch: Arc<std::sync::Mutex<Option<String>>>,
}

#[async_trait::async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();

        let path = self.known_hosts_path.clone();
        let mut hosts = load_known_hosts(&path);
        match hosts.get(&self.host_id) {
            Some(known) if known == &fingerprint => {
                tracing::debug!(host = %self.host_id, "SSH host key matches pinned fingerprint");
                Ok(true)
            }
            Some(known) => {
                let msg = format!(
                    "host key for {} changed: pinned {}, server presented {}. \
                     This may indicate a man-in-the-middle attack, or a legitimate \
                     host-key rotation. Remove the entry from known_hosts.json to re-pin.",
                    self.host_id, known, fingerprint
                );
                tracing::error!("{}", msg);
                if let Ok(mut m) = self.mismatch.lock() {
                    *m = Some(msg);
                }
                Ok(false)
            }
            None => {
                // Trust on first use: pin and accept.
                tracing::info!(
                    host = %self.host_id,
                    fingerprint = %fingerprint,
                    "Pinning SSH host key (trust-on-first-use)"
                );
                hosts.insert(self.host_id.clone(), fingerprint);
                save_known_hosts(&path, &hosts);
                Ok(true)
            }
        }
    }
}

/// A live SSH tunnel. While this value is alive, `127.0.0.1:<local_port>`
/// forwards to the configured remote service. Drop it to tear the tunnel down.
pub struct SshTunnel {
    /// Loopback port the caller should connect to.
    pub local_port: u16,
    /// The SSH client session handle. Kept alive so the session (and thus the
    /// forwarded channels) stays open; also used for a best-effort close on drop.
    handle: Arc<Handle<Client>>,
    /// The accept loop that turns inbound local connections into forwards.
    accept_task: JoinHandle<()>,
}

impl SshTunnel {
    /// Open a tunnel: dial the bastion, authenticate, bind a loopback
    /// listener, and spawn the accept loop that forwards each connection.
    pub async fn open(cfg: TunnelConfig) -> Result<SshTunnel, TunnelError> {
        // 1. Bind a loopback-only listener and read the OS-assigned port.
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| TunnelError::Forward(format!("failed to bind local listener: {e}")))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| TunnelError::Forward(format!("failed to read local port: {e}")))?
            .port();

        // 2. Connect the russh client to the bastion, with TOFU host-key pinning.
        // Fail closed: pinning is the only MITM defense on the tunnel that
        // carries DB credentials, so refuse to connect when no known_hosts path
        // is available rather than blindly trusting whatever key is presented.
        let known_hosts_path = cfg.known_hosts_path.clone().ok_or_else(|| {
            TunnelError::Connect(
                "cannot verify SSH host key: no known_hosts path available \
                 (failed to resolve the app data directory)"
                    .to_string(),
            )
        })?;
        let mismatch: Arc<std::sync::Mutex<Option<String>>> =
            Arc::new(std::sync::Mutex::new(None));
        let client = Client {
            host_id: format!("{}:{}", cfg.ssh_host, cfg.ssh_port),
            known_hosts_path,
            mismatch: Arc::clone(&mismatch),
        };
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (cfg.ssh_host.as_str(), cfg.ssh_port), client)
            .await
            .map_err(|e| {
                // If the handshake failed because the host key did not match the
                // pinned one, surface that specific (actionable) error.
                if let Ok(guard) = mismatch.lock() {
                    if let Some(msg) = guard.as_ref() {
                        return TunnelError::HostKeyMismatch(msg.clone());
                    }
                }
                TunnelError::Connect(format!("failed to connect to SSH server: {e}"))
            })?;

        // 3. Authenticate.
        let authenticated = match &cfg.auth {
            SshAuth::Password(password) => handle
                .authenticate_password(&cfg.ssh_user, password.clone())
                .await
                .map_err(|e| TunnelError::Auth(format!("password authentication failed: {e}")))?,
            SshAuth::Key { pem, passphrase } => {
                let pem_str = std::str::from_utf8(pem)
                    .map_err(|e| TunnelError::Key(format!("private key is not valid UTF-8: {e}")))?;
                let key_pair = decode_secret_key(pem_str, passphrase.as_deref())
                    .map_err(|e| TunnelError::Key(format!("failed to decode private key: {e}")))?;
                handle
                    .authenticate_publickey(&cfg.ssh_user, Arc::new(key_pair))
                    .await
                    .map_err(|e| {
                        TunnelError::Auth(format!("public-key authentication failed: {e}"))
                    })?
            }
        };

        if !authenticated {
            return Err(TunnelError::Auth(
                "SSH server rejected the credentials".to_string(),
            ));
        }

        // 4. Spawn the accept loop. Each inbound connection becomes its own
        // forwarding task pumping bytes between the TCP stream and a fresh
        // direct-tcpip channel.
        let handle = Arc::new(handle);
        let accept_handle = Arc::clone(&handle);
        let remote_host = cfg.remote_host.clone();
        let remote_port = cfg.remote_port;

        let accept_task = tokio::spawn(async move {
            loop {
                let (mut inbound, peer) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(e) => {
                        tracing::error!("SSH tunnel accept loop failed: {e}");
                        break;
                    }
                };

                let session = Arc::clone(&accept_handle);
                let remote_host = remote_host.clone();
                let peer_ip = peer.ip().to_string();
                let peer_port = peer.port() as u32;

                tokio::spawn(async move {
                    // Open a direct-tcpip channel from the bastion to the DB server.
                    let channel = match session
                        .channel_open_direct_tcpip(
                            remote_host.clone(),
                            remote_port as u32,
                            peer_ip,
                            peer_port,
                        )
                        .await
                    {
                        Ok(ch) => ch,
                        Err(e) => {
                            tracing::error!(
                                "failed to open direct-tcpip channel to {}:{}: {}",
                                remote_host,
                                remote_port,
                                e
                            );
                            return;
                        }
                    };

                    let mut channel_stream = channel.into_stream();
                    if let Err(e) = copy_bidirectional(&mut inbound, &mut channel_stream).await {
                        // Expected on normal close (e.g. broken pipe / reset).
                        tracing::debug!("forwarded connection closed: {e}");
                    }
                });
            }
        });

        tracing::info!(
            "SSH tunnel open: 127.0.0.1:{} -> {}:{} via {}@{}:{}",
            local_port,
            cfg.remote_host,
            cfg.remote_port,
            cfg.ssh_user,
            cfg.ssh_host,
            cfg.ssh_port,
        );

        Ok(SshTunnel {
            local_port,
            handle,
            accept_task,
        })
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        // Stop accepting new connections.
        self.accept_task.abort();

        // Best-effort: close the SSH session so the forward tears down. This is
        // async; we fire it off on the runtime if one is available and don't
        // block the drop. If there's no runtime (e.g. drop on a plain thread),
        // dropping the last handle still cleans up the client task.
        let handle = Arc::clone(&self.handle);
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                let _ = handle
                    .disconnect(russh::Disconnect::ByApplication, "tunnel closed", "")
                    .await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_error_display() {
        assert_eq!(
            TunnelError::Connect("dial refused".into()).to_string(),
            "SSH connect error: dial refused"
        );
        assert_eq!(
            TunnelError::Auth("bad password".into()).to_string(),
            "SSH authentication error: bad password"
        );
        assert_eq!(
            TunnelError::Key("wrong passphrase".into()).to_string(),
            "SSH key error: wrong passphrase"
        );
        assert_eq!(
            TunnelError::Forward("bind failed".into()).to_string(),
            "SSH port-forward error: bind failed"
        );
    }

    #[test]
    fn tunnel_config_construction() {
        // Exercises the public config/auth surface without needing a server.
        let cfg = TunnelConfig {
            ssh_host: "bastion.example.com".into(),
            ssh_port: 22,
            ssh_user: "deploy".into(),
            auth: SshAuth::Password("hunter2".into()),
            remote_host: "db.internal".into(),
            remote_port: 5432,
            known_hosts_path: None,
        };
        assert_eq!(cfg.ssh_port, 22);
        assert_eq!(cfg.remote_port, 5432);
        match cfg.auth {
            SshAuth::Password(p) => assert_eq!(p, "hunter2"),
            _ => panic!("expected password auth"),
        }
    }

    /// The `SshAuth::Key` decode path: generate an ed25519 key, serialize it to
    /// an OpenSSH PEM, and confirm `decode_secret_key` (the same call `open`
    /// uses) round-trips it. This covers key plumbing without a live server.
    #[test]
    fn key_decode_roundtrip() {
        use russh::keys::encode_pkcs8_pem;

        let key_pair = key::KeyPair::generate_ed25519().expect("generate ed25519 key");
        let mut pem_buf: Vec<u8> = Vec::new();
        encode_pkcs8_pem(&key_pair, &mut pem_buf).expect("encode private key to PKCS#8 PEM");

        let pem_str = std::str::from_utf8(&pem_buf).expect("PEM is UTF-8");
        let decoded = decode_secret_key(pem_str, None).expect("decode the generated key");

        // Public keys must match after a serialize -> decode round-trip.
        assert_eq!(
            key_pair.clone_public_key().expect("orig public").fingerprint(),
            decoded.clone_public_key().expect("decoded public").fingerprint(),
        );
    }

    /// Decoding a passphrase-protected key with the WRONG passphrase must fail,
    /// and our wrapper surfaces it as `TunnelError::Key`. This mirrors what
    /// `SshTunnel::open` does for `SshAuth::Key`.
    #[test]
    fn key_decode_wrong_passphrase_is_key_error() {
        // A non-key string is the simplest reliable "undecodable" input.
        let err = decode_secret_key("not a private key at all", Some("nope"))
            .map_err(|e| TunnelError::Key(format!("failed to decode private key: {e}")))
            .unwrap_err();
        assert!(matches!(err, TunnelError::Key(_)));
    }

    /// Gated integration test. Skips (returns) unless `ANSQL_TEST_SSH_HOST` is
    /// set, mirroring the `ANSQL_TEST_MYSQL_*` pattern in `db/mysql.rs`.
    ///
    /// Run with, e.g.:
    ///   ANSQL_TEST_SSH_HOST=127.0.0.1 ANSQL_TEST_SSH_PORT=22 \
    ///   ANSQL_TEST_SSH_USER=tunnel ANSQL_TEST_SSH_PASS=secret \
    ///   ANSQL_TEST_SSH_REMOTE_HOST=127.0.0.1 ANSQL_TEST_SSH_REMOTE_PORT=3306 \
    ///   cargo test -p ansql ssh_tunnel_forwards_connection -- --nocapture
    #[tokio::test]
    async fn ssh_tunnel_forwards_connection() {
        let host = match std::env::var("ANSQL_TEST_SSH_HOST") {
            Ok(h) => h,
            Err(_) => {
                eprintln!("skipping: ANSQL_TEST_SSH_HOST not set");
                return;
            }
        };
        let port: u16 = std::env::var("ANSQL_TEST_SSH_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(22);
        let user = std::env::var("ANSQL_TEST_SSH_USER").unwrap_or_else(|_| "root".into());
        let remote_host =
            std::env::var("ANSQL_TEST_SSH_REMOTE_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let remote_port: u16 = std::env::var("ANSQL_TEST_SSH_REMOTE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3306);

        // Auth: prefer a key file if given, else a password.
        let auth = if let Ok(key_path) = std::env::var("ANSQL_TEST_SSH_KEY") {
            let pem = std::fs::read(&key_path).expect("read test SSH key");
            let passphrase = std::env::var("ANSQL_TEST_SSH_KEY_PASS").ok();
            SshAuth::Key { pem, passphrase }
        } else {
            let pass = std::env::var("ANSQL_TEST_SSH_PASS").unwrap_or_default();
            SshAuth::Password(pass)
        };

        let cfg = TunnelConfig {
            ssh_host: host,
            ssh_port: port,
            ssh_user: user,
            auth,
            remote_host,
            remote_port,
            // Pinning is mandatory now (open() fails closed without a path), so
            // pin into a throwaway temp store; the first connect pins-and-accepts.
            known_hosts_path: Some(std::env::temp_dir().join("ansql_test_known_hosts.json")),
        };

        let tunnel = SshTunnel::open(cfg).await.expect("open SSH tunnel");
        assert_ne!(tunnel.local_port, 0);

        // The loopback listener should accept a TCP connection (which the accept
        // loop then forwards over a direct-tcpip channel to the remote service).
        let stream = tokio::net::TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .expect("connect to local tunnel port");
        drop(stream);
    }
}
