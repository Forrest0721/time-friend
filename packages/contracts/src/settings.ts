import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const weekStartsOnSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const updateDateTimePreferenceBodySchema = z
  .strictObject({
    timezone: z.string().trim().min(1).max(100).optional(),
    weekStartsOn: weekStartsOnSchema.optional(),
    expectedRevision: z.int().positive(),
  })
  .refine((value) => value.timezone !== undefined || value.weekStartsOn !== undefined, {
    message: "timezone or weekStartsOn is required",
  });

export const userDateTimePreferenceSchema = z.strictObject({
  userId: uuidSchema,
  timezone: z.string().min(1).max(100),
  weekStartsOn: weekStartsOnSchema,
  revision: z.int().positive(),
  updatedAt: isoDateTimeSchema,
});

export const updateAgentPreferenceBodySchema = z.strictObject({
  agentEnabled: z.boolean(),
  expectedRevision: z.int().positive(),
});

export const userAgentPreferenceSchema = z.strictObject({
  userId: uuidSchema,
  agentEnabled: z.boolean(),
  revision: z.int().positive(),
  updatedAt: isoDateTimeSchema,
});

export type UpdateDateTimePreferenceBody = z.infer<typeof updateDateTimePreferenceBodySchema>;
export type UserDateTimePreference = z.infer<typeof userDateTimePreferenceSchema>;
export type UpdateAgentPreferenceBody = z.infer<typeof updateAgentPreferenceBodySchema>;
export type UserAgentPreference = z.infer<typeof userAgentPreferenceSchema>;
