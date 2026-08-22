import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { ContentDocument } from "@time-friend/domain";

import { createdAtColumn, entityId, updatedAtColumn, userIdColumn } from "./common.js";
import { users } from "./identity.js";
import { groups, lists } from "./organization.js";

export const itemKindEnum = pgEnum("item_kind", ["task", "note"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "completed", "abandoned"]);
export const taskEventActorEnum = pgEnum("task_event_actor", ["user", "system"]);

export const items = pgTable(
  "items",
  {
    id: entityId(),
    userId: userIdColumn(),
    listId: uuid("list_id").notNull(),
    groupId: uuid("group_id"),
    parentTaskId: uuid("parent_task_id"),
    kind: itemKindEnum("kind").notNull(),
    title: text("title").notNull(),
    status: taskStatusEnum("status"),
    priority: integer("priority"),
    plannedOn: date("planned_on", { mode: "string" }),
    contentDoc: jsonb("content_doc").$type<ContentDocument>().notNull(),
    contentText: text("content_text").notNull().default(""),
    positionKey: text("position_key").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true, mode: "date" }),
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "items_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.listId], foreignColumns: [lists.userId, lists.id], name: "items_list_fk" }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.listId, table.groupId],
      foreignColumns: [groups.userId, groups.listId, groups.id],
      name: "items_group_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.userId, table.listId, table.parentTaskId],
      foreignColumns: [table.userId, table.listId, table.id],
      name: "items_parent_task_fk",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("items_user_id_id_unique").on(table.userId, table.id),
    unique("items_user_list_id_unique").on(table.userId, table.listId, table.id),
    check("items_title_not_blank", sql`length(btrim(${table.title})) > 0`),
    check("items_priority_valid", sql`${table.priority} IS NULL OR ${table.priority} IN (0, 1, 3, 5)`),
    check(
      "items_kind_fields_valid",
      sql`(${table.kind} = 'task' AND ${table.status} IS NOT NULL) OR (${table.kind} = 'note' AND ${table.status} IS NULL AND ${table.priority} IS NULL AND ${table.parentTaskId} IS NULL AND ${table.plannedOn} IS NULL)`,
    ),
    check(
      "items_status_timestamps_valid",
      sql`(${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.abandonedAt} IS NULL)
        OR (${table.status} = 'abandoned' AND ${table.abandonedAt} IS NOT NULL AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'pending' AND ${table.completedAt} IS NULL AND ${table.abandonedAt} IS NULL)
        OR (${table.status} IS NULL AND ${table.completedAt} IS NULL AND ${table.abandonedAt} IS NULL)`,
    ),
    index("items_user_list_group_position_idx").on(table.userId, table.listId, table.groupId, table.positionKey),
    index("items_user_parent_position_idx").on(table.userId, table.parentTaskId, table.positionKey),
    index("items_user_planned_on_idx").on(table.userId, table.plannedOn),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: entityId(),
    userId: userIdColumn(),
    taskId: uuid("task_id").notNull(),
    eventType: text("event_type").notNull(),
    actorType: taskEventActorEnum("actor_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    payload: jsonb("payload").$type<Readonly<Record<string, unknown>>>().notNull(),
    dedupeKey: text("dedupe_key"),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "task_events_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.taskId], foreignColumns: [items.userId, items.id], name: "task_events_task_fk" }).onDelete("cascade"),
    uniqueIndex("task_events_user_dedupe_unique").on(table.userId, table.dedupeKey).where(sql`${table.dedupeKey} IS NOT NULL`),
    index("task_events_user_task_occurred_idx").on(table.userId, table.taskId, table.occurredAt),
    index("task_events_user_occurred_idx").on(table.userId, table.occurredAt),
  ],
);
