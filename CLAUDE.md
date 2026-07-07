# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ANSQL is a Tauri 2 desktop SQL/NoSQL client (React 19 + TypeScript frontend, Rust backend) covering MySQL/MariaDB, PostgreSQL, SQLite, SQL Server, Redis, and MongoDB.

> **Read `AGENTS.md` first.** It owns the command table, the architecture map, and the coding conventions. This file only adds the big-picture, cross-file architecture and the non-obvious invariants that aren't visible from any single file.

**Scope.** This repository is the **Community** edition (MIT, open source). ANSQL **Pro** (enterprise engines, AI, automation) is a separate closed-source edition built on top — see `EDITIONS.md`. Keep PRs in scope for Community; the CLA in `CLA.md` must be signed before any PR is merged (automated by the CLA Assistant bot — see `CONTRIBUTING.md`).

## Definition of done

Every change must keep these green (also in `AGENTS.md`):

```bash
pnpm typecheck && pnpm lint && pnpm test && cargo check --manifest-path src-tauri/Cargo.toml
```

- `no-explicit-any` is a lint **warning**, not an error. There is a small pre-existing baseline of `any` warnings in `src/components/table/cells/*`; do not add new ones — hold the baseline.
- Run a single frontend test: `pnpm test src/lib/foo.test.ts` or `pnpm vitest run -t "test name"`. Single Rust test: `cargo test --manifest-path src-tauri/Cargo.toml <name>`.
- `pnpm tauri dev` launches the real desktop app (needs a display). The Rust crate is named `ansql_lib`; logs go through `tracing` (`println!` is not used).

## The two driver worlds (most important architectural split)

There are **two parallel engine subsystems** that do NOT share a trait — confusing them is the most common mistake:

1. **SQL engines** (MySQL, PostgreSQL, SQLite, SQL Server) implement the Rust `DatabaseDriver` trait in `src-tauri/src/db/driver.rs`, are constructed by `db/factory.rs` (`build_driver_with_tunnel`), and are stored in the `SessionStore` (`commands/session_commands.rs`) as `Arc<Mutex<Box<dyn DatabaseDriver>>>` keyed by session id. All relational features (explorer, designers, query, transfer, ERD) go through this trait.

2. **NoSQL engines** (Redis, MongoDB) do **not** implement `DatabaseDriver`. Each has its own driver (`db/redis_driver.rs`, `db/mongo_driver.rs`), its own command module (`commands/redis_commands.rs`, `commands/mongo_commands.rs`), and its own `*SessionStore` managed in `lib.rs`. They open dedicated workspace tabs (`RedisKeyBrowser`, `MongoBrowser`) instead of the SQL explorer.

The frontend mirrors this with a deliberate **`DatabaseDriver` vs `Dialect` type split** in `src/types/index.ts`:

- `DatabaseDriver` = all 6 engines (`"mysql" | "postgres" | "sqlite" | "sqlserver" | "redis" | "mongodb"`).
- `Dialect` = the 4 SQL engines only — what every builder in `src/lib/` switches on.
- `isSqlDriver(d)` / `toDialect(d)` (set-driven off `SQL_DRIVERS`) bridge them; `toDialect` **throws** for `redis`/`mongodb`. Any SQL-only path must guard with `isSqlDriver` first. Adding a new SQL engine means adding a `Dialect` case to every builder; a new NoSQL engine means only `DatabaseDriver` + a new browser/command module.

## How a SQL mutation flows end-to-end

Never string-concatenate values. The pipeline is: **component/hook → builder in `src/lib/` → `tauri-commands.ts` wrapper → `#[tauri::command]` → driver `execute_with_params` / `commit_batch`.**

- Builders (`mutationBuilder.ts`, `whereBuilder.ts`, `ddlBuilder.ts`, …) emit `(sql, params)` with dialect-correct identifier quoting (`` `x` `` / `"x"` / `[x]`) and placeholders (`?` / `$n` / `@Pn`). `rawSql()` is the escape hatch for non-bindable fragments.
- Multi-statement atomic writes go through `commit_batch` (single transaction). This is also what the **Time Machine** (`hooks/useActionJournal.ts`) records: each reversible action stores forward + inverse `(sql, params)` batches in the local SQLite journal for LIFO undo/redo.
- Adding a Tauri command = register it in `lib.rs` `invoke_handler!` **and** wrap it in `src/lib/tauri-commands.ts`. The two must stay in sync.

## Introspection: per-table vs batched

Schema metadata has per-table methods (`get_tables`/`get_columns`/`get_indexes`/`get_foreign_keys`) and a **batched** `get_schema_graph(database, schema, tables)` used by the ER diagram. The batched method has a default per-table fallback in the trait and single-pass overrides in `mysql.rs`/`postgres.rs` — this exists because the ERD's old per-table fan-out caused an N+1 hang on large schemas (~2 queries instead of ~2N). Prefer batched introspection for any "whole schema at once" feature.

## Frontend composition & provider ordering

`useAppState()` (`hooks/useAppState.ts`) is the central state hook: it composes the smaller domain hooks (`useSessions`, `useWorkspaceTabs`, `useActionJournal`, …) and returns one big `AppState` object that `App.tsx` threads into `AppShell`, which fans it out to feature areas.

**Provider ordering is load-bearing:** `useAppState()` runs during `App`'s own render and calls `useActionJournal()` → `useToast()`, so `ToastProvider` must sit **above** `<App/>` (it lives in `main.tsx`, wrapping `App` under `I18nProvider`). `AppShell` then adds `JournalRecorderProvider` + `PasteProvider` for its subtree. A hook that needs a context must have its provider mounted above the component that triggers the hook — putting a provider only inside `AppShell` will crash any `useAppState`-level consumer.

Workspace content is a discriminated union: `lib/workspaceTabs.ts` defines `WorkspaceTabKind`, and `WorkspaceArea`/`WorkspaceTabBar` switch exhaustively over it (each new tab kind needs a render case + an icon entry). State that should survive reload is persisted per-diagram/per-tab.

## Credential vault modes

`crypto/vault.rs` (AES-256-GCM + Argon2) encrypts stored credentials. The unlock mode is decided in `lib.rs` by the presence of the `vault.key` device-key file: **device** (key present → auto-unlock), **master/locked** (key absent but vault initialized → prompt for master password), or **first-run** (key absent + uninitialized). Re-keying (set/disable master password) verifies before committing so a failed re-key can't lock the user out; `reset_vault` is the escape hatch. Default behaviour is device auto-unlock — the master password is strictly opt-in.

## Runtime-unverified code

SQL Server, Redis, MongoDB, the vault master-password, and the Time Machine were committed compile-clean but not all exercised against live servers (flagged "runtime-unverified" in `CHANGELOG.md`). Treat those paths as plausible-but-unproven; prefer minimal, additive edits there and verify against a real server when possible. The Toast/provider crash fixed in this area is the kind of latent bug to expect.

## Docs

- `CHANGELOG.md` — per-sprint narrative, newest first (each sprint = a feature wave; check it before assuming something is missing).
- `docs/navicat-gap-analysis.md` — the 177-feature gap audit vs Navicat + closeout notes.
- `docs/2026_*.md` — per-sprint retrospectives (problem/solution/testing deep dives on individual features and fixes).
- `TODO.md` — historical numbered backlog (all shipped; active work tracked in CHANGELOG).
- `EDITIONS.md`, `CLA.md`, `CONTRIBUTING.md` — open-core scope, contributor license agreement, and contribution workflow.
