-- Action Journal (Time Machine): one row per reversible action the app applied.
-- forward_sql / inverse_sql hold a JSON-encoded array of {sql, params} statements.
CREATE TABLE IF NOT EXISTS action_journal (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT,
    database_name   TEXT,
    table_name      TEXT,
    kind            TEXT NOT NULL,                    -- 'grid_dml' | 'raw_sql'
    label           TEXT NOT NULL,
    forward_sql     TEXT NOT NULL,                    -- JSON: Statement[]
    inverse_sql     TEXT NOT NULL,                    -- JSON: Statement[]
    tier            INTEGER NOT NULL DEFAULT 1,       -- 1 = reversible, 2 = best-effort
    status          TEXT NOT NULL DEFAULT 'applied',  -- 'applied' | 'undone'
    affected_rows   INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_action_journal_created ON action_journal(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_journal_connection ON action_journal(connection_id);
