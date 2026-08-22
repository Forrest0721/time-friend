import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAtColumn, entityId, updatedAtColumn } from "./common.js";

export const accountDeletionStatusEnum = pgEnum("account_deletion_status", ["queued", "processing", "completed", "failed"]);

export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: entityId(),
    userId: uuid("user_id"),
    subjectHash: text("subject_hash").notNull(),
    status: accountDeletionStatusEnum("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    errorCode: text("error_code"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("account_deletion_requests_active_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL AND ${table.status} IN ('queued', 'processing')`),
    index("account_deletion_requests_status_requested_idx").on(table.status, table.requestedAt),
  ],
);
