# Contributing to ANSQL Community

Thanks for your interest in contributing! This repository is **ANSQL Community Edition**, the open-source core of ANSQL, licensed under the [MIT License](LICENSE). Please read this guide before opening an issue or pull request.

## Open-core model

ANSQL is developed as an [open-core project](EDITIONS.md): the Community edition here is open source, while **ANSQL Pro** (enterprise engines, AI, automation) is a separate closed-source edition built on top. Contributions are accepted **to Community only** — Pro features live in a private repository and are out of scope here.

Because a closed edition exists alongside the open one, all contributors agree to a Contributor License Agreement (see below).

## Contributor License Agreement (CLA)

Before we can merge your contribution, you must sign the [Contributor License Agreement](CLA.md). **You keep the copyright to your work**; the CLA grants the ANSQL maintainers the rights needed to use your contribution across all editions, including the commercial Pro edition.

Signing is automated: the first time you open a pull request, the **CLA Assistant** bot comments with instructions. You sign once by replying with the sentence it gives you, and it then applies to all of your future PRs.

We also encourage signing off each commit under the [Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s -m "feat: add ..."
```

## Development setup

**Prerequisites:** Node.js 18+ (CI uses 20), [pnpm](https://pnpm.io/), Rust 1.70+ with `cargo`, and the platform packages listed in the [README](README.md#platform-specific-requirements).

```bash
pnpm install      # install frontend dependencies
pnpm tauri dev    # run the desktop app with hot reload
```

## Before you open a pull request

Every change must keep the full check suite green — this is exactly what CI runs:

```bash
pnpm typecheck && pnpm lint && pnpm test && cargo check --manifest-path src-tauri/Cargo.toml
```

- `pnpm test` — Vitest unit tests; add or extend tests for behavior you change.
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust tests.
- New `any` types are discouraged: `no-explicit-any` is a lint **warning** with a small existing baseline — please don't add to it.

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)**: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:` — optionally scoped, e.g. `feat(explorer): ...`.
- Branch from `main` (e.g. `feat/my-feature`), keep each PR focused, and describe **what** changed and **why**.
- Link any related issue.

## Codebase conventions

[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) cover the architecture in depth. A few load-bearing rules:

- **Two driver worlds**: SQL engines implement the Rust `DatabaseDriver` trait; NoSQL engines (Redis/MongoDB) are a separate subsystem. Don't conflate them.
- **Never string-concatenate SQL values.** Use the builders in `src/lib/` — they emit `(sql, params)` with dialect-correct identifier quoting and placeholders.
- Adding a Tauri command means registering it in `src-tauri/src/lib.rs` **and** wrapping it in `src/lib/tauri-commands.ts` — keep the two in sync.

## Reporting bugs & requesting features

Open an issue with clear reproduction steps, plus your OS and the database engine/version for bugs. For **security vulnerabilities, please do not open a public issue** — report it privately to the maintainers instead.

## Be respectful

Be kind and constructive. We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/).
