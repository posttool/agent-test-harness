import { parse as parseYaml } from "yaml";
import { CapabilitySpecSchema, isOutputSchemaName, type CapabilitySpec } from "@harness/core";

const FENCE = "---";

export class CapabilityFormatError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "CapabilityFormatError";
  }
}

/**
 * Parses a capability Markdown file: YAML front-matter between `---` fences, then the
 * instructions body. Validates the front-matter and checks that `outputSchema` names a
 * registered output schema.
 */
export function parseCapability(text: string, source = "capability"): CapabilitySpec {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) {
    throw new CapabilityFormatError(source, "must start with a --- front-matter fence");
  }
  const end = normalized.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end === -1) throw new CapabilityFormatError(source, "front-matter is not closed with ---");

  const frontMatter: unknown = parseYaml(normalized.slice(FENCE.length + 1, end));
  const instructions = normalized.slice(end + FENCE.length + 2).trim();

  const result = CapabilitySpecSchema.safeParse({ ...(frontMatter as object), instructions });
  if (!result.success) {
    throw new CapabilityFormatError(source, result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  if (!isOutputSchemaName(result.data.outputSchema)) {
    throw new CapabilityFormatError(source, `outputSchema "${result.data.outputSchema}" is not a registered output schema`);
  }
  if (result.data.instructions.length === 0) throw new CapabilityFormatError(source, "has no instructions");
  return result.data;
}
