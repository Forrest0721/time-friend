import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { TimeFriendDatabase } from "./client.js";

export function runMigrations(database: TimeFriendDatabase, migrationsFolder: string): Promise<void> {
  return migrate(database, { migrationsFolder });
}
