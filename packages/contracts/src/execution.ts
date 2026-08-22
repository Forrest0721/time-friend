import { z } from "zod";

import { isoDateTimeSchema, revisionSchema, uuidSchema } from "./common.js";
import { itemSchema } from "./items.js";

export const focusModeSchema = z.enum(["pomodoro", "stopwatch"]);
export const focusStateSchema = z.enum(["running", "paused", "awaiting_feedback", "completed", "canceled", "needs_attention"]);
export const focusOutcomeSchema = z.enum(["completed", "progressed", "blocked", "maintenance"]);
export const progressOutcomeSchema = z.enum(["completed", "progressed", "blocked", "maintenance", "note"]);

export const focusSessionSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  taskId: uuidSchema.nullable(),
  mode: focusModeSchema,
  state: focusStateSchema,
  plannedSeconds: z.int().min(60).max(43_200).nullable(),
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.nullable(),
  expectedEndAt: isoDateTimeSchema.nullable(),
  baseActiveSeconds: z.int().nonnegative(),
  effectiveSeconds: z.int().min(0).max(86_400).nullable(),
  revision: revisionSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const focusSegmentSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  sessionId: uuidSchema,
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.nullable(),
  closeReason: z.enum(["pause", "finish", "pomodoro_elapsed", "limit", "cancel"]).nullable(),
  createdAt: isoDateTimeSchema,
});

export const focusSessionViewSchema = z.strictObject({
  session: focusSessionSchema,
  openSegment: focusSegmentSchema.nullable(),
  serverNow: isoDateTimeSchema,
});

export const progressEntrySchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  taskId: uuidSchema.nullable(),
  focusSessionId: uuidSchema.nullable(),
  source: z.enum(["focus_end", "manual"]),
  outcome: progressOutcomeSchema,
  note: z.string().max(2_000).nullable(),
  nextStep: z.string().max(1_000).nullable(),
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  revision: revisionSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createFocusBodySchema = z
  .strictObject({
    id: uuidSchema.optional(),
    taskId: uuidSchema.nullable().optional(),
    mode: focusModeSchema,
    plannedSeconds: z.int().min(60).max(43_200).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "stopwatch" && value.plannedSeconds != null) {
      context.addIssue({ code: "custom", path: ["plannedSeconds"], message: "正计时不能设置计划时长" });
    }
  });

export const focusCommandBodySchema = z.strictObject({ expectedRevision: revisionSchema });
export const focusSessionIdParamsSchema = z.strictObject({ sessionId: uuidSchema });
export const progressIdParamsSchema = z.strictObject({ progressId: uuidSchema });

export const focusFeedbackBodySchema = z
  .strictObject({
    outcome: focusOutcomeSchema.nullable(),
    note: z.string().trim().max(2_000).nullable().optional(),
    nextStep: z.string().trim().max(1_000).nullable().optional(),
    completeTask: z.boolean().default(false),
    effectiveSeconds: z.int().min(0).max(86_400).optional(),
    adjustmentReason: z.string().trim().min(1).max(500).optional(),
    expectedRevision: revisionSchema,
  })
  .superRefine((value, context) => {
    if (value.completeTask && value.outcome !== "completed") {
      context.addIssue({ code: "custom", path: ["completeTask"], message: "只有完成反馈才能同时完成任务" });
    }
    if (value.effectiveSeconds !== undefined && value.adjustmentReason === undefined) {
      context.addIssue({ code: "custom", path: ["adjustmentReason"], message: "修正时长时必须填写原因" });
    }
    if (value.outcome === null && (value.note || value.nextStep || value.completeTask)) {
      context.addIssue({ code: "custom", path: ["outcome"], message: "跳过反馈时不能提交进展字段" });
    }
  });

export const focusFeedbackResultSchema = z.strictObject({
  session: focusSessionSchema,
  progress: progressEntrySchema.nullable(),
  task: itemSchema.nullable(),
});

export const adjustFocusBodySchema = z.strictObject({
  effectiveSeconds: z.int().min(0).max(86_400),
  reason: z.string().trim().min(1).max(500),
  expectedRevision: revisionSchema,
});

export const retargetFocusBodySchema = z.strictObject({ taskId: uuidSchema.nullable(), expectedRevision: revisionSchema });
export const deleteFocusQuerySchema = z.strictObject({ expectedRevision: z.coerce.number().int().positive() });
export const focusSessionsQuerySchema = z
  .strictObject({
    taskId: uuidSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from >= value.to) {
      context.addIssue({ code: "custom", path: ["to"], message: "to 必须晚于 from" });
    }
  });

export const focusRecordSchema = z.strictObject({ session: focusSessionSchema, progress: progressEntrySchema.nullable() });
export const focusSessionPageSchema = z.strictObject({ items: z.array(focusRecordSchema), nextCursor: z.string().nullable() });

export const taskExecutionSummarySchema = z.strictObject({
  totalFocusSeconds: z.int().nonnegative(),
  sessionCount: z.int().nonnegative(),
  pomodoroCount: z.int().nonnegative(),
  recentProgress: z.array(progressEntrySchema).max(10),
});

export const createManualProgressBodySchema = z.strictObject({
  id: uuidSchema.optional(),
  outcome: z.enum(["progressed", "blocked", "maintenance", "note"]),
  note: z.string().trim().max(2_000).nullable().optional(),
  nextStep: z.string().trim().max(1_000).nullable().optional(),
});

export const updateProgressBodySchema = z.strictObject({
  outcome: progressOutcomeSchema.optional(),
  note: z.string().trim().max(2_000).nullable().optional(),
  nextStep: z.string().trim().max(1_000).nullable().optional(),
  expectedRevision: revisionSchema,
});

export const deleteProgressQuerySchema = z.strictObject({ expectedRevision: z.coerce.number().int().positive() });
export const progressPageSchema = z.strictObject({ items: z.array(progressEntrySchema), nextCursor: z.string().nullable() });

export type FocusSessionDto = z.infer<typeof focusSessionSchema>;
export type ProgressEntryDto = z.infer<typeof progressEntrySchema>;
