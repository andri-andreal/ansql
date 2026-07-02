import { useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { exportCommands } from "../lib/tauri-commands";
import {
  buildXlsx,
  buildInsertSql,
  buildHtml,
  buildXml,
  buildDelimitedText,
  type ExportTextOptions,
} from "../lib/exportFormats";
import type { Dialect, QueryResult } from "../types";

/** Project a QueryResult onto plain row objects keyed by column name. */
function toRowObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col) => {
      obj[col.name] = row[col.name];
    });
    return obj;
  });
}

export function useExport() {
  const exportToCSV = useCallback(async (result: QueryResult, defaultName?: string) => {
    const filePath = await save({
      title: "Export to CSV",
      defaultPath: defaultName || "export.csv",
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
    });

    if (!filePath) return false;

    await exportCommands.exportToCsv(toRowObjects(result), filePath);
    return true;
  }, []);

  const exportToJSON = useCallback(async (result: QueryResult, defaultName?: string) => {
    const filePath = await save({
      title: "Export to JSON",
      defaultPath: defaultName || "export.json",
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });

    if (!filePath) return false;

    await exportCommands.exportToJson(toRowObjects(result), filePath);
    return true;
  }, []);

  /**
   * Export the result set to an Excel .xlsx file. Builds the workbook in the
   * frontend (xlsx lib) and writes the raw bytes via plugin-fs.
   */
  const exportXlsx = useCallback(async (result: QueryResult, defaultName?: string) => {
    const filePath = await save({
      title: "Export to Excel",
      defaultPath: defaultName || "export.xlsx",
      filters: [{ name: "Excel Files", extensions: ["xlsx"] }],
    });

    if (!filePath) return false;

    const columns = result.columns.map((c) => c.name);
    const bytes = buildXlsx(columns, toRowObjects(result));
    await writeFile(filePath, bytes);
    return true;
  }, []);

  /**
   * Export the result set as a .sql file of INSERT statements.
   *
   * @param tableName  Target table name for the INSERTs (caller passes the
   *                   source table or a default like "export_table").
   * @param dialect    Identifier-quoting / literal-escaping dialect.
   */
  const exportSql = useCallback(
    async (
      result: QueryResult,
      tableName: string,
      dialect: Dialect,
      defaultName?: string
    ) => {
      const filePath = await save({
        title: "Export to SQL",
        defaultPath: defaultName || `${tableName || "export_table"}.sql`,
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
      });

      if (!filePath) return false;

      const columns = result.columns.map((c) => c.name);
      const sql = buildInsertSql(
        tableName || "export_table",
        columns,
        toRowObjects(result),
        dialect
      );
      await writeTextFile(filePath, sql);
      return true;
    },
    []
  );

  /**
   * Export the result set as an HTML `<table>` document. Built in the frontend
   * (buildHtml) and written as text via plugin-fs.
   */
  const exportHtml = useCallback(async (result: QueryResult, defaultName?: string) => {
    const filePath = await save({
      title: "Export to HTML",
      defaultPath: defaultName || "export.html",
      filters: [{ name: "HTML Files", extensions: ["html"] }],
    });

    if (!filePath) return false;

    const html = buildHtml(result.columns, toRowObjects(result));
    await writeTextFile(filePath, html);
    return true;
  }, []);

  /**
   * Export the result set as an XML document (`<rows><row>…</row></rows>`).
   * Built in the frontend (buildXml) and written as text via plugin-fs.
   */
  const exportXml = useCallback(async (result: QueryResult, defaultName?: string) => {
    const filePath = await save({
      title: "Export to XML",
      defaultPath: defaultName || "export.xml",
      filters: [{ name: "XML Files", extensions: ["xml"] }],
    });

    if (!filePath) return false;

    const xml = buildXml(result.columns, toRowObjects(result));
    await writeTextFile(filePath, xml);
    return true;
  }, []);

  /**
   * Export the result set as a delimited-text file (general CSV / TXT builder).
   *
   * Unlike {@link exportToCSV} (which uses the raw backend CSV writer), this
   * routes through the frontend `buildDelimitedText` builder so the caller can
   * configure delimiter / quote char / headers / NULL token via `options`.
   *
   * @param extension  File extension + dialog filter ("csv" or "txt").
   */
  const exportText = useCallback(
    async (
      result: QueryResult,
      extension: "csv" | "txt",
      options: ExportTextOptions,
      defaultName?: string
    ) => {
      const isCsv = extension === "csv";
      const filePath = await save({
        title: isCsv ? "Export to CSV" : "Export to Text",
        defaultPath: defaultName || `export.${extension}`,
        filters: [
          {
            name: isCsv ? "CSV Files" : "Text Files",
            extensions: [extension],
          },
        ],
      });

      if (!filePath) return false;

      const text = buildDelimitedText(result.columns, toRowObjects(result), options);
      await writeTextFile(filePath, text);
      return true;
    },
    []
  );

  return {
    exportToCSV,
    exportToJSON,
    exportXlsx,
    exportSql,
    exportHtml,
    exportXml,
    exportText,
  };
}
