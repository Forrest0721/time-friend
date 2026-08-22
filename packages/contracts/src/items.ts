import { z } from "zod";

import { dateOnlySchema, isoDateTimeSchema, nonBlankTextSchema, positionKeySchema, revisionSchema, uuidSchema } from "./common.js";

export const itemKindSchema = z.enum(["task", "note"]);
export const taskStatusSchema = z.enum(["pending", "completed", "abandoned"]);
export const taskPrioritySchema = z.enum(["none", "low", "medium", "high"]);

export const contentDocumentSchema = z.strictObject({
  type: z.literal("doc"),
  schemaVersion: z.literal(1),
  content: z.array(z.unknown()).max(10_000),
});

export const itemSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  listId: uuidSchema,
  groupId: uuidSchema.nullable(),
  parentTaskId: uuidSchema.nullable(),
  kind: itemKindSchema,
  title: nonBlankTextSchema,
  status: taskStatusSchema.nullable(),
  priority: taskPrioritySchema.nullable(),
  plannedOn: dateOnlySchema.nullable(),
  contentDoc: contentDocumentSchema,
  contentText: z.string(),
  positionKey: positionKeySchema,
  completedAt: isoDateTimeSchema.nullable(),
  abandonedAt: isoDateTimeSchema.nullable(),
  revision: revisionSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createItemBodySchema = z.strictObject({
  id: uuidSchema.optional(),
  listId: uuidSchema,
  groupId: uuidSchema.nullable().optional(),
  parentTaskId: uuidSchema.nullable().optional(),
  kind: itemKindSchema,
  title: nonBlankTextSchema,
  priority: taskPrioritySchema.nullable().optional(),
  plannedOn: dateOnlySchema.nullable().optional(),
  contentDoc: contentDocumentSchema.optional(),
});

export const updateItemBodySchema = z.strictObject({
  title: nonBlankTextSchema.optional(),
  priority: taskPrioritySchema.nullable().optional(),
  plannedOn: dateOnlySchema.nullable().optional(),
  contentDoc: contentDocumentSchema.optional(),
  expectedRevision: revisionSchema,
});

export const moveItemBodySchema = z.strictObject({
  listId: uuidSchema,
  groupId: uuidSchema.nullable(),
  parentTaskId: uuidSchema.nullable(),
  positionKey: positionKeySchema,
  expectedRevision: revisionSchema,
});

export const reorderItemsBodySchema = z.strictObject({
  listId: uuidSchema,
  groupId: uuidSchema.nullable(),
  parentTaskId: uuidSchema.nullable(),
  ids: z.array(uuidSchema).min(1).max(10_000).refine((ids) => new Set(ids).size === ids.length, "ids 不能重复"),
});

export const taskCommandBodySchema = z.strictObject({ expectedRevision: revisionSchema });
export const itemIdParamsSchema = z.strictObject({ itemId: uuidSchema });
export const deleteItemQuerySchema = z.strictObject({ expectedRevision: z.coerce.number().int().positive() });
export const listItemsQuerySchema = z.strictObject({
  listId: uuidSchema.optional(),
  groupId: z.union([uuidSchema, z.literal("ungrouped")]).optional(),
  parentTaskId: z.union([uuidSchema, z.literal("top-level")]).optional(),
  status: taskStatusSchema.optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const taskEventSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  taskId: uuidSchema,
  eventType: z.string().min(1),
  actorType: z.enum(["user", "system"]),
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
  dedupeKey: z.string().nullable(),
});

export const itemPageSchema = z.strictObject({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
});

export const taskEventPageSchema = z.strictObject({
  items: z.array(taskEventSchema),
  nextCursor: z.string().nullable(),
});

export type ItemDto = z.infer<typeof itemSchema>;
export type CreateItemBody = z.infer<typeof createItemBodySchema>;
export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;
