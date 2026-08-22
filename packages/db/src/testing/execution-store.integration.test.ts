import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import { ExecutionService, ExecutionStore, ExecutionStoreTransaction, TaskService } from "@time-friend/domain";

import { createDatabaseClient, DatabaseClient } from "../client.js";
import { PostgresExecutionStore } from "../repositories/execution-store.js";
import { PostgresTaskStore } from "../repositories/task-store.js";
import { focusAdjustments, focusSegments, focusSessions, progressEntries, taskEvents, users } from "../schema/index.js";
import { PostgresTransactionContext } from "../transaction-context.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";

describe("PostgresExecutionStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let tasks: TaskService;
  let execution: ExecutionService;
  let transactions: PostgresTransactionContext;
  let now: Date;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await migrate(client.db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await client.db.execute(
      sql`TRUNCATE TABLE progress_entries, focus_adjustments, focus_segments, focus_sessions, idempotency_records, task_events, items, groups, lists, folders, users CASCADE`,
    );
    await client.db.insert(users).values([
      { id: USER_A, email: "a@example.com", name: "A" },
      { id: USER_B, email: "b@example.com", name: "B" },
    ]);
    now = new Date("2026-08-22T08:00:00.000Z");
    transactions = new PostgresTransactionContext();
    tasks = new TaskService({
      store: new PostgresTaskStore(client.db, transactions),
      clock: { now: () => new Date(now) },
      ids: { next: uuidv7 },
    });
    execution = new ExecutionService({
      store: new PostgresExecutionStore(client.db, transactions),
      clock: { now: () => new Date(now) },
      ids: { next: uuidv7 },
    });
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("persists a recoverable segmented timer and excludes paused time", async () => {
    const task = await createTask("计时任务");
    const started = await execution.startFocus(USER_A, { taskId: task.id, mode: "stopwatch" });
    now = new Date("2026-08-22T08:10:00.000Z");
    await execution.pauseFocus(USER_A, started.session.id, 1);
    now = new Date("2026-08-22T08:15:00.000Z");
    await execution.resumeFocus(USER_A, started.session.id, 2);
    now = new Date("2026-08-22T08:20:00.000Z");
    const finished = await execution.finishFocus(USER_A, started.session.id, 3);

    expect(finished.session).toMatchObject({ state: "awaiting_feedback", baseActiveSeconds: 900, effectiveSeconds: 900 });
    const segments = await client.db.select().from(focusSegments).where(sql`${focusSegments.sessionId} = ${started.session.id}`);
    expect(segments.map((segment) => segment.closeReason)).toEqual(["pause", "finish"]);
    await expect(execution.getActiveFocusSession(USER_A)).resolves.toBeNull();
  });

  it("enforces one active timer under concurrent starts at the database boundary", async () => {
    const results = await Promise.allSettled([
      execution.startFocus(USER_A, { id: uuidv7(), mode: "stopwatch" }),
      execution.startFocus(USER_A, { id: uuidv7(), mode: "pomodoro" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "ACTIVE_FOCUS_EXISTS" } });
    const rows = await client.db.select().from(focusSessions).where(sql`${focusSessions.userId} = ${USER_A}`);
    expect(rows).toHaveLength(1);
  });

  it("commits feedback, progress, task completion and events atomically", async () => {
    const task = await createTask("完成闭环");
    const started = await execution.startFocus(USER_A, { taskId: task.id, mode: "pomodoro", plannedSeconds: 60 });
    now = new Date("2026-08-22T08:01:00.000Z");
    await execution.finishFocus(USER_A, started.session.id, 1);
    const result = await execution.submitFocusFeedback(USER_A, started.session.id, {
      outcome: "completed",
      note: "已经完成",
      completeTask: true,
      expectedRevision: 2,
    });

    expect(result).toMatchObject({ session: { state: "completed" }, progress: { outcome: "completed" }, task: { status: "completed" } });
    const progress = await client.db.select().from(progressEntries).where(sql`${progressEntries.focusSessionId} = ${started.session.id}`);
    const events = await client.db.select().from(taskEvents).where(sql`${taskEvents.taskId} = ${task.id}`);
    expect(progress).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual(["created", "focus_started", "focus_finished", "completed", "progress_created"]);
  });

  it("rolls back feedback when immutable event persistence fails", async () => {
    const task = await createTask("事务任务");
    const started = await execution.startFocus(USER_A, { taskId: task.id, mode: "stopwatch" });
    now = new Date("2026-08-22T08:01:00.000Z");
    await execution.finishFocus(USER_A, started.session.id, 1);
    const postgresStore = new PostgresExecutionStore(client.db, transactions);
    const failingStore: ExecutionStore = {
      transaction: <T>(work: (transaction: ExecutionStoreTransaction) => Promise<T>) =>
        postgresStore.transaction((transaction) =>
          work(
            new Proxy(transaction, {
              get(target, property) {
                if (property === "appendTaskEvents") return async () => Promise.reject(new Error("simulated event failure"));
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ),
    };
    const failingExecution = new ExecutionService({
      store: failingStore,
      clock: { now: () => new Date(now) },
      ids: { next: uuidv7 },
    });

    await expect(
      failingExecution.submitFocusFeedback(USER_A, started.session.id, { outcome: "progressed", expectedRevision: 2 }),
    ).rejects.toThrow("simulated event failure");
    const [stored] = await client.db.select().from(focusSessions).where(sql`${focusSessions.id} = ${started.session.id}`);
    expect(stored?.state).toBe("awaiting_feedback");
    expect(await client.db.select().from(progressEntries)).toHaveLength(0);
  });

  it("records effective-time adjustments without rewriting segments", async () => {
    const task = await createTask("修正时长");
    const started = await execution.startFocus(USER_A, { taskId: task.id, mode: "stopwatch" });
    now = new Date("2026-08-22T08:10:00.000Z");
    await execution.finishFocus(USER_A, started.session.id, 1);
    const adjusted = await execution.adjustFocusDuration(USER_A, started.session.id, {
      effectiveSeconds: 540,
      reason: "忘记暂停",
      expectedRevision: 2,
    });

    expect(adjusted.effectiveSeconds).toBe(540);
    const [segment] = await client.db.select().from(focusSegments).where(sql`${focusSegments.sessionId} = ${started.session.id}`);
    const [adjustment] = await client.db.select().from(focusAdjustments).where(sql`${focusAdjustments.sessionId} = ${started.session.id}`);
    expect(segment?.endedAt).toEqual(new Date("2026-08-22T08:10:00.000Z"));
    expect(adjustment).toMatchObject({ beforeSeconds: 600, afterSeconds: 540, reason: "忘记暂停" });
  });

  it("keeps tenant scope on task links and progress reads", async () => {
    const task = await createTask("A 的任务");
    await expect(execution.startFocus(USER_B, { taskId: task.id, mode: "stopwatch" })).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    await execution.createManualProgress(USER_A, task.id, { outcome: "progressed", note: "A 的进展" });
    await expect(execution.listProgressEntries({ userId: USER_B, taskId: task.id })).resolves.toEqual([]);
  });

  async function createTask(title: string) {
    const existingLists = await tasks.getTaskData(USER_A);
    const list = existingLists.lists[0] ?? (await tasks.createTaskList(USER_A, { name: "收集箱", isInbox: true }));
    return tasks.createItem(USER_A, { kind: "task", title, listId: list.id });
  }
});
