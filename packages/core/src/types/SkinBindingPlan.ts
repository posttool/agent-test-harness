import { z } from "zod";

/**
 * LLM output: which parts of one Claude Design artboard show live harness data, which are
 * decoration, and which are controls (docs/SKINS_FROM_CLAUDE_DESIGN.md section 6).
 * Anchors are the `#aN` ids the analyzer puts on the artboard's elements.
 */
export const SkinBindingPlanSchema = z.object({
  screen: z.enum(["lock", "home", "brief", "spaces", "discover", "document", "question", "other"]).describe("The harness screen this artboard is."),
  summary: z.string().describe("One or two sentences on what the artboard shows."),
  regions: z
    .array(
      z.object({
        anchor: z.string().describe("The #aN id of the region's outermost element."),
        label: z.string().describe("A few words naming the region, e.g. 'Brief card'."),
        role: z.enum(["live", "decoration", "control"]),
        slot: z.string().describe("Contract path the region shows: a list for 'list' regions (e.g. 'brief.items'), an object or '' for root. Empty string for decoration."),
        cardinality: z.enum(["one", "list"]).describe("'list' when the region is repeated rows that become one sc-for template."),
        fields: z
          .array(
            z.object({
              anchor: z.string().describe("The #aN id of the element whose text or attribute shows this value (in a list: in the first row)."),
              path: z.string().describe("Contract path relative to the slot, e.g. 'title'."),
              sample: z.string().describe("The designer's copy there now, verbatim."),
            }),
          )
          .describe("The literal copy to replace with holes. Empty for decoration."),
        rationale: z.string(),
      }),
    )
    .describe("Every meaningful region, top to bottom. Group purely visual chrome (wallpaper, status bar, dock) as decoration."),
  interactions: z
    .array(
      z.object({
        anchor: z.string(),
        command: z.enum(["unlock", "lock", "say", "answer", "open", "act", "dismiss", "need", "navigate", "none"]),
        argsFrom: z.string().describe("Where the command's argument comes from, e.g. 'brief.items[].id', or an empty string."),
        rationale: z.string(),
      }),
    )
    .describe("Tappable elements and the skin command each should send. 'navigate' is a link between artboards only; 'none' for controls outside the contract (flashlight, camera)."),
  needs: z
    .array(
      z.object({
        id: z.string().describe("Short id, e.g. 'weather'."),
        ask: z.string().describe("What to ask the agent for, one sentence."),
        fields: z.array(z.string()).describe("The value names the region shows, e.g. ['now', 'high', 'low', 'summary']."),
        refreshMinutes: z.number().describe("How stale the data may get, in minutes."),
        anchor: z.string(),
      }),
    )
    .describe("Live regions whose data no contract slot holds and the agent could look up with a tool, like weather."),
  unmapped: z
    .array(z.object({ anchor: z.string(), what: z.string(), options: z.array(z.string()) }))
    .describe("Regions that are neither decoration nor bindable, with options for the user."),
});

export type SkinBindingPlan = z.infer<typeof SkinBindingPlanSchema>;
