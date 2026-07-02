use crate::transfer::Dialect;

#[derive(Debug, Clone, PartialEq)]
pub enum CanonicalType {
    Boolean,
    SmallInt,
    Integer,
    BigInt,
    Decimal { precision: Option<u32>, scale: Option<u32> },
    Real,
    Double,
    Varchar(Option<u32>),
    Text,
    Date,
    Time,
    DateTime,
    Blob,
    Json,
    Uuid,
    /// Unrecognized; preserves the original type string for warnings.
    Unknown(String),
}

/// Lowercase, strip the `(...)` suffix and any trailing modifiers, return base + args.
fn split_type(type_str: &str) -> (String, Vec<u32>) {
    let lower = type_str.trim().to_lowercase();
    let base = lower.split(['(', ' ']).next().unwrap_or("").to_string();
    let mut args = Vec::new();
    if let (Some(open), Some(close)) = (lower.find('('), lower.find(')')) {
        if close > open {
            for part in lower[open + 1..close].split(',') {
                if let Ok(n) = part.trim().parse::<u32>() {
                    args.push(n);
                }
            }
        }
    }
    (base, args)
}

pub fn parse(dialect: Dialect, type_str: &str) -> CanonicalType {
    let (base, args) = split_type(type_str);
    match base.as_str() {
        "bool" | "boolean" => CanonicalType::Boolean,
        "tinyint" => {
            if dialect == Dialect::MySql && args.first() == Some(&1) {
                CanonicalType::Boolean
            } else {
                CanonicalType::SmallInt
            }
        }
        "smallint" | "int2" | "smallserial" => CanonicalType::SmallInt,
        "mediumint" | "int" | "integer" | "int4" | "serial" => CanonicalType::Integer,
        "bigint" | "int8" | "bigserial" => CanonicalType::BigInt,
        "decimal" | "numeric" | "dec" => CanonicalType::Decimal {
            precision: args.first().copied(),
            scale: args.get(1).copied(),
        },
        "float" | "real" | "float4" => CanonicalType::Real,
        "double" | "float8" => CanonicalType::Double,
        "char" | "varchar" | "character" => CanonicalType::Varchar(args.first().copied()),
        "text" | "tinytext" | "mediumtext" | "longtext" | "clob" => CanonicalType::Text,
        "date" => CanonicalType::Date,
        "time" => CanonicalType::Time,
        "datetime" => CanonicalType::DateTime,
        // Both tz-aware and tz-naive timestamps collapse to DateTime for now
        // (no separate TimestampTz canonical type yet).
        "timestamp" | "timestamptz" => CanonicalType::DateTime,
        "blob" | "bytea" | "binary" | "varbinary" | "tinyblob" | "mediumblob" | "longblob" => {
            CanonicalType::Blob
        }
        "json" | "jsonb" => CanonicalType::Json,
        "uuid" => CanonicalType::Uuid,
        _ => CanonicalType::Unknown(base),
    }
}

pub fn render(ty: &CanonicalType, target: Dialect) -> String {
    match ty {
        CanonicalType::Boolean => match target {
            Dialect::MySql => "TINYINT(1)".into(),
            Dialect::Postgres => "BOOLEAN".into(),
            Dialect::Sqlite => "INTEGER".into(),
        },
        CanonicalType::SmallInt => "SMALLINT".into(),
        CanonicalType::Integer => "INTEGER".into(),
        CanonicalType::BigInt => "BIGINT".into(),
        CanonicalType::Decimal { precision, scale } => match (precision, scale) {
            (Some(p), Some(s)) => format!("DECIMAL({},{})", p, s),
            (Some(p), None) => format!("DECIMAL({})", p),
            _ => "DECIMAL".into(),
        },
        CanonicalType::Real => "REAL".into(),
        CanonicalType::Double => match target {
            Dialect::MySql => "DOUBLE".into(),
            _ => "DOUBLE PRECISION".into(),
        },
        CanonicalType::Varchar(len) => match len {
            Some(n) => format!("VARCHAR({})", n),
            None => "VARCHAR(255)".into(),
        },
        CanonicalType::Text => "TEXT".into(),
        CanonicalType::Date => "DATE".into(),
        CanonicalType::Time => "TIME".into(),
        CanonicalType::DateTime => match target {
            Dialect::MySql => "DATETIME".into(),
            _ => "TIMESTAMP".into(),
        },
        CanonicalType::Blob => match target {
            Dialect::MySql => "LONGBLOB".into(),
            Dialect::Postgres => "BYTEA".into(),
            Dialect::Sqlite => "BLOB".into(),
        },
        CanonicalType::Json => match target {
            Dialect::Postgres => "JSONB".into(),
            Dialect::MySql => "JSON".into(),
            Dialect::Sqlite => "TEXT".into(),
        },
        CanonicalType::Uuid => match target {
            Dialect::Postgres => "UUID".into(),
            _ => "VARCHAR(36)".into(),
        },
        CanonicalType::Unknown(_) => "TEXT".into(),
    }
}

/// True when rendering this type to the target loses fidelity (caller logs a warning).
pub fn is_lossy(ty: &CanonicalType) -> bool {
    matches!(ty, CanonicalType::Unknown(_))
}

/// Best-effort canonical type from a sample JSON value. Used when a source
/// column has no declared type (e.g. an arbitrary query-result snapshot).
/// Integers widen to BigInt and floats to Double so the target column never
/// overflows; NULL falls back to Text.
pub fn infer_from_value(v: &serde_json::Value) -> CanonicalType {
    match v {
        serde_json::Value::Bool(_) => CanonicalType::Boolean,
        serde_json::Value::Number(n) if n.is_i64() || n.is_u64() => CanonicalType::BigInt,
        serde_json::Value::Number(_) => CanonicalType::Double,
        serde_json::Value::String(_) => CanonicalType::Text,
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => CanonicalType::Json,
        serde_json::Value::Null => CanonicalType::Text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_mysql_types() {
        assert_eq!(parse(Dialect::MySql, "tinyint(1)"), CanonicalType::Boolean);
        assert_eq!(parse(Dialect::MySql, "int"), CanonicalType::Integer);
        assert_eq!(parse(Dialect::MySql, "bigint unsigned"), CanonicalType::BigInt);
        assert_eq!(parse(Dialect::MySql, "varchar(255)"), CanonicalType::Varchar(Some(255)));
        assert_eq!(parse(Dialect::MySql, "datetime"), CanonicalType::DateTime);
        assert_eq!(parse(Dialect::MySql, "json"), CanonicalType::Json);
        assert_eq!(
            parse(Dialect::MySql, "decimal(10,2)"),
            CanonicalType::Decimal { precision: Some(10), scale: Some(2) }
        );
    }

    #[test]
    fn parses_common_postgres_types() {
        assert_eq!(parse(Dialect::Postgres, "boolean"), CanonicalType::Boolean);
        assert_eq!(parse(Dialect::Postgres, "integer"), CanonicalType::Integer);
        assert_eq!(parse(Dialect::Postgres, "serial"), CanonicalType::Integer);
        assert_eq!(parse(Dialect::Postgres, "timestamp without time zone"), CanonicalType::DateTime);
        assert_eq!(parse(Dialect::Postgres, "uuid"), CanonicalType::Uuid);
        assert_eq!(parse(Dialect::Postgres, "jsonb"), CanonicalType::Json);
    }

    #[test]
    fn unknown_type_preserved() {
        assert_eq!(
            parse(Dialect::Postgres, "geometry"),
            CanonicalType::Unknown("geometry".to_string())
        );
    }

    #[test]
    fn renders_across_engines() {
        assert_eq!(render(&CanonicalType::DateTime, Dialect::Postgres), "TIMESTAMP");
        assert_eq!(render(&CanonicalType::Boolean, Dialect::MySql), "TINYINT(1)");
        assert_eq!(render(&CanonicalType::Varchar(Some(255)), Dialect::Postgres), "VARCHAR(255)");
        assert_eq!(render(&CanonicalType::Unknown("geometry".into()), Dialect::Sqlite), "TEXT");
        assert_eq!(
            render(&CanonicalType::Decimal { precision: Some(10), scale: Some(2) }, Dialect::MySql),
            "DECIMAL(10,2)"
        );
    }

    #[test]
    fn infers_canonical_from_json_values() {
        use serde_json::json;
        assert_eq!(infer_from_value(&json!(true)), CanonicalType::Boolean);
        assert_eq!(infer_from_value(&json!(42)), CanonicalType::BigInt);
        assert_eq!(infer_from_value(&json!(3.14)), CanonicalType::Double);
        assert_eq!(infer_from_value(&json!("hello")), CanonicalType::Text);
        assert_eq!(infer_from_value(&json!({"a": 1})), CanonicalType::Json);
        assert_eq!(infer_from_value(&json!([1, 2])), CanonicalType::Json);
        assert_eq!(infer_from_value(&serde_json::Value::Null), CanonicalType::Text);
    }
}
