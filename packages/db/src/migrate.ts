import { createDatabaseClient } from "./client.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const client = createDatabaseClient(connectionString);
try {
  await runMigrations(client.db, new URL("../migrations", import.meta.url).pathname);
} finally {
  await client.close();
}
