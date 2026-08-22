import { z } from "zod";

import { isoDateTimeSchema, nonBlankTextSchema, positionKeySchema, revisionSchema, uuidSchema } from "./common.js";

const versionedOrganizationShape = {
  id: uuidSchema,
  userId: uuidSchema,
  name: nonBlankTextSchema,
  positionKey: positionKeySchema,
  archivedAt: isoDateTimeSchema.nullable(),
  revision: revisionSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

export const folderSchema = z.strictObject(versionedOrganizationShape);
export const taskListSchema = z.strictObject({
  ...versionedOrganizationShape,
  folderId: uuidSchema.nullable(),
  isInbox: z.boolean(),
  learningPolicy: z.enum(["include", "exclude"]),
});
export const taskGroupSchema = z.strictObject({
  ...versionedOrganizationShape,
  listId: uuidSchema,
});

export const createFolderBodySchema = z.strictObject({
  id: uuidSchema.optional(),
  name: nonBlankTextSchema,
});
export const updateFolderBodySchema = z.strictObject({
  name: nonBlankTextSchema.optional(),
  archived: z.boolean().optional(),
  positionKey: positionKeySchema.optional(),
  expectedRevision: revisionSchema,
});

export const createTaskListBodySchema = z.strictObject({
  id: uuidSchema.optional(),
  folderId: uuidSchema.nullable().optional(),
  name: nonBlankTextSchema,
  isInbox: z.boolean().optional(),
  learningPolicy: z.enum(["include", "exclude"]).optional(),
});
export const updateTaskListBodySchema = z.strictObject({
  folderId: uuidSchema.nullable().optional(),
  name: nonBlankTextSchema.optional(),
  learningPolicy: z.enum(["include", "exclude"]).optional(),
  archived: z.boolean().optional(),
  positionKey: positionKeySchema.optional(),
  expectedRevision: revisionSchema,
});

export const listIdParamsSchema = z.strictObject({ listId: uuidSchema });
export const createTaskGroupBodySchema = z.strictObject({
  id: uuidSchema.optional(),
  name: nonBlankTextSchema,
});
export const updateTaskGroupBodySchema = z.strictObject({
  name: nonBlankTextSchema.optional(),
  archived: z.boolean().optional(),
  positionKey: positionKeySchema.optional(),
  expectedRevision: revisionSchema,
});

export const reorderBodySchema = z.strictObject({
  ids: z.array(uuidSchema).min(1).max(10_000).refine((ids) => new Set(ids).size === ids.length, "ids 不能重复"),
});

export type FolderDto = z.infer<typeof folderSchema>;
export type TaskListDto = z.infer<typeof taskListSchema>;
export type TaskGroupDto = z.infer<typeof taskGroupSchema>;
