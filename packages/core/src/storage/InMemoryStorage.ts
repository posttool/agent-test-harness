import { checkVersion, COLLECTIONS, type Collection, type StorageAdapter, type StorageChange } from "./StorageAdapter.ts";

/** Storage in plain maps. Also the base of the server's file-backed storage. */
export class InMemoryStorage implements StorageAdapter {
  protected readonly data = new Map<Collection, Map<string, unknown>>(COLLECTIONS.map((c) => [c, new Map()]));
  private readonly listeners = new Set<(change: StorageChange) => void>();

  protected emit(change: StorageChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private bucket(collection: Collection): Map<string, unknown> {
    return this.data.get(collection)!;
  }

  async get<T extends { id: string }>(collection: Collection, id: string): Promise<T | undefined> {
    const doc = this.bucket(collection).get(id);
    return doc === undefined ? undefined : (structuredClone(doc) as T);
  }

  async list<T extends { id: string }>(collection: Collection): Promise<T[]> {
    return [...this.bucket(collection).values()].map((d) => structuredClone(d) as T);
  }

  async put<T extends { id: string }>(collection: Collection, doc: T, expectedVersion?: number): Promise<void> {
    checkVersion(collection, doc.id, this.bucket(collection).get(doc.id) as { version?: unknown } | undefined, expectedVersion);
    this.bucket(collection).set(doc.id, structuredClone(doc));
    this.emit({ collection, id: doc.id, op: "put" });
  }

  async delete(collection: Collection, id: string): Promise<void> {
    this.bucket(collection).delete(id);
    this.emit({ collection, id, op: "delete" });
  }

  async clear(): Promise<void> {
    for (const bucket of this.data.values()) bucket.clear();
    this.emit({ collection: "nodes", id: "*", op: "clear" });
  }

  subscribe(listener: (change: StorageChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every collection as plain objects, for persistence. */
  dump(): Record<string, unknown[]> {
    return Object.fromEntries([...this.data].map(([c, bucket]) => [c, [...bucket.values()]]));
  }

  /** Replaces all data from a dump. */
  load(dump: Record<string, unknown[]>): void {
    for (const c of COLLECTIONS) {
      const bucket = this.bucket(c);
      bucket.clear();
      for (const doc of dump[c] ?? []) bucket.set((doc as { id: string }).id, doc);
    }
  }
}
