# ANSQL - Implementation Tracker

**Last Updated:** 2026-06-20
**Original numbered backlog:** 20 / 20 complete ✅

> All twenty numbered backlog items below are shipped. Active work is now tracked
> in `CHANGELOG.md` (per-sprint, newest first) and `docs/navicat-gap-analysis.md`
> (residual gaps vs Navicat). This file is kept for historical reference.

---

## ✅ Completed (20 / 20)

- [x] #1: Delete Row feature
- [x] #2: Fix Connection Testing
- [x] #3: SQL Query History (Backend)
- [x] #4: SQL Formatter/Beautify
- [x] #5: Integrate Credential Vault for Passwords
- [x] #6: Implement Query Cancellation (best-effort abort)
- [x] #7: Saved Queries/Favorites (Backend)
- [x] #8: CSV/Excel Import to Table — `useImport.ts` + `fileImport.ts`
      (Sprint 5-E; parse options, XML, upsert, type override)
- [x] #9: Dark Mode Toggle
- [x] #10: Search/Filter in Results Grid
- [x] #11: Copy with Headers
- [x] #12: Keyboard Shortcut Ctrl+N
- [x] #13: Undo/Redo for Cell Edits
- [x] #14: Duplicate Row Feature
- [x] #15: Bulk Edit for Multiple Cells — `BulkEditDialog.tsx` + find & replace
      (`GridFindReplaceBar.tsx`, Sprint 5-C)
- [x] #16: Foreign Key Dropdown Selector — `cells/FkCell.tsx` + `fkLookup.ts`
      (searchable, debounced, cached, NULL option)
- [x] #17: Client-Side Validation Before Commit — `lib/validators.ts`,
      wired into `TableData.tsx` (`validateRow` / `CellError`)
- [x] #18: SQL Auto-Complete/IntelliSense — `lib/sqlCompletion.ts`
      (per-statement alias map, schema-aware, cached per session+db)
- [x] #19: Multiple Result Tabs — `components/query/ResultTabs.tsx`
      (pin / rename, per-tab execution time + export; Sprint 5-D)
- [x] #20: ERD Diagram Generator — `components/erd/` (ErdView + TableNode,
      @xyflow/react + dagre; Sprint 4.2, extended in 5-F with FK→ALTER,
      color, save-layout, PNG/SVG, reverse/forward-engineer)

> Beyond the numbered backlog: **Cross-DB Data Transfer** (wizard, 2026-05-31),
> **Cross-DB Smart Copy/Paste** (Ctrl+C / Ctrl+V → transfer modal, 2026-06-13),
> **Time Machine** action journal + rollback (Sprint 13/13.1, 2026-06-19/20),
> and the **Redis / MongoDB / SQL Server** engines (Sprints 7/11/12) are also
> complete. See `CHANGELOG.md`.

---

## ⚠️ Runtime-unverified (code-complete, needs live-server validation)

These compile and pass unit/typecheck/lint, but were not exercised against a live
server in their sprint. Treat their code paths as plausible-but-unproven:

- [ ] **Sprint 7** — SQL Server engine (`tiberius` driver, T-SQL builders)
- [ ] **Sprint 9** — Vault master-password (opt-in re-key + startup unlock)
- [ ] **Sprint 11** — Redis engine + key browser
- [ ] **Sprint 12** — MongoDB engine + document browser
- [ ] **Sprint 13** — Time Machine record→undo→redo cycle (grid + raw editor)

---

## 🎯 Out of scope / future work

From `docs/navicat-gap-analysis.md` — explicit non-goals (different products or
large separate efforts):

- Oracle / Snowflake / ODBC engines
- Native cloud connection variants (Navicat Cloud / On-Prem Server)
- Navicat Monitor / full BI product
- In-app scheduling / automation daemon
- Long-tail UI polish against Navicat 17

---

## 🔗 Related Documents

- [Project README](./README.md)
- [CHANGELOG](./CHANGELOG.md) — per-sprint narrative (newest first)
- [Navicat gap analysis](./docs/navicat-gap-analysis.md)
