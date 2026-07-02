/**
 * UserManager — a pane (rendered as a full-screen modal overlay) for managing
 * database users/roles: list, create, drop, set password, and grant/revoke.
 *
 * Fully presentational + local state. The parent supplies a `runQuery` that
 * executes a single SQL string against the active session and a `dialect`.
 * SQLite has no users, so the parent must not open this on SQLite (and every
 * builder throws on SQLite as a defense in depth).
 *
 * SECURITY: passwords are interpolated as escaped literals by `userBuilder`
 * (unavoidable for CREATE USER). We never concatenate them raw and never log
 * these statements.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  X,
  Users,
  Trash2,
  KeyRound,
  UserPlus,
  AlertTriangle,
  ShieldCheck,
  ListChecks,
  UserCog,
} from "lucide-react";

import type { Dialect, Statement } from "../../types";
import { quoteIdent } from "../../lib/mutationBuilder";
import {
  buildCreateUser,
  buildDropUser,
  buildSetPassword,
  buildGrant,
  buildRevoke,
  buildCreateRole,
  buildDropRole,
  buildGrantRole,
} from "../../lib/userBuilder";
import {
  listUsersQuery,
  listGrantsQuery,
  parseGrants,
  listRolesQuery,
} from "../../lib/userQueries";
import { SqlPreviewPane } from "../table/SqlPreviewPane";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UserManagerProps {
  dialect: Dialect;
  /** Executes a single SQL string and resolves with the raw query result. */
  runQuery: (sql: string) => Promise<unknown>;
  onClose: () => void;
}

// A row from listUsersQuery, shape varies by dialect.
interface UserRow {
  name: string;
  host?: string;
  can_login?: boolean;
  is_super?: boolean;
}

const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"] as const;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Wrap a plain SQL string as a Statement[] for the SqlPreviewPane. */
function asStatements(sql: string | null): Statement[] {
  return sql ? [{ sql, params: [] }] : [];
}

/** Pull `{ rows }` out of an unknown query result, tolerating shape drift. */
function extractRows(result: unknown): Record<string, unknown>[] {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserManager({ dialect, runQuery, onClose }: UserManagerProps) {
  const { t } = useTranslation();
  const isMysql = dialect === "mysql";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Inline action feedback (shared by create/password/grant forms).
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  // Create-user form
  const [newName, setNewName] = useState("");
  const [newHost, setNewHost] = useState("%");
  const [newPassword, setNewPassword] = useState("");

  // Selected user (drives password + grant sections)
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [pwValue, setPwValue] = useState("");

  // Existing grants for the selected user
  const [grants, setGrants] = useState<string[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);

  // Grant/revoke editor
  const [grantPrivs, setGrantPrivs] = useState<Set<string>>(new Set(["SELECT"]));
  const [scopeKind, setScopeKind] = useState<
    "global" | "database" | "schema" | "table"
  >(isMysql ? "global" : "database");
  const [scopeName, setScopeName] = useState("");
  // Table/column scope (only used when scopeKind === "table").
  const [scopeTable, setScopeTable] = useState("");
  const [scopeColumns, setScopeColumns] = useState("");

  // Roles
  const [roles, setRoles] = useState<UserRow[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [grantRoleName, setGrantRoleName] = useState("");
  const [dropRoleTarget, setDropRoleTarget] = useState<string | null>(null);

  // Drop confirmation
  const [dropTarget, setDropTarget] = useState<UserRow | null>(null);

  // ---------- list ----------
  const refresh = useCallback(async () => {
    const sql = listUsersQuery(dialect);
    if (!sql) {
      setUsers([]);
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      const result = await runQuery(sql);
      const rows = extractRows(result);
      setUsers(
        rows.map((r) => ({
          name: String(r.name ?? ""),
          host: r.host != null ? String(r.host) : undefined,
          can_login: typeof r.can_login === "boolean" ? r.can_login : undefined,
          is_super: typeof r.is_super === "boolean" ? r.is_super : undefined,
        })),
      );
    } catch (e) {
      setListError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [dialect, runQuery]);

  // ---------- roles ----------
  const refreshRoles = useCallback(async () => {
    const sql = listRolesQuery(dialect);
    if (!sql) {
      setRoles([]);
      return;
    }
    setRolesLoading(true);
    setRolesError(null);
    try {
      const result = await runQuery(sql);
      const rows = extractRows(result);
      setRoles(
        rows.map((r) => ({
          name: String(r.name ?? ""),
          host: r.host != null ? String(r.host) : undefined,
        })),
      );
    } catch (e) {
      // Older MySQL has no roles; surface but don't block the rest of the UI.
      setRolesError(errMessage(e));
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, [dialect, runQuery]);

  useEffect(() => {
    void refresh();
    void refreshRoles();
  }, [refresh, refreshRoles]);

  // ---------- existing grants for the selected user ----------
  const refreshGrants = useCallback(async () => {
    if (!selected) {
      setGrants([]);
      return;
    }
    const sql = listGrantsQuery(dialect, selected.name, selected.host);
    if (!sql) {
      setGrants([]);
      return;
    }
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const result = await runQuery(sql);
      const rows = extractRows(result);
      setGrants(parseGrants(dialect, rows));
    } catch (e) {
      setGrantsError(errMessage(e));
      setGrants([]);
    } finally {
      setGrantsLoading(false);
    }
  }, [dialect, runQuery, selected]);

  useEffect(() => {
    void refreshGrants();
  }, [refreshGrants]);

  // Reset transient feedback when the selected user changes.
  useEffect(() => {
    setActionError(null);
    setActionOk(null);
    setPwValue("");
    setGrantRoleName("");
  }, [selected]);

  // ---------- helpers ----------
  const run = useCallback(
    async (sql: string, okMessage: string) => {
      setBusy(true);
      setActionError(null);
      setActionOk(null);
      try {
        await runQuery(sql);
        setActionOk(okMessage);
        await refresh();
        await refreshGrants();
        return true;
      } catch (e) {
        setActionError(errMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [runQuery, refresh, refreshGrants],
  );

  // ---------- create ----------
  const canCreate = newName.trim() !== "" && newPassword !== "" && !busy;
  const handleCreate = async () => {
    if (!canCreate) return;
    let sql: string;
    try {
      sql = buildCreateUser(dialect, {
        name: newName.trim(),
        host: isMysql ? newHost.trim() || "%" : undefined,
        password: newPassword,
      });
    } catch (e) {
      setActionError(errMessage(e));
      return;
    }
    const ok = await run(sql, `User "${newName.trim()}" created.`);
    if (ok) {
      setNewName("");
      setNewHost("%");
      setNewPassword("");
    }
  };

  // ---------- set password ----------
  const handleSetPassword = async () => {
    if (!selected || pwValue === "" || busy) return;
    let sql: string;
    try {
      sql = buildSetPassword(dialect, {
        name: selected.name,
        host: selected.host,
        password: pwValue,
      });
    } catch (e) {
      setActionError(errMessage(e));
      return;
    }
    const ok = await run(sql, `Password updated for "${selected.name}".`);
    if (ok) setPwValue("");
  };

  // ---------- drop ----------
  const handleDrop = async () => {
    if (!dropTarget) return;
    let sql: string;
    try {
      sql = buildDropUser(dialect, { name: dropTarget.name, host: dropTarget.host });
    } catch (e) {
      setActionError(errMessage(e));
      setDropTarget(null);
      return;
    }
    const dropped = dropTarget;
    setDropTarget(null);
    const ok = await run(sql, `User "${dropped.name}" dropped.`);
    if (ok && selected?.name === dropped.name && selected.host === dropped.host) {
      setSelected(null);
    }
  };

  // ---------- grant / revoke ----------
  const builtScope = useMemo(() => {
    if (scopeKind === "table") {
      // `db`.`t` (MySQL) / "schema"."t" (Postgres). The "container" is the
      // database (MySQL) or schema (Postgres); both are required.
      const container = scopeName.trim();
      const table = scopeTable.trim();
      if (!container || !table) return "";
      return `${quoteIdent(dialect, container)}.${quoteIdent(dialect, table)}`;
    }
    if (isMysql) {
      if (scopeKind === "global") return "*.*";
      // database scope: `db`.*
      const db = scopeName.trim();
      return db ? `${quoteIdent(dialect, db)}.*` : "";
    }
    // postgres
    const id = scopeName.trim();
    if (scopeKind === "database") return id ? `DATABASE ${quoteIdent(dialect, id)}` : "";
    // schema scope
    return id ? `ALL TABLES IN SCHEMA ${quoteIdent(dialect, id)}` : "";
  }, [isMysql, dialect, scopeKind, scopeName, scopeTable]);

  // Column list is only meaningful on a table scope.
  const builtColumns = useMemo(() => {
    if (scopeKind !== "table") return [] as string[];
    return scopeColumns
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "");
  }, [scopeKind, scopeColumns]);

  const scopeNeedsName = !(isMysql && scopeKind === "global");
  const canGrant =
    !!selected && grantPrivs.size > 0 && builtScope !== "" && !busy;

  const grantInput = useMemo(() => {
    if (!selected) return null;
    return {
      privileges: Array.from(grantPrivs),
      scope: builtScope,
      columns: builtColumns.length > 0 ? builtColumns : undefined,
      name: selected.name,
      host: selected.host,
    };
  }, [selected, grantPrivs, builtScope, builtColumns]);

  // Live preview of the grant/revoke statement (empty on invalid scope/privs).
  const grantPreviewSql = useMemo(() => {
    if (!grantInput || !canGrant) return null;
    try {
      return buildGrant(dialect, grantInput);
    } catch {
      return null;
    }
  }, [dialect, grantInput, canGrant]);
  const revokePreviewSql = useMemo(() => {
    if (!grantInput || !canGrant) return null;
    try {
      return buildRevoke(dialect, grantInput);
    } catch {
      return null;
    }
  }, [dialect, grantInput, canGrant]);

  const handleGrantRevoke = async (action: "grant" | "revoke") => {
    if (!selected || !canGrant || !grantInput) return;
    let sql: string;
    try {
      sql =
        action === "grant"
          ? buildGrant(dialect, grantInput)
          : buildRevoke(dialect, grantInput);
    } catch (e) {
      setActionError(errMessage(e));
      return;
    }
    await run(
      sql,
      `${action === "grant" ? "Granted" : "Revoked"} on ${builtScope} for "${selected.name}".`,
    );
  };

  const togglePriv = (priv: string) => {
    setGrantPrivs((prev) => {
      const next = new Set(prev);
      if (next.has(priv)) next.delete(priv);
      else next.add(priv);
      return next;
    });
  };

  // ---------- create-user preview ----------
  const createPreviewSql = useMemo(() => {
    if (newName.trim() === "" || newPassword === "") return null;
    try {
      return buildCreateUser(dialect, {
        name: newName.trim(),
        host: isMysql ? newHost.trim() || "%" : undefined,
        password: newPassword,
      });
    } catch {
      return null;
    }
  }, [dialect, isMysql, newName, newHost, newPassword]);

  // ---------- roles: run a Statement[] and refresh ----------
  const runRoleStatements = useCallback(
    async (stmts: Statement[], okMessage: string) => {
      setBusy(true);
      setActionError(null);
      setActionOk(null);
      try {
        for (const stmt of stmts) {
          await runQuery(stmt.sql);
        }
        setActionOk(okMessage);
        await refreshRoles();
        await refreshGrants();
        return true;
      } catch (e) {
        setActionError(errMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [runQuery, refreshRoles, refreshGrants],
  );

  const canCreateRole = newRoleName.trim() !== "" && !busy;
  const handleCreateRole = async () => {
    if (!canCreateRole) return;
    let stmts: Statement[];
    try {
      stmts = buildCreateRole(dialect, newRoleName.trim());
    } catch (e) {
      setActionError(errMessage(e));
      return;
    }
    const ok = await runRoleStatements(stmts, `Role "${newRoleName.trim()}" created.`);
    if (ok) setNewRoleName("");
  };

  const handleDropRole = async () => {
    if (!dropRoleTarget) return;
    let stmts: Statement[];
    try {
      stmts = buildDropRole(dialect, dropRoleTarget);
    } catch (e) {
      setActionError(errMessage(e));
      setDropRoleTarget(null);
      return;
    }
    const dropped = dropRoleTarget;
    setDropRoleTarget(null);
    await runRoleStatements(stmts, `Role "${dropped}" dropped.`);
  };

  const canGrantRole = !!selected && grantRoleName.trim() !== "" && !busy;
  const grantRolePreviewSql = useMemo(() => {
    if (!selected || grantRoleName.trim() === "") return null;
    try {
      return buildGrantRole(dialect, grantRoleName.trim(), selected.name)[0]?.sql ?? null;
    } catch {
      return null;
    }
  }, [dialect, selected, grantRoleName]);

  const handleGrantRole = async () => {
    if (!selected || !canGrantRole) return;
    let stmts: Statement[];
    try {
      stmts = buildGrantRole(dialect, grantRoleName.trim(), selected.name);
    } catch (e) {
      setActionError(errMessage(e));
      return;
    }
    const ok = await runRoleStatements(
      stmts,
      `Granted role "${grantRoleName.trim()}" to "${selected.name}".`,
    );
    if (ok) setGrantRoleName("");
  };

  // ---------- render ----------
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-manager-title"
        className="flex max-h-[88vh] w-[56rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 id="user-manager-title" className="text-base font-semibold leading-tight">
                {t("table.usersAndRoles")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {dialect === "mysql" ? "MySQL" : "PostgreSQL"} — {t("table.manageLoginsPrivileges")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              title={t("table.refresh")}
              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title={t("table.close")}
              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: list (left) + detail (right) */}
        <div className="flex min-h-0 flex-1">
          {/* ── User list ── */}
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>{users.length === 1 ? t("table.userCountOne", { count: users.length }) : t("table.userCountMany", { count: users.length })}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {listError ? (
                <div className="m-3 flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{listError}</span>
                </div>
              ) : users.length === 0 && !loading ? (
                <div className="p-3 text-xs text-muted-foreground">{t("table.noUsersFound")}</div>
              ) : (
                <ul>
                  {users.map((u, i) => {
                    const active =
                      selected?.name === u.name && selected?.host === u.host;
                    return (
                      <li key={`${u.name}@${u.host ?? ""}-${i}`}>
                        <button
                          type="button"
                          onClick={() => setSelected(u)}
                          className={[
                            "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                            active ? "bg-primary/10 text-foreground" : "hover:bg-secondary",
                          ].join(" ")}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {u.name}
                            {isMysql && u.host != null && (
                              <span className="text-muted-foreground">@{u.host}</span>
                            )}
                          </span>
                          {!isMysql && u.is_super && (
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Create user form */}
            <div className="border-t border-border p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <UserPlus className="h-3.5 w-3.5" />
                {t("table.createUser")}
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("table.nameLower")}
                  aria-label="New user name"
                  className="rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {isMysql && (
                  <input
                    type="text"
                    value={newHost}
                    onChange={(e) => setNewHost(e.target.value)}
                    placeholder={t("table.hostPlaceholder")}
                    aria-label="New user host"
                    className="rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("table.passwordLower")}
                  aria-label="New user password"
                  className="rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!canCreate}
                  className="mt-0.5 flex items-center justify-center gap-1.5 rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  {t("table.create")}
                </button>
                {createPreviewSql && (
                  <div className="mt-1">
                    <SqlPreviewPane statements={asStatements(createPreviewSql)} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Detail ── */}
          <div className="min-h-0 flex-1 overflow-auto p-5">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("table.selectUserHint")}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {/* Selected header + drop */}
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-foreground">
                      {selected.name}
                      {isMysql && selected.host != null && (
                        <span className="text-muted-foreground">@{selected.host}</span>
                      )}
                    </div>
                    {!isMysql && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {selected.can_login ? t("table.canLogin") : t("table.noLogin")}
                        {selected.is_super ? ` · ${t("table.superuser")}` : ""}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDropTarget(selected)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("table.drop")}
                  </button>
                </div>

                {/* Feedback */}
                {actionError && (
                  <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-words">{actionError}</span>
                  </div>
                )}
                {actionOk && !actionError && (
                  <div className="rounded border border-green-500/40 bg-green-500/5 px-3 py-2 text-xs text-green-600 dark:text-green-400">
                    {actionOk}
                  </div>
                )}

                {/* Set password */}
                <section className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <KeyRound className="h-4 w-4" />
                    {t("table.setPassword")}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={pwValue}
                      onChange={(e) => setPwValue(e.target.value)}
                      placeholder={t("table.newPasswordPlaceholder")}
                      aria-label="New password"
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSetPassword()}
                      disabled={pwValue === "" || busy}
                      className="shrink-0 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("table.update")}
                    </button>
                  </div>
                </section>

                {/* Existing grants */}
                <section className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <ListChecks className="h-4 w-4" />
                      {t("table.currentGrants")}
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshGrants()}
                      disabled={grantsLoading}
                      title={t("table.refreshGrants")}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${grantsLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                  {grantsError ? (
                    <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{grantsError}</span>
                    </div>
                  ) : grantsLoading ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("table.loading")}
                    </div>
                  ) : grants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("table.noGrantsFound")}</p>
                  ) : (
                    <ul className="max-h-40 space-y-1 overflow-auto rounded bg-secondary/40 p-2 font-mono text-xs text-foreground">
                      {grants.map((g, i) => (
                        <li key={i} className="break-all">
                          {g}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Grant / revoke */}
                <section className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    {t("table.privileges")}
                  </div>

                  {/* Privilege checkboxes */}
                  <div className="mb-3 flex flex-wrap gap-3">
                    {PRIVILEGES.map((p) => (
                      <label key={p} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={grantPrivs.has(p)}
                          onChange={() => togglePriv(p)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {p}
                      </label>
                    ))}
                  </div>

                  {/* Scope picker */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <select
                      value={scopeKind}
                      onChange={(e) =>
                        setScopeKind(
                          e.target.value as
                            | "global"
                            | "database"
                            | "schema"
                            | "table",
                        )
                      }
                      aria-label="Scope kind"
                      className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {isMysql ? (
                        <>
                          <option value="global">{t("table.scopeGlobal")}</option>
                          <option value="database">{t("table.scopeDatabase")}</option>
                          <option value="table">{t("table.scopeTableColumns")}</option>
                        </>
                      ) : (
                        <>
                          <option value="database">{t("table.scopeDatabase")}</option>
                          <option value="schema">{t("table.scopeAllTablesInSchema")}</option>
                          <option value="table">{t("table.scopeTableColumns")}</option>
                        </>
                      )}
                    </select>
                    {scopeNeedsName && (
                      <input
                        type="text"
                        value={scopeName}
                        onChange={(e) => setScopeName(e.target.value)}
                        placeholder={
                          scopeKind === "table"
                            ? isMysql
                              ? "database"
                              : "schema"
                            : !isMysql && scopeKind === "schema"
                              ? "schema"
                              : "database"
                        }
                        aria-label="Scope name"
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>

                  {/* Table + column scope */}
                  {scopeKind === "table" && (
                    <div className="mb-3 flex flex-col gap-2">
                      <input
                        type="text"
                        value={scopeTable}
                        onChange={(e) => setScopeTable(e.target.value)}
                        placeholder="table"
                        aria-label="Table name"
                        className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        type="text"
                        value={scopeColumns}
                        onChange={(e) => setScopeColumns(e.target.value)}
                        placeholder={t("table.columnsCsvPlaceholder")}
                        aria-label="Column list"
                        className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}

                  {/* SQL preview */}
                  <div className="mb-3">
                    <SqlPreviewPane
                      statements={asStatements(grantPreviewSql ?? revokePreviewSql)}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleGrantRevoke("grant")}
                      disabled={!canGrant}
                      className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("table.grant")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGrantRevoke("revoke")}
                      disabled={!canGrant}
                      className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("table.revoke")}
                    </button>
                  </div>
                </section>

                {/* Roles */}
                <section className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <UserCog className="h-4 w-4" />
                      {t("table.roles")}
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshRoles()}
                      disabled={rolesLoading}
                      title={t("table.refreshRoles")}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${rolesLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  {rolesError && (
                    <div className="mb-3 flex items-start gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{rolesError}</span>
                    </div>
                  )}

                  {/* Grant a role to the selected user */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      {t("table.grantRoleTo", { name: selected.name })}
                    </div>
                    <div className="flex items-center gap-2">
                      {roles.length > 0 ? (
                        <select
                          value={grantRoleName}
                          onChange={(e) => setGrantRoleName(e.target.value)}
                          aria-label="Role to grant"
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">{t("table.selectARole")}</option>
                          {roles.map((r, i) => (
                            <option key={`${r.name}-${i}`} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={grantRoleName}
                          onChange={(e) => setGrantRoleName(e.target.value)}
                          placeholder={t("table.roleNamePlaceholder")}
                          aria-label="Role to grant"
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => void handleGrantRole()}
                        disabled={!canGrantRole}
                        className="shrink-0 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("table.grantRole")}
                      </button>
                    </div>
                    {grantRolePreviewSql && (
                      <div className="mt-2">
                        <SqlPreviewPane statements={asStatements(grantRolePreviewSql)} />
                      </div>
                    )}
                  </div>

                  {/* Create role */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      {t("table.createRole")}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        placeholder={t("table.newRoleNamePlaceholder")}
                        aria-label="New role name"
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateRole()}
                        disabled={!canCreateRole}
                        className="shrink-0 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("table.createRole")}
                      </button>
                    </div>
                  </div>

                  {/* Existing roles */}
                  {roles.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {roles.length === 1 ? t("table.roleCountOne", { count: roles.length }) : t("table.roleCountMany", { count: roles.length })}
                      </div>
                      <ul className="max-h-36 space-y-0.5 overflow-auto rounded bg-secondary/40 p-1.5">
                        {roles.map((r, i) => (
                          <li
                            key={`${r.name}-${i}`}
                            className="flex items-center justify-between gap-2 px-1.5 py-1 text-xs"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono">
                              {r.name}
                              {isMysql && r.host != null && (
                                <span className="text-muted-foreground">@{r.host}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDropRoleTarget(r.name)}
                              disabled={busy}
                              title={t("table.dropRole")}
                              className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drop confirmation */}
      {dropTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-fade-in"
          onClick={() => setDropTarget(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="drop-user-title"
            className="flex w-[28rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="drop-user-title" className="text-base font-semibold leading-tight">
                  {t("table.dropUser")}{" "}
                  <span className="font-mono text-sm">
                    {dropTarget.name}
                    {isMysql && dropTarget.host != null ? `@${dropTarget.host}` : ""}
                  </span>
                  ?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isMysql ? t("table.dropUserWarning") : t("table.dropRoleWarning")}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                type="button"
                onClick={() => setDropTarget(null)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("table.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleDrop()}
                className="flex items-center gap-2 rounded-lg bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
              >
                <Trash2 className="h-4 w-4" />
                {t("table.drop")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop role confirmation */}
      {dropRoleTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 animate-fade-in"
          onClick={() => setDropRoleTarget(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="drop-role-title"
            className="flex w-[28rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="drop-role-title" className="text-base font-semibold leading-tight">
                  {t("table.dropRoleTitle")}{" "}
                  <span className="font-mono text-sm">{dropRoleTarget}</span>?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("table.dropRoleWarning")}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                type="button"
                onClick={() => setDropRoleTarget(null)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("table.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleDropRole()}
                className="flex items-center gap-2 rounded-lg bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
              >
                <Trash2 className="h-4 w-4" />
                {t("table.drop")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
