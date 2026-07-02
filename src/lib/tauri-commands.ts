import { invoke } from "@tauri-apps/api/core";
import type {
  Connection,
  ConnectionGroup,
  QueryResult,
  QueryHistory,
  FavoriteQuery,
  TableInfo,
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
  TableGraph,
  SessionInfo,
  TransferJob,
  TransferOptions,
  TablePreview,
  TransferReport,
  ParamValue,
  Statement,
  RowTransfer,
  ActionJournalEntry,
  NewActionJournalEntry,
  ActionStatus,
} from "../types";
import type { RedisApi, RedisKeyInfo, RedisValue } from "../components/redis/types";
import type { MongoApi } from "../components/mongo/types";

// Helper function to add timeout to invoke calls
function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs: number = 10000
): Promise<T> {
  return Promise.race([
    invoke<T>(command, args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Command '${command}' timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// Connection commands
export const connectionCommands = {
  async getConnections(): Promise<Connection[]> {
    return await invoke("get_connections");
  },

  async getConnection(id: string): Promise<Connection> {
    return await invoke("get_connection", { id });
  },

  async createConnection(
    connection: Omit<Connection, "id" | "created_at" | "updated_at">
  ): Promise<Connection> {
    return await invokeWithTimeout<Connection>("create_connection", {
      name: connection.name,
      driver: connection.driver,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      credentialId: connection.credential_id,
      groupId: connection.group_id,
      options: connection.options,
      color: connection.color,
    }, 5000); // 5 second timeout for creating connection
  },

  async updateConnection(
    id: string,
    connection: Partial<Omit<Connection, "id" | "created_at" | "updated_at">>
  ): Promise<Connection> {
    return await invokeWithTimeout<Connection>("update_connection", {
      id,
      name: connection.name,
      driver: connection.driver,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      credentialId: connection.credential_id,
      groupId: connection.group_id,
      options: connection.options,
      color: connection.color,
    }, 10000); // 10 second timeout (increased for update operations)
  },

  async deleteConnection(id: string): Promise<void> {
    return await invoke("delete_connection", { id });
  },

  async testConnection(id: string): Promise<boolean> {
    return await invoke("test_connection", { id });
  },

  async testConnectionParams(params: {
    driver: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    // SSL/SSH transport options as the JSON blob stored in `Connection.options`.
    options?: string;
    // Raw SSH secrets for an UNSAVED form (nothing in the vault yet).
    sshPassword?: string;
    sshPassphrase?: string;
  }): Promise<boolean> {
    return await invokeWithTimeout<boolean>("test_connection_params", {
      driver: params.driver,
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      options: params.options,
      sshPassword: params.sshPassword,
      sshPassphrase: params.sshPassphrase,
    }, 30000); // 30s: SSH handshake + external DB connect adds latency
  },
};

// Group commands
export const groupCommands = {
  async getGroups(): Promise<ConnectionGroup[]> {
    return await invoke("get_groups");
  },

  async createGroup(
    group: Omit<ConnectionGroup, "id" | "created_at" | "updated_at">
  ): Promise<ConnectionGroup> {
    // Map snake_case fields to the command's camelCase args (parent_id -> parentId).
    return await invoke("create_group", {
      name: group.name,
      description: group.description,
      color: group.color,
      icon: group.icon,
      parentId: group.parent_id,
    });
  },

  async updateGroup(
    id: string,
    group: Partial<Omit<ConnectionGroup, "id" | "created_at" | "updated_at">>
  ): Promise<ConnectionGroup> {
    return await invoke("update_group", {
      id,
      name: group.name,
      description: group.description,
      color: group.color,
      icon: group.icon,
      parentId: group.parent_id,
    });
  },

  async deleteGroup(id: string): Promise<void> {
    return await invoke("delete_group", { id });
  },
};

// Session commands
export const sessionCommands = {
  async connect(connectionId: string, database?: string): Promise<SessionInfo> {
    return await invoke("connect", { connectionId, database });
  },

  async disconnect(sessionId: string): Promise<void> {
    return await invoke("disconnect", { sessionId });
  },

  async getSessions(): Promise<SessionInfo[]> {
    return await invoke("get_sessions");
  },
};

// Query commands
export const queryCommands = {
  /**
   * Execute a query. `requestId` identifies this run so it can be cancelled via
   * `cancelQuery`; one is generated if the caller doesn't need to cancel.
   */
  async executeQuery(
    sessionId: string,
    query: string,
    requestId: string = crypto.randomUUID()
  ): Promise<QueryResult> {
    return await invoke<QueryResult>("execute_query", {
      requestId,
      sessionId,
      query,
    });
  },

  async cancelQuery(requestId: string): Promise<void> {
    return await invoke("cancel_query", { requestId });
  },

  /** Run a single parameterized mutation (INSERT/UPDATE/DELETE). */
  async executeMutation(
    sessionId: string,
    sql: string,
    params: ParamValue[]
  ): Promise<QueryResult> {
    return await invoke("execute_mutation", { sessionId, sql, params });
  },

  /** Commit a batch of parameterized statements atomically (one transaction). */
  async commitChanges(
    sessionId: string,
    statements: Statement[]
  ): Promise<QueryResult[]> {
    return await invoke("commit_changes", { sessionId, statements });
  },
};

// Database exploration commands
export const databaseCommands = {
  async getDatabases(sessionId: string): Promise<string[]> {
    return await invoke("get_databases", { sessionId });
  },

  async getTables(sessionId: string, database: string, schema?: string): Promise<TableInfo[]> {
    return await invoke("get_tables", { sessionId, database, schema });
  },

  async getColumns(
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<ColumnDefinition[]> {
    return await invoke("get_columns", { sessionId, database, table, schema });
  },

  async getViewDefinition(
    sessionId: string,
    database: string,
    view: string,
    schema?: string
  ): Promise<string> {
    return await invoke("get_view_definition", { sessionId, database, view, schema });
  },

  async getIndexes(
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<IndexInfo[]> {
    return await invoke("get_indexes", { sessionId, database, table, schema });
  },

  async getForeignKeys(
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<ForeignKeyInfo[]> {
    return await invoke("get_foreign_keys", { sessionId, database, table, schema });
  },

  /** Batched ERD introspection: columns + foreign keys for many tables at once
   * (one round-trip on MySQL/Postgres). Used by the ER diagram instead of a
   * per-table `getColumns` + `getForeignKeys` fan-out. */
  async getSchemaGraph(
    sessionId: string,
    database: string,
    tables: string[],
    schema?: string
  ): Promise<TableGraph[]> {
    return await invoke("get_schema_graph", { sessionId, database, schema, tables });
  },
};

// Query history commands
export const historyCommands = {
  async getQueryHistory(
    connectionId?: string,
    limit?: number
  ): Promise<QueryHistory[]> {
    return await invoke("get_query_history", { connectionId, limit });
  },

  async clearQueryHistory(connectionId?: string): Promise<void> {
    return await invoke("clear_query_history", { connectionId });
  },
};

// Action journal (Time Machine) commands
export const journalCommands = {
  /** Record a reversible action; returns the persisted entry. */
  async record(entry: NewActionJournalEntry): Promise<ActionJournalEntry> {
    return await invoke("journal_record", { entry });
  },

  async list(connectionId?: string, limit?: number): Promise<ActionJournalEntry[]> {
    return await invoke("journal_list", { connectionId, limit });
  },

  /** Flip an entry's status after re-running its inverse/forward statements. */
  async setStatus(id: string, status: ActionStatus): Promise<void> {
    return await invoke("journal_set_status", { id, status });
  },

  async clear(connectionId?: string): Promise<void> {
    return await invoke("journal_clear", { connectionId });
  },
};

// Favorite queries commands
export const favoriteCommands = {
  async getFavorites(folderId?: string): Promise<FavoriteQuery[]> {
    return await invoke("get_favorites", { folderId });
  },

  async createFavorite(
    favorite: Omit<FavoriteQuery, "id" | "created_at" | "updated_at">
  ): Promise<FavoriteQuery> {
    return await invoke("create_favorite", favorite);
  },

  async updateFavorite(
    id: string,
    favorite: Partial<Omit<FavoriteQuery, "id" | "created_at" | "updated_at">>
  ): Promise<FavoriteQuery> {
    return await invoke("update_favorite", { id, ...favorite });
  },

  async deleteFavorite(id: string): Promise<void> {
    return await invoke("delete_favorite", { id });
  },
};

// Vault commands
export const vaultCommands = {
  async isVaultInitialized(): Promise<boolean> {
    return await invoke("is_vault_initialized");
  },

  async initializeVault(masterPassword: string): Promise<void> {
    return await invoke("initialize_vault", { masterPassword });
  },

  async unlockVault(masterPassword: string): Promise<boolean> {
    return await invoke("unlock_vault", { masterPassword });
  },

  async lockVault(): Promise<void> {
    return await invoke("lock_vault");
  },

  async isVaultLocked(): Promise<boolean> {
    return await invoke("is_vault_locked");
  },

  // Re-keys the vault from device mode to a master password, deleting vault.key
  // so the next launch starts locked. Requires the vault to be unlocked.
  async setMasterPassword(newPassword: string): Promise<void> {
    return await invoke("set_master_password", { newPassword });
  },

  // Re-keys back to a fresh device key and recreates vault.key (auto-unlock).
  async disableMasterPassword(): Promise<void> {
    return await invoke("disable_master_password");
  },

  // Forgotten-password escape: wipes credentials + metadata + vault.key and
  // re-inits a fresh device-mode vault. Connections survive; saved secrets are
  // lost. The caller MUST confirm with the user first.
  async resetVault(): Promise<void> {
    return await invoke("reset_vault");
  },

  // Current vault mode marker. 'master' means the app started locked and the
  // user must unlock; 'device' is auto-unlocked; 'uninitialized' is first run.
  async vaultMode(): Promise<"device" | "master" | "uninitialized"> {
    return await invoke("vault_mode");
  },
};

// Credential commands
export const credentialCommands = {
  async saveCredential(
    name: string,
    password: string,
    // "password" (default) or "ssh_key". Omit to keep prior behavior.
    credentialType?: "password" | "ssh_key"
  ): Promise<string> {
    return await invoke("save_credential", { name, password, credentialType });
  },

  async getCredential(credentialId: string): Promise<string> {
    return await invoke("get_credential", { credentialId });
  },

  async updateCredential(credentialId: string, password: string): Promise<void> {
    return await invoke("update_credential", { credentialId, password });
  },

  async deleteCredential(credentialId: string): Promise<void> {
    return await invoke("delete_credential", { credentialId });
  },
};

// Export commands
export const exportCommands = {
  async exportToCsv(
    data: Record<string, unknown>[],
    filePath: string
  ): Promise<void> {
    return await invoke("export_to_csv", { data, filePath });
  },

  async exportToJson(
    data: Record<string, unknown>[],
    filePath: string
  ): Promise<void> {
    return await invoke("export_to_json", { data, filePath });
  },
};

// Transfer commands
export async function previewTransfer(
  sourceSession: string,
  targetSession: string,
  jobs: TransferJob[],
  options: TransferOptions
): Promise<TablePreview[]> {
  return invoke("preview_transfer", { sourceSession, targetSession, jobs, options });
}

export async function runTransfer(
  sourceSession: string,
  targetSession: string,
  jobs: TransferJob[],
  options: TransferOptions
): Promise<TransferReport> {
  return invoke("run_transfer", { sourceSession, targetSession, jobs, options });
}

export async function transferRows(
  targetSession: string,
  transfer: RowTransfer
): Promise<TransferReport> {
  return invoke("transfer_rows", { targetSession, transfer });
}

// Redis commands — thin wrappers over the `redis_*` Tauri commands. Tauri maps
// the Rust snake_case args to camelCase on the JS side, so the arg keys here are
// camelCase (e.g. ttl_seconds -> ttlSeconds). Keyed by a redis session id from
// redis_connect; see makeRedisApi for the per-session RedisApi adapter the key
// browser consumes.
export const redisCommands = {
  async connect(connectionId: string): Promise<{ sessionId: string }> {
    return await invoke("redis_connect", { connectionId });
  },

  async disconnect(sessionId: string): Promise<void> {
    return await invoke("redis_disconnect", { sessionId });
  },

  async scan(
    sessionId: string,
    db: number,
    pattern: string,
    cursor: string,
    count: number
  ): Promise<{ keys: RedisKeyInfo[]; cursor: string }> {
    return await invoke("redis_scan", { sessionId, db, pattern, cursor, count });
  },

  async get(sessionId: string, db: number, key: string): Promise<RedisValue> {
    return await invoke("redis_get", { sessionId, db, key });
  },

  async set(sessionId: string, db: number, key: string, value: RedisValue): Promise<void> {
    return await invoke("redis_set", { sessionId, db, key, value });
  },

  async del(sessionId: string, db: number, key: string): Promise<void> {
    return await invoke("redis_del", { sessionId, db, key });
  },

  async expire(sessionId: string, db: number, key: string, ttlSeconds: number): Promise<void> {
    return await invoke("redis_expire", { sessionId, db, key, ttlSeconds });
  },

  async command(sessionId: string, db: number, args: string[]): Promise<unknown> {
    return await invoke("redis_command", { sessionId, db, args });
  },
};

/**
 * Build a {@link RedisApi} adapter bound to a single redis session id. Each
 * method threads the captured `sessionId` into the matching redisCommands call,
 * so the key browser stays decoupled from the session-keyed command layer.
 */
export function makeRedisApi(sessionId: string): RedisApi {
  return {
    scan: (db, pattern, cursor, count) =>
      redisCommands.scan(sessionId, db, pattern, cursor, count),
    get: (db, key) => redisCommands.get(sessionId, db, key),
    set: (db, key, value) => redisCommands.set(sessionId, db, key, value),
    del: (db, key) => redisCommands.del(sessionId, db, key),
    expire: (db, key, ttlSeconds) => redisCommands.expire(sessionId, db, key, ttlSeconds),
    command: (db, args) => redisCommands.command(sessionId, db, args),
  };
}

// MongoDB commands — thin wrappers over the `mongo_*` Tauri commands. As with
// redisCommands, Tauri maps the Rust snake_case args to camelCase, so the arg
// keys here are camelCase. Keyed by a mongo session id from mongo_connect; see
// makeMongoApi for the per-session MongoApi adapter the document browser
// consumes. NOTE the backend arg names differ from the MongoApi method params:
// the browser's filterJson maps to the `filter` arg and docJson to `doc`.
export const mongoCommands = {
  async connect(connectionId: string): Promise<{ sessionId: string }> {
    return await invoke("mongo_connect", { connectionId });
  },

  async disconnect(sessionId: string): Promise<void> {
    return await invoke("mongo_disconnect", { sessionId });
  },

  async listDatabases(sessionId: string): Promise<string[]> {
    return await invoke("mongo_list_databases", { sessionId });
  },

  async listCollections(sessionId: string, db: string): Promise<string[]> {
    return await invoke("mongo_list_collections", { sessionId, db });
  },

  async find(
    sessionId: string,
    db: string,
    coll: string,
    filter: string,
    limit: number,
    skip: number
  ): Promise<{ docs: unknown[]; total: number }> {
    return await invoke("mongo_find", { sessionId, db, coll, filter, limit, skip });
  },

  async insertOne(sessionId: string, db: string, coll: string, doc: string): Promise<void> {
    return await invoke("mongo_insert_one", { sessionId, db, coll, doc });
  },

  async replaceOne(
    sessionId: string,
    db: string,
    coll: string,
    filter: string,
    doc: string
  ): Promise<void> {
    return await invoke("mongo_replace_one", { sessionId, db, coll, filter, doc });
  },

  async deleteOne(sessionId: string, db: string, coll: string, filter: string): Promise<void> {
    return await invoke("mongo_delete_one", { sessionId, db, coll, filter });
  },

  async command(sessionId: string, db: string, command: string): Promise<unknown> {
    return await invoke("mongo_command", { sessionId, db, command });
  },
};

/**
 * Build a {@link MongoApi} adapter bound to a single mongo session id. Each
 * method threads the captured `sessionId` into the matching mongoCommands call,
 * mapping the browser's `filterJson`/`docJson` params onto the backend's
 * `filter`/`doc` args, so the document browser stays decoupled from the
 * session-keyed command layer.
 */
export function makeMongoApi(sessionId: string): MongoApi {
  return {
    listDatabases: () => mongoCommands.listDatabases(sessionId),
    listCollections: (db) => mongoCommands.listCollections(sessionId, db),
    find: (db, coll, filterJson, limit, skip) =>
      mongoCommands.find(sessionId, db, coll, filterJson, limit, skip),
    insertOne: (db, coll, docJson) => mongoCommands.insertOne(sessionId, db, coll, docJson),
    replaceOne: (db, coll, filterJson, docJson) =>
      mongoCommands.replaceOne(sessionId, db, coll, filterJson, docJson),
    deleteOne: (db, coll, filterJson) => mongoCommands.deleteOne(sessionId, db, coll, filterJson),
    command: (db, commandJson) => mongoCommands.command(sessionId, db, commandJson),
  };
}
