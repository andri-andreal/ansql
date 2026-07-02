use crate::transfer::type_map::CanonicalType;
use crate::transfer::Dialect;
use serde_json::Value;

pub fn quote_ident(dialect: Dialect, name: &str) -> String {
    match dialect {
        Dialect::MySql => format!("`{}`", name.replace('`', "``")),
        Dialect::Postgres | Dialect::Sqlite => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

/// Single-quote and escape a string literal for the given dialect.
///
/// MySQL (with the default `sql_mode`, i.e. `NO_BACKSLASH_ESCAPES` off) treats `\`
/// as an escape character inside string literals, so backslashes must be doubled
/// there. Postgres and SQLite use standard-conforming strings where only the single
/// quote needs doubling.
fn quote_string(dialect: Dialect, s: &str) -> String {
    match dialect {
        Dialect::MySql => format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''")),
        Dialect::Postgres | Dialect::Sqlite => format!("'{}'", s.replace('\'', "''")),
    }
}

/// Render a JSON value as a SQL literal appropriate for the target dialect and type.
pub fn format_value(dialect: Dialect, value: &Value, ty: &CanonicalType) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        // JSON/JSONB target: the literal must itself be valid JSON. serde_json's
        // Display yields valid JSON for every kind (string -> "...", number, bool,
        // object, array), so quote the full serialization. Without this, scalar
        // JSON values (a bare string/number/bool) were emitted as plain SQL
        // literals and Postgres rejected them: "invalid input syntax for type json".
        _ if matches!(ty, CanonicalType::Json) => quote_string(dialect, &value.to_string()),
        Value::Bool(b) => match (dialect, ty) {
            (Dialect::Postgres, CanonicalType::Boolean) => {
                if *b { "TRUE".into() } else { "FALSE".into() }
            }
            _ => if *b { "1".into() } else { "0".into() },
        },
        Value::Number(n) => n.to_string(),
        Value::String(s) => {
            // Booleans sometimes arrive as strings from drivers.
            if matches!(ty, CanonicalType::Boolean) {
                let truthy = matches!(s.as_str(), "1" | "true" | "t" | "TRUE");
                return match dialect {
                    Dialect::Postgres => if truthy { "TRUE".into() } else { "FALSE".into() },
                    _ => if truthy { "1".into() } else { "0".into() },
                };
            }
            quote_string(dialect, s)
        }
        // Arrays/objects (e.g. JSON columns) -> serialize compactly and quote.
        Value::Array(_) | Value::Object(_) => quote_string(dialect, &value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn quotes_identifiers_per_dialect() {
        assert_eq!(quote_ident(Dialect::MySql, "users"), "`users`");
        assert_eq!(quote_ident(Dialect::Postgres, "users"), "\"users\"");
        assert_eq!(quote_ident(Dialect::Sqlite, "users"), "\"users\"");
    }

    #[test]
    fn quote_escapes_embedded_quotes() {
        assert_eq!(quote_ident(Dialect::MySql, "a`b"), "`a``b`");
        assert_eq!(quote_ident(Dialect::Postgres, "a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn formats_null_and_strings() {
        assert_eq!(format_value(Dialect::Postgres, &Value::Null, &CanonicalType::Text), "NULL");
        assert_eq!(
            format_value(Dialect::MySql, &json!("O'Brien"), &CanonicalType::Text),
            "'O''Brien'"
        );
    }

    #[test]
    fn formats_booleans_per_dialect() {
        assert_eq!(format_value(Dialect::Postgres, &json!(true), &CanonicalType::Boolean), "TRUE");
        assert_eq!(format_value(Dialect::MySql, &json!(true), &CanonicalType::Boolean), "1");
        assert_eq!(format_value(Dialect::Sqlite, &json!(false), &CanonicalType::Boolean), "0");
    }

    #[test]
    fn escapes_backslashes_for_mysql_only() {
        // MySQL: backslashes doubled (escape char), single quote doubled.
        assert_eq!(
            format_value(Dialect::MySql, &json!("C:\\Users\\O'Brien"), &CanonicalType::Text),
            "'C:\\\\Users\\\\O''Brien'"
        );
        // Postgres/SQLite: standard strings — backslash left as-is, only quote doubled.
        assert_eq!(
            format_value(Dialect::Postgres, &json!("C:\\path"), &CanonicalType::Text),
            "'C:\\path'"
        );
    }

    #[test]
    fn formats_numbers_and_json() {
        assert_eq!(format_value(Dialect::MySql, &json!(42), &CanonicalType::Integer), "42");
        let obj = json!({"a": 1});
        assert_eq!(
            format_value(Dialect::Postgres, &obj, &CanonicalType::Json),
            "'{\"a\":1}'"
        );
    }

    #[test]
    fn json_column_serializes_every_value_kind_as_valid_json() {
        use CanonicalType::Json;
        // A scalar JSON string must become a VALID json literal '"hello"', not
        // 'hello' — Postgres rejects the latter: "invalid input syntax for type json".
        assert_eq!(format_value(Dialect::Postgres, &json!("hello"), &Json), "'\"hello\"'");
        // Scalar number / bool must also be valid JSON literals.
        assert_eq!(format_value(Dialect::Postgres, &json!(42), &Json), "'42'");
        assert_eq!(format_value(Dialect::Postgres, &json!(true), &Json), "'true'");
        // Objects / arrays keep working.
        assert_eq!(format_value(Dialect::Postgres, &json!({"a": 1}), &Json), "'{\"a\":1}'");
        assert_eq!(format_value(Dialect::Postgres, &json!([1, 2]), &Json), "'[1,2]'");
        // JSON-encoded string is also SQL-escaped (embedded single quote doubled).
        assert_eq!(format_value(Dialect::Postgres, &json!("O'Brien"), &Json), "'\"O''Brien\"'");
        // SQL NULL stays NULL (not the JSON literal 'null').
        assert_eq!(format_value(Dialect::Postgres, &Value::Null, &Json), "NULL");
    }
}
