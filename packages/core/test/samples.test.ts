import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InMemoryStorage, ToolProposalSchema, ToolRegistry } from "../src/index.ts";

describe("sample tool suggestions (samples/tools)", () => {
  const files = readdirSync("samples/tools").filter((f) => f.endsWith(".json"));
  it.each(files)("%s is a valid tool proposal the registry accepts", async (file) => {
    const proposal = ToolProposalSchema.parse(JSON.parse(readFileSync(`samples/tools/${file}`, "utf8")));
    const tool = await new ToolRegistry(new InMemoryStorage()).registerProposal(proposal, null, "sample");
    expect(tool.functions.length).toBeGreaterThan(0);
  });
});
