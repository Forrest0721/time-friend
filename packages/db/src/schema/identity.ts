import { boolean, check, foreignKey, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { createdAtColumn, updatedAtColumn } from "./common.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    weekStartsOn: smallint("week_starts_on").notNull().default(1),
    agentEnabled: boolean("agent_enabled").notNull().default(true),
    frozenAt: timestamp("frozen_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_week_starts_on_monday", sql`${table.weekStartsOn} = 1`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "sessions_user_fk" }).onDelete("cascade"),
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_expires_idx").on(table.userId, table.expiresAt),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "accounts_user_fk" }).onDelete("cascade"),
    uniqueIndex("accounts_issuer_account_id_unique").on(table.issuer, table.accountId),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);
