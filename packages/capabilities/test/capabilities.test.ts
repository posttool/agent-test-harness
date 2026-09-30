import { describe, expect, it } from "vitest";
import { OUTPUT_SCHEMAS } from "@harness/core";
import { CapabilityFormatError, DEFAULT_CAPABILITY_IDS, loadCapabilities, loadPrompt, parseCapability } from "../src/index.ts";

const valid = `---
id: demo.cap
title: Demo
role: loop
outputSchema: NextStepDecision
whenToUse: Testing.
---
## Instructions

Do the thing.
`;

describe("capability files", () => {
  it("loads exactly the six default capabilities", async () => {
    const specs = await loadCapabilities();
    expect(specs.map((s) => s.id).sort()).toEqual([...DEFAULT_CAPABILITY_IDS].sort());
  });

  it("every capability names a registered output schema and has instructions", async () => {
    for (const spec of await loadCapabilities()) {
      expect(Object.keys(OUTPUT_SCHEMAS)).toContain(spec.outputSchema);
      expect(spec.instructions.length).toBeGreaterThan(100);
      expect(spec.whenToUse.length).toBeGreaterThan(10);
    }
  });

  it("loads the loop and router prompts", async () => {
    expect(await loadPrompt("loop")).toContain("capabilit");
    expect(await loadPrompt("router")).toContain("session");
  });
});

describe("parseCapability", () => {
  it("parses front-matter and body", () => {
    expect(parseCapability(valid)).toEqual({
      id: "demo.cap",
      title: "Demo",
      role: "loop",
      outputSchema: "NextStepDecision",
      whenToUse: "Testing.",
      activity: "Thinking",
      instructions: "## Instructions\n\nDo the thing.",
    });
  });

  it("accepts Windows line endings", () => {
    expect(parseCapability(valid.replaceAll("\n", "\r\n")).id).toBe("demo.cap");
  });

  it.each([
    ["no front-matter", "# Just markdown", "must start with"],
    ["unclosed front-matter", "---\nid: x\n", "not closed"],
    ["unknown output schema", valid.replace("NextStepDecision", "Nope"), 'outputSchema "Nope"'],
    ["unknown role", valid.replace("role: loop", "role: wizard"), "role"],
    ["missing field", valid.replace("title: Demo\n", ""), "title"],
    ["empty body", valid.slice(0, valid.indexOf("## Instructions")), "no instructions"],
  ])("rejects %s", (_label, text, message) => {
    expect(() => parseCapability(text, "x.md")).toThrow(CapabilityFormatError);
    expect(() => parseCapability(text, "x.md")).toThrow(message);
  });
});
