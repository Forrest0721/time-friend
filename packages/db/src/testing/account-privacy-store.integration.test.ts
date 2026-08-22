import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccountPrivacyService } from "@time-friend/domain";

import { createDatabaseClient, type DatabaseClient } from "../client.js";
import {
  PostgresAccountPrivacyStore,
  type AccountDeletionJobScheduler,
} from "../repositories/account-privacy-store.js";
import { accountDeletionRequests, items, lists, sessions, users } from "../schema/index.js";
import { PostgresTransactionContext } from "../transaction-context.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";
const LIST_A = "00000000-0000-7000-8000-000000000011";
const LIST_B = "00000000-0000-7000-8000-000000000012";
const TASK_A = "00000000-0000-7000-8000-000000000021";
const TASK_B = "00000000-0000-7000-8000-000000000022";

describe("PostgresAccountPrivacyStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let scheduled: string[];
  let service: AccountPrivacyService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await migrate(client.db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE account_deletion_requests, users CASCADE`);
    await client.db.insert(users).values([
      { id: USER_A, email: "privacy-a@example.com", name: "A", timezone: "Asia/Shanghai" },
      { id: USER_B, email: "privacy-b@example.com", name: "B", timezone: "Asia/Shanghai" },
    ]);
    await client.db.insert(lists).values([
      { id: LIST_A, userId: USER_A, name: "A 的私有清单", positionKey: "a0" },
      { id: LIST_B, userId: USER_B, name: "B 的私有清单", positionKey: "a0" },
    ]);
    await client.db.insert(items).values([
      {
        id: TASK_A,
        userId: USER_A,
        listId: LIST_A,
        kind: "task",
        title: "A 的私有任务",
        status: "pending",
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        contentText: "A 的私有正文",
        positionKey: "a0",
      },
      {
        id: TASK_B,
        userId: USER_B,
        listId: LIST_B,
        kind: "task",
        title: "B 的私有任务",
        status: "pending",
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        contentText: "B 的私有正文",
        positionKey: "a0",
      },
    ]);
    await client.db.insert(sessions).values({
      id: randomUUID(),
      userId: USER_A,
      token: "privacy-session-a",
      expiresAt: new Date("2026-09-22T08:00:00.000Z"),
    });
    scheduled = [];
    const scheduler: AccountDeletionJobScheduler = {
      async schedule(_transaction, requestId) {
        scheduled.push(requestId);
      },
    };
    service = new AccountPrivacyService({
      store: new PostgresAccountPrivacyStore(client.db, new PostgresTransactionContext(), scheduler),
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
      ids: { next: randomUUID },
    });
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("exports a tenant-scoped portable archive without authentication secrets", async () => {
    const exported = await service.exportData(USER_A);

    expect(exported.profile).toMatchObject({ id: USER_A, email: "privacy-a@example.com" });
    expect(exported.data.items).toEqual([expect.objectContaining({ id: TASK_A, title: "A 的私有任务" })]);
    expect(JSON.stringify(exported)).not.toContain("privacy-session-a");
    expect(JSON.stringify(exported)).not.toContain("B 的私有");
  });

  it("revokes sessions immediately and leaves only a content-free receipt after erasure", async () => {
    const requested = await service.requestDeletion(USER_A);

    expect(scheduled).toEqual([requested.id]);
    await expect(client.db.select().from(sessions).where(eq(sessions.userId, USER_A))).resolves.toEqual([]);
    await expect(client.db.select().from(users).where(eq(users.id, USER_A))).resolves.toEqual([
      expect.objectContaining({ frozenAt: new Date("2026-08-22T08:00:00.000Z"), agentEnabled: false }),
    ]);

    const completed = await service.executeDeletion(requested.id);
    expect(completed).toMatchObject({ status: "completed", userId: null });
    await expect(client.db.select().from(users).where(eq(users.id, USER_A))).resolves.toEqual([]);
    await expect(client.db.select().from(items).where(eq(items.userId, USER_A))).resolves.toEqual([]);
    await expect(client.db.select().from(users).where(eq(users.id, USER_B))).resolves.toHaveLength(1);
    await expect(client.db.select().from(items).where(eq(items.userId, USER_B))).resolves.toHaveLength(1);
    await expect(client.db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, requested.id))).resolves.toEqual([
      expect.objectContaining({ userId: null, status: "completed", errorCode: null }),
    ]);
  });
});
