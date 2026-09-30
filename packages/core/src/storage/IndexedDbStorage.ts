import { checkVersion, COLLECTIONS, type Collection, type StorageAdapter, type StorageChange } from "./StorageAdapter.ts";

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Browser storage for a harness running entirely in one tab. */
export class IndexedDbStorage implements StorageAdapter {
  private readonly listeners = new Set<(change: StorageChange) => void>();
  private dbPromise: Promise<IDBDatabase> | null = null;

  private readonly name: string;
  private readonly factory: IDBFactory;

  constructor(name = "agent-harness", factory: IDBFactory = globalThis.indexedDB) {
    this.name = name;
    this.factory = factory;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(this.name, 1);
      open.onupgradeneeded = () => {
        for (const c of COLLECTIONS) if (!open.result.objectStoreNames.contains(c)) open.result.createObjectStore(c, { keyPath: "id" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }

  private async store(collection: Collection, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(collection, mode).objectStore(collection);
  }

  async get<T extends { id: string }>(collection: Collection, id: string): Promise<T | undefined> {
    return (await request((await this.store(collection, "readonly")).get(id))) as T | undefined;
  }

  async list<T extends { id: string }>(collection: Collection): Promise<T[]> {
    return (await request((await this.store(collection, "readonly")).getAll())) as T[];
  }

  async put<T extends { id: string }>(collection: Collection, doc: T, expectedVersion?: number): Promise<void> {
    const store = await this.store(collection, "readwrite");
    // get and put share one readwrite transaction, so the version check is atomic.
    const existing = (await request(store.get(doc.id))) as { version?: unknown } | undefined;
    checkVersion(collection, doc.id, existing, expectedVersion);
    await request(store.put(doc));
    this.emit({ collection, id: doc.id, op: "put" });
  }

  async delete(collection: Collection, id: string): Promise<void> {
    await request((await this.store(collection, "readwrite")).delete(id));
    this.emit({ collection, id, op: "delete" });
  }

  async clear(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([...COLLECTIONS], "readwrite");
    await Promise.all(COLLECTIONS.map((c) => request(tx.objectStore(c).clear())));
    this.emit({ collection: "nodes", id: "*", op: "clear" });
  }

  subscribe(listener: (change: StorageChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: StorageChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
