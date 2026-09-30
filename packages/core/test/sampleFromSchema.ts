import { z } from "zod";

type Json = { [key: string]: unknown };

/** Builds a minimal value that satisfies a JSON Schema, used to round-trip every type. */
export function sampleFrom(schema: Json): unknown {
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf as Json[];
    const nonNull = variants.find((v) => v.type !== "null") ?? variants[0];
    return sampleFrom(nonNull ?? {});
  }
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== "null") : schema.type;
  switch (type) {
    case "string":
      return "sample";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array":
      return schema.items ? [sampleFrom(schema.items as Json)] : [];
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, Json>;
      const out = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFrom(v)]));
      // An exhaustive enum-keyed record: every key must be present.
      const keyEnum = (schema.propertyNames as Json | undefined)?.enum;
      if (Array.isArray(keyEnum) && typeof schema.additionalProperties === "object") {
        for (const key of keyEnum as string[]) out[key] = sampleFrom(schema.additionalProperties as Json);
      }
      return out;
    }
    default:
      return {};
  }
}

export function sampleFor(schema: z.ZodType): unknown {
  return sampleFrom(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Json);
}
