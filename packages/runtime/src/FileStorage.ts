import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { InMemoryStorage } from "@harness/core";

/**
 * The harness server's storage: everything in memory, persisted to one JSON file after
 * changes (debounced, atomic rename). Plain Node; no database or cloud service needed.
 */
export class FileStorage extends InMemoryStorage {
  private readonly path: string;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string, debounceMs = 250) {
    super();
    this.path = path;
    if (existsSync(path)) this.load(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown[]>);
    this.subscribe(() => {
      if (this.timer) return;
      this.timer = setTimeout(() => this.flush(), debounceMs);
    });
  }

  /** Writes to disk now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.dump()));
    renameSync(tmp, this.path);
  }
}
