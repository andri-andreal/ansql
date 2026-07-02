import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, readFile } from "@tauri-apps/plugin-fs";
import { parseCsv, parseJson, parseExcel, parseXml } from "../lib/fileImport";
import type { ParsedFile, ImportParseOptions } from "../lib/fileImport";
import { buildUpsertStatements } from "../lib/importUpsert";
import { transferRows, queryCommands } from "../lib/tauri-commands";
import type {
  RowTransfer,
  TransferReport,
  Dialect,
  MutationColumn,
  ColumnMap,
} from "../types";

/** Detected file format, so the modal can decide whether to show a sheet picker
 * (excel) or a "first row is header" toggle (csv). */
export type ImportFormat = "csv" | "json" | "excel" | "xml";

export interface ParsedImport extends ParsedFile {
  format: ImportFormat;
}

/** Excel-family extensions parsed as binary workbooks. CSV/TSV/other text is the default. */
const EXCEL_EXT = new Set(["xlsx", "xls", "xlsm", "xlsb"]);

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

function formatFor(path: string): ImportFormat {
  const ext = extensionOf(path);
  if (EXCEL_EXT.has(ext)) return "excel";
  if (ext === "json") return "json";
  if (ext === "xml") return "xml";
  // Default everything else (csv/tsv/txt) to delimited text.
  return "csv";
}

export interface ParseFileOpts {
  /** Excel sheet to read; defaults to the first sheet. */
  sheet?: string;
  /** Whether the first row of a CSV is a header. @default true */
  hasHeader?: boolean;
  /**
   * Advanced delimited/structured parse options (delimiter, quote char,
   * encoding, skip-rows, header-row). Forwarded to `parseCsv`/`parseXml`;
   * ignored by the Excel/JSON parsers. `headerRow` supersedes `hasHeader`.
   */
  parseOptions?: ImportParseOptions;
}

export function useImport() {
  /** Open the native picker; returns the chosen path or null if cancelled. */
  const pickFile = useCallback(async (): Promise<string | null> => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Data", extensions: ["csv", "tsv", "json", "xml", "xlsx", "xls"] },
      ],
    });
    // `open` returns string | string[] | null depending on options.
    if (selected == null) return null;
    return Array.isArray(selected) ? (selected[0] ?? null) : selected;
  }, []);

  /**
   * Read + parse a file into a `ParsedImport`. The format is detected from the
   * extension; callers re-invoke with `sheet`/`hasHeader` to re-parse Excel
   * sheets or toggle the CSV header row.
   */
  const parseFile = useCallback(
    async (path: string, opts: ParseFileOpts = {}): Promise<ParsedImport> => {
      const format = formatFor(path);

      if (format === "excel") {
        const bytes = await readFile(path);
        const parsed = parseExcel(bytes, opts.sheet);
        return { ...parsed, format };
      }

      const text = await readTextFile(path);
      if (format === "json") {
        return { ...parseJson(text), format };
      }
      if (format === "xml") {
        return { ...parseXml(text), format };
      }
      // csv / tsv / other text. `parseOptions` carries the advanced settings;
      // `headerRow` (inside parseOptions) supersedes the legacy `hasHeader`.
      return {
        ...parseCsv(text, {
          hasHeader: opts.hasHeader ?? true,
          ...opts.parseOptions,
        }),
        format,
      };
    },
    []
  );

  /** Run the import via the existing `transfer_rows` backend command. */
  const runImport = useCallback(
    async (
      sessionId: string,
      rowTransfer: RowTransfer
    ): Promise<TransferReport> => {
      return transferRows(sessionId, rowTransfer);
    },
    []
  );

  /**
   * Run an "upsert" import: turn the parsed source rows + mapping into
   * parameterized INSERT … ON CONFLICT/DUPLICATE-KEY statements via
   * `buildUpsertStatements`, then commit them in a single transaction.
   *
   * `targetColumns` is the full target column metadata (drives INSERT column
   * order, types, casts). `qualifiedTable` must already be fully-qualified AND
   * pre-quoted. `keyColumns` are the bare conflict-key target names. Only mapped
   * source columns (`target !== ""`) contribute values; unmapped target columns
   * are left to the database (defaults).
   */
  const runUpsert = useCallback(
    async (
      sessionId: string,
      args: {
        dialect: Dialect;
        qualifiedTable: string;
        sourceColumns: string[];
        sourceRows: unknown[][];
        mapping: ColumnMap[];
        targetColumns: MutationColumn[];
        keyColumns: string[];
        batchSize?: number;
      }
    ): Promise<TransferReport> => {
      const {
        dialect,
        qualifiedTable,
        sourceColumns,
        sourceRows,
        mapping,
        targetColumns,
        keyColumns,
        batchSize = 500,
      } = args;

      // Active mapping (skip "" targets) → source-column index per target.
      const sourceIndex = new Map(sourceColumns.map((name, i) => [name, i]));
      const active = mapping.filter(
        (m) => m.target !== "" && sourceIndex.has(m.source)
      );

      // The INSERT column set is the mapped target columns intersected with the
      // known target metadata (so types/casts stay correct). Unmapped target
      // columns are omitted; key columns must be present to drive the conflict.
      const mappedTargets = new Set(active.map((m) => m.target));
      const insertColumns = targetColumns.filter((c) => mappedTargets.has(c.name));

      // Shape rows as Record<targetName, value> using the active mapping.
      const rows: Record<string, unknown>[] = sourceRows.map((row) => {
        const rec: Record<string, unknown> = {};
        for (const m of active) {
          const idx = sourceIndex.get(m.source)!;
          rec[m.target] = row[idx] ?? null;
        }
        return rec;
      });

      const statements = buildUpsertStatements(
        dialect,
        qualifiedTable,
        insertColumns,
        keyColumns,
        rows,
        batchSize
      );

      if (statements.length > 0) {
        await queryCommands.commitChanges(sessionId, statements);
      }

      // Synthesize a TransferReport-shaped result so the modal's existing report
      // UI renders without a special case.
      return {
        tables: [
          {
            table: qualifiedTable,
            status: rows.length > 0 ? "success" : "skipped",
            rows_copied: rows.length,
            skipped: 0,
            error: null,
          },
        ],
        warnings: [],
      };
    },
    []
  );

  return { pickFile, parseFile, runImport, runUpsert };
}
