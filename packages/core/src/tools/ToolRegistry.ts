import { Ajv } from "ajv";
import type { StorageAdapter } from "../storage/StorageAdapter.ts";
import type { ToolDefinition } from "../types/ToolDefinition.ts";
import type { ToolProposal } from "../types/ToolProposal.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";
import { BUILTIN_TOOLS } from "./builtins.ts";

const ajv = new Ajv({ strict: false });

function parseSchema(text: string, label: string): Record<string, unknown> {
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) throw new Error(`${label} must be a JSON Schema object`);
  try {
    ajv.compile(schema);
  } catch (error) {
    throw new Error(`${label} is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return schema as Record<string, unknown>;
}

/** Every tool the agent knows (PLAN.md section 6). Built-ins always exist and cannot be deleted. */
export class ToolRegistry {
  private readonly storage: StorageAdapter;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(storage: StorageAdapter, clock: Clock = systemClock, ids: IdGenerator = randomIds) {
    this.storage = storage;
    this.clock = clock;
    this.ids = ids;
  }

  async list(): Promise<ToolDefinition[]> {
    const stored = await this.storage.list<ToolDefinition>("tools");
    return [...BUILTIN_TOOLS, ...stored.sort((a, b) => a.provenance.createdAt.localeCompare(b.provenance.createdAt))];
  }

  async get(id: string): Promise<ToolDefinition | undefined> {
    return BUILTIN_TOOLS.find((t) => t.id === id) ?? (await this.storage.get<ToolDefinition>("tools", id));
  }

  async save(tool: ToolDefinition): Promise<ToolDefinition> {
    if (BUILTIN_TOOLS.some((t) => t.id === tool.id)) throw new Error(`${tool.id} is a built-in tool`);
    for (const fn of tool.functions) {
      ajv.compile(fn.params);
      ajv.compile(fn.returns);
    }
    await this.storage.put("tools", tool);
    return tool;
  }

  /** Registers a tool the model proposed (tools.discover). Validates every function's schemas. */
  async registerProposal(proposal: ToolProposal, sessionId: string | null, discoveredVia: string): Promise<ToolDefinition> {
    const functions = proposal.functions.map((f) => ({
      name: f.name,
      description: f.description,
      params: parseSchema(f.paramsJsonSchema, `${f.name} parameters`),
      returns: parseSchema(f.returnsJsonSchema, `${f.name} returns`),
      oversight: f.oversight,
      longRunning: f.longRunning,
    }));
    if (proposal.source === "generated_code" && !proposal.code) throw new Error("A generated_code tool needs code");
    if ((proposal.source === "web_api" || proposal.source === "mcp") && !proposal.endpoint) throw new Error(`A ${proposal.source} tool needs an endpoint`);
    return this.save({
      id: this.ids.next("tool"),
      name: proposal.name,
      description: proposal.description,
      source: proposal.source,
      functions,
      endpoint: proposal.endpoint,
      code: proposal.code,
      provenance: { discoveredVia, createdAt: isoAt(this.clock), createdBySessionId: sessionId },
    });
  }

  async delete(id: string): Promise<void> {
    if (BUILTIN_TOOLS.some((t) => t.id === id)) throw new Error(`${id} is a built-in tool`);
    await this.storage.delete("tools", id);
  }

  /** The tool catalog as text for the model. */
  async render(): Promise<string> {
    const tools = await this.list();
    return tools
      .map((t) =>
        [
          `- [${t.id}] ${t.name} (${t.source}): ${t.description}`,
          ...t.functions.map((f) => `  - ${f.name} [${f.oversight}${f.longRunning ? ", long-running" : ""}]: ${f.description} params ${JSON.stringify(f.params)}`),
        ].join("\n"),
      )
      .join("\n");
  }
}
