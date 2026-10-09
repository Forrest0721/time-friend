import { z } from "zod";

import { uuidSchema } from "./common.js";
import { focusSessionViewSchema } from "./execution.js";
import { itemSchema } from "./items.js";
import { folderSchema, taskGroupSchema, taskListSchema } from "./organization.js";
import { weekStartsOnSchema } from "./settings.js";

export const bootstrapSchema = z.strictObject({
  user: z.strictObject({
    id: uuidSchema,
    email: z.email(),
    name: z.string(),
    timezone: z.string(),
    weekStartsOn: weekStartsOnSchema,
    settingsRevision: z.int().positive(),
    agentEnabled: z.boolean(),
  }),
  folders: z.array(folderSchema),
  lists: z.array(taskListSchema),
  groups: z.array(taskGroupSchema),
  items: z.array(itemSchema),
  activeFocusSession: focusSessionViewSchema.nullable(),
  pendingReviews: z.int().nonnegative(),
});
