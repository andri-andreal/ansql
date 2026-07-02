/**
 * erdScript.ts — forward-engineer an ERD model into a runnable SQL script.
 *
 * Pure string builder (no React, no Tauri). Given the introspected metadata for
 * a set of tables, assembles a single script: a leading dump header followed by
 * one CREATE TABLE block per table (CREATE TABLE + indexes + ALTER ADD FK),
 * exactly as the dump export does — this just stitches them together for the
 * whole model. Reuses dumpBuilder so the per-table SQL stays in one place.
 */

import type { Dialect } from "../types";
import {
  buildCreateTableDump,
  dumpHeader,
  type DumpTableInput,
} from "./dumpBuilder";

/**
 * Build a full model script for `tables`: the dump header, then each table's
 * CREATE TABLE block (via buildCreateTableDump), joined by a blank line.
 *
 * The header names the model via dumpHeader's databaseName slot ("model"),
 * keeping a single source of truth for header formatting.
 */
export function buildModelScript(
  dialect: Dialect,
  tables: DumpTableInput[],
): string {
  const blocks = [dumpHeader(dialect, "model")];
  for (const t of tables) {
    blocks.push(buildCreateTableDump(dialect, t));
  }
  return blocks.join("\n\n");
}
