import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.js";

export type TimeFriendDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: TimeFriendDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle({ client: pool, schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
