/**
 * MongoDB document-browser contract.
 *
 * The {@link MongoBrowser} component is written purely against {@link MongoApi};
 * the integration layer backs this interface with the `mongo_*` Tauri commands
 * (keyed by a mongo session id). Keep this file free of Tauri / SQL coupling so
 * the browser stays a standalone, testable workspace view.
 */

/** Everything the document browser needs from the host integration. */
export interface MongoApi {
  listDatabases: () => Promise<string[]>;
  listCollections: (db: string) => Promise<string[]>;
  /**
   * Find documents in a collection.
   * `filterJson` is a JSON string (`"{}"` = all); `docs` are parsed JSON objects.
   */
  find: (
    db: string,
    coll: string,
    filterJson: string,
    limit: number,
    skip: number
  ) => Promise<{ docs: unknown[]; total: number }>;
  insertOne: (db: string, coll: string, docJson: string) => Promise<void>;
  /** Replace a matched document (filter usually by `_id`). */
  replaceOne: (
    db: string,
    coll: string,
    filterJson: string,
    docJson: string
  ) => Promise<void>;
  deleteOne: (db: string, coll: string, filterJson: string) => Promise<void>;
  /** Run a raw `runCommand` against the database and return the reply. */
  command: (db: string, commandJson: string) => Promise<unknown>;
}
