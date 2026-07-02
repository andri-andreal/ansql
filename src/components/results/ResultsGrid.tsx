import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Download, Copy, Check, Search, FilterX } from "lucide-react";
import type { QueryResult } from "../../types";
import { applyGridFilters, type ColumnFilter } from "../../lib/gridFilter";
import { ColumnFilterPopover } from "../table/ColumnFilterPopover";
import { useTranslation } from "../../i18n";

interface ResultsGridProps {
  result: QueryResult;
  onExport?: (format: "csv" | "json") => void;
}

type SortDirection = "asc" | "desc" | null;

function ResultsGrid({ result, onExport }: ResultsGridProps) {
  const { t } = useTranslation();
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [copied, setCopied] = useState(false);
  const [searchText, setSearchText] = useState("");
  // Per-column filters keyed by column name (one active filter per column).
  const [columnFilters, setColumnFilters] = useState<Map<string, ColumnFilter>>(new Map());

  const setColumnFilter = (column: string, filter: ColumnFilter | undefined) => {
    setColumnFilters((prev) => {
      const next = new Map(prev);
      if (filter) next.set(column, filter);
      else next.delete(column);
      return next;
    });
  };

  const clearAllFilters = () => {
    setColumnFilters(new Map());
    setSearchText("");
  };

  const handleSort = (columnName: string) => {
    if (sortColumn === columnName) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnName);
      setSortDirection("asc");
    }
  };

  const sortedAndFilteredRows = useMemo(() => {
    // Global search AND per-column filters (shared, pure helper).
    const columnNames = result.columns.map((c) => c.name);
    const rows = applyGridFilters(
      result.rows,
      columnNames,
      searchText,
      Array.from(columnFilters.values())
    );

    // Then sort
    if (!sortColumn || !sortDirection) return rows;

    const colIndex = result.columns.findIndex((c) => c.name === sortColumn);
    if (colIndex === -1) return rows;

    return [...rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null || aVal === undefined) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === "asc" ? -1 : 1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [result.rows, result.columns, sortColumn, sortDirection, searchText, columnFilters]);

  const activeFilterCount = columnFilters.size + (searchText ? 1 : 0);

  const handleCopy = async () => {
    const headers = result.columns.map((c) => c.name).join("\t");
    const rows = sortedAndFilteredRows
      .map((row) =>
        result.columns.map((c) => String(row[c.name] ?? "")).join("\t")
      )
      .join("\n");
    const text = `${headers}\n${rows}`;

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (result.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("query.queryExecutedSuccessfully")}</p>
        {result.affected_rows !== undefined && (
          <p className="text-xs mt-1">
            {t("query.rowsAffected", { count: result.affected_rows })}
          </p>
        )}
        <p className="text-xs mt-1">
          {t("query.executionTime", { ms: result.execution_time_ms })}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {t("query.rowsSummary", { count: sortedAndFilteredRows.length })}{" "}
            {activeFilterCount > 0 &&
              t("query.filteredFrom", { total: result.rows.length })}{" "}
            | {result.execution_time_ms}ms
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("query.search")}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-8 pr-3 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary w-64"
            />
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
              title={t("query.clearFiltersTooltip")}
            >
              <FilterX className="w-4 h-4" />
              {t("query.clearFilters")}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-secondary rounded transition-colors"
            title={t("query.copyToClipboard")}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {t("query.copy")}
          </button>
          {onExport && (
            <>
              <button
                onClick={() => onExport("csv")}
                className="flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-secondary rounded transition-colors"
                title={t("query.exportCsvTooltip")}
              >
                <Download className="w-4 h-4" />
                {t("query.exportCsv")}
              </button>
              <button
                onClick={() => onExport("json")}
                className="flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-secondary rounded transition-colors"
                title={t("query.exportJsonTooltip")}
              >
                <Download className="w-4 h-4" />
                {t("query.exportJson")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-secondary">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border w-12">
                #
              </th>
              {result.columns.map((column) => (
                <th
                  key={column.name}
                  onClick={() => handleSort(column.name)}
                  className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border cursor-pointer hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>{column.name}</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {column.data_type}
                    </span>
                    {sortColumn === column.name && (
                      sortDirection === "asc" ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )
                    )}
                    <ColumnFilterPopover
                      column={column.name}
                      filter={columnFilters.get(column.name)}
                      onChange={(filter) => setColumnFilter(column.name, filter)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedAndFilteredRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="hover:bg-accent/50 transition-colors"
              >
                <td className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
                  {rowIndex + 1}
                </td>
                {result.columns.map((column) => {
                  const value = row[column.name];
                  const isNull = value === null || value === undefined;

                  return (
                    <td
                      key={column.name}
                      className="px-3 py-1.5 border-b border-border max-w-[300px] truncate"
                      title={isNull ? "NULL" : String(value)}
                    >
                      {isNull ? (
                        <span className="text-muted-foreground/50 italic">NULL</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ResultsGrid;
