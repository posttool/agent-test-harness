import { z } from "zod";

export type JsonSchema = { [key: string]: unknown };

/**
 * Keywords that at least one provider's structured-output mode rejects (Claude does not
 * support numeric or string bounds, complex array constraints or recursion). Output
 * schemas must avoid them so the same schema works on Claude and Gemini.
 */
const FORBIDDEN_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "$ref",
  "$defs",
] as const;

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!isObject(node)) return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    out[key] = normalize(value);
  }

  // `type: ["string", "null"]` becomes `anyOf: [{type: "string"}, {type: "null"}]`,
  // the nullable form both providers document.
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const { type: _type, description, enum: enumValues, ...rest } = out;
    const variants = types.map((t) => {
      if (t !== "null" && enumValues !== undefined) {
        return { type: t, enum: (enumValues as unknown[]).filter((v) => v !== null) };
      }
      return { type: t };
    });
    return { ...(description === undefined ? {} : { description }), ...rest, anyOf: variants };
  }

  if (out.type === "object") {
    out.additionalProperties = false;
    const props = isObject(out.properties) ? out.properties : {};
    out.properties = props;
    out.required = Object.keys(props);
  }
  return out;
}

/** Converts a Zod schema into the JSON Schema we send to every provider. */
export function toProviderJsonSchema(schema: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { io: "output", target: "draft-2020-12", unrepresentable: "throw" });
  return normalize(raw) as JsonSchema;
}

/**
 * Returns every reason a converted schema would be rejected by at least one provider.
 * An empty list means the schema is safe to use as a model output schema.
 */
export function findParityViolations(schema: JsonSchema, path = "$"): string[] {
  const problems: string[] = [];
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (Object.hasOwn(schema, keyword)) problems.push(`${path}: uses unsupported keyword "${keyword}"`);
  }
  if (Array.isArray(schema.type)) problems.push(`${path}: type arrays must be normalized to anyOf`);

  if (schema.type === "object") {
    if (schema.additionalProperties !== false) problems.push(`${path}: object must set additionalProperties: false`);
    const props = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) problems.push(`${path}.${key}: every property must be required (use nullable instead)`);
    }
    for (const [key, child] of Object.entries(props)) {
      if (isObject(child)) problems.push(...findParityViolations(child, `${path}.${key}`));
    }
    if (Object.keys(props).length === 0) problems.push(`${path}: object has no properties (free-form objects are not allowed)`);
  }
  if (isObject(schema.items)) problems.push(...findParityViolations(schema.items, `${path}[]`));
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((variant, i) => {
      if (isObject(variant)) problems.push(...findParityViolations(variant, `${path}.anyOf[${i}]`));
    });
  }
  return problems;
}
