import { useState, useEffect, type ReactNode } from "react";
import {
  X,
  Database,
  KeyRound,
  Leaf,
  TestTube,
  Loader2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useGroups } from "../../hooks/useGroups";
import { useTranslation } from "../../i18n";
import { isDriverAvailable } from "../../lib/edition";
import GroupManager from "../group/GroupManager";
import type {
  Connection,
  ConnectionOptions,
  DatabaseDriver,
  SshAuth,
  SslMode,
} from "../../types";

/** Raw SSH secrets entered in the form for the current (unsaved) edit, kept out
 * of the `options` JSON so the credential vault can own them. */
export interface ConnectionSecrets {
  password?: string;
  sshPassword?: string;
  sshPassphrase?: string;
}

interface ConnectionFormProps {
  connection?: Connection;
  onSave: (
    connection: Omit<Connection, "id" | "created_at" | "updated_at">,
    secrets?: ConnectionSecrets
  ) => Promise<void>;
  onCancel: () => void;
  onTest?: (
    connection: Omit<Connection, "id" | "created_at" | "updated_at"> & ConnectionSecrets
  ) => Promise<boolean>;
}

const DRIVER_OPTIONS: {
  value: DatabaseDriver;
  label: string;
  defaultPort: number;
  kindKey: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { value: "mysql", label: "MySQL", defaultPort: 3306, kindKey: "connection.kindRelational", icon: Database, color: "text-orange-500" },
  { value: "postgres", label: "PostgreSQL", defaultPort: 5432, kindKey: "connection.kindRelational", icon: Database, color: "text-blue-500" },
  { value: "sqlite", label: "SQLite", defaultPort: 0, kindKey: "connection.kindFileBased", icon: Database, color: "text-green-500" },
  { value: "sqlserver", label: "SQL Server", defaultPort: 1433, kindKey: "connection.kindRelational", icon: Database, color: "text-red-500" },
  { value: "redis", label: "Redis", defaultPort: 6379, kindKey: "connection.kindKeyValue", icon: KeyRound, color: "text-rose-600" },
  { value: "mongodb", label: "MongoDB", defaultPort: 27017, kindKey: "connection.kindDocument", icon: Leaf, color: "text-emerald-600" },
];

const SSL_MODE_OPTIONS: { value: SslMode | ""; labelKey: string }[] = [
  { value: "", labelKey: "connection.sslModeServerDefault" },
  { value: "disable", labelKey: "connection.sslModeDisable" },
  { value: "prefer", labelKey: "connection.sslModePrefer" },
  { value: "require", labelKey: "connection.sslModeRequire" },
  { value: "verify-ca", labelKey: "connection.sslModeVerifyCa" },
  { value: "verify-full", labelKey: "connection.sslModeVerifyFull" },
];

const INPUT_CLASS =
  "w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all";

// Preset connection colors (mirrors GroupManager's COLOR_PRESETS).
const COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

/** Parse `Connection.options` JSON, swallowing malformed blobs. */
function parseOptions(raw?: string | null): ConnectionOptions {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ConnectionOptions;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** A labelled group of fields in the details step. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ConnectionForm({ connection, onSave, onCancel, onTest }: ConnectionFormProps) {
  const initialOptions = parseOptions(connection?.options);
  const initialSsl = initialOptions.ssl ?? {};
  const initialSsh = initialOptions.ssh ?? {};

  const { groups } = useGroups();
  const { t } = useTranslation();
  const isEditing = !!connection;
  // New connections start on the driver picker; edits jump straight to details.
  const [step, setStep] = useState<"driver" | "details">(isEditing ? "details" : "driver");
  const [name, setName] = useState(connection?.name || "");
  const [groupId, setGroupId] = useState(connection?.group_id || "");
  const [color, setColor] = useState(connection?.color ?? "");
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [driver, setDriver] = useState<DatabaseDriver>(connection?.driver || "mysql");
  const [host, setHost] = useState(connection?.host || "localhost");
  const [port, setPort] = useState(connection?.port || 3306);
  const [database, setDatabase] = useState(connection?.database || "");
  const [username, setUsername] = useState(connection?.username || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // SSL state
  const [sslOpen, setSslOpen] = useState(!!initialSsl.mode);
  const [sslMode, setSslMode] = useState<SslMode | "">(initialSsl.mode ?? "");
  const [sslCaPath, setSslCaPath] = useState(initialSsl.ca_path ?? "");
  const [sslCertPath, setSslCertPath] = useState(initialSsl.cert_path ?? "");
  const [sslKeyPath, setSslKeyPath] = useState(initialSsl.key_path ?? "");

  // SSH state. Secrets are never returned from the backend, so the inputs start
  // blank on edit; the parsed `*_credential_id`s are preserved unless replaced.
  const [sshOpen, setSshOpen] = useState(!!initialSsh.enabled);
  const [sshEnabled, setSshEnabled] = useState(!!initialSsh.enabled);
  const [sshHost, setSshHost] = useState(initialSsh.host ?? "");
  const [sshPort, setSshPort] = useState(initialSsh.port ?? 22);
  const [sshUser, setSshUser] = useState(initialSsh.user ?? "");
  const [sshAuth, setSshAuth] = useState<SshAuth>(initialSsh.auth ?? "password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState(initialSsh.key_path ?? "");
  const [sshPassphrase, setSshPassphrase] = useState("");
  // Credential ids parsed from an existing connection, kept so a blank secret
  // field leaves the stored credential untouched on save.
  const existingSshPasswordCredId = initialSsh.password_credential_id;
  const existingSshPassphraseCredId = initialSsh.passphrase_credential_id;

  const isSQLite = driver === "sqlite";
  const isRedis = driver === "redis";
  const isMongo = driver === "mongodb";
  // Redis has no username and no named database (the key browser picks a numeric
  // DB index), so those SQL-only fields are hidden. Host/port/password + SSL/SSH
  // transport still apply.
  // MongoDB keeps host/port/user/password and reuses the `database` field as an
  // optional authentication database (defaults to "admin" server-side when blank).
  const showCertInputs = sslMode === "verify-ca" || sslMode === "verify-full";
  const selectedDriver = DRIVER_OPTIONS.find((d) => d.value === driver) ?? DRIVER_OPTIONS[0];

  useEffect(() => {
    // Update default port when driver changes
    const driverOption = DRIVER_OPTIONS.find((d) => d.value === driver);
    if (driverOption && !isEditing) {
      setPort(driverOption.defaultPort);
    }
  }, [driver, isEditing]);

  /** Pick a database type and advance to the details step. */
  const handlePickDriver = (value: DatabaseDriver) => {
    setDriver(value);
    setTestResult(null);
    setError(null);
    setStep("details");
  };

  /** Open the native file picker, returning the chosen path or null if cancelled. */
  const pickFilePath = async (): Promise<string | null> => {
    const selected = await open({ multiple: false, directory: false });
    if (selected == null) return null;
    return Array.isArray(selected) ? (selected[0] ?? null) : selected;
  };

  /**
   * Assemble the `ConnectionOptions` from current SSL/SSH form state.
   * When `forTest` is true the `*_credential_id` fields are omitted (the raw
   * secrets travel separately via `testConnectionParams`).
   */
  const buildOptions = (forTest: boolean): ConnectionOptions | undefined => {
    if (isSQLite) return undefined;
    const options: ConnectionOptions = {};

    if (sslMode) {
      const ssl: ConnectionOptions["ssl"] = { mode: sslMode };
      if (sslCaPath.trim()) ssl.ca_path = sslCaPath.trim();
      if (showCertInputs) {
        if (sslCertPath.trim()) ssl.cert_path = sslCertPath.trim();
        if (sslKeyPath.trim()) ssl.key_path = sslKeyPath.trim();
      }
      options.ssl = ssl;
    }

    if (sshEnabled) {
      const ssh: ConnectionOptions["ssh"] = {
        enabled: true,
        host: sshHost.trim(),
        port: sshPort,
        user: sshUser.trim(),
        auth: sshAuth,
      };
      if (sshAuth === "key" && sshKeyPath.trim()) ssh.key_path = sshKeyPath.trim();
      if (!forTest) {
        // Preserve previously stored credential ids; the save path replaces them
        // when a fresh secret is entered.
        if (sshAuth === "password" && existingSshPasswordCredId) {
          ssh.password_credential_id = existingSshPasswordCredId;
        }
        if (sshAuth === "key" && existingSshPassphraseCredId) {
          ssh.passphrase_credential_id = existingSshPassphraseCredId;
        }
      }
      options.ssh = ssh;
    }

    if (!options.ssl && !options.ssh) return undefined;
    return options;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const options = buildOptions(false);
      await onSave(
        {
          name,
          driver,
          host: isSQLite ? undefined : host,
          port: isSQLite ? undefined : port,
          database: isRedis ? undefined : database,
          username: isSQLite || isRedis ? undefined : username,
          credential_id: undefined,
          group_id: groupId || undefined,
          // Always send an explicit options string (never undefined) so the
          // backend's partial-update always overwrites the column. When no
          // SSL/SSH is configured, "{}" clears any previously stored blob.
          // SQLite connections never have transport options.
          options: isSQLite ? undefined : (options ? JSON.stringify(options) : "{}"),
          color: color || undefined,
        },
        isSQLite
          ? undefined
          : {
              password,
              sshPassword: sshEnabled && sshAuth === "password" ? sshPassword : undefined,
              sshPassphrase: sshEnabled && sshAuth === "key" ? sshPassphrase : undefined,
            }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connection.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!onTest) return;

    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const options = buildOptions(true);
      const success = await onTest({
        name,
        driver,
        host: isSQLite ? undefined : host,
        port: isSQLite ? undefined : port,
        database: isRedis ? undefined : database,
        username: isSQLite || isRedis ? undefined : username,
        credential_id: undefined,
        group_id: undefined,
        options: options ? JSON.stringify(options) : undefined,
        color: color || undefined,
        password: isSQLite ? undefined : password,
        sshPassword: sshEnabled && sshAuth === "password" ? sshPassword : undefined,
        sshPassphrase: sshEnabled && sshAuth === "key" ? sshPassphrase : undefined,
      });
      setTestResult(success ? "success" : "failed");
    } catch (err) {
      setTestResult("failed");
      setError(err instanceof Error ? err.message : t("connection.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  const SelectedIcon = selectedDriver.icon;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50 animate-fade-in">
      <div className="bg-card shadow-xl w-[28rem] max-w-[90vw] h-full flex flex-col border-l border-border animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">
              {isEditing ? t("connection.editConnection") : t("connection.newConnection")}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {step === "driver" ? (
          /* ---- Step 1: choose a database type -------------------------- */
          <div className="p-6 flex-1 overflow-y-auto">
            <p className="text-sm font-medium">{t("connection.chooseDatabaseType")}</p>
            <p className="text-xs text-muted-foreground mb-4">
              {t("connection.chooseDatabaseTypeHint")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {DRIVER_OPTIONS.filter((option) => isDriverAvailable(option.value)).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handlePickDriver(option.value)}
                    className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border bg-secondary text-left hover:border-primary hover:bg-primary/5 transition-all"
                  >
                    <Icon className={`w-6 h-6 ${option.color}`} />
                    <div>
                      <div className="text-sm font-semibold">{option.label}</div>
                      <div className="text-xs text-muted-foreground">{t(option.kindKey)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ---- Step 2: connection details ------------------------------ */
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
            {/* Selected driver bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-secondary/40">
              <div className="flex items-center gap-2">
                <SelectedIcon className={`w-5 h-5 ${selectedDriver.color}`} />
                <span className="text-sm font-medium">{selectedDriver.label}</span>
              </div>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => setStep("driver")}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {t("connection.changeType")}
                </button>
              )}
            </div>

            <div className="p-6 space-y-5 flex-1 overflow-y-auto">
              {/* General */}
              <Section title={t("connection.sectionGeneral")}>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("connection.connectionName")} <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("connection.connectionNamePlaceholder")}
                    className={INPUT_CLASS}
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium">{t("connection.group")}</label>
                    <button
                      type="button"
                      onClick={() => setShowGroupManager(true)}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      {t("connection.manageGroups")}
                    </button>
                  </div>
                  <select
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    <option value="">{t("connection.noGroup")}</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">{t("connection.color")}</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-full border-2 transition-all ${
                          color === c
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setColor("")}
                      className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                        color === ""
                          ? "border-foreground"
                          : "border-border hover:border-muted-foreground"
                      }`}
                      title={t("connection.noColor")}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </Section>

              {/* Connection */}
              <Section title={t("connection.sectionConnection")}>
                {/* Host & Port (not for SQLite) */}
                {!isSQLite && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{t("connection.host")}</label>
                      <input
                        type="text"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder={t("connection.hostPlaceholder")}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("connection.port")}</label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}

                {/* Database (SQL only — Redis selects a numeric DB in the key
                    browser). MongoDB reuses this field as an optional auth db. */}
                {!isRedis && (
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      {isSQLite ? t("connection.databaseFilePath") : t("connection.databaseName")}
                      {isMongo && (
                        <span className="ml-1 text-xs text-muted-foreground">{t("connection.optional")}</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder={
                        isSQLite
                          ? t("connection.databaseFilePathPlaceholder")
                          : isMongo
                          ? "admin"
                          : t("connection.databaseNamePlaceholder")
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                )}

                {/* Username & Password (not for SQLite). Redis has no username. */}
                {!isSQLite && (
                  <div className={isRedis ? "" : "grid grid-cols-2 gap-4"}>
                    {!isRedis && (
                      <div>
                        <label className="block text-xs font-medium mb-1">{t("connection.username")}</label>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder={t("connection.usernamePlaceholder")}
                          className={INPUT_CLASS}
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("connection.password")}</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("connection.passwordPlaceholder")}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}
              </Section>

              {/* Advanced — SSL + SSH (not for SQLite) */}
              {!isSQLite && (
                <Section title={t("connection.sectionAdvanced")}>
                  {/* SSL section */}
                  <div className="border border-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSslOpen((o) => !o)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
                    >
                      {sslOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      {t("connection.sslTls")}
                      {sslMode && <span className="ml-auto text-xs text-primary">{sslMode}</span>}
                    </button>
                    {sslOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
                        <div>
                          <label className="block text-xs font-medium mb-1">{t("connection.sslMode")}</label>
                          <select
                            value={sslMode}
                            onChange={(e) => setSslMode(e.target.value as SslMode | "")}
                            className={INPUT_CLASS}
                          >
                            {SSL_MODE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                              </option>
                            ))}
                          </select>
                        </div>

                        {sslMode && (
                          <FilePathInput
                            label={t("connection.caCertificate")}
                            value={sslCaPath}
                            onChange={setSslCaPath}
                            onBrowse={pickFilePath}
                            placeholder={t("connection.caCertificatePlaceholder")}
                          />
                        )}

                        {showCertInputs && (
                          <>
                            <FilePathInput
                              label={t("connection.clientCertificate")}
                              value={sslCertPath}
                              onChange={setSslCertPath}
                              onBrowse={pickFilePath}
                              placeholder={t("connection.clientCertificatePlaceholder")}
                            />
                            <FilePathInput
                              label={t("connection.clientKey")}
                              value={sslKeyPath}
                              onChange={setSslKeyPath}
                              onBrowse={pickFilePath}
                              placeholder={t("connection.clientKeyPlaceholder")}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* SSH tunnel section */}
                  <div className="border border-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSshOpen((o) => !o)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-secondary transition-colors"
                    >
                      {sshOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      {t("connection.sshTunnel")}
                      {sshEnabled && (
                        <span className="ml-auto text-xs text-primary">{t("connection.sshOn")}</span>
                      )}
                    </button>
                    {sshOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sshEnabled}
                            onChange={(e) => setSshEnabled(e.target.checked)}
                            className="rounded border-input"
                          />
                          {t("connection.useSshTunnel")}
                        </label>

                        {sshEnabled && (
                          <>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="col-span-2">
                                <label className="block text-xs font-medium mb-1">{t("connection.sshHost")}</label>
                                <input
                                  type="text"
                                  value={sshHost}
                                  onChange={(e) => setSshHost(e.target.value)}
                                  placeholder={t("connection.sshHostPlaceholder")}
                                  className={INPUT_CLASS}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">{t("connection.port")}</label>
                                <input
                                  type="number"
                                  value={sshPort}
                                  onChange={(e) => setSshPort(parseInt(e.target.value) || 0)}
                                  className={INPUT_CLASS}
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-medium mb-1">{t("connection.sshUser")}</label>
                              <input
                                type="text"
                                value={sshUser}
                                onChange={(e) => setSshUser(e.target.value)}
                                placeholder={t("connection.sshUserPlaceholder")}
                                className={INPUT_CLASS}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium mb-1">{t("connection.authentication")}</label>
                              <div className="flex gap-4">
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="radio"
                                    name="ssh-auth"
                                    checked={sshAuth === "password"}
                                    onChange={() => setSshAuth("password")}
                                  />
                                  {t("connection.authPassword")}
                                </label>
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="radio"
                                    name="ssh-auth"
                                    checked={sshAuth === "key"}
                                    onChange={() => setSshAuth("key")}
                                  />
                                  {t("connection.authPrivateKey")}
                                </label>
                              </div>
                            </div>

                            {sshAuth === "password" ? (
                              <div>
                                <label className="block text-xs font-medium mb-1">{t("connection.sshPassword")}</label>
                                <input
                                  type="password"
                                  value={sshPassword}
                                  onChange={(e) => setSshPassword(e.target.value)}
                                  placeholder={
                                    isEditing && existingSshPasswordCredId
                                      ? t("connection.passwordUnchangedPlaceholder")
                                      : t("connection.passwordPlaceholder")
                                  }
                                  className={INPUT_CLASS}
                                />
                              </div>
                            ) : (
                              <>
                                <FilePathInput
                                  label={t("connection.privateKeyFile")}
                                  value={sshKeyPath}
                                  onChange={setSshKeyPath}
                                  onBrowse={pickFilePath}
                                  placeholder={t("connection.privateKeyFilePlaceholder")}
                                />
                                <div>
                                  <label className="block text-xs font-medium mb-1">
                                    {t("connection.passphrase")}
                                    <span className="ml-1 text-xs text-muted-foreground">{t("connection.optional")}</span>
                                  </label>
                                  <input
                                    type="password"
                                    value={sshPassphrase}
                                    onChange={(e) => setSshPassphrase(e.target.value)}
                                    placeholder={
                                      isEditing && existingSshPassphraseCredId
                                        ? t("connection.passwordUnchangedPlaceholder")
                                        : t("connection.passwordPlaceholder")
                                    }
                                    className={INPUT_CLASS}
                                  />
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* Error Message */}
              {error && (
                <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Test Result */}
              {testResult && (
                <div
                  className={`px-3 py-2 rounded-lg text-sm ${
                    testResult === "success"
                      ? "bg-green-500/10 border border-green-500/20 text-green-600"
                      : "bg-destructive/10 border border-destructive/20 text-destructive"
                  }`}
                >
                  {testResult === "success"
                    ? t("connection.connectionSuccessful")
                    : t("connection.connectionFailed")}
                </div>
              )}
            </div>

            {/* Actions (sticky footer) */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !name}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TestTube className="w-4 h-4" />
                )}
                {t("connection.testConnection")}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                >
                  {t("connection.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving || !name}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isEditing ? t("connection.saveChanges") : t("connection.createConnection")}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {showGroupManager && <GroupManager onClose={() => setShowGroupManager(false)} />}
    </div>
  );
}

/** Text input + native "Browse" button for selecting a file path. */
function FilePathInput({
  label,
  value,
  onChange,
  onBrowse,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => Promise<string | null>;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const handleBrowse = async () => {
    const path = await onBrowse();
    if (path) onChange(path);
  };

  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={handleBrowse}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-secondary border border-input rounded-lg hover:bg-secondary/70 transition-colors shrink-0"
        >
          <FolderOpen className="w-4 h-4" />
          {t("connection.browse")}
        </button>
      </div>
    </div>
  );
}

export default ConnectionForm;
