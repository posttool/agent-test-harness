import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Calls one tool on an MCP server over streamable HTTP (tools with source "mcp"). */
export async function mcpCall(endpoint: string, functionName: string, args: Record<string, unknown>): Promise<unknown> {
  const client = new Client({ name: "agent-test-harness", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  try {
    const result = await client.callTool({ name: functionName, arguments: args });
    if (result.isError) throw new Error(`MCP tool ${functionName} failed: ${JSON.stringify(result.content)}`);
    if (result.structuredContent) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text };
    }
  } finally {
    await client.close();
  }
}
