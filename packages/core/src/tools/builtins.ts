import type { ToolDefinition } from "../types/ToolDefinition.ts";

const at = "1970-01-01T00:00:00.000Z";

/** The only default tools (PLAN.md section 6.3): web access and device control. */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: "web",
    name: "Web",
    description: "Search the web and read pages.",
    source: "builtin",
    endpoint: null,
    code: null,
    provenance: { discoveredVia: "builtin", createdAt: at, createdBySessionId: null },
    functions: [
      {
        name: "search",
        description: "Search the web. Returns a short summary and the top results.",
        params: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
        returns: { type: "object" },
        oversight: "auto_from_memory",
        longRunning: false,
      },
      {
        name: "fetch",
        description: "Read a web page (or download a file to the device) and return its main text.",
        params: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
        returns: { type: "object" },
        oversight: "auto_from_memory",
        longRunning: false,
      },
    ],
  },
  {
    id: "device",
    name: "Device",
    description: "Control the phone's surfaces: notify the user or open a document in Spaces.",
    source: "builtin",
    endpoint: null,
    code: null,
    provenance: { discoveredVia: "builtin", createdAt: at, createdBySessionId: null },
    functions: [
      {
        name: "notify",
        description: "Show a short notice on the Contextual Brief.",
        params: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
        returns: { type: "object" },
        oversight: "auto_from_memory",
        longRunning: false,
      },
      {
        name: "open_space",
        description: "Bring a document to the front of Spaces.",
        params: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"], additionalProperties: false },
        returns: { type: "object" },
        oversight: "auto_from_memory",
        longRunning: false,
      },
    ],
  },
];

export type BuiltinHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
