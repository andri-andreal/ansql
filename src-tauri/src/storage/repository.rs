use rusqlite::params;
use uuid::Uuid;

use super::models::{ActionJournalEntry, Connection, ConnectionGroup, VaultMetadata, QueryHistory, FavoriteQuery, Credential};
use super::Database;

impl Database {
    // Connection operations
    pub fn get_connections(&self) -> Result<Vec<Connection>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, name, driver, host, port, database_name, username,
                    credential_id, group_id, options, color, created_at, updated_at
             FROM connections
             ORDER BY name"
        )?;

        let connections = stmt.query_map([], |row| {
            Ok(Connection {
                id: row.get(0)?,
                name: row.get(1)?,
                driver: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                database_name: row.get(5)?,
                username: row.get(6)?,
                credential_id: row.get(7)?,
                group_id: row.get(8)?,
                options: row.get(9)?,
                color: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(connections)
    }

    pub fn get_connection(&self, id: &str) -> Result<Option<Connection>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, name, driver, host, port, database_name, username,
                    credential_id, group_id, options, color, created_at, updated_at
             FROM connections
             WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(Connection {
                id: row.get(0)?,
                name: row.get(1)?,
                driver: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                database_name: row.get(5)?,
                username: row.get(6)?,
                credential_id: row.get(7)?,
                group_id: row.get(8)?,
                options: row.get(9)?,
                color: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        });

        match result {
            Ok(connection) => Ok(Some(connection)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn create_connection(
        &self,
        name: &str,
        driver: &str,
        host: Option<&str>,
        port: Option<i32>,
        database_name: Option<&str>,
        username: Option<&str>,
        credential_id: Option<&str>,
        group_id: Option<&str>,
        options: Option<&str>,
        color: Option<&str>,
    ) -> Result<Connection, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO connections (id, name, driver, host, port, database_name, username,
                                      credential_id, group_id, options, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![id, name, driver, host, port, database_name, username,
                    credential_id, group_id, options, color, now, now],
        )?;

        Ok(Connection {
            id,
            name: name.to_string(),
            driver: driver.to_string(),
            host: host.map(|s| s.to_string()),
            port,
            database_name: database_name.map(|s| s.to_string()),
            username: username.map(|s| s.to_string()),
            credential_id: credential_id.map(|s| s.to_string()),
            group_id: group_id.map(|s| s.to_string()),
            options: options.map(|s| s.to_string()),
            color: color.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_connection(
        &self,
        id: &str,
        name: Option<&str>,
        driver: Option<&str>,
        host: Option<&str>,
        port: Option<i32>,
        database_name: Option<&str>,
        username: Option<&str>,
        credential_id: Option<&str>,
        group_id: Option<&str>,
        options: Option<&str>,
        color: Option<&str>,
    ) -> Result<Connection, rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.connection();

        // Build dynamic update query
        let mut updates = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(v) = name {
            updates.push("name = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = driver {
            updates.push("driver = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = host {
            updates.push("host = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = port {
            updates.push("port = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = database_name {
            updates.push("database_name = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = username {
            updates.push("username = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = credential_id {
            updates.push("credential_id = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = group_id {
            updates.push("group_id = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = options {
            updates.push("options = ?");
            values.push(Box::new(v.to_string()));
        }
        if let Some(v) = color {
            updates.push("color = ?");
            values.push(Box::new(v.to_string()));
        }

        updates.push("updated_at = ?");
        values.push(Box::new(now));
        values.push(Box::new(id.to_string()));

        let query = format!(
            "UPDATE connections SET {} WHERE id = ?",
            updates.join(", ")
        );

        let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&query, params.as_slice())?;

        // Drop the connection guard before calling get_connection to avoid deadlock
        drop(conn);

        self.get_connection(id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;
        Ok(())
    }

    // Group operations
    pub fn get_groups(&self) -> Result<Vec<ConnectionGroup>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, icon, parent_id, created_at, updated_at
             FROM groups
             ORDER BY name"
        )?;

        let groups = stmt.query_map([], |row| {
            Ok(ConnectionGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                icon: row.get(4)?,
                parent_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(groups)
    }

    pub fn create_group(
        &self,
        name: &str,
        description: Option<&str>,
        color: Option<&str>,
        icon: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<ConnectionGroup, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO groups (id, name, description, color, icon, parent_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, name, description, color, icon, parent_id, now, now],
        )?;

        Ok(ConnectionGroup {
            id,
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            color: color.map(|s| s.to_string()),
            icon: icon.map(|s| s.to_string()),
            parent_id: parent_id.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_group(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<&str>,
        color: Option<&str>,
        icon: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<ConnectionGroup, rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.connection();

        conn.execute(
            "UPDATE groups SET
                name = COALESCE(?2, name),
                description = COALESCE(?3, description),
                color = COALESCE(?4, color),
                icon = COALESCE(?5, icon),
                parent_id = COALESCE(?6, parent_id),
                updated_at = ?7
             WHERE id = ?1",
            params![id, name, description, color, icon, parent_id, now],
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, icon, parent_id, created_at, updated_at
             FROM groups WHERE id = ?1"
        )?;

        stmt.query_row([id], |row| {
            Ok(ConnectionGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                icon: row.get(4)?,
                parent_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
    }

    pub fn delete_group(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        conn.execute("DELETE FROM groups WHERE id = ?1", [id])?;
        Ok(())
    }

    // Vault operations
    pub fn get_vault_metadata(&self) -> Result<Option<VaultMetadata>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, master_password_hash, salt, db_salt, created_at, updated_at
             FROM vault_metadata WHERE id = 1"
        )?;

        let result = stmt.query_row([], |row| {
            Ok(VaultMetadata {
                id: row.get(0)?,
                master_password_hash: row.get(1)?,
                salt: row.get(2)?,
                db_salt: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        });

        match result {
            Ok(meta) => Ok(Some(meta)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn save_vault_metadata(
        &self,
        password_hash: &str,
        salt: &[u8],
        db_salt: &[u8],
    ) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.connection();

        conn.execute(
            "INSERT OR REPLACE INTO vault_metadata (id, master_password_hash, salt, db_salt, created_at, updated_at)
             VALUES (1, ?1, ?2, ?3, COALESCE((SELECT created_at FROM vault_metadata WHERE id = 1), ?4), ?4)",
            params![password_hash, salt, db_salt, now],
        )?;

        Ok(())
    }

    // Query History operations
    pub fn save_query_history(
        &self,
        connection_id: &str,
        database_name: Option<&str>,
        query: &str,
        execution_time_ms: Option<i32>,
        row_count: Option<i32>,
        success: bool,
        error_message: Option<&str>,
    ) -> Result<QueryHistory, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO query_history (id, connection_id, database_name, query, execution_time_ms, row_count, success, error_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, connection_id, database_name, query, execution_time_ms, row_count, success as i32, error_message, now],
        )?;

        Ok(QueryHistory {
            id,
            connection_id: connection_id.to_string(),
            database_name: database_name.map(|s| s.to_string()),
            query: query.to_string(),
            execution_time_ms,
            row_count,
            success,
            error_message: error_message.map(|s| s.to_string()),
            created_at: now,
        })
    }

    pub fn get_query_history(
        &self,
        connection_id: Option<&str>,
        limit: Option<i32>,
    ) -> Result<Vec<QueryHistory>, rusqlite::Error> {
        let conn = self.connection();

        let (query, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(conn_id) = connection_id {
            (
                format!(
                    "SELECT id, connection_id, database_name, query, execution_time_ms, row_count, success, error_message, created_at
                     FROM query_history
                     WHERE connection_id = ?1
                     ORDER BY created_at DESC
                     LIMIT ?2"
                ),
                vec![Box::new(conn_id.to_string()), Box::new(limit.unwrap_or(100))],
            )
        } else {
            (
                format!(
                    "SELECT id, connection_id, database_name, query, execution_time_ms, row_count, success, error_message, created_at
                     FROM query_history
                     ORDER BY created_at DESC
                     LIMIT ?1"
                ),
                vec![Box::new(limit.unwrap_or(100))],
            )
        };

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&query)?;

        let history = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(QueryHistory {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                database_name: row.get(2)?,
                query: row.get(3)?,
                execution_time_ms: row.get(4)?,
                row_count: row.get(5)?,
                success: row.get::<_, i32>(6)? == 1,
                error_message: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(history)
    }

    pub fn clear_query_history(
        &self,
        connection_id: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.connection();

        if let Some(conn_id) = connection_id {
            conn.execute("DELETE FROM query_history WHERE connection_id = ?1", [conn_id])?;
        } else {
            conn.execute("DELETE FROM query_history", [])?;
        }

        Ok(())
    }

    // Favorite Queries operations
    pub fn save_favorite_query(
        &self,
        name: &str,
        description: Option<&str>,
        connection_id: Option<&str>,
        database_name: Option<&str>,
        query: &str,
        folder_id: Option<&str>,
    ) -> Result<FavoriteQuery, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO favorite_queries (id, name, description, connection_id, database_name, query, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, name, description, connection_id, database_name, query, folder_id, now, now],
        )?;

        Ok(FavoriteQuery {
            id,
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            connection_id: connection_id.map(|s| s.to_string()),
            database_name: database_name.map(|s| s.to_string()),
            query: query.to_string(),
            folder_id: folder_id.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_favorite_queries(
        &self,
        connection_id: Option<&str>,
    ) -> Result<Vec<FavoriteQuery>, rusqlite::Error> {
        let conn = self.connection();

        let (query_sql, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(conn_id) = connection_id {
            (
                "SELECT id, name, description, connection_id, database_name, query, folder_id, created_at, updated_at
                 FROM favorite_queries
                 WHERE connection_id = ?1 OR connection_id IS NULL
                 ORDER BY name".to_string(),
                vec![Box::new(conn_id.to_string())],
            )
        } else {
            (
                "SELECT id, name, description, connection_id, database_name, query, folder_id, created_at, updated_at
                 FROM favorite_queries
                 ORDER BY name".to_string(),
                vec![],
            )
        };

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&query_sql)?;

        let favorites = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(FavoriteQuery {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                connection_id: row.get(3)?,
                database_name: row.get(4)?,
                query: row.get(5)?,
                folder_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(favorites)
    }

    pub fn delete_favorite_query(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        conn.execute("DELETE FROM favorite_queries WHERE id = ?1", [id])?;
        Ok(())
    }

    // Credential operations
    pub fn save_credential(
        &self,
        name: &str,
        credential_type: &str,
        encrypted_data: &[u8],
    ) -> Result<Credential, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO credentials (id, name, type, encrypted_data, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, credential_type, encrypted_data, now, now],
        )?;

        Ok(Credential {
            id,
            name: name.to_string(),
            credential_type: credential_type.to_string(),
            encrypted_data: encrypted_data.to_vec(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_credential(&self, id: &str) -> Result<Option<Credential>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT id, name, type, encrypted_data, created_at, updated_at
             FROM credentials
             WHERE id = ?1"
        )?;

        let result = stmt.query_row([id], |row| {
            Ok(Credential {
                id: row.get(0)?,
                name: row.get(1)?,
                credential_type: row.get(2)?,
                encrypted_data: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        });

        match result {
            Ok(credential) => Ok(Some(credential)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn update_credential(
        &self,
        id: &str,
        encrypted_data: &[u8],
    ) -> Result<Credential, rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.connection();

        conn.execute(
            "UPDATE credentials SET encrypted_data = ?1, updated_at = ?2 WHERE id = ?3",
            params![encrypted_data, now, id],
        )?;

        // Drop the connection guard before calling get_credential to avoid deadlock
        drop(conn);

        self.get_credential(id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn delete_credential(&self, id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        conn.execute("DELETE FROM credentials WHERE id = ?1", [id])?;
        Ok(())
    }

    /// List every stored credential as (id, encrypted_data blob). Used by vault
    /// re-key to re-encrypt all secrets under a new key.
    pub fn list_credential_blobs(&self) -> Result<Vec<(String, Vec<u8>)>, rusqlite::Error> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT id, encrypted_data FROM credentials")?;

        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    /// Atomically write back re-encrypted credential blobs and update vault
    /// metadata (master_password_hash; db_salt unchanged) in ONE transaction.
    /// If anything fails the transaction rolls back and nothing is written.
    pub fn rekey_credentials(
        &self,
        new_blobs: &[(String, Vec<u8>)],
        new_password_hash: &str,
        db_salt: &[u8],
    ) -> Result<(), rusqlite::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = self.connection();
        let tx = conn.transaction()?;

        for (id, blob) in new_blobs {
            tx.execute(
                "UPDATE credentials SET encrypted_data = ?1, updated_at = ?2 WHERE id = ?3",
                params![blob, now, id],
            )?;
        }

        tx.execute(
            "UPDATE vault_metadata SET master_password_hash = ?1, db_salt = ?2, updated_at = ?3 WHERE id = 1",
            params![new_password_hash, db_salt, now],
        )?;

        tx.commit()?;
        Ok(())
    }

    // Action Journal (Time Machine) operations
    #[allow(clippy::too_many_arguments)]
    pub fn record_action(
        &self,
        connection_id: Option<&str>,
        database_name: Option<&str>,
        table_name: Option<&str>,
        kind: &str,
        label: &str,
        forward_sql: &str,
        inverse_sql: &str,
        tier: i32,
        affected_rows: Option<i32>,
    ) -> Result<ActionJournalEntry, rusqlite::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = self.connection();
        conn.execute(
            "INSERT INTO action_journal
                (id, connection_id, database_name, table_name, kind, label,
                 forward_sql, inverse_sql, tier, status, affected_rows, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'applied', ?10, ?11)",
            params![id, connection_id, database_name, table_name, kind, label,
                    forward_sql, inverse_sql, tier, affected_rows, now],
        )?;

        Ok(ActionJournalEntry {
            id,
            connection_id: connection_id.map(|s| s.to_string()),
            database_name: database_name.map(|s| s.to_string()),
            table_name: table_name.map(|s| s.to_string()),
            kind: kind.to_string(),
            label: label.to_string(),
            forward_sql: forward_sql.to_string(),
            inverse_sql: inverse_sql.to_string(),
            tier,
            status: "applied".to_string(),
            affected_rows,
            created_at: now,
        })
    }

    pub fn get_action_journal(
        &self,
        connection_id: Option<&str>,
        limit: Option<i32>,
    ) -> Result<Vec<ActionJournalEntry>, rusqlite::Error> {
        let conn = self.connection();

        let (query, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(conn_id) = connection_id {
            (
                "SELECT id, connection_id, database_name, table_name, kind, label,
                        forward_sql, inverse_sql, tier, status, affected_rows, created_at
                 FROM action_journal
                 WHERE connection_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2".to_string(),
                vec![Box::new(conn_id.to_string()), Box::new(limit.unwrap_or(200))],
            )
        } else {
            (
                "SELECT id, connection_id, database_name, table_name, kind, label,
                        forward_sql, inverse_sql, tier, status, affected_rows, created_at
                 FROM action_journal
                 ORDER BY created_at DESC
                 LIMIT ?1".to_string(),
                vec![Box::new(limit.unwrap_or(200))],
            )
        };

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&query)?;

        let entries = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(ActionJournalEntry {
                id: row.get(0)?,
                connection_id: row.get(1)?,
                database_name: row.get(2)?,
                table_name: row.get(3)?,
                kind: row.get(4)?,
                label: row.get(5)?,
                forward_sql: row.get(6)?,
                inverse_sql: row.get(7)?,
                tier: row.get(8)?,
                status: row.get(9)?,
                affected_rows: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// Flip an action's status ('applied' ⇄ 'undone') after its inverse/forward
    /// statements have been re-run against the live database.
    pub fn set_action_status(&self, id: &str, status: &str) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        conn.execute(
            "UPDATE action_journal SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn clear_action_journal(
        &self,
        connection_id: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.connection();
        if let Some(conn_id) = connection_id {
            conn.execute("DELETE FROM action_journal WHERE connection_id = ?1", [conn_id])?;
        } else {
            conn.execute("DELETE FROM action_journal", [])?;
        }
        Ok(())
    }

    /// Wipe all saved secrets and vault metadata (forgotten-password escape).
    /// Connections survive; they only reference credential ids.
    pub fn reset_vault_storage(&self) -> Result<(), rusqlite::Error> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM credentials", [])?;
        tx.execute("DELETE FROM vault_metadata", [])?;
        tx.commit()?;
        Ok(())
    }
}
