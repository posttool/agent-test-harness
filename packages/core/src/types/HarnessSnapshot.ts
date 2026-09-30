import { z } from "zod";
import { AmbientStateSchema } from "./AmbientState.ts";
import { CalendarEntrySchema } from "./CalendarEntry.ts";
import { DeviceStateSchema } from "./DeviceState.ts";
import { DocumentSchema } from "./Document.ts";
import { DocumentRevisionSchema } from "./DocumentRevision.ts";
import { HarnessSettingsSchema } from "./HarnessSettings.ts";
import { MemoryEdgeSchema } from "./MemoryEdge.ts";
import { MemoryEventSchema } from "./MemoryEvent.ts";
import { MemoryNodeSchema } from "./MemoryNode.ts";
import { PendingApprovalSchema } from "./PendingApproval.ts";
import { PersonaSummarySchema } from "./PersonaSummary.ts";
import { ProviderIdSchema } from "./ProviderId.ts";
import { ReasoningSessionSchema } from "./ReasoningSession.ts";
import { ReasoningStepSchema } from "./ReasoningStep.ts";
import { SchemaExtensionSchema } from "./SchemaExtension.ts";
import { SubscriptionSchema } from "./Subscription.ts";
import { ToolCallRecordSchema } from "./ToolCallRecord.ts";
import { ToolDefinitionSchema } from "./ToolDefinition.ts";
import { TopicSchema } from "./Topic.ts";

/** Everything the harness UI shows, pushed by the runtime whenever something changes. */
export const HarnessSnapshotSchema = z.object({
  settings: HarnessSettingsSchema,
  device: DeviceStateSchema,
  memory: z.object({
    nodes: z.array(MemoryNodeSchema),
    edges: z.array(MemoryEdgeSchema),
    events: z.array(MemoryEventSchema),
    topics: z.array(TopicSchema),
    documents: z.array(DocumentSchema),
    calendar: z.array(CalendarEntrySchema),
    revisions: z.array(DocumentRevisionSchema),
    schemaExtensions: z.array(SchemaExtensionSchema),
  }),
  tools: z.object({
    definitions: z.array(ToolDefinitionSchema),
    calls: z.array(ToolCallRecordSchema),
    approvals: z.array(PendingApprovalSchema),
    subscriptions: z.array(SubscriptionSchema),
    suggestions: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
  ambient: AmbientStateSchema,
  sessions: z.array(ReasoningSessionSchema),
  steps: z.array(ReasoningStepSchema),
  persona: z.object({
    active: z.object({ id: z.string(), name: z.string(), date: z.string() }).nullable(),
    source: z.string(),
    personas: z.array(PersonaSummarySchema),
  }),
  templates: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), kind: z.string() })),
  models: z.object({
    configured: z.array(ProviderIdSchema),
    disabled: z.array(ProviderIdSchema),
    rests: z.record(z.string(), z.object({ resting: z.boolean(), restUntil: z.number().nullable(), recentFailures: z.number() })),
  }),
  busySessions: z.number().int(),
  clients: z.number().int(),
});

export type HarnessSnapshot = z.infer<typeof HarnessSnapshotSchema>;
