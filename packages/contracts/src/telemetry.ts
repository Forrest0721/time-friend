import { z } from "zod";

export const productEventBodySchema = z.strictObject({
  name: z.enum(["evidence_opened", "focus_restored", "item_sync_failed", "onboarding_dismissed"]),
  context: z.enum(["trajectory", "focus", "tasks", "onboarding"]),
  entityType: z.enum(["claim", "focus_session", "item", "guide"]).optional(),
});
