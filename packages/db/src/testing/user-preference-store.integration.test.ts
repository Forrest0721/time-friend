import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { UserPreferenceService } from "@time-friend/domain";

import { createDatabaseClient, type DatabaseClient } from "../client.js";
import { runMigrations } from "../migrations.js";
import { PostgresUserPreferenceStore } from "../repositories/user-preference-store.js";
import { users } from "../schema/index.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";

describe("PostgresUserPreferenceStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let service: UserPreferenceService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await runMigrations(client.db, new URL("../../migrations", import.meta.url).pathname);
    service = new UserPreferenceService({
      store: new PostgresUserPreferenceStore(client.db),
      clock: { now: () => new Date("2026-10-09T08:00:00.000Z") },
    });
  });

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE users CASCADE`);
    await client.db.insert(users).values([
      { id: USER_A, email: "settings-a@example.com", name: "A" },
      { id: USER_B, email: "settings-b@example.com", name: "B", timezone: "Europe/London", weekStartsOn: 6 },
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("persists every supported week boundary without changing another user", async () => {
    const first = await service.updateDateTimePreferences(USER_A, { timezone: "America/New_York", weekStartsOn: 0 }, 1);
    const second = await service.updateDateTimePreferences(USER_A, { weekStartsOn: 6 }, first.revision);

    expect(first).toMatchObject({ timezone: "America/New_York", weekStartsOn: 0, revision: 2 });
    expect(second).toMatchObject({ weekStartsOn: 6, revision: 3 });
    await expect(client.db.select({ timezone: users.timezone, weekStartsOn: users.weekStartsOn }).from(users).orderBy(users.id))
      .resolves.toEqual([
        { timezone: "America/New_York", weekStartsOn: 6 },
        { timezone: "Europe/London", weekStartsOn: 6 },
      ]);
  });

  it("allows only one writer for the same settings revision", async () => {
    const results = await Promise.allSettled([
      service.updateDateTimePreferences(USER_A, { weekStartsOn: 0 }, 1),
      service.updateDateTimePreferences(USER_A, { weekStartsOn: 6 }, 1),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "REVISION_CONFLICT" }) }),
    ]);
  });
});
