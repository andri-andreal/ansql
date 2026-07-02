use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Create migrations table if not exists
    conn.execute(
        "CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // List of migrations
    let migrations = [
        ("001_initial", include_str!("sql/001_initial.sql")),
        ("002_action_journal", include_str!("sql/002_action_journal.sql")),
    ];

    for (name, sql) in migrations.iter() {
        // Check if migration already applied
        let applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM migrations WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;

        if !applied {
            // Run migration
            conn.execute_batch(sql)?;

            // Mark as applied
            conn.execute(
                "INSERT INTO migrations (name) VALUES (?1)",
                [name],
            )?;

            tracing::info!("Applied migration: {}", name);
        }
    }

    Ok(())
}
