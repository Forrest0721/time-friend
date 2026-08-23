import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { PeriodFacts, SnapshotEntityIndex } from "@time-friend/domain";

import { createdAtColumn, entityId, userIdColumn } from "./common.js";
import { users } from "./identity.js";

export const periodKindEnum = pgEnum("period_kind", ["week", "month", "year"]);
export const periodSnapshotStatusEnum = pgEnum("period_snapshot_status", ["current", "stale", "superseded"]);
export const evidenceEntityTypeEnum = pgEnum("evidence_entity_type", ["task", "focus_session", "progress_entry", "task_event", "memory"]);

export const periods = pgTable(
  "periods",
  {
    id: entityId(),
    userId: userIdColumn(),
    kind: periodKindEnum("kind").notNull(),
    timezone: text("timezone").notNull(),
    localStartDate: date("local_start_date", { mode: "string" }).notNull(),
    localEndDate: date("local_end_date", { mode: "string" }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "periods_user_fk" }).onDelete("cascade"),
    unique("periods_user_id_id_unique").on(table.userId, table.id),
    unique("periods_identity_unique").on(table.userId, table.kind, table.startsAt, table.timezone),
    check("periods_bounds_valid", sql`${table.startsAt} < ${table.endsAt} AND ${table.localStartDate} <= ${table.localEndDate}`),
    check("periods_v1_week_only", sql`${table.kind} = 'week'`),
    index("periods_user_starts_idx").on(table.userId, table.startsAt),
  ],
);

export const periodSnapshots = pgTable(
  "period_snapshots",
  {
    id: entityId(),
    userId: userIdColumn(),
    periodId: uuid("period_id").notNull(),
    version: integer("version").notNull(),
    status: periodSnapshotStatusEnum("status").notNull(),
    sourceWatermark: timestamp("source_watermark", { withTimezone: true, mode: "date" }).notNull(),
    inputHash: text("input_hash").notNull(),
    schemaVersion: text("schema_version").notNull(),
    metricsJson: jsonb("metrics_json").$type<PeriodFacts>().notNull(),
    entityIndexJson: jsonb("entity_index_json").$type<SnapshotEntityIndex>().notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "period_snapshots_user_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.periodId],
      foreignColumns: [periods.userId, periods.id],
      name: "period_snapshots_period_fk",
    }).onDelete("cascade"),
    unique("period_snapshots_user_id_id_unique").on(table.userId, table.id),
    unique("period_snapshots_period_version_unique").on(table.periodId, table.version),
    unique("period_snapshots_period_hash_unique").on(table.periodId, table.inputHash),
    uniqueIndex("period_snapshots_one_current_per_period").on(table.periodId).where(sql`${table.status} = 'current'`),
    check("period_snapshots_version_valid", sql`${table.version} > 0`),
    index("period_snapshots_user_period_created_idx").on(table.userId, table.periodId, table.createdAt),
  ],
);

export const snapshotEvidence = pgTable(
  "snapshot_evidence",
  {
    id: entityId(),
    userId: userIdColumn(),
    snapshotId: uuid("snapshot_id").notNull(),
    entityType: evidenceEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    taskId: uuid("task_id"),
    listId: uuid("list_id"),
    metricsJson: jsonb("metrics_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "snapshot_evidence_user_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.snapshotId],
      foreignColumns: [periodSnapshots.userId, periodSnapshots.id],
      name: "snapshot_evidence_snapshot_fk",
    }).onDelete("cascade"),
    unique("snapshot_evidence_snapshot_entity_unique").on(table.snapshotId, table.entityType, table.entityId),
    check("snapshot_evidence_no_memory", sql`${table.entityType} <> 'memory'`),
    index("snapshot_evidence_user_snapshot_idx").on(table.userId, table.snapshotId, table.occurredAt),
  ],
);
