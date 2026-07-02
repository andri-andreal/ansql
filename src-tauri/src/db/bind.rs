//! JSON-scalar binding helpers for parameterized queries.
//!
//! Each backend has a distinct `Arguments` type, so there is one helper per
//! database. Callers bind values left-to-right in the order the placeholders
//! appear (`?` for MySQL/SQLite, `$1..$n` for Postgres — sqlx maps both to the
//! bind order).
//!
//! NULL must never reach these helpers: the mutation builder emits `NULL` /
//! `IS NULL` as SQL literals, never as a bound parameter. The `Null` / `Array`
//! / `Object` arms below are defensive fallbacks only — arrays/objects (JSON
//! columns) are serialized to a string by the builder before transport.

use serde_json::Value;

/// Bind one JSON scalar onto a SQLite query.
pub fn bind_sqlite<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) if n.is_i64() => q.bind(n.as_i64().unwrap()),
        Value::Number(n) if n.is_u64() => q.bind(n.as_u64().unwrap() as i64),
        Value::Number(n) => q.bind(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => q.bind(s.as_str()),
        Value::Null => q.bind(Option::<String>::None),
        other => q.bind(other.to_string()),
    }
}

/// Bind one JSON scalar onto a MySQL query.
pub fn bind_mysql<'q>(
    q: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match v {
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) if n.is_i64() => q.bind(n.as_i64().unwrap()),
        Value::Number(n) if n.is_u64() => q.bind(n.as_u64().unwrap() as i64),
        Value::Number(n) => q.bind(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => q.bind(s.as_str()),
        Value::Null => q.bind(Option::<String>::None),
        other => q.bind(other.to_string()),
    }
}

/// Bind one JSON scalar onto a Postgres query.
pub fn bind_postgres<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    v: &'q Value,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match v {
        Value::Bool(b) => q.bind(*b),
        Value::Number(n) if n.is_i64() => q.bind(n.as_i64().unwrap()),
        Value::Number(n) if n.is_u64() => q.bind(n.as_u64().unwrap() as i64),
        Value::Number(n) => q.bind(n.as_f64().unwrap_or(0.0)),
        Value::String(s) => q.bind(s.as_str()),
        Value::Null => q.bind(Option::<String>::None),
        other => q.bind(other.to_string()),
    }
}
