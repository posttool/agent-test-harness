import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as types from "../src/types/index.ts";
import { sampleFor } from "./sampleFromSchema.ts";

const typesDir = fileURLToPath(new URL("../src/types/", import.meta.url));
const typeFiles = readdirSync(typesDir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .map((f) => f.slice(0, -3))
  .sort();

describe("P2: one type per file", () => {
  it("has type files", () => {
    expect(typeFiles.length).toBeGreaterThan(50);
  });

  it.each(typeFiles)("%s.ts exports exactly one schema, named %sSchema, re-exported from index", (name) => {
    const source = readFileSync(join(typesDir, `${name}.ts`), "utf8");
    const schemaExports = source.split("\n").filter((line) => line.startsWith("export const") && line.includes("Schema"));
    expect(schemaExports).toEqual([expect.stringContaining(`export const ${name}Schema =`)]);
    expect(source).toContain(`export type ${name} =`);
    const schema = (types as Record<string, unknown>)[`${name}Schema`];
    expect(schema).toBeInstanceOf(z.ZodType);
  });
});

describe("schemas round-trip", () => {
  it.each(typeFiles)("%s parses a generated sample and re-parses its own output", (name) => {
    const schema = (types as unknown as Record<string, z.ZodType>)[`${name}Schema`]!;
    const sample = sampleFor(schema);
    const once = schema.parse(sample);
    const twice = schema.parse(once);
    expect(twice).toEqual(once);
  });
});

describe("defaults", () => {
  it("RestingPolicy defaults match PLAN.md section 4.5", () => {
    expect(types.RestingPolicySchema.parse({})).toEqual({
      maxAttempts: 4,
      baseDelayMs: 1_000,
      factor: 2,
      maxDelayMs: 30_000,
      schemaRetries: 1,
      restAfterFailures: 3,
      failureWindowMs: 120_000,
      restMs: 60_000,
      maxRestMs: 600_000,
      stepBudgetMs: 90_000,
    });
  });

  it("core node and edge types match PLAN.md section 5.1", () => {
    expect(types.CORE_NODE_TYPES).toHaveLength(10);
    expect(types.CORE_EDGE_TYPES).toContain("conflicts_with");
  });
});
