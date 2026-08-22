import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common.js";

export const updateAgentPreferenceBodySchema = z.strictObject({
  agentEnabled: z.boolean(),
});

export const userAgentPreferenceSchema = z.strictObject({
  userId: uuidSchema,
  agentEnabled: z.boolean(),
  updatedAt: isoDateTimeSchema,
});

export type UpdateAgentPreferenceBody = z.infer<typeof updateAgentPreferenceBodySchema>;
export type UserAgentPreference = z.infer<typeof userAgentPreferenceSchema>;
