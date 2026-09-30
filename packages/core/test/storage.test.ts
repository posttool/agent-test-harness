import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { InMemoryStorage, IndexedDbStorage, VersionConflictError, type StorageAdapter, type StorageChange } from "../src/index.ts";

let dbCount = 0;
const adapters: [string, () => StorageAdapter][] = [
  ["InMemoryStorage", () => new InMemoryStorage()],
  ["IndexedDbStorage", () => new IndexedDbStorage(`test-${++dbCount}`, new IDBFactory())],
];

describe.each(adapters)("%s", (_name, make) => {
  it("puts, gets, lists and deletes", async () => {
    const s = make();
    await s.put("nodes", { id: "a", title: "A" });
    await s.put("nodes", { id: "b", title: "B" });
    expect(await s.get("nodes", "a")).toEqual({ id: "a", title: "A" });
    expect((await s.list("nodes")).map((d) => d.id).sort()).toEqual(["a", "b"]);
    await s.delete("nodes", "a");
    expect(await s.get("nodes", "a")).toBeUndefined();
    expect(await s.list("edges")).toEqual([]);
  });

  it("returns copies, not live references", async () => {
    const s = make();
    const doc = { id: "a", tags: ["x"] };
    await s.put("nodes", doc);
    doc.tags.push("y");
    const read = await s.get<{ id: string; tags: string[] }>("nodes", "a");
    read!.tags.push("z");
    expect((await s.get<{ id: string; tags: string[] }>("nodes", "a"))!.tags).toEqual(["x"]);
  });

  it("enforces optimistic versions", async () => {
    const s = make();
    await s.put("nodes", { id: "a", version: 1 }, 0);
    await expect(s.put("nodes", { id: "a", version: 1 }, 0)).rejects.toBeInstanceOf(VersionConflictError);
    await s.put("nodes", { id: "a", version: 2 }, 1);
    await expect(s.put("nodes", { id: "a", version: 3 }, 1)).rejects.toBeInstanceOf(VersionConflictError);
    expect(await s.get("nodes", "a")).toEqual({ id: "a", version: 2 });
  });

  it("clears everything and notifies subscribers", async () => {
    const s = make();
    const changes: StorageChange[] = [];
    const off = s.subscribe((c) => changes.push(c));
    await s.put("tools", { id: "t" });
    await s.clear();
    off();
    await s.put("tools", { id: "u" });
    expect(changes.map((c) => c.op)).toEqual(["put", "clear"]);
    expect(await s.list("tools")).toEqual([{ id: "u" }]);
  });
});

describe("InMemoryStorage dump/load", () => {
  it("round-trips all collections", async () => {
    const a = new InMemoryStorage();
    await a.put("nodes", { id: "n1" });
    await a.put("settings", { id: "settings", theme: "dark" });
    const b = new InMemoryStorage();
    b.load(JSON.parse(JSON.stringify(a.dump())));
    expect(await b.get("settings", "settings")).toEqual({ id: "settings", theme: "dark" });
    expect(await b.list("nodes")).toEqual([{ id: "n1" }]);
  });
});
