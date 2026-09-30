/** Every collection the runtime persists. */
export const COLLECTIONS = [
  "nodes",
  "edges",
  "events",
  "revisions",
  "schemaExtensions",
  "tools",
  "toolCalls",
  "approvals",
  "subscriptions",
  "ambientSources",
  "settings",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

export interface StorageChange {
  collection: Collection;
  id: string;
  op: "put" | "delete" | "clear";
}

export class VersionConflictError extends Error {
  constructor(collection: Collection, id: string, expected: number, actual: number | undefined) {
    super(`Version conflict on ${collection}/${id}: expected ${expected}, found ${actual ?? "nothing"}`);
    this.name = "VersionConflictError";
  }
}

/**
 * Where memory and the rest of the runtime's state live. Implementations: in-memory (tests,
 * one tab), IndexedDB (a browser on its own), and a JSON file on the harness server, which
 * every client shares over WebSocket (cross-device).
 *
 * Documents with a numeric `version` support optimistic concurrency: `put` with
 * `expectedVersion` fails with VersionConflictError when the stored version differs (0 means
 * "must not exist yet").
 */
export interface StorageAdapter {
  get<T extends { id: string }>(collection: Collection, id: string): Promise<T | undefined>;
  list<T extends { id: string }>(collection: Collection): Promise<T[]>;
  put<T extends { id: string }>(collection: Collection, doc: T, expectedVersion?: number): Promise<void>;
  delete(collection: Collection, id: string): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: (change: StorageChange) => void): () => void;
}

export function checkVersion(collection: Collection, id: string, existing: { version?: unknown } | undefined, expected: number | undefined): void {
  if (expected === undefined) return;
  const actual = existing === undefined ? undefined : typeof existing.version === "number" ? existing.version : undefined;
  if ((expected === 0 && existing !== undefined) || (expected !== 0 && actual !== expected)) {
    throw new VersionConflictError(collection, id, expected, actual);
  }
}
