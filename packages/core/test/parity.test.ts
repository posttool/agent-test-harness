import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OUTPUT_SCHEMAS, findParityViolations, toProviderJsonSchema } from "../src/index.ts";

describe("provider parity check", () => {
  it.each(Object.keys(OUTPUT_SCHEMAS))("%s is accepted by both providers", (name) => {
    const schema = OUTPUT_SCHEMAS[name as keyof typeof OUTPUT_SCHEMAS];
    const json = toProviderJsonSchema(schema);
    expect(findParityViolations(json)).toEqual([]);
    expect(json.$schema).toBeUndefined();
  });

  it("normalizes nullable fields to anyOf and closes every object", () => {
    const json = toProviderJsonSchema(z.object({ a: z.string().nullable(), b: z.object({ c: z.boolean() }) }));
    expect(json).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["a", "b"],
      properties: {
        a: { anyOf: [{ type: "string" }, { type: "null" }] },
        b: { type: "object", additionalProperties: false, required: ["c"], properties: { c: { type: "boolean" } } },
      },
    });
  });

  it("keeps enum values on a nullable enum", () => {
    const json = toProviderJsonSchema(z.object({ q: z.enum(["a", "b"]).nullable() }));
    const q = (json.properties as Record<string, unknown>).q;
    expect(JSON.stringify(q)).toContain('"enum":["a","b"]');
    expect(findParityViolations(json)).toEqual([]);
  });

  it("flags bounds, free-form records and integers", () => {
    const bad = toProviderJsonSchema(
      z.object({
        n: z.number().min(1),
        s: z.string().max(3),
        r: z.record(z.string(), z.string()),
        i: z.number().int(),
      }),
    );
    const problems = findParityViolations(bad).join("\n");
    expect(problems).toContain('$.n: uses unsupported keyword "minimum"');
    expect(problems).toContain('$.s: uses unsupported keyword "maxLength"');
    expect(problems).toContain("$.r: object has no properties");
    expect(problems).toContain('$.i: uses unsupported keyword "minimum"');
  });

  it("enforces Claude's limit of 16 union-typed parameters", () => {
    const many = z.object(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, z.string().nullable()])));
    expect(findParityViolations(toProviderJsonSchema(many))[0]).toContain("17 union-typed parameters");
    const ok = z.object(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}`, z.string().nullable()])));
    expect(findParityViolations(toProviderJsonSchema(ok))).toEqual([]);
  });

  it("flags recursive schemas", () => {
    type Node = { children: Node[] };
    const NodeSchema: z.ZodType<Node> = z.lazy(() => z.object({ children: z.array(NodeSchema) }));
    expect(() => findParityViolations(toProviderJsonSchema(NodeSchema))).not.toThrow();
    expect(findParityViolations(toProviderJsonSchema(NodeSchema)).join("\n")).toMatch(/\$ref|\$defs/);
  });
});
