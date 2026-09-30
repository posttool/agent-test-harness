import { z } from "zod";
import { ModelPolicySchema } from "./ModelPolicy.ts";
import { SkinNeedSchema } from "./SkinNeed.ts";
import { ToolProposalSchema } from "./ToolProposal.ts";
import { UiFeedbackSchema } from "./UiFeedback.ts";

/** A command from a harness client (browser tab, phone, eval runner) to the runtime. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_text"), text: z.string(), source: z.string().default("home input bar") }),
  z.object({ type: z.literal("ui_feedback"), feedback: UiFeedbackSchema, said: z.string().default("") }),
  z.object({ type: z.literal("device"), action: z.enum(["lock", "unlock"]) }),
  z.object({ type: z.literal("seen"), topicId: z.string() }),
  z.object({ type: z.literal("dismiss"), itemId: z.string() }),
  z.object({ type: z.literal("open_document"), documentId: z.string() }),
  z.object({ type: z.literal("clear") }),
  z.object({
    type: z.literal("settings"),
    policy: ModelPolicySchema.optional(),
    theme: z.enum(["light", "dark"]).optional(),
    signalWindowSeconds: z.number().optional(),
  }),
  z.object({ type: z.literal("ambient_global"), enabled: z.boolean().optional(), speed: z.number().optional() }),
  z.object({ type: z.literal("ambient_add_template"), templateId: z.string() }),
  z.object({ type: z.literal("ambient_vibe"), description: z.string() }),
  z.object({ type: z.literal("ambient_update"), sourceId: z.string(), enabled: z.boolean().optional(), speed: z.number().optional() }),
  z.object({ type: z.literal("ambient_remove"), sourceId: z.string() }),
  z.object({ type: z.literal("tool_add"), proposal: ToolProposalSchema }),
  z.object({ type: z.literal("tool_add_suggestion"), name: z.string() }),
  z.object({ type: z.literal("tool_delete"), toolId: z.string() }),
  z.object({ type: z.literal("persona_start"), personaId: z.string() }),
  z.object({ type: z.literal("persona_stop") }),
  z.object({ type: z.literal("refresh_surfaces") }),
  z.object({ type: z.literal("skin_need"), need: SkinNeedSchema }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
