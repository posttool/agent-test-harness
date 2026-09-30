import { z } from "zod";

/** Memory node type (open-ended). */
export const NodeTypeSchema = z.string().describe("A memory node type. Core types are in CORE_NODE_TYPES; others are SchemaExtensions.");

export type NodeType = z.infer<typeof NodeTypeSchema>;

export const CORE_NODE_TYPES = [
  "personal_preference",
  "project_context",
  "ambient_state",
  "tool_knowledge",
  "active_process",
  "document",
  "topic",
  "person",
  "place",
  "calendar_entry",
] as const;
