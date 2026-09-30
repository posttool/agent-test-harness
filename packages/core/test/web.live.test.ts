import { describe, expect, it } from "vitest";
import { ClaudeWebBackend } from "../src/index.ts";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Claude web backend (live)", () => {
  it("searches the web", async () => {
    const found = await new ClaudeWebBackend().search("Hong Kong Observatory weather forecast");
    console.log(found.summary.slice(0, 300), found.results.slice(0, 3));
    expect(found.summary.length).toBeGreaterThan(20);
    expect(found.results.length).toBeGreaterThan(0);
  });
});
