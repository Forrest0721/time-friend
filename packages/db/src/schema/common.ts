import { timestamp, uuid } from "drizzle-orm/pg-core";

export const entityId = (name = "id") => uuid(name).primaryKey();
export const userIdColumn = () => uuid("user_id").notNull();
export const createdAtColumn = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
export const updatedAtColumn = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
