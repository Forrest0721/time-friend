import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, entityId, updatedAtColumn, userIdColumn } from "./common.js";
import { users } from "./identity.js";

export const learningPolicyEnum = pgEnum("learning_policy", ["include", "exclude"]);

export const folders = pgTable(
  "folders",
  {
    id: entityId(),
    userId: userIdColumn(),
    name: text("name").notNull(),
    positionKey: text("position_key").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "folders_user_fk" }).onDelete("cascade"),
    unique("folders_user_id_id_unique").on(table.userId, table.id),
    index("folders_user_position_idx").on(table.userId, table.positionKey),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: entityId(),
    userId: userIdColumn(),
    folderId: uuid("folder_id"),
    name: text("name").notNull(),
    positionKey: text("position_key").notNull(),
    isInbox: boolean("is_inbox").notNull().default(false),
    learningPolicy: learningPolicyEnum("learning_policy").notNull().default("include"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "lists_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.folderId], foreignColumns: [folders.userId, folders.id], name: "lists_folder_fk" }).onDelete("restrict"),
    unique("lists_user_id_id_unique").on(table.userId, table.id),
    uniqueIndex("lists_one_active_inbox_per_user")
      .on(table.userId)
      .where(sql`${table.isInbox} = true AND ${table.archivedAt} IS NULL`),
    check("lists_inbox_has_no_folder", sql`NOT (${table.isInbox} AND ${table.folderId} IS NOT NULL)`),
    index("lists_user_folder_position_idx").on(table.userId, table.folderId, table.positionKey),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: entityId(),
    userId: userIdColumn(),
    listId: uuid("list_id").notNull(),
    name: text("name").notNull(),
    positionKey: text("position_key").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "groups_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.listId], foreignColumns: [lists.userId, lists.id], name: "groups_list_fk" }).onDelete("cascade"),
    unique("groups_user_id_id_unique").on(table.userId, table.id),
    unique("groups_user_list_id_unique").on(table.userId, table.listId, table.id),
    index("groups_user_list_position_idx").on(table.userId, table.listId, table.positionKey),
  ],
);
