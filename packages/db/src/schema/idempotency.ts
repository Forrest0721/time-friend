import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAtColumn, entityId, userIdColumn } from "./common.js";
import { users } from "./identity.js";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: entityId(),
    userId: userIdColumn(),
    idempotencyKey: text("idempotency_key").notNull(),
    routeKey: text("route_key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    responseJson: jsonb("response_json").$type<unknown>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "idempotency_user_fk" }).onDelete("cascade"),
    uniqueIndex("idempotency_user_route_key_unique").on(table.userId, table.routeKey, table.idempotencyKey),
    index("idempotency_expires_at_idx").on(table.expiresAt),
  ],
);
