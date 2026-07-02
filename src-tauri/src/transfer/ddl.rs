use crate::db::driver::{ColumnDefinition, ForeignKeyInfo, IndexInfo};
use crate::transfer::dialect::quote_ident;
use crate::transfer::type_map::{is_lossy, parse, render, CanonicalType};
use crate::transfer::Dialect;

/// Result of generating DDL for one table: statements plus any fidelity warnings.
pub struct DdlOutput {
    pub statements: Vec<String>,
    pub warnings: Vec<String>,
}

/// Qualify a table name with an optional schema, each identifier quoted.
fn qualified(dialect: Dialect, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(s) if !s.is_empty() => {
            format!("{}.{}", quote_ident(dialect, s), quote_ident(dialect, table))
        }
        _ => quote_ident(dialect, table),
    }
}

/// Render a column's type, substituting Postgres SERIAL pseudo-types for
/// auto-increment integer columns (other dialects keep the plain type and
/// express auto-increment via a trailing keyword instead).
fn render_column_type(canonical: &CanonicalType, target: Dialect, is_auto_increment: bool) -> String {
    if is_auto_increment && target == Dialect::Postgres {
        match canonical {
            CanonicalType::SmallInt => return "SMALLSERIAL".into(),
            CanonicalType::Integer => return "SERIAL".into(),
            CanonicalType::BigInt => return "BIGSERIAL".into(),
            _ => {}
        }
    }
    render(canonical, target)
}

pub fn generate_create_table(
    source: Dialect,
    target: Dialect,
    table: &str,
    schema: Option<&str>,
    columns: &[ColumnDefinition],
) -> DdlOutput {
    let mut warnings = Vec::new();
    let mut col_defs = Vec::new();
    let mut pk_cols = Vec::new();

    // SQLite expresses an auto-increment integer primary key as the inline column
    // constraint `INTEGER PRIMARY KEY AUTOINCREMENT` (a rowid alias). That form is
    // mutually exclusive with a separate table-level `PRIMARY KEY (...)` clause and
    // is only valid for a single-column PK, so detect and special-case it.
    let pk_count = columns.iter().filter(|c| c.is_primary_key).count();
    let sqlite_inline_pk = target == Dialect::Sqlite
        && pk_count == 1
        && columns.iter().any(|c| c.is_primary_key && c.is_auto_increment);

    for c in columns {
        let canonical = parse(source, &c.data_type);
        if is_lossy(&canonical) {
            warnings.push(format!(
                "{}.{}: {} → TEXT (lossy)",
                table, c.name, c.data_type
            ));
        }

        if sqlite_inline_pk && c.is_primary_key {
            col_defs.push(format!(
                "  {} INTEGER PRIMARY KEY AUTOINCREMENT",
                quote_ident(target, &c.name)
            ));
            continue;
        }

        let target_type = render_column_type(&canonical, target, c.is_auto_increment);
        let null = if c.nullable { "" } else { " NOT NULL" };
        // MySQL marks auto-increment columns with a trailing keyword; Postgres
        // already encoded it in the SERIAL type above; SQLite is handled inline.
        let auto = if c.is_auto_increment && target == Dialect::MySql {
            " AUTO_INCREMENT"
        } else {
            ""
        };
        col_defs.push(format!(
            "  {} {}{}{}",
            quote_ident(target, &c.name),
            target_type,
            null,
            auto
        ));
        if c.is_primary_key {
            pk_cols.push(quote_ident(target, &c.name));
        }
    }

    if !pk_cols.is_empty() && !sqlite_inline_pk {
        col_defs.push(format!("  PRIMARY KEY ({})", pk_cols.join(", ")));
    }

    let stmt = format!(
        "CREATE TABLE {} (\n{}\n);",
        qualified(target, schema, table),
        col_defs.join(",\n")
    );

    DdlOutput { statements: vec![stmt], warnings }
}

pub fn generate_indexes(
    target: Dialect,
    table: &str,
    schema: Option<&str>,
    indexes: &[IndexInfo],
) -> Vec<String> {
    indexes
        .iter()
        .filter(|i| !i.is_primary)
        .map(|i| {
            let unique = if i.is_unique { "UNIQUE " } else { "" };
            let cols: Vec<String> = i.columns.iter().map(|c| quote_ident(target, c)).collect();
            format!(
                "CREATE {}INDEX {} ON {} ({});",
                unique,
                quote_ident(target, &i.name),
                qualified(target, schema, table),
                cols.join(", ")
            )
        })
        .collect()
}

pub fn generate_foreign_keys(
    target: Dialect,
    table: &str,
    schema: Option<&str>,
    fks: &[ForeignKeyInfo],
) -> Vec<String> {
    // `ForeignKeyInfo` carries no schema for the referenced table, so we assume it
    // lives in the same target schema as the owning table. This holds for the common
    // case of transferring a set of related tables into one schema; cross-schema
    // references would need a `referenced_schema` field to be reproduced faithfully.
    fks.iter()
        .map(|fk| {
            let cols: Vec<String> = fk.columns.iter().map(|c| quote_ident(target, c)).collect();
            let ref_cols: Vec<String> =
                fk.referenced_columns.iter().map(|c| quote_ident(target, c)).collect();
            let mut s = format!(
                "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
                qualified(target, schema, table),
                quote_ident(target, &fk.name),
                cols.join(", "),
                qualified(target, schema, &fk.referenced_table),
                ref_cols.join(", ")
            );
            if let Some(on_delete) = &fk.on_delete {
                s.push_str(&format!(" ON DELETE {}", on_delete));
            }
            if let Some(on_update) = &fk.on_update {
                s.push_str(&format!(" ON UPDATE {}", on_update));
            }
            s.push(';');
            s
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, ty: &str, pk: bool, nullable: bool) -> ColumnDefinition {
        ColumnDefinition {
            name: name.into(),
            data_type: ty.into(),
            full_type: None,
            nullable,
            default_value: None,
            is_primary_key: pk,
            is_unique: false,
            is_auto_increment: false,
            comment: None,
        }
    }

    #[test]
    fn create_table_mysql_to_postgres() {
        let cols = vec![
            col("id", "int", true, false),
            col("name", "varchar(100)", false, false),
            col("created", "datetime", false, true),
        ];
        let out = generate_create_table(
            Dialect::MySql,
            Dialect::Postgres,
            "users",
            None,
            &cols,
        );
        let ddl = &out.statements[0];
        assert!(ddl.starts_with("CREATE TABLE \"users\""), "got: {ddl}");
        assert!(ddl.contains("\"id\" INTEGER NOT NULL"), "got: {ddl}");
        assert!(ddl.contains("\"name\" VARCHAR(100) NOT NULL"), "got: {ddl}");
        assert!(ddl.contains("\"created\" TIMESTAMP"), "got: {ddl}");
        assert!(ddl.contains("PRIMARY KEY (\"id\")"), "got: {ddl}");
    }

    fn auto_inc_col(name: &str, ty: &str) -> ColumnDefinition {
        ColumnDefinition {
            name: name.into(),
            data_type: ty.into(),
            full_type: None,
            nullable: false,
            default_value: None,
            is_primary_key: true,
            is_unique: false,
            is_auto_increment: true,
            comment: None,
        }
    }

    #[test]
    fn auto_increment_mysql_uses_keyword() {
        let cols = vec![auto_inc_col("id", "int")];
        let out = generate_create_table(Dialect::MySql, Dialect::MySql, "t", None, &cols);
        let ddl = &out.statements[0];
        assert!(ddl.contains("`id` INTEGER NOT NULL AUTO_INCREMENT"), "got: {ddl}");
        assert!(ddl.contains("PRIMARY KEY (`id`)"), "got: {ddl}");
    }

    #[test]
    fn auto_increment_postgres_uses_serial() {
        let cols = vec![auto_inc_col("id", "int")];
        let out = generate_create_table(Dialect::MySql, Dialect::Postgres, "t", None, &cols);
        let ddl = &out.statements[0];
        assert!(ddl.contains("\"id\" SERIAL"), "got: {ddl}");
        assert!(!ddl.contains("AUTO_INCREMENT"), "got: {ddl}");
        assert!(ddl.contains("PRIMARY KEY (\"id\")"), "got: {ddl}");
    }

    #[test]
    fn auto_increment_sqlite_inline_pk() {
        let cols = vec![auto_inc_col("id", "int")];
        let out = generate_create_table(Dialect::MySql, Dialect::Sqlite, "t", None, &cols);
        let ddl = &out.statements[0];
        assert!(ddl.contains("\"id\" INTEGER PRIMARY KEY AUTOINCREMENT"), "got: {ddl}");
        // The inline form must not be combined with a table-level PRIMARY KEY clause.
        assert!(!ddl.contains("PRIMARY KEY (\"id\")"), "got: {ddl}");
    }

    #[test]
    fn unknown_type_adds_warning_and_uses_text() {
        let cols = vec![col("shape", "geometry", false, true)];
        let out = generate_create_table(Dialect::Postgres, Dialect::Sqlite, "geo", None, &cols);
        assert!(out.statements[0].contains("\"shape\" TEXT"));
        assert_eq!(out.warnings.len(), 1);
        assert!(out.warnings[0].contains("geometry"));
    }

    #[test]
    fn generates_index_statement() {
        let idx = IndexInfo {
            name: "idx_name".into(),
            columns: vec!["name".into()],
            is_unique: true,
            is_primary: false,
            index_type: None,
        };
        let stmts = generate_indexes(Dialect::Postgres, "users", None, &[idx]);
        assert_eq!(
            stmts[0],
            "CREATE UNIQUE INDEX \"idx_name\" ON \"users\" (\"name\");"
        );
    }

    #[test]
    fn skips_primary_index() {
        let idx = IndexInfo {
            name: "PRIMARY".into(),
            columns: vec!["id".into()],
            is_unique: true,
            is_primary: true,
            index_type: None,
        };
        let stmts = generate_indexes(Dialect::MySql, "users", None, &[idx]);
        assert!(stmts.is_empty());
    }

    #[test]
    fn generates_fk_statement() {
        let fk = ForeignKeyInfo {
            name: "fk_user".into(),
            columns: vec!["user_id".into()],
            referenced_table: "users".into(),
            referenced_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: None,
        };
        let stmts = generate_foreign_keys(Dialect::Postgres, "orders", None, &[fk]);
        assert!(stmts[0].contains("ALTER TABLE \"orders\" ADD CONSTRAINT \"fk_user\""));
        assert!(stmts[0].contains("FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\")"));
        assert!(stmts[0].contains("ON DELETE CASCADE"));
    }
}
