-- Connection Groups
CREATE TABLE IF NOT EXISTS groups (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    color           TEXT,
    icon            TEXT,
    parent_id       TEXT REFERENCES groups(id) ON DELETE CASCADE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Encrypted Credentials
CREATE TABLE IF NOT EXISTS credentials (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT CHECK(type IN ('password', 'ssh_key')) NOT NULL,
    encrypted_data  BLOB NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Database Connections
CREATE TABLE IF NOT EXISTS connections (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    driver          TEXT CHECK(driver IN ('mysql', 'postgres', 'sqlite')) NOT NULL,
    host            TEXT,
    port            INTEGER,
    database_name   TEXT,
    username        TEXT,
    credential_id   TEXT REFERENCES credentials(id) ON DELETE SET NULL,
    group_id        TEXT REFERENCES groups(id) ON DELETE SET NULL,
    options         TEXT,
    color           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Query History
CREATE TABLE IF NOT EXISTS query_history (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT REFERENCES connections(id) ON DELETE CASCADE,
    database_name   TEXT,
    query           TEXT NOT NULL,
    execution_time_ms INTEGER,
    row_count       INTEGER,
    success         INTEGER NOT NULL DEFAULT 1,
    error_message   TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Query Folders
CREATE TABLE IF NOT EXISTS query_folders (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    parent_id       TEXT REFERENCES query_folders(id) ON DELETE CASCADE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Favorite Queries
CREATE TABLE IF NOT EXISTS favorite_queries (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    connection_id   TEXT REFERENCES connections(id) ON DELETE SET NULL,
    database_name   TEXT,
    query           TEXT NOT NULL,
    folder_id       TEXT REFERENCES query_folders(id) ON DELETE SET NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User Preferences
CREATE TABLE IF NOT EXISTS preferences (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

-- Activity Logs
CREATE TABLE IF NOT EXISTS logs (
    id              TEXT PRIMARY KEY,
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
    level           TEXT CHECK(level IN ('INFO', 'WARNING', 'ERROR')) NOT NULL,
    category        TEXT CHECK(category IN ('connection', 'query', 'system', 'error')) NOT NULL,
    message         TEXT NOT NULL,
    connection_id   TEXT REFERENCES connections(id) ON DELETE SET NULL,
    details         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Vault metadata
CREATE TABLE IF NOT EXISTS vault_metadata (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    master_password_hash    TEXT NOT NULL,
    salt                    BLOB NOT NULL,
    db_salt                 BLOB NOT NULL,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);
CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_id);
CREATE INDEX IF NOT EXISTS idx_query_history_connection ON query_history(connection_id);
CREATE INDEX IF NOT EXISTS idx_query_history_created ON query_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorite_queries_connection ON favorite_queries(connection_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
