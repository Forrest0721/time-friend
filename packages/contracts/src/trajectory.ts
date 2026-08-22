import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common.js";

const localDateSchema = z.iso.date();

export const periodFactsSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  focus: z.strictObject({
    totalSeconds: z.int().nonnegative(),
    sessionCount: z.int().nonnegative(),
    pomodoroCount: z.int().nonnegative(),
    unlinkedSeconds: z.int().nonnegative(),
    byList: z.array(
      z.strictObject({
        listId: uuidSchema,
        listName: z.string().min(1),
        seconds: z.int().nonnegative(),
      }),
    ),
  }),
  progress: z.strictObject({
    completed: z.int().nonnegative(),
    progressed: z.int().nonnegative(),
    blocked: z.int().nonnegative(),
    maintenance: z.int().nonnegative(),
  }),
  tasks: z.strictObject({
    completedIds: z.array(uuidSchema),
    abandonedIds: z.array(uuidSchema),
    plannedButUnfinishedIds: z.array(uuidSchema),
  }),
  dataQuality: z.strictObject({
    evidenceCount: z.int().nonnegative(),
    unlinkedFocusRatio: z.number().min(0).max(1),
    hasEnoughData: z.boolean(),
  }),
});

export const periodSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  kind: z.literal("week"),
  timezone: z.string().min(1).max(100),
  localStartDate: localDateSchema,
  localEndDate: localDateSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const snapshotEntityIndexSchema = z.strictObject({
  taskIds: z.array(uuidSchema),
  focusSessionIds: z.array(uuidSchema),
  progressEntryIds: z.array(uuidSchema),
  taskEventIds: z.array(uuidSchema),
});

export const periodSnapshotSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  periodId: uuidSchema,
  version: z.int().positive(),
  status: z.enum(["current", "stale", "superseded"]),
  sourceWatermark: isoDateTimeSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.literal("1"),
  metrics: periodFactsSchema,
  entityIndex: snapshotEntityIndexSchema,
  createdAt: isoDateTimeSchema,
});

export const trajectoryWeekSummarySchema = z.strictObject({
  period: periodSchema,
  snapshots: z.array(periodSnapshotSchema),
});

export const agentRunSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  periodSnapshotId: uuidSchema,
  workflowName: z.literal("trajectory.weekly-review.v1"),
  workflowVersion: z.literal("1"),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.literal("1"),
  outputSchemaVersion: z.literal("1"),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  forceLowData: z.boolean(),
  status: z.enum(["waiting_for_data", "queued", "running", "validating", "succeeded", "failed"]),
  sdkTraceId: z.string().nullable(),
  inputTokens: z.int().nonnegative().nullable(),
  outputTokens: z.int().nonnegative().nullable(),
  durationMs: z.int().nonnegative().nullable(),
  attempts: z.int().nonnegative(),
  errorCode: z.string().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const evidenceRefSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  claimId: uuidSchema,
  entityType: z.enum(["task", "focus_session", "progress_entry", "task_event", "memory"]),
  entityId: uuidSchema,
  role: z.enum(["supports", "contradicts", "context"]),
  excerpt: z.string().nullable(),
  excludedAt: isoDateTimeSchema.nullable(),
  exclusionReason: z.string().nullable(),
});

export const evidenceIdParamsSchema = z.strictObject({ evidenceId: uuidSchema });
export const excludeEvidenceBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  remember: z.boolean().default(false),
});

export const memoryCandidateSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  reviewClaimId: uuidSchema,
  memoryType: z.enum(["direction", "mapping", "classification", "preference", "exclusion"]),
  proposedValue: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "confirmed", "rejected", "expired"]),
});

export const reviewClaimSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  reviewVersionId: uuidSchema,
  claimType: z.enum(["direction", "progress", "deviation", "blocker", "pattern"]),
  statement: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  status: z.enum(["pending", "accepted", "edited", "rejected"]),
  userRevision: z.string().nullable(),
  position: z.int().nonnegative(),
  proposedDirection: z
    .strictObject({
      name: z.string().min(1),
      relation: z.enum(["direct", "support", "maintenance", "exploration", "unrelated"]),
    })
    .nullable(),
  evidence: z.array(evidenceRefSchema),
  memoryCandidate: memoryCandidateSchema.nullable(),
});

export const reviewVersionSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  periodId: uuidSchema,
  snapshotId: uuidSchema,
  agentRunId: uuidSchema,
  version: z.int().positive(),
  status: z.enum(["pending", "partially_confirmed", "confirmed", "superseded"]),
  limitations: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
});

export const commitmentSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  sourceReviewId: uuidSchema,
  targetPeriodId: uuidSchema.nullable(),
  title: z.string().min(1),
  reason: z.string(),
  evidenceIds: z.array(uuidSchema),
  status: z.enum(["proposed", "confirmed", "paused", "dropped", "completed"]),
  position: z.int().nonnegative(),
  revision: z.int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const weeklyReviewViewSchema = z.strictObject({
  run: agentRunSchema,
  review: reviewVersionSchema.nullable(),
  claims: z.array(reviewClaimSchema),
  commitments: z.array(commitmentSchema),
});

export const trajectoryWeekSchema = trajectoryWeekSummarySchema.extend({
  review: weeklyReviewViewSchema.nullable(),
});

export const trajectoryWeeksQuerySchema = z.strictObject({
  beforeStartsAt: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const trajectoryWeekPageSchema = z.strictObject({
  items: z.array(trajectoryWeekSummarySchema),
  nextCursor: isoDateTimeSchema.nullable(),
});

export const periodIdParamsSchema = z.strictObject({ periodId: uuidSchema });
export const agentRunIdParamsSchema = z.strictObject({ runId: uuidSchema });
export const generateTrajectoryReviewBodySchema = z.strictObject({ forceLowData: z.boolean().default(false) });
export const reviewClaimIdParamsSchema = z.strictObject({ claimId: uuidSchema });
export const reviewIdParamsSchema = z.strictObject({ reviewId: uuidSchema });
export const memoryIdParamsSchema = z.strictObject({ memoryId: uuidSchema });
export const commitmentIdParamsSchema = z.strictObject({ commitmentId: uuidSchema });

const memoryValueSchema = z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, "记忆内容不能为空");
export const acceptReviewClaimBodySchema = z.strictObject({
  remember: z.boolean().default(false),
  memoryValue: memoryValueSchema.optional(),
});
export const editReviewClaimBodySchema = z.strictObject({
  userRevision: z.string().trim().min(1).max(2_000),
  remember: z.boolean().default(false),
  memoryValue: memoryValueSchema.optional(),
});
export const rejectReviewClaimBodySchema = z.strictObject({});
export const confirmReviewBodySchema = z.strictObject({});

export const confirmedMemorySchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  memoryType: z.enum(["direction", "mapping", "classification", "preference", "exclusion", "direction_state"]),
  value: memoryValueSchema,
  sourceCandidateId: uuidSchema.nullable(),
  sourceReviewId: uuidSchema,
  effectiveFrom: isoDateTimeSchema,
  effectiveTo: isoDateTimeSchema.nullable(),
  status: z.enum(["active", "superseded", "deleted"]),
  revision: z.int().positive(),
  supersedesId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export const memoriesQuerySchema = z.strictObject({ status: z.enum(["active", "all"]).default("active") });
export const memoryPageSchema = z.strictObject({ items: z.array(confirmedMemorySchema) });
export const updateMemoryBodySchema = z.strictObject({ value: memoryValueSchema, expectedRevision: z.int().positive() });
export const memoryCommandBodySchema = z.strictObject({ expectedRevision: z.int().positive() });
export const memoryDeleteQuerySchema = z.strictObject({ expectedRevision: z.coerce.number().int().positive() });

export const directionSchema = z.strictObject({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1),
  description: z.string(),
  state: z.enum(["candidate", "active", "paused", "ended", "replaced"]),
  createdFromReviewId: uuidSchema,
  revision: z.int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export const directionIdParamsSchema = z.strictObject({ directionId: uuidSchema });
export const directionsQuerySchema = z.strictObject({ state: z.enum(["active", "all"]).default("active") });
export const directionPageSchema = z.strictObject({ items: z.array(directionSchema) });
export const updateDirectionBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(2_000).optional(),
    state: z.enum(["candidate", "active", "paused", "ended", "replaced"]).optional(),
    expectedRevision: z.int().positive(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined || value.state !== undefined, "至少修改一个方向字段");

export const createCommitmentBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  reason: z.string().trim().max(2_000).optional(),
});
export const updateCommitmentBodySchema = z
  .strictObject({
    title: z.string().trim().min(1).max(500).optional(),
    reason: z.string().trim().max(2_000).optional(),
    expectedRevision: z.int().positive(),
  })
  .refine((value) => value.title !== undefined || value.reason !== undefined, "至少修改一个字段");
export const commitmentCommandBodySchema = z.strictObject({ expectedRevision: z.int().positive() });

export type PeriodFactsDto = z.infer<typeof periodFactsSchema>;
export type PeriodSnapshotDto = z.infer<typeof periodSnapshotSchema>;
export type AgentRunDto = z.infer<typeof agentRunSchema>;
export type WeeklyReviewViewDto = z.infer<typeof weeklyReviewViewSchema>;
