import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, entityId, updatedAtColumn, userIdColumn } from "./common.js";
import { users } from "./identity.js";
import { items } from "./items.js";

export const focusModeEnum = pgEnum("focus_mode", ["pomodoro", "stopwatch"]);
export const focusStateEnum = pgEnum("focus_state", [
  "running",
  "paused",
  "awaiting_feedback",
  "completed",
  "canceled",
  "needs_attention",
]);
export const focusSegmentCloseReasonEnum = pgEnum("focus_segment_close_reason", [
  "pause",
  "finish",
  "pomodoro_elapsed",
  "limit",
  "cancel",
]);
export const progressSourceEnum = pgEnum("progress_source", ["focus_end", "manual"]);
export const progressOutcomeEnum = pgEnum("progress_outcome", ["completed", "progressed", "blocked", "maintenance", "note"]);

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: entityId(),
    userId: userIdColumn(),
    taskId: uuid("task_id"),
    mode: focusModeEnum("mode").notNull(),
    state: focusStateEnum("state").notNull(),
    plannedSeconds: integer("planned_seconds"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    expectedEndAt: timestamp("expected_end_at", { withTimezone: true, mode: "date" }),
    baseActiveSeconds: integer("base_active_seconds").notNull().default(0),
    effectiveSeconds: integer("effective_seconds"),
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "focus_sessions_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.taskId], foreignColumns: [items.userId, items.id], name: "focus_sessions_task_fk" }).onDelete(
      "restrict",
    ),
    unique("focus_sessions_user_id_id_unique").on(table.userId, table.id),
    uniqueIndex("focus_sessions_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.state} IN ('running', 'paused', 'needs_attention') AND ${table.deletedAt} IS NULL`),
    check(
      "focus_sessions_mode_plan_valid",
      sql`(${table.mode} = 'pomodoro' AND ${table.plannedSeconds} BETWEEN 60 AND 43200)
        OR (${table.mode} = 'stopwatch' AND ${table.plannedSeconds} IS NULL)`,
    ),
    check("focus_sessions_base_seconds_valid", sql`${table.baseActiveSeconds} >= 0`),
    check("focus_sessions_effective_seconds_valid", sql`${table.effectiveSeconds} IS NULL OR ${table.effectiveSeconds} BETWEEN 0 AND 86400`),
    check(
      "focus_sessions_terminal_fields_valid",
      sql`(${table.state} IN ('running', 'paused', 'needs_attention') AND ${table.endedAt} IS NULL AND ${table.effectiveSeconds} IS NULL)
        OR (${table.state} IN ('awaiting_feedback', 'completed') AND ${table.endedAt} IS NOT NULL AND ${table.effectiveSeconds} IS NOT NULL)
        OR (${table.state} = 'canceled' AND ${table.endedAt} IS NOT NULL AND ${table.effectiveSeconds} IS NULL)`,
    ),
    check(
      "focus_sessions_expected_end_valid",
      sql`${table.expectedEndAt} IS NULL OR (${table.state} = 'running' AND ${table.expectedEndAt} > ${table.startedAt})`,
    ),
    check("focus_sessions_deleted_terminal_only", sql`${table.deletedAt} IS NULL OR ${table.state} IN ('completed', 'canceled')`),
    index("focus_sessions_user_started_idx").on(table.userId, table.startedAt),
    index("focus_sessions_user_task_started_idx").on(table.userId, table.taskId, table.startedAt),
  ],
);

export const focusSegments = pgTable(
  "focus_segments",
  {
    id: entityId(),
    userId: userIdColumn(),
    sessionId: uuid("session_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    closeReason: focusSegmentCloseReasonEnum("close_reason"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "focus_segments_user_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [focusSessions.userId, focusSessions.id],
      name: "focus_segments_session_fk",
    }).onDelete("cascade"),
    uniqueIndex("focus_segments_one_open_per_session").on(table.sessionId).where(sql`${table.endedAt} IS NULL`),
    check(
      "focus_segments_close_fields_valid",
      sql`(${table.endedAt} IS NULL AND ${table.closeReason} IS NULL)
        OR (${table.endedAt} IS NOT NULL AND ${table.closeReason} IS NOT NULL AND ${table.endedAt} >= ${table.startedAt})`,
    ),
    index("focus_segments_user_session_started_idx").on(table.userId, table.sessionId, table.startedAt),
  ],
);

export const focusAdjustments = pgTable(
  "focus_adjustments",
  {
    id: entityId(),
    userId: userIdColumn(),
    sessionId: uuid("session_id").notNull(),
    beforeSeconds: integer("before_seconds").notNull(),
    afterSeconds: integer("after_seconds").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "focus_adjustments_user_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [focusSessions.userId, focusSessions.id],
      name: "focus_adjustments_session_fk",
    }).onDelete("cascade"),
    check("focus_adjustments_seconds_valid", sql`${table.beforeSeconds} BETWEEN 0 AND 86400 AND ${table.afterSeconds} BETWEEN 0 AND 86400`),
    check("focus_adjustments_reason_not_blank", sql`length(btrim(${table.reason})) > 0`),
    index("focus_adjustments_user_session_created_idx").on(table.userId, table.sessionId, table.createdAt),
  ],
);

export const progressEntries = pgTable(
  "progress_entries",
  {
    id: entityId(),
    userId: userIdColumn(),
    taskId: uuid("task_id"),
    focusSessionId: uuid("focus_session_id"),
    source: progressSourceEnum("source").notNull(),
    outcome: progressOutcomeEnum("outcome").notNull(),
    note: text("note"),
    nextStep: text("next_step"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: updatedAtColumn(),
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "progress_entries_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.taskId], foreignColumns: [items.userId, items.id], name: "progress_entries_task_fk" }).onDelete(
      "restrict",
    ),
    foreignKey({
      columns: [table.userId, table.focusSessionId],
      foreignColumns: [focusSessions.userId, focusSessions.id],
      name: "progress_entries_focus_session_fk",
    }).onDelete("restrict"),
    check(
      "progress_entries_source_valid",
      sql`(${table.source} = 'manual' AND ${table.taskId} IS NOT NULL AND ${table.focusSessionId} IS NULL AND ${table.outcome} <> 'completed')
        OR (${table.source} = 'focus_end' AND ${table.focusSessionId} IS NOT NULL AND ${table.outcome} <> 'note')`,
    ),
    check("progress_entries_note_valid", sql`${table.outcome} <> 'note' OR (${table.note} IS NOT NULL AND length(btrim(${table.note})) > 0)`),
    index("progress_entries_user_task_occurred_idx").on(table.userId, table.taskId, table.occurredAt),
    index("progress_entries_user_occurred_idx").on(table.userId, table.occurredAt),
    index("progress_entries_user_session_idx").on(table.userId, table.focusSessionId),
    uniqueIndex("progress_entries_one_per_focus_session")
      .on(table.userId, table.focusSessionId)
      .where(sql`${table.focusSessionId} IS NOT NULL`),
  ],
);
