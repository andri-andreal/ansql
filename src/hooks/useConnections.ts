import { useState, useEffect, useCallback } from "react";
import { connectionCommands, credentialCommands } from "../lib/tauri-commands";
import type { Connection, ConnectionOptions } from "../types";

interface UseConnectionsOptions {
  enabled?: boolean;
}

/** Raw SSH secrets entered in the connection form; persisted to the vault and
 * referenced from `options.ssh.*_credential_id`. */
export interface ConnectionSecrets {
  password?: string;
  sshPassword?: string;
  sshPassphrase?: string;
}

/**
 * Save any SSH secrets to the credential vault and stamp their ids into the
 * `options.ssh` blob. Returns the (possibly rewritten) options JSON string, or
 * the original when there's nothing to do.
 *
 * A blank secret leaves whatever `*_credential_id` the form preserved intact.
 */
async function persistSshSecrets(
  connectionName: string,
  optionsJson: string | null | undefined,
  secrets: ConnectionSecrets
): Promise<string | null | undefined> {
  if (!optionsJson) return optionsJson;

  let options: ConnectionOptions;
  try {
    options = JSON.parse(optionsJson) as ConnectionOptions;
  } catch {
    return optionsJson;
  }

  const ssh = options.ssh;
  if (!ssh?.enabled) return optionsJson;

  if (ssh.auth === "password" && secrets.sshPassword && secrets.sshPassword.trim() !== "") {
    ssh.password_credential_id = await credentialCommands.saveCredential(
      `${connectionName} - SSH`,
      secrets.sshPassword,
      "ssh_key"
    );
  } else if (ssh.auth === "key" && secrets.sshPassphrase && secrets.sshPassphrase.trim() !== "") {
    ssh.passphrase_credential_id = await credentialCommands.saveCredential(
      `${connectionName} - SSH passphrase`,
      secrets.sshPassphrase,
      "ssh_key"
    );
  }

  return JSON.stringify(options);
}

export function useConnections(options: UseConnectionsOptions = {}) {
  const { enabled = true } = options;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const data = await connectionCommands.getConnections();
      setConnections(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error("Failed to load connections:", errorMsg);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const createConnection = useCallback(
    async (
      connection: Omit<Connection, "id" | "created_at" | "updated_at">,
      secrets?: ConnectionSecrets
    ) => {
      setError(null);
      const password = secrets?.password;

      try {
        let credentialId = connection.credential_id;

        // If password is provided, save it to the credential vault
        if (password && password.trim() !== "") {
          try {
            credentialId = await credentialCommands.saveCredential(
              `${connection.name} - Credential`,
              password
            );
          } catch (credErr) {
            const errorMsg = credErr instanceof Error ? credErr.message : String(credErr);
            setError(`Failed to save credential: ${errorMsg}`);
            throw new Error(`Failed to save credential: ${errorMsg}`, { cause: credErr });
          }
        }

        // Persist SSH secrets to the vault and stamp credential ids into options.
        let options = connection.options;
        if (secrets) {
          try {
            options = await persistSshSecrets(connection.name, options, secrets);
          } catch (credErr) {
            const errorMsg = credErr instanceof Error ? credErr.message : String(credErr);
            setError(`Failed to save SSH credential: ${errorMsg}`);
            throw new Error(`Failed to save SSH credential: ${errorMsg}`, { cause: credErr });
          }
        }

        const created = await connectionCommands.createConnection({
          ...connection,
          credential_id: credentialId,
          options,
        });
        setConnections((prev) => [...prev, created]);
        return created;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        throw err;
      }
    },
    []
  );

  const updateConnection = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Connection, "id" | "created_at" | "updated_at">>,
      secrets?: ConnectionSecrets
    ) => {
      setError(null);

      try {
        const password = secrets?.password;

        // Update the DB-password credential when a new one is entered.
        let credentialId = updates.credential_id;
        if (password && password.trim() !== "") {
          credentialId = await credentialCommands.saveCredential(
            `${updates.name ?? "Connection"} - Credential`,
            password
          );
        }

        // Persist any new SSH secrets and stamp credential ids into options.
        let options = updates.options;
        if (secrets) {
          options = await persistSshSecrets(updates.name ?? "Connection", options, secrets);
        }

        const updated = await connectionCommands.updateConnection(id, {
          ...updates,
          ...(credentialId !== undefined ? { credential_id: credentialId } : {}),
          options,
        });
        setConnections((prev) =>
          prev.map((conn) => (conn.id === id ? updated : conn))
        );
        return updated;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        throw err;
      }
    },
    []
  );

  const deleteConnection = useCallback(async (id: string) => {
    setError(null);

    try {
      await connectionCommands.deleteConnection(id);
      setConnections((prev) => prev.filter((conn) => conn.id !== id));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      throw err;
    }
  }, []);

  const testConnection = useCallback(async (id: string) => {
    try {
      return await connectionCommands.testConnection(id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Connection test failed:", errorMsg);
      return false;
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  return {
    connections,
    loading,
    error,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
  };
}
