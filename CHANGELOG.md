# ANSQL - Changelog

## 2026-06-20

### Sprint 13.1 — Time Machine UX pass

Polish + safety fixes after the initial Sprint 13 review.

- **Safety — snapshot cap is no longer silent.** Raw `UPDATE`/`DELETE` that
  would affect more rows than `settings.timeMachineSnapshotCap` (default 1000)
  now blocks the run and asks the user to explicitly opt in to running without
  an undo entry. Previously the statement ran with no journal at all and the
  user had no way to know.
- **Safety — undo reload is scoped to the changed table.** The
  `ansql:data-changed` event now carries `{sessionId, table}` and
  `TableData` only reloads when the table matches. Previously, undoing on
  table A would silently wipe unsaved edits in any other open table on the
  same session.
- **Record-confirmation toast.** Every reversible commit surfaces a
  `Time Machine · <label>  (Ctrl+Alt+Z to undo)` toast so the user knows the
  change is in the timeline.
- **Connection filter on the timeline.** `Time Machine` panel now has a
  filter dropdown (All connections / per-connection). Cross-connection
  entries are tagged with the connection name when the filter is "All".
- **Undoable-count badge on the History button.** Header icon shows a small
  primary-color badge with the count of currently undoable actions.
- **Redo shortcut.** `Ctrl+Alt+Shift+Z` redoes the most recent undone
  action (mirrors `Ctrl+Alt+Z`).
- **Redo stack is cleared on new edit.** Recording a new action supersedes
  any prior `undone` entries on the same connection — standard editor
  behavior. Superseded entries stay in storage for audit but are hidden
  from the timeline.
- **Naming consistency.** User-facing surfaces all use the single name
  `Time Machine` (was `Time Machine (Rollback)` / `Action Timeline` /
  `action timeline` in different places).
- **Reusable `ConfirmDialog` + tier badge tooltips.** Native
  `window.confirm` replaced by the in-app modal; the Tier 1/2 badges
  explain what they mean on hover.
- **Configurable snapshot cap.** `settings.timeMachineSnapshotCap`
  (default 1000) is now a typed setting; was a hardcoded constant in
  `QueryDocument`.

## 2026-06-19

### Sprint 13 — Time Machine (action journal + rollback; runtime-unverified)

A signature feature with no equivalent in Navicat/DBeaver/DbGate: every
reversible change the app makes is journaled with a precomputed **inverse**, and
can be rolled back from a LIFO undo stack — `Ctrl/Cmd+Alt+Z` undoes the last
action, and a **Time Machine** timeline panel (History icon, top-right) lists the
full history with per-entry Undo/Redo. The journal persists in local SQLite, so
it survives restarts.

- **Compensating-statement engine** (`lib/inverseBuilder.ts`, pure + 12 tests):
  reuses the existing forward builders, so an inverse is always dialect-correct
  and parameterized the same way the original was. `INSERT → DELETE`,
  `UPDATE(old→new) → UPDATE(new→old)`, `DELETE → INSERT` (full row, forcing the
  PK via a new `buildInsert({forceAll})`). Inverses for a batch run in reverse
  order in one transaction.
- **Tier 1 — exactly reversible** (the data grid): grid inserts/updates/deletes
  are recorded with their inverse on commit (`TableData`). 🟢 badge.
- **Tier 2 — best-effort** (raw SQL editor): a single-table `UPDATE`/`DELETE`
  typed in the query editor is **snapshotted before it runs**
  (`SELECT * … WHERE …`, capped at 1000 rows), and the snapshot is turned into a
  restore batch (`lib/rawDmlSource.ts` + `lib/rawDmlSnapshot.ts`, pure + 17
  tests). Aliased / multi-table / PK-less statements are rejected (no misleading
  undo is offered). 🟡 badge.
- **Storage + commands**: new `action_journal` table (migration `002`),
  `journal_record` / `journal_list` / `journal_set_status` / `journal_clear`
  Tauri commands, and a `useActionJournal` hook exposing the stack +
  `JournalRecorderProvider` so deep mutation sites record without prop-drilling.
- **Conflict guard**: an undo whose inverse matches 0 rows (the row changed in
  another session) surfaces a warning instead of silently corrupting data; open
  grids reload live via an `ansql:data-changed` event.

> ⚠️ **Runtime-unverified.** All pure logic is unit-tested (29 new tests; suite
> now 1151) and the Rust side compiles (`cargo check`), typecheck/lint/build are
> green and the change is additive — but the end-to-end record→undo cycle could
> not be exercised against a live database here. Test the commit→undo→redo and
> raw-UPDATE→undo flows against a real server before relying on it. Not yet wired
> for importer/data-sync mutations (grid + raw editor only).

## 2026-06-16

### Sprint 12 — MongoDB engine (document browser; runtime-unverified)

Added MongoDB as a second non-relational engine, reusing the `DatabaseDriver`/
`Dialect` split introduced for Redis — the document store coexists with the SQL
clients and the Redis key browser without touching relational code. ansql now
covers six engines: MySQL/MariaDB, PostgreSQL, SQLite, SQL Server, Redis, MongoDB.

- **Pure-Rust driver** (`mongodb` 3.7, rustls — no native deps): `mongo_driver.rs`
  + `mongo_commands.rs` (a `MongoSessionStore` keyed session) — list databases/
  collections, `find(filter, limit, skip)` with a full match count for paging,
  insert/replace/delete one, and a raw `runCommand`. JSON ⇄ BSON round-trips through
  `bson` (`ObjectId` as extended JSON `{"$oid":…}`); credentials resolve from the
  vault like the SQL engines, with `database` reused as the optional auth DB.
- **Document-browser workspace** (`MongoBrowser`): database + collection navigation,
  a JSON filter query bar with limit/skip paging, documents rendered as pretty JSON
  cards, an `_id`-keyed view/edit/insert/delete editor, and a raw-command console.
  Opens automatically when you connect to a MongoDB connection.

> ⚠️ **Runtime-unverified** (no MongoDB server here): compiles (`cargo check`) and
> frontend green (typecheck/lint/test/build), additive (the SQL + Redis engines are
> untouched), but test against a live MongoDB before relying on it.

### Sprint 11 — Redis engine (key browser; runtime-unverified)

Added Redis as a non-relational engine — a new workspace paradigm alongside the SQL
clients. `DatabaseDriver` is now split from the SQL `Dialect` (a `toDialect`/
`isSqlDriver` guard narrows SQL connections), so non-SQL engines coexist without
touching the relational code.

- **Pure-Rust driver** (`redis` crate, no native deps): `redis_driver.rs` +
  `redis_commands.rs` (a `RedisSessionStore` keyed session) — connect/scan/get/set/
  del/expire + raw command, with TYPE-dispatched typed reads
  (string/hash/list/set/zset) and `SELECT`-per-op DB switching. Credentials resolve
  from the vault like the SQL engines; SSH tunnel via the factory.
- **Key-browser workspace** (`RedisKeyBrowser`): DB selector (0–15), `SCAN` by
  pattern with cursor paging, a type-aware value viewer/editor (string textarea,
  hash/zset tables, list/set), TTL control, delete, and a raw-command console.
  Opens automatically when you connect to a Redis connection.

> ⚠️ **Runtime-unverified** (no Redis server here): compiles (`cargo check`) and
> frontend green, additive (the SQL engines are untouched), but test against a live
> Redis before relying on it.

### Sprint 10 — Localization (i18n: English + Bahasa Indonesia)

The UI is now translatable. A lightweight, dependency-free i18n layer
(`src/i18n` — `I18nProvider` + `useTranslation` with `{{param}}` interpolation and
an English fallback) drives all user-facing text, with a **Language** selector in
Preferences (persisted). ~1,200 strings were extracted into per-area catalogs
(`shell`/`connection`/`explorer`/`query`/`table`/`io`) with full **English** and
**Bahasa Indonesia** translations. Code, SQL, identifiers and logs are left
untranslated; the framework is trivially extensible for any long-tail strings.

### Sprint 9 — Vault master-password (opt-in)

The credential vault can now be protected by a user master password instead of only
the device key — closing the last deferred security gap. Default behavior is
unchanged (device-key auto-unlock); the master password is strictly opt-in.

- **Safe-by-construction re-key.** Enabling it re-encrypts every stored credential
  from the device key to the password-derived key with **verify-before-commit**
  (each re-encrypted blob is decrypted back and checked before anything is written,
  in one transaction) — a failure aborts with no data loss. No schema migration:
  `vault.key` present = device mode, absent + initialized = master mode.
- **Startup unlock.** In master mode the app launches locked behind a blocking
  `VaultUnlockDialog`; the main UI is gated until the password is entered.
- **Preferences → Security.** Set / change / disable the master password, plus a
  **Reset vault** escape for a forgotten password (wipes saved secrets, keeps
  connections). New Rust commands: `set_master_password` / `disable_master_password`
  / `reset_vault` / `vault_mode`.

> ⚠️ **Runtime-unverified.** The re-key logic and `cargo check` pass, frontend is
> green, and the design is safe-by-construction (opt-in, verify-before-commit,
> resettable) — but the live unlock/re-key flow could not be exercised here. Test
> the enable → restart → unlock → disable cycle before relying on it.

### Sprint 8 — BI Dashboards

Closed the Charts/BI gap (previously out-of-scope) with a real dashboard workspace,
building on the Sprint-5 result-to-chart work. Frontend-only, fully verified.

- **Dashboards** (`useDashboards`, localStorage) — create/rename/delete named
  dashboards, each holding chart **widgets**.
- **Widgets** (`DashboardWidget` + `WidgetEditor`) — each widget is a SQL query
  (against a chosen session/database) plus a chart config (bar/line/area/pie via
  `chartData.buildChartData` + recharts), sizeable (sm/md/lg) and individually
  refreshable; reorderable on a responsive grid.
- Opens from the now-enabled **Charts** ribbon button (a `dashboard` workspace tab).

### Sprint 7 — Microsoft SQL Server engine (compile-verified, runtime-unverified)

Added SQL Server as a fourth database engine — the highest-ROI item from the gap
analysis. Purely additive: it cannot affect the existing MySQL / PostgreSQL / SQLite
engines (the new code path is only reached for a `sqlserver` connection).

- **Frontend dialect (S7.1).** `Dialect`/`DatabaseDriver` gained `"sqlserver"`, and
  T-SQL branches were added across **every** SQL builder: identifier quoting
  (`[brackets]`), `@P1..` parameters, `OFFSET…ROWS FETCH NEXT…ROWS ONLY` pagination
  (with `ORDER BY (SELECT NULL)` fallback), `IDENTITY(1,1)`,
  `NVARCHAR/BIT/DATETIME2/UNIQUEIDENTIFIER` types, `CREATE OR ALTER`
  view/routine/trigger, `MERGE` upsert, `sys`-catalog server monitor, etc.
  ConnectionForm exposes a "SQL Server" driver (port 1433). +147 unit tests.
- **Rust driver (S7.2).** `src-tauri/src/db/mssql.rs` — a `tiberius` 0.12 driver
  (tokio + `tokio-util` compat, `Mutex<Option<Client>>`) implementing the full
  `DatabaseDriver` trait + introspection via `sys.*` / `INFORMATION_SCHEMA`, wired
  into the connection factory (SSL + SSH tunnel) and default port 1433.

> ⚠️ **Runtime-unverified.** The engine **compiles** (`cargo build` clean) and the
> frontend stays green (typecheck + 1122 tests), but no SQL Server instance was
> available to test actual runtime behavior — authentication/TLS, tiberius type
> decoding, and the introspection queries are best-effort and should be validated
> against a live server before relying on it.

### Sprint 6 — Deferred-item closeout

Closed the safely-implementable items that earlier sprints had deferred (frontend-only;
504 → **975 tests**, build green):

- **Editable query results.** A conservative single-table-SELECT detector
  (`sqlSource.detectSingleTableSelect`) drives an "Edit results" action: when a result
  comes from one base table it opens that table in the editable grid carrying the
  query's `WHERE` (`initialWhereSql` + a "Filtered from query" chip), reusing the full
  inline-edit/commit pipeline. Joins / group-by / unions / aggregates stay read-only.
- **Transfer of non-table objects.** The Transfer Wizard gained an "Objects" step to
  select views / functions / procedures / triggers; after the table copy, a frontend
  pass fetches each object's DDL from the source and recreates it on the target
  (`objectTransfer` — view-body→CREATE, DEFINER stripping, dependency ordering,
  continue-on-error), merged into the run report.

> Still deferred (real risk / separate effort): a true **vault master-password** needs
> re-keying the AES vault (untested crypto-migration risks losing saved credentials —
> needs a deliberate design + manual-test pass); **MariaDB as a distinct engine**
> deprioritized (it already connects via the MySQL driver). New engines
> (**SQL Server** via `tiberius`, Oracle, Mongo, Redis), Cloud/collaboration,
> scheduling daemon, full BI, and i18n remain larger separate efforts.

### Sprint 5 — Residual-gap closeout (re-audit vs Navicat → 7 waves)

After a detailed re-audit of the post-Sprint-4 state vs Navicat (see
`docs/navicat-gap-analysis.md`), closed the bulk of the remaining gaps in 7 waves
(all frontend; backend untouched). Build stayed green at every checkpoint
(typecheck clean, lint 0 errors); the suite grew 504 → **915 tests**.

- **A — Table Designer depth:** Checks / Options (engine·charset·collation·comment·
  AUTO_INCREMENT seed·row_format) / Uniques tabs, column reorder, per-column attrs
  (unsigned·on-update·generated·charset), index method/order/prefix/FULLTEXT/SPATIAL,
  cross-schema FK.
- **B — Designers + new object types:** View Preview/Explain/Beautify + WITH CHECK +
  Materialized views; Routine parameter grid + return type + Execute; Events (MySQL),
  Sequences (Postgres) designers + explorer categories.
- **C — Data grid pro:** hide/freeze/reorder columns + row height + layout profiles,
  multi-column sort, nav bar + Stop, column statistics + selection footer,
  find & replace, save-cell-to-file, raw cell values (CURRENT_TIMESTAMP).
- **D — Editor pro:** find/replace surfaced, result-tab pin/rename, EXPLAIN visual
  plan tree, Visual SQL Builder.
- **E — Import/Export/Transfer/Sync:** import parse-options + XML + upsert + type
  override; export HTML/XML/TXT + options; transfer column-mapping + WHERE + profiles
  + to-.sql-file; **Data Synchronization** (row-level diff).
- **F — ERD editing:** draw/delete FK → ALTER, per-table color, save layout,
  export PNG/SVG, reverse-from-DB selection, forward-engineer → SQL.
- **G — Cross-cutting:** Postgres schema tier; user grants/preview/scope/roles;
  connection import/export + starring + in-tree groups; vault lock indicator;
  AI streaming + Fix-with-AI + chat persistence + replace-selection; workspace
  persistence; Focus Mode; Information pane; in-app **Server Monitor**;
  result-to-chart (recharts); activity-log export.

> Deliberate non-goals (documented, unchanged): new DB engines (Oracle/SQL Server/
> MongoDB/Redis), Navicat Cloud/collaboration, scheduling daemon, full BI product,
> i18n; full vault master-password (needs Rust changes to the device-key auto-unlock);
> editable query-results grid; transfer of non-table objects (needs the Rust engine).

### Sprint 4 — Big tools

**4.5 AI Assistant.** A multi-provider AI assistant (`aiProviders.ts` —
Anthropic / OpenAI / Ollama via the webview, default model `claude-opus-4-8`,
configured in Preferences). A docked chat pane (`AiAssistantPane.tsx`) with
optional schema-context attachment and an "Insert into editor" action on fenced
SQL, opened from a header toggle. **Ask AI** editor actions
(Explain / Optimize / Convert / Fix) build a targeted prompt from the current
selection or statement plus the active dialect (`aiPrompts.ts`) and stream the
answer into the pane. Keys are stored locally.

**4.4 Structure Synchronization.** Compare the schema of two
connections/databases and generate a deployment script that transforms the target
to match the source. A pure diff engine (`schemaDiff.ts`) classifies every table
(only-source → CREATE, only-target → DROP, different → column/index/FK
ADD/DROP/ALTER) reusing `dumpBuilder` for whole-table DDL and per-dialect ALTER
rules; `useSchemaSnapshot` introspects both sides. The Structure Sync workspace
tab shows source/target pickers, a checkable difference tree, and an editable
deployment-script pane you can run on the target. Same-dialect focused (v1).

**4.3 Backup / Dump SQL / Execute SQL File / Restore.** A Dump/Backup modal
generates a `.sql` script (DDL via `dumpBuilder.ts` from introspection —
per-dialect auto-increment/SERIAL/AUTOINCREMENT, indexes, FKs — plus optional
batched `INSERT` data), with table selection, structure-only vs structure+data,
DROP-before-CREATE, and save-to-file/copy. An Execute SQL File / Restore modal
reads a `.sql` file, splits it with the statement splitter, and runs it with
continue-on-error and wrap-in-transaction options plus a streaming message log.
Reachable from the now-enabled **Backup** ribbon button and explorer
database/table context actions.

**4.2 ER Diagram.** An auto-generated entity-relationship diagram
(`@xyflow/react` + `@dagrejs/dagre`) rendered from existing introspection
(`useErd` → `get_tables`/`get_columns`/`get_foreign_keys`). Table nodes show
columns with PK/FK markers; FK relationships are drawn as edges; dagre lays it out
automatically (`erdLayout.ts`), with pan/zoom, minimap and a reload control.
Double-click a table to open it. Opens as a workspace tab from the now-enabled
**Model** ribbon button and a "Show ER Diagram" explorer action.

**4.1 Trigger Designer.** A structured trigger designer (`triggerBuilder.ts`,
`TriggerDesigner.tsx`) with create/edit modes: name, table, timing
(BEFORE/AFTER/INSTEAD OF), events, FOR EACH ROW, WHEN condition and a Monaco body,
with a live SQL preview and confirm-on-apply. Per-dialect DDL — MySQL single-event,
SQLite `WHEN`/`BEGIN…END`, Postgres emits the `CREATE FUNCTION … RETURNS trigger`
+ `CREATE TRIGGER … EXECUTE FUNCTION` pair. Opens as a workspace tab from the
explorer's trigger nodes (edit/drop) and a Triggers tab in the Table Designer.

### Sprint 3 — Editor power tools

- **Multi-statement execution.** A new statement splitter (`statementSplitter.ts`,
  respecting strings, comments, dollar-quoted bodies and `DELIMITER`) lets the
  editor run a whole buffer as a sequence — one result tab per statement, stopping
  at the first error.
- **Run scopes.** The primary Run / Ctrl+Enter now runs the **selection** if any,
  else the **statement at the cursor**; added explicit **Run All** and **Run
  Selected** toolbar actions (the editor surfaces its live selection/cursor via a
  new `onEditorMount`).
- **EXPLAIN.** An Explain button prefixes the per-engine plan command
  (Postgres `EXPLAIN (FORMAT JSON)`, MySQL `EXPLAIN FORMAT=JSON`, SQLite
  `EXPLAIN QUERY PLAN`) and shows the plan as a result tab (`explain.ts`).
- **Parameterized `[$name]` queries.** `[$name]` placeholders are detected and a
  prompt dialog collects values; bound mode runs a parameterized statement
  (`executeMutation`), raw mode substitutes literally (`sqlParams.ts`,
  `ParamInputDialog.tsx`).
- **User snippet library.** Create/edit/delete reusable snippets (`useSnippets`,
  `SnippetManager.tsx`); they also appear in code-completion alongside the built-ins.

Frontend-only. Verification: `pnpm typecheck` clean, `pnpm lint` 0 errors,
`pnpm test` 441 passing (incl. new splitter / sqlParams / explain suites).

### Sprint 2 — Data editor → Navicat-grade

Brought the table-data editor closer to Navicat's data viewer:

- **Server-side sort.** Click a column header to sort none→asc→desc→none; the
  `ORDER BY` is pushed into the load query (whole table, not just the page) with a
  ▲/▼ indicator. New `src/lib/whereBuilder.ts` (`buildOrderBy`).
- **Server-side Filter & Sort pane.** A dockable pane builds a multi-condition
  `WHERE` (AND/OR, full operator set) pushed to the database as a **parameterized**
  SELECT (`buildWhere` → `queryCommands.executeMutation`), so it finds rows beyond
  the current page — no string interpolation. (`FilterSortPane.tsx`.)
- **Form (single-record) view.** A Grid/Form toggle renders the active row as a
  vertical labeled form with First/Prev/Next/Last navigation, routing edits through
  the same commit pipeline. (`FormView.tsx`.)
- **Cell viewer panel.** A dockable Text / JSON / Hex / Image viewer for the focused
  cell. (`CellViewerPanel.tsx`.)
- **Cell context menu.** Right-click a cell: Set NULL / Set empty string / Generate
  UUID / Filter by this value / Copy as INSERT / Copy as UPDATE / View cell.
- **ENUM / SET editors.** MySQL `enum(...)` columns render a dropdown and `set(...)`
  columns a checklist (parsed from `full_type`). (`enumType.ts`, `cells/EnumCell.tsx`,
  `cells/SetCell.tsx`.)
- Sort/filter reloads are gated on `hasUncommittedChanges` so they can't silently
  discard pending edits (consistent with paging/refresh).

Frontend-only (the parameterized-SELECT path reuses the existing
`execute_with_params` backend). Verification: `pnpm typecheck` clean, `pnpm lint`
0 errors, `pnpm test` 390 passing (incl. new `whereBuilder` + `enumType` suites).

### Navicat gap analysis + Sprint 1 (polish & correctness)

Ran a research pass comparing ANSQL against Navicat 17 (177 features across 10 areas)
and captured it in `docs/navicat-gap-analysis.md` with a prioritized 4-sprint roadmap.
Sprint 1 lands the cheap, high-impact polish/correctness items:

- **Explorer object search/filter.** A search box in the Database Explorer header
  filters the tree as-you-type (case-insensitive; keeps matching nodes + their
  ancestors and auto-expands matched branches via a new `forceExpandedIds` prop on
  `TreeView`). Empty query preserves the user's existing expansion.
- **Connection colour.** `ConnectionForm` now has a colour-swatch picker (reusing
  the group colour presets); the chosen colour tints the connection's icon in the
  explorer tree. Wires up the previously dead `Connection.color` field (was always
  sent as `undefined`).
- **Preferences dialog.** Replaced the "coming soon" stub with a real persisted
  Preferences dialog (`useSettings` → `localStorage`): Appearance (Light / Dark /
  **System**, with `useTheme` gaining a reactive `resolvedTheme`), default
  rows-per-page (wired into the table grid), and SQL-editor font size / word-wrap /
  minimap (wired into the Monaco editors). Monaco now follows the resolved theme so
  'System' renders correctly under a dark OS.
- **Formatter dialect fix.** Beautify/Format now picks the sql-formatter language
  from the active connection (`postgres`→postgresql, `sqlite`→sqlite, else mysql),
  instead of always formatting as MySQL.
- **Excel date-serial import fix.** `parseExcel` reads with `cellDates: true` and
  formats date/datetime cells as `YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS` (local
  components, no off-by-one), instead of importing raw serial numbers. Added a
  Vitest covering it.

Verification: `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test` 370 passing.

> Deferred: the vault master-password UI conflicts with the existing device-key
> auto-unlock (`lib.rs`) and needs an architecture decision; tracked but not built.

## 2026-06-13

### Cross-DB smart copy/paste (Ctrl+C / Ctrl+V)

Copy a table, a query result, or a row selection in one database and paste it into
another — a configurable cross-DB transfer modal opens pre-filled, reusing the
existing transfer engine. Inspired by Navicat's copy/transfer ergonomics.

- **Internal structured clipboard** (`src/lib/clipboardStore.ts`) carries one of
  three payloads — `table-ref`, `query-ref`, `row-snapshot` — while copy still
  dual-writes TSV to the OS clipboard (Excel interop intact).
- **Auto data-capture:** whole table / query result is captured by *reference*
  (re-streamed by the engine at paste time — anti-OOM, like Navicat); an explicit
  cell/row selection is captured as a *snapshot*.
- **Target-aware paste dispatch** (`src/hooks/usePaste.ts` `decidePaste`): same-DB
  cell paste keeps the existing instant in-grid path; cross-DB or table-level paste
  opens `PasteTransferModal` (target picker, create-vs-conflict mode, column
  mapping, DDL/sample-INSERT preview, run + report).
- **Paste entry points:** the data grid (Ctrl+V), an Explorer database node
  ("Paste here"), plus "Copy" on a table node and "Copy as source" on a query
  result.
- **Backend:** new parameterized `transfer_rows` command + `transfer/rows.rs`
  (INSERT via `commit_batch`, CREATE-from-inferred-types), and a query-as-source
  mode for the engine (`TransferJob.source_query`). Empty-result and drop-mode
  error paths are surfaced, not swallowed.
- Backend: 37 Rust tests; frontend: clipboard-store + paste-routing Vitest suites.

## 2026-06-06

### Secure, parameterized table editing + quality pass

- **Parameterized edit path.** Grid edits no longer build SQL strings in the
  frontend. A pure `src/lib/mutationBuilder.ts` produces `{sql, params}` statements
  with dialect-correct placeholders (`?` for MySQL/SQLite, `$1..$n` for Postgres);
  the Rust drivers bind values via sqlx. This removes a MySQL injection / data-
  corruption vector (backslash escaping) and the old naive single-quote escaping.
- **Primary-key row identification.** UPDATE/DELETE target rows by their real
  primary key (fetched via `get_columns`), falling back to an all-columns WHERE
  only when a table has no PK. Removes the hardcoded `id` / `created_at` /
  `updated_at` name heuristics.
- **Atomic commits.** All pending INSERT/UPDATE/DELETE statements run in a single
  transaction (`commit_changes` → driver `commit_batch`); any failure rolls back.
- **Query cancellation (#6).** `execute_query` runs in an abortable task keyed by a
  request id; `cancel_query` aborts it (best-effort).
- **Restored grid regressions.** Cell undo/redo (Ctrl+Z / Ctrl+Y) and
  copy-with-headers (Ctrl+Shift+C) re-implemented on the canvas grid.
- **Tooling & hygiene.** Added ESLint flat config and `lint` / `typecheck` / `test`
  scripts; added Vitest with mutation-builder tests and Rust tests for binding and
  transactional rollback. Removed stray `console.log`s and stopped logging query
  text/values in the backend.

## 2026-06-01

### Data table revamped to a canvas grid (glide-data-grid)

Replaced the hand-rolled virtualized HTML table with a canvas-based grid for
smooth scrolling on large result sets (1000+ rows × many columns).

- Canvas rendering with built-in row + column virtualization (no scroll lag).
- Preserved: inline cell editing, multi-cell selection, copy/paste, add / delete /
  duplicate / restore rows (row-marker selection + toolbar), dirty-cell highlight,
  row coloring (new = green, deleted = red), column resize, NULL display, and the
  commit → SQL generation (UPDATE / INSERT / DELETE) unchanged.
- JSON columns edit in a textarea overlay; date / datetime / time columns edit with
  a native picker (custom canvas cells).
- Theme derived from the app's CSS variables (dark / light).
- Removed the now-unused `@tanstack/react-virtual` dependency and the old
  `JsonCellEditor` component.

> Note: cell-edit undo/redo (Ctrl+Z/Y) and copy-with-headers from the old table are
> not yet reimplemented on the canvas grid.

## 2026-05-31

### Cross-DB Data Transfer

Added a Data Transfer wizard to copy table structure + data + indexes + foreign
keys between databases, including across engines (MySQL / PostgreSQL / SQLite).

- Backend `transfer` module:
  - `type_map` — canonical type model parsing/rendering across dialects
  - `dialect` — identifier quoting and dialect-correct value literals (incl. MySQL backslash escaping)
  - `ddl` — cross-dialect `CREATE TABLE` (with auto-increment as AUTO_INCREMENT/SERIAL/AUTOINCREMENT), indexes, foreign keys
  - `plan` — topological table ordering by FK dependency (cycle-safe)
  - `engine` — preview + batched literal-INSERT execution with per-table conflict
    modes (drop/truncate/append/skip) and error policies (stop / table-atomic continue / skip-row)
- Tauri commands `preview_transfer` and `run_transfer`, streaming `transfer://progress` events
- SQLite driver: type-aware value extraction and opt-in `create_if_missing`
- Frontend: `TransferWizard` (vertical step sidebar) launched from the Database
  Explorer context menu, with target/tables/options/preview/run steps and live progress

## 2026-01-31

### Phase 1: Project Setup & Foundation
**Time: Initial Setup**

- Created new Tauri 2.x project structure
- Setup React 19 + TypeScript + Vite frontend
- Configured Tailwind CSS 4.x with OKLCH theming (style copied from ANSSH)
- Created project folder structure:
  - `src/components/` - React components
  - `src/hooks/` - Custom React hooks
  - `src/lib/` - Utility functions and Tauri command wrappers
  - `src/types/` - TypeScript type definitions
  - `src-tauri/src/commands/` - Tauri command handlers
  - `src-tauri/src/db/` - Database driver implementations
  - `src-tauri/src/storage/` - Local SQLite storage
  - `src-tauri/src/crypto/` - Credential vault encryption

- Implemented core infrastructure:
  - `index.css` - OKLCH theme variables
  - `App.tsx` - Main app layout with sidebar navigation
  - `Sidebar.tsx` - Reusable sidebar component
  - `types/index.ts` - All TypeScript interfaces
  - `lib/tauri-commands.ts` - Tauri IPC command wrappers

- Backend infrastructure:
  - `storage/database.rs` - SQLite storage layer
  - `storage/migrations.rs` - Database migrations
  - `storage/models.rs` - Data models
  - `crypto/vault.rs` - AES-256-GCM credential encryption with Argon2

---

### Phase 2: Connection Management
**Time: After Phase 1**

- Created connection UI components:
  - `ConnectionForm.tsx` - Modal form for create/edit connections
  - `ConnectionCard.tsx` - Card display with context menu (connect, edit, delete)

- Implemented `useConnections.ts` hook for CRUD operations

- Created database drivers (Rust):
  - `db/driver.rs` - DatabaseDriver trait definition
  - `db/mysql.rs` - MySQL driver using sqlx
  - `db/postgres.rs` - PostgreSQL driver using sqlx
  - `db/sqlite.rs` - SQLite driver using sqlx

- Backend commands:
  - `connection_commands.rs` - CRUD for connections
  - `group_commands.rs` - Connection groups management
  - `vault_commands.rs` - Vault initialization and unlock

---

### Phase 3: Database Explorer
**Time: After Phase 2**

- Created explorer UI components:
  - `TreeView.tsx` - Generic hierarchical tree component with expand/collapse
  - `DatabaseExplorer.tsx` - Database explorer with tree view, sessions, context menus

- Implemented `useSessions.ts` hook:
  - Session management (connect/disconnect)
  - Database listing
  - Table listing
  - Column/Index/ForeignKey fetching

- Backend session commands (`session_commands.rs`):
  - `connect` - Create database session
  - `disconnect` - Close database session
  - `get_sessions` - List active sessions
  - `get_databases` - List databases
  - `get_tables` - List tables in database
  - `get_columns` - Get column definitions
  - `get_indexes` - Get index information
  - `get_foreign_keys` - Get foreign key relationships

- Integrated explorer with App.tsx:
  - Shared session state between views
  - Connection status indicators on ConnectionCard
  - Explorer panel with tree view sidebar
  - Double-click to connect or select tables

---

### Phase 4: Query Editor
**Time: After Phase 3**

- Created query UI components:
  - `QueryTabs.tsx` - Tab management for multiple query editors
  - `QueryToolbar.tsx` - Execute, cancel, save buttons + session selector
  - `QueryEditor.tsx` - Monaco Editor integration with SQL syntax highlighting
  - `QueryPanel.tsx` - Combined panel with tabs, toolbar, editor, and results

- Created results UI component:
  - `ResultsGrid.tsx` - Sortable data grid with copy/export functionality

- Implemented `useQueries.ts` hook:
  - Multiple query tabs management
  - Tab content tracking (modified state)
  - Query execution and result storage
  - Error handling

- Backend query commands (`query_commands.rs`):
  - `execute_query` - Execute SQL query and return results
  - `cancel_query` - Cancel running query

- Features:
  - Monaco Editor with SQL syntax highlighting
  - Multiple query tabs with close/new tab buttons
  - Ctrl+Enter to execute query
  - Resizable results panel
  - Sortable result columns
  - Copy results to clipboard
  - Execution time display
  - Session selector dropdown

---

## Technical Notes

### Fixed Issues
1. **TypeScript Section type error** - Fixed by casting section parameter
2. **Missing icons** - Copied from ANSSH project
3. **Library name mismatch** - Added `[lib] name = "ansql_lib"` to Cargo.toml
4. **Missing trait imports** - Added `use tauri::Manager;` and `use sqlx::Column;`
5. **SaltString.as_bytes() error** - Changed to `salt.as_str().as_bytes()`
6. **Borrow after move** - Fixed data_type usage in sqlite.rs
7. **Future not Send error** - Restructured session_commands.rs to drop MutexGuard before async await
8. **TableInfo type mismatch** - Changed `type` to `table_type` to match backend
9. **Monaco Editor types** - Used `any` type for editor ref to avoid monaco-editor dependency

### Architecture Decisions
- Used domain-driven custom hooks pattern (useConnections, useSessions, useQueries)
- Lifted session state to App level for sharing between views
- Used Map for session storage to allow efficient lookups
- Database drivers implement async trait for connection pooling
- Used ref pattern for Monaco Editor execute command to avoid stale closures

---

### Phase 5: Results & Table View
**Time: After Phase 4**

- Created table structure UI component:
  - `TableStructure.tsx` - Tabbed view for columns, indexes, and foreign keys

- Created export functionality:
  - `useExport.ts` hook - Export to CSV/JSON with Tauri file dialog
  - `export_commands.rs` - Backend export to CSV and JSON files

- Enhanced ResultsGrid:
  - Sortable columns (click to sort ascending/descending)
  - Copy results to clipboard (tab-separated)
  - Export to CSV and JSON files
  - Row count and execution time display

- Backend export commands:
  - `export_to_csv` - Export data to CSV file
  - `export_to_json` - Export data to JSON file

- Features:
  - Tauri file save dialog integration
  - CSV escaping for special characters
  - Pretty-printed JSON output
  - Proper null value handling

---

## Project Complete

All 5 phases have been implemented:
1. Project Setup & Foundation
2. Connection Management
3. Database Explorer
4. Query Editor
5. Results & Table View

The application now supports:
- Creating and managing database connections (MySQL, PostgreSQL, SQLite)
- Browsing database structure (databases, tables, columns, indexes, foreign keys)
- Writing and executing SQL queries with Monaco Editor
- Viewing query results in a sortable grid
- Exporting results to CSV or JSON files
- Encrypted credential storage (vault system)
