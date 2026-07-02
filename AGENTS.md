# AGENTS.md

Guidance for AI agents (and human contributors) working in this repository.

## Project

ANSQL — a Tauri 2.x desktop SQL client. Frontend: React 19 + TypeScript + Vite.
Backend: Rust (`src-tauri/`). Supports MySQL/MariaDB, PostgreSQL, SQLite,
Microsoft SQL Server, Redis, and MongoDB.

## Essential commands

Always run these from the repo root and verify they pass before finishing a task.

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Frontend dev (Vite only) | `pnpm dev` |
| Full Tauri dev (frontend + Rust) | `pnpm tauri dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests (frontend, Vitest) | `pnpm test` |
| Unit tests watch | `pnpm test:watch` |
| Production build (frontend) | `pnpm build` |
| Production build (full app) | `pnpm tauri build` |
| Rust check (fast, no codegen) | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |

**Definition of done for any change:**

```bash
pnpm typecheck && pnpm lint && pnpm test && cargo check --manifest-path src-tauri/Cargo.toml
```

Keep these green. `pnpm lint` is configured to treat `no-explicit-any` as a
warning; do not introduce new `any` types — use proper types.

## Architecture map

```
src/                       React frontend
├── components/            UI (one folder per feature area)
├── hooks/                 useXxx.ts domain hooks (state + Tauri calls)
├── lib/                   Pure logic (builders, parsers) + tauri-commands.ts
├── i18n/                  Localization (en + id catalogs)
├── types/                 Shared TS types
└── App.tsx

src-tauri/src/             Rust backend
├── commands/              #[tauri::command] handlers (one file per area)
├── db/                    DatabaseDriver trait + per-engine drivers
│                          (mysql/postgres/sqlite/mssql/redis_driver/mongo_driver)
├── transfer/              Cross-DB transfer engine (DDL, plans, row transfer)
├── crypto/                Credential vault (AES-256-GCM + Argon2)
├── ssh/                   Pure-Rust SSH tunneling
├── storage/               Local SQLite (app DB, migrations)
└── lib.rs                 Tauri builder + command registration
```

### Conventions

- **Pure logic goes in `src/lib/`** with co-located `*.test.ts` (Vitest). UI
  components and hooks stay thin; push testable behavior into `lib/`.
- **SQL is built by parameterized builders** (`mutationBuilder.ts`,
  `whereBuilder.ts`, `ddlBuilder.ts`, …) per dialect — never string-concatenate
  values in components. Bind via `execute_with_params` / `commit_batch` on the
  Rust side.
- **New Tauri commands** must be registered in `src-tauri/src/lib.rs`
  `invoke_handler!` and wrapped in `src/lib/tauri-commands.ts`.
- **New engines** implement `DatabaseDriver` (`db/driver.rs`), are constructed in
  `db/factory.rs`, and add a `Dialect` case across every builder in `src/lib/`.
- **i18n:** all user-facing strings go through `useTranslation()` catalogs in
  `src/i18n/`; do not hardcode English in UI.
- **Rust:** follow existing style — `tracing::info!`/`error!` for logs (never
  `println!`), `thiserror` for error enums, no secrets in logs.

### Runtime-unverified features

Several engines/features were added compile-clean but could not be exercised
against a live server in their sprint (see CHANGELOG entries flagged
"runtime-unverified": SQL Server, Redis, MongoDB, vault master-password, Time
Machine). Treat their code paths as plausible-but-unproven and prefer minimal,
additive edits there unless you can test against a real server.

## Docs

- `README.md` — setup, scripts, project structure
- `CHANGELOG.md` — per-sprint narrative (newest first)
- `TODO.md` — open task tracker
- `docs/navicat-gap-analysis.md` — feature gap audit vs Navicat
