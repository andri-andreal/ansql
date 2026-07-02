use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::migrations;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;

        // Enable foreign keys
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        // Run migrations
        db.migrate()?;

        Ok(db)
    }

    pub fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    fn migrate(&self) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        migrations::run_migrations(&conn)
    }
}
