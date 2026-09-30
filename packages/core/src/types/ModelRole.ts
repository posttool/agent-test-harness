import { z } from "zod";

/** Which part of the system is calling the model. Each role can have its own model chain and effort. */
export const ModelRoleSchema = z.enum(["router", "loop", "memoryMerge", "device", "judge", "simulator"]);

export type ModelRole = z.infer<typeof ModelRoleSchema>;
