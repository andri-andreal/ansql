use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub host: Option<String>,
    pub port: Option<i32>,
    #[serde(rename = "database")]
    pub database_name: Option<String>,
    pub username: Option<String>,
    pub credential_id: Option<String>,
    pub group_id: Option<String>,
    pub options: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub credential_type: String,
    #[serde(skip_serializing)]
    pub encrypted_data: Vec<u8>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistory {
    pub id: String,
    pub connection_id: String,
    #[serde(rename = "database")]
    pub database_name: Option<String>,
    pub query: String,
    pub execution_time_ms: Option<i32>,
    pub row_count: Option<i32>,
    pub success: bool,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteQuery {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub connection_id: Option<String>,
    #[serde(rename = "database")]
    pub database_name: Option<String>,
    pub query: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionJournalEntry {
    pub id: String,
    pub connection_id: Option<String>,
    #[serde(rename = "database")]
    pub database_name: Option<String>,
    #[serde(rename = "table")]
    pub table_name: Option<String>,
    pub kind: String,
    pub label: String,
    pub forward_sql: String,
    pub inverse_sql: String,
    pub tier: i32,
    pub status: String,
    pub affected_rows: Option<i32>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMetadata {
    pub id: i32,
    pub master_password_hash: String,
    pub salt: Vec<u8>,
    pub db_salt: Vec<u8>,
    pub created_at: String,
    pub updated_at: Option<String>,
}
