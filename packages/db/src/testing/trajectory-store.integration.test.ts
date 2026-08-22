import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import { TrajectoryService } from "@time-friend/domain";

import { createDatabaseClient, type DatabaseClient } from "../client.js";
import { PostgresAutoReviewUserStore } from "../repositories/trajectory-schedule-store.js";
import { PostgresTrajectoryStore } from "../repositories/trajectory-store.js";
import { focusSegments, focusSessions, items, lists, periodSnapshots, progressEntries, snapshotEvidence, users } from "../schema/index.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";
const LIST_INCLUDED = "00000000-0000-7000-8000-000000000011";
const LIST_EXCLUDED = "00000000-0000-7000-8000-000000000012";
const TASK_INCLUDED = "00000000-0000-7000-8000-000000000021";
const TASK_EXCLUDED = "00000000-0000-7000-8000-000000000022";

describe("PostgresTrajectoryStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let service: TrajectoryService;
  let now: Date;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await migrate(client.db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE period_snapshots, periods, progress_entries, focus_segments, focus_sessions, items, lists, users CASCADE`);
    await client.db.insert(users).values([
      { id: USER_A, email: "trajectory-a@example.com", name: "A", timezone: "Asia/Shanghai" },
      { id: USER_B, email: "trajectory-b@example.com", name: "B", timezone: "America/New_York" },
    ]);
    now = new Date("2026-08-22T08:00:00.000Z");
    service = new TrajectoryService({
      store: new PostgresTrajectoryStore(client.db),
      clock: { now: () => new Date(now) },
      ids: { next: uuidv7 },
    });
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("builds an immutable tenant-scoped snapshot and excludes opted-out list data", async () => {
    await seedTrajectoryData();
    const period = await service.ensureCurrentWeek(USER_A);
    const snapshot = await service.generateSnapshot(USER_A, period.id);

    expect(snapshot.metrics.focus).toMatchObject({ totalSeconds: 345, sessionCount: 2, unlinkedSeconds: 300 });
    expect(snapshot.metrics.focus.byList).toEqual([{ listId: LIST_INCLUDED, listName: "产品", seconds: 45 }]);
    expect(snapshot.metrics.progress).toEqual({ completed: 0, progressed: 1, blocked: 0, maintenance: 0 });
    expect(snapshot.entityIndex).toMatchObject({ taskIds: [TASK_INCLUDED] });
    expect(snapshot.entityIndex.focusSessionIds).toHaveLength(2);
    expect(snapshot.metrics.tasks.plannedButUnfinishedIds).toEqual([TASK_INCLUDED]);
    const evidenceRows = await client.db.select().from(snapshotEvidence).where(sql`${snapshotEvidence.snapshotId} = ${snapshot.id}`);
    expect(evidenceRows.some((row) => row.title === "不参与学习")).toBe(false);
    expect(evidenceRows.map((row) => row.entityType).sort()).toEqual(["focus_session", "focus_session", "progress_entry", "task"]);
    await expect(service.getWeek(USER_B, period.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("is idempotent for the same source and versions changed input without overwriting history", async () => {
    await seedTrajectoryData();
    const period = await service.ensureCurrentWeek(USER_A);
    const first = await service.generateSnapshot(USER_A, period.id);
    await expect(service.generateSnapshot(USER_A, period.id)).resolves.toMatchObject({ id: first.id, version: 1 });

    await client.db.insert(progressEntries).values({
      id: uuidv7(),
      userId: USER_A,
      taskId: TASK_INCLUDED,
      source: "manual",
      outcome: "blocked",
      occurredAt: new Date("2026-08-21T07:00:00Z"),
      recordedAt: new Date("2026-08-21T07:00:00Z"),
    });
    const second = await service.generateSnapshot(USER_A, period.id);
    expect(second).toMatchObject({ version: 2, status: "current" });
    expect(first.inputHash).not.toBe(second.inputHash);
    const rows = await client.db.select().from(periodSnapshots).orderBy(periodSnapshots.version);
    expect(rows.map((row) => row.status)).toEqual(["superseded", "current"]);
  });

  it("upserts concurrent period creation and marks only the affected user's current snapshot stale", async () => {
    await seedTrajectoryData();
    const results = await Promise.all([service.ensureCurrentWeek(USER_A), service.ensureCurrentWeek(USER_A)]);
    expect(new Set(results.map((entry) => entry.id))).toHaveProperty("size", 1);
    const snapshot = await service.generateSnapshot(USER_A, results[0]!.id);
    await expect(service.markSnapshotsStale(USER_A, "2026-08-20T08:00:00Z")).resolves.toBe(1);
    await expect(service.markSnapshotsStale(USER_B, "2026-08-20T08:00:00Z")).resolves.toBe(0);
    const [row] = await client.db.select().from(periodSnapshots).where(sql`${periodSnapshots.id} = ${snapshot.id}`);
    expect(row?.status).toBe("stale");
  });

  it("invalidates snapshots by local date, immutable evidence entity, and user scope", async () => {
    await seedTrajectoryData();
    const period = await service.ensureCurrentWeek(USER_A);
    const snapshot = await service.generateSnapshot(USER_A, period.id);

    await expect(service.markSnapshotsContainingEntity(USER_A, "task", TASK_INCLUDED)).resolves.toBe(1);
    await expect(service.generateSnapshot(USER_A, period.id)).resolves.toMatchObject({ id: snapshot.id, status: "current" });
    await expect(service.markSnapshotsStaleForLocalDate(USER_A, "2026-08-20")).resolves.toBe(1);
    await expect(service.generateSnapshot(USER_A, period.id)).resolves.toMatchObject({ id: snapshot.id, status: "current" });
    await expect(service.markSnapshotsContainingEntity(USER_B, "task", TASK_INCLUDED)).resolves.toBe(0);
    await expect(service.markAllSnapshotsStale(USER_A)).resolves.toBe(1);
  });

  it("pages only unfrozen users who enabled automatic reviews", async () => {
    await client.db.update(users).set({ agentEnabled: false }).where(sql`${users.id} = ${USER_B}`);
    const store = new PostgresAutoReviewUserStore(client.db);

    await expect(store.listEnabledUserIds(null, 1)).resolves.toEqual([USER_A]);
    await expect(store.listEnabledUserIds(USER_A, 10)).resolves.toEqual([]);
  });

  async function seedTrajectoryData(): Promise<void> {
    await client.db.insert(lists).values([
      { id: LIST_INCLUDED, userId: USER_A, name: "产品", positionKey: "a0", learningPolicy: "include" },
      { id: LIST_EXCLUDED, userId: USER_A, name: "私人", positionKey: "a1", learningPolicy: "exclude" },
    ]);
    await client.db.insert(items).values([
      {
        id: TASK_INCLUDED,
        userId: USER_A,
        listId: LIST_INCLUDED,
        kind: "task",
        title: "推进轨迹",
        status: "pending",
        plannedOn: "2026-08-20",
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        contentText: "",
        positionKey: "a0",
      },
      {
        id: TASK_EXCLUDED,
        userId: USER_A,
        listId: LIST_EXCLUDED,
        kind: "task",
        title: "不参与学习",
        status: "pending",
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        contentText: "",
        positionKey: "a0",
      },
    ]);
    const includedFocus = uuidv7();
    const excludedFocus = uuidv7();
    const unlinkedFocus = uuidv7();
    await client.db.insert(focusSessions).values([
      {
        id: includedFocus,
        userId: USER_A,
        taskId: TASK_INCLUDED,
        mode: "stopwatch",
        state: "completed",
        startedAt: new Date("2026-08-16T15:59:00Z"),
        endedAt: new Date("2026-08-16T16:01:00Z"),
        baseActiveSeconds: 120,
        effectiveSeconds: 90,
      },
      {
        id: excludedFocus,
        userId: USER_A,
        taskId: TASK_EXCLUDED,
        mode: "pomodoro",
        state: "completed",
        plannedSeconds: 600,
        startedAt: new Date("2026-08-19T06:00:00Z"),
        endedAt: new Date("2026-08-19T06:10:00Z"),
        baseActiveSeconds: 600,
        effectiveSeconds: 600,
      },
      {
        id: unlinkedFocus,
        userId: USER_A,
        taskId: null,
        mode: "stopwatch",
        state: "completed",
        startedAt: new Date("2026-08-20T06:00:00Z"),
        endedAt: new Date("2026-08-20T06:05:00Z"),
        baseActiveSeconds: 300,
        effectiveSeconds: 300,
      },
    ]);
    await client.db.insert(focusSegments).values([
      {
        id: uuidv7(),
        userId: USER_A,
        sessionId: includedFocus,
        startedAt: new Date("2026-08-16T15:59:00Z"),
        endedAt: new Date("2026-08-16T16:01:00Z"),
        closeReason: "finish",
      },
      {
        id: uuidv7(),
        userId: USER_A,
        sessionId: excludedFocus,
        startedAt: new Date("2026-08-19T06:00:00Z"),
        endedAt: new Date("2026-08-19T06:10:00Z"),
        closeReason: "finish",
      },
      {
        id: uuidv7(),
        userId: USER_A,
        sessionId: unlinkedFocus,
        startedAt: new Date("2026-08-20T06:00:00Z"),
        endedAt: new Date("2026-08-20T06:05:00Z"),
        closeReason: "finish",
      },
    ]);
    await client.db.insert(progressEntries).values([
      {
        id: uuidv7(),
        userId: USER_A,
        taskId: TASK_INCLUDED,
        source: "manual",
        outcome: "progressed",
        occurredAt: new Date("2026-08-20T07:00:00Z"),
        recordedAt: new Date("2026-08-20T07:00:00Z"),
      },
      {
        id: uuidv7(),
        userId: USER_A,
        taskId: TASK_EXCLUDED,
        source: "manual",
        outcome: "blocked",
        occurredAt: new Date("2026-08-20T07:00:00Z"),
        recordedAt: new Date("2026-08-20T07:00:00Z"),
      },
    ]);
  }
});
