// Application preferences (see src/hooks/useSettings.ts)
export interface AppSettings {
  /** Default rows-per-page for the table data grid. */
  defaultPageSize: number;
  /** Font size (px) for the SQL editor. */
  editorFontSize: number;
  /** Whether the SQL editor wraps long lines. */
  editorWordWrap: boolean;
  /** Whether the SQL editor shows the minimap. */
  editorMinimap: boolean;
  /**
   * Maximum rows the Time Machine will snapshot for a Tier-2 (raw SQL) undo
   * entry. Statements that would touch more rows than this require an
   * explicit user confirmation to run without an undo entry. Conservative
   * default; raise with care — larger values mean longer pre-execute latency
   * and more inverse SQL stored on disk.
   */
  timeMachineSnapshotCap: number;
  /**
   * Pre-flight dry-run: show a before→after preview and a Commit/Cancel gate
   * before a raw single-table UPDATE/DELETE from the query editor executes.
   * Preview failures degrade to running normally (never blocks a run). The
   * preview row cap reuses `timeMachineSnapshotCap`.
   */
  preflightEnabled: boolean;
}

// Database connection types.
// Redis and MongoDB are non-SQL drivers: they can back a Connection but never
// open SQL workspaces (designers/query/table). Use isSqlDriver/toDialect (below)
// to narrow a driver to a SQL Dialect before entering SQL-only code paths.
export type DatabaseDriver = "mysql" | "postgres" | "sqlite" | "sqlserver" | "redis" | "mongodb";

export interface Connection {
  id: string;
  name: string;
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  credential_id?: string;
  group_id?: string;
  /** Serialized JSON blob (see {@link ConnectionOptions}) carrying SSL/SSH transport options. */
  options?: string | null;
  color?: string;
  created_at: string;
  updated_at: string;
}

// SSL/SSH transport options. Serialized to JSON and stored in `Connection.options`.

export type SslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

export interface SslOptions {
  mode?: SslMode;
  ca_path?: string;
  cert_path?: string;
  key_path?: string;
}

export type SshAuth = "password" | "key";

export interface SshOptions {
  enabled?: boolean;
  host?: string;
  port?: number;
  user?: string;
  auth?: SshAuth;
  /** Private-key FILE PATH used for key auth (not pasted key contents). */
  key_path?: string;
  /** Vault credential id holding the SSH password (password auth, saved connections). */
  password_credential_id?: string;
  /** Vault credential id holding the SSH key passphrase (key auth, saved connections). */
  passphrase_credential_id?: string;
}

export interface ConnectionOptions {
  ssl?: SslOptions;
  ssh?: SshOptions;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  name: string;
  type: "password" | "ssh_key";
  created_at: string;
  updated_at: string;
}

// Query types
export interface QueryTab {
  id: string;
  connection_id?: string;
  database?: string;
  title: string;
  content: string;
  is_modified: boolean;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  affected_rows?: number;
  execution_time_ms: number;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
}

// Parameterized mutation types (see src/lib/mutationBuilder.ts).
// Dialect is SQL-only — the non-SQL drivers (Redis, MongoDB) are intentionally
// excluded (they are DatabaseDrivers but never a SQL Dialect).
export type Dialect = "mysql" | "postgres" | "sqlite" | "sqlserver";
export type ParamValue = string | number | boolean;

/** The SQL drivers — every DatabaseDriver except the non-SQL ones (redis, mongodb). Each value is also a Dialect. */
export const SQL_DRIVERS = ["mysql", "postgres", "sqlite", "sqlserver"] as const;

/** True when `d` is a SQL driver (i.e. not a non-SQL driver like redis/mongodb). */
export function isSqlDriver(d: DatabaseDriver): boolean {
  return (SQL_DRIVERS as readonly string[]).includes(d);
}

/**
 * Narrow a SQL DatabaseDriver to its Dialect. Only ever called in SQL contexts;
 * throws on non-SQL drivers (redis, mongodb), which have no Dialect.
 */
export function toDialect(d: DatabaseDriver): Dialect {
  if (!isSqlDriver(d)) {
    throw new Error(`${d} is not a SQL dialect; toDialect("${d}") is invalid.`);
  }
  return d as Dialect;
}

export interface Statement {
  sql: string;
  params: ParamValue[];
}

/** Minimal column metadata the mutation builder needs (subset of ColumnDefinition). */
export interface MutationColumn {
  name: string;
  data_type: string;
  is_primary_key?: boolean;
  is_auto_increment?: boolean;
}

export interface QueryHistory {
  id: string;
  connection_id: string;
  database?: string;
  query: string;
  execution_time_ms: number;
  row_count?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

// Action Journal (Time Machine) — one reversible action the app applied.
// `forward_sql` / `inverse_sql` are JSON-encoded Statement[] (parse with
// JSON.parse → Statement[]). `tier` 1 = exactly reversible (app-mediated grid
// DML); 2 = best-effort (snapshot-based raw SQL).
//
// `status` lifecycle: an entry starts as "applied". The user can move it to
// "undone" by clicking Undo in the timeline (or Ctrl+Alt+Z). If a NEW action
// is recorded while older entries are "undone", those older entries are moved
// to "superseded" — they remain in storage for audit but are hidden from the
// timeline and can't be redone. This matches the standard editor behavior
// where a new edit clears the redo stack.
export type ActionTier = 1 | 2;
export type ActionStatus = "applied" | "undone" | "superseded";
export type ActionKind = "grid_dml" | "raw_sql";

export interface ActionJournalEntry {
  id: string;
  connection_id?: string;
  database?: string;
  table?: string;
  kind: ActionKind;
  label: string;
  /** JSON-encoded Statement[] that was applied. */
  forward_sql: string;
  /** JSON-encoded Statement[] that undoes it. */
  inverse_sql: string;
  tier: ActionTier;
  status: ActionStatus;
  affected_rows?: number;
  created_at: string;
}

/** Payload for recording a new journal entry (camelCase → Rust NewJournalEntry). */
export interface NewActionJournalEntry {
  connectionId?: string;
  database?: string;
  table?: string;
  kind: ActionKind;
  label: string;
  forwardSql: string;
  inverseSql: string;
  tier: ActionTier;
  affectedRows?: number;
}

export interface FavoriteQuery {
  id: string;
  name: string;
  description?: string;
  connection_id?: string;
  database?: string;
  query: string;
  folder_id?: string;
  created_at: string;
  updated_at: string;
}

// Database structure types
export interface DatabaseInfo {
  name: string;
  schemas?: SchemaInfo[];
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  views: ViewInfo[];
  procedures: ProcedureInfo[];
  functions: FunctionInfo[];
}

export interface TableInfo {
  name: string;
  schema?: string;
  table_type: string;
  row_count?: number;
}

export interface ViewInfo {
  name: string;
  schema?: string;
}

export interface ProcedureInfo {
  name: string;
  schema?: string;
}

export interface FunctionInfo {
  name: string;
  schema?: string;
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  /** Sized/declared type when the driver can determine it, e.g. `varchar(500)`,
   * `decimal(18,4)`, `int unsigned`. Falls back to the bare type otherwise. */
  full_type?: string | null;
  nullable: boolean;
  default_value?: string;
  is_primary_key: boolean;
  is_unique: boolean;
  is_auto_increment: boolean;
  comment?: string;
}

/** A UI-editable column definition used by the Table Designer. */
export interface DesignerColumn {
  /** Stable client-side identity (nanoid or uuid). */
  id: string;
  name: string;
  /** Key into TYPE_CATALOG (e.g. "varchar", "int", "decimal", "text", …). */
  type: string;
  /** Length for varchar/char types. */
  length?: number | null;
  /** Precision for decimal/numeric types. */
  precision?: number | null;
  /** Scale for decimal/numeric types. */
  scale?: number | null;
  nullable: boolean;
  /** Raw free-text default expression (user responsible for quoting string literals). */
  defaultValue?: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  /** Free-text column comment. Empty string / null / undefined all mean "no comment". */
  comment?: string | null;
  /** MySQL: UNSIGNED modifier on integer/decimal types. */
  unsigned?: boolean | null;
  /** MySQL: ZEROFILL modifier (implies UNSIGNED). */
  zerofill?: boolean | null;
  /** MySQL: per-column CHARACTER SET. */
  charset?: string | null;
  /** MySQL: per-column COLLATE. */
  collation?: string | null;
  /** MySQL: ON UPDATE CURRENT_TIMESTAMP for timestamp/datetime columns. */
  onUpdateCurrentTimestamp?: boolean | null;
  /** GENERATED ALWAYS AS (expression) STORED|VIRTUAL. When set, the column is computed. */
  generated?: { expression: string; stored: boolean } | null;
}

/** A UI-editable foreign key definition used by the Table Designer. */
export interface DesignerForeignKey {
  /** Stable client-side identity (nanoid or uuid). */
  id: string;
  /** Constraint name (e.g. fk_orders_user). */
  name: string;
  /** Local column names participating in this FK. */
  columns: string[];
  /** Referenced table name. */
  referencedTable: string;
  /** Referenced table schema (null = same schema as the owning table). */
  referencedSchema?: string | null;
  /** Referenced column names. */
  referencedColumns: string[];
  /** ON DELETE action (CASCADE, SET NULL, NO ACTION, RESTRICT, SET DEFAULT). */
  onDelete?: string | null;
  /** ON UPDATE action. */
  onUpdate?: string | null;
}

/** A UI-editable index definition used by the Table Designer. */
export interface DesignerIndex {
  /** Stable client-side identity. */
  id: string;
  name: string;
  unique: boolean;
  /** Column names included in this index. */
  columns: string[];
  /** Index access method (USING BTREE | HASH | GIN | GiST). null = engine default. */
  method?: string | null;
  /** MySQL FULLTEXT / SPATIAL index kind. null/"normal" = ordinary index. */
  indexKind?: "normal" | "fulltext" | "spatial" | null;
  /** Per-column sort direction, keyed by column name. */
  columnOrders?: Record<string, "ASC" | "DESC">;
  /** MySQL: per-column prefix length, keyed by column name. */
  prefixLengths?: Record<string, number>;
}

/** A UI-editable CHECK constraint used by the Table Designer. */
export interface DesignerCheck {
  /** Stable client-side identity. */
  id: string;
  /** Constraint name. */
  name: string;
  /** Raw boolean expression (user responsible for quoting). */
  expression: string;
}

/** A UI-editable named UNIQUE constraint used by the Table Designer. */
export interface DesignerUnique {
  /** Stable client-side identity. */
  id: string;
  /** Constraint name. */
  name: string;
  /** Column names participating in the uniqueness constraint. */
  columns: string[];
}

/** Table-level storage/display options (engine-aware; mostly MySQL). */
export interface TableOptions {
  /** MySQL storage engine (InnoDB, MyISAM, …). */
  engine?: string | null;
  /** MySQL DEFAULT CHARSET. */
  charset?: string | null;
  /** MySQL table COLLATE. */
  collation?: string | null;
  /** Table comment (MySQL inline; Postgres COMMENT ON TABLE). */
  comment?: string | null;
  /** MySQL AUTO_INCREMENT seed. */
  autoIncrement?: number | null;
  /** MySQL ROW_FORMAT (DYNAMIC, COMPRESSED, …). */
  rowFormat?: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  type?: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referenced_table: string;
  referenced_columns: string[];
  on_delete?: string;
  on_update?: string;
}

/** Batched ERD introspection payload: one table's columns + foreign keys,
 * returned by the `get_schema_graph` command so the ER diagram fetches a whole
 * schema in a couple of round-trips instead of two per table. */
export interface TableGraph {
  name: string;
  schema?: string | null;
  columns: ColumnDefinition[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
}

// Session types
export interface SessionInfo {
  id: string;
  connection_id: string;
  database?: string;
  connected_at: string;
}

// Transfer types
export type ConflictMode = "drop" | "truncate" | "append" | "skip";
export type ErrorPolicy = "stop_on_error" | "table_atomic_continue" | "skip_row_continue";

export interface TransferJob {
  source_table: string;
  source_schema: string | null;
  target_db: string;
  target_schema: string | null;
  target_table: string;
  conflict: ConflictMode;
  source_query?: string | null;
}

export interface TransferOptions {
  copy_structure: boolean;
  copy_data: boolean;
  copy_indexes: boolean;
  copy_fks: boolean;
  batch_size: number;
  error_policy: ErrorPolicy;
}

export interface TableResult {
  table: string;
  status: "success" | "failed" | "skipped";
  rows_copied: number;
  skipped: number;
  error: string | null;
}

export interface TransferReport {
  tables: TableResult[];
  warnings: string[];
}

export interface TablePreview {
  table: string;
  ddl: string;
  sample_insert: string;
}

export interface TransferProgress {
  table: string;
  phase: "structure" | "data" | "indexes" | "fks" | "done";
  rows_done: number;
  rows_total: number;
}

// Activity log types
export type LogLevel = "INFO" | "WARNING" | "ERROR";
export type LogCategory = "connection" | "query" | "system" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  connection_id?: string;
  details?: string;
}

// Cross-DB clipboard + row-transfer types
export interface SourceRef {
  sessionId: string;
  connectionId: string;
  dbType: DatabaseDriver;
  database: string;
  schema: string | null;
}

export interface TableRef {
  name: string;
  schema: string | null;
}

export interface ColumnMeta {
  name: string;
  data_type: string;
  nullable: boolean;
}

export type AnsqlClipboard =
  | { kind: "table-ref"; source: SourceRef; tables: TableRef[] }
  | { kind: "query-ref"; source: SourceRef; sql: string; columns: ColumnMeta[] }
  | {
      kind: "row-snapshot";
      source: SourceRef;
      table: string | null;
      columns: ColumnMeta[];
      rows: unknown[][];
    };

export interface SnapshotColumn {
  name: string;
  data_type: string;
  nullable: boolean;
}

export interface ColumnMap {
  source: string;
  target: string;
}

export interface RowTransfer {
  source_dialect: Dialect;
  target_schema: string | null;
  target_table: string;
  columns: SnapshotColumn[];
  rows: unknown[][];
  mapping: ColumnMap[];
  conflict: ConflictMode;
  create_if_missing: boolean;
  batch_size: number;
}
