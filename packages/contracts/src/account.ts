import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const accountDataExportSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  generatedAt: isoDateTimeSchema,
  profile: z.strictObject({
    id: uuidSchema,
    email: z.email(),
    name: z.string(),
    timezone: z.string(),
    weekStartsOn: z.int(),
    agentEnabled: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  }),
  data: z.record(z.string(), z.array(z.unknown())),
});

export const requestAccountDeletionBodySchema = z.strictObject({
  confirmation: z.literal("DELETE"),
});

export const accountDeletionRequestSchema = z.strictObject({
  id: uuidSchema,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  requestedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export type AccountDataExportDto = z.infer<typeof accountDataExportSchema>;
export type AccountDeletionRequestDto = z.infer<typeof accountDeletionRequestSchema>;
