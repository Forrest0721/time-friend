import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  PostgresAccountPrivacyStore,
  DatabaseClient,
  ExecutionJobScheduler,
  PostgresExecutionStore,
  PostgresTaskStore,
  PostgresTrajectoryReviewStore,
  PostgresTrajectoryStore,
  PostgresTransactionContext,
  TimeFriendTransaction,
} from "@time-friend/db";
import {
  AccountPrivacyService,
  type AgentRunner,
  ExecutionService,
  FocusDeadlineJob,
  TaskService,
  TrajectoryFeedbackService,
  TrajectoryReviewService,
  TrajectoryService,
} from "@time-friend/domain";

import {
  ACCOUNT_DELETE_QUEUE,
  createTimeFriendBoss,
  PgBossAccountDeletionJobScheduler,
  PgBossExecutionJobScheduler,
  PgBossTrajectoryReviewJobScheduler,
  POMODORO_EXPIRE_QUEUE,
  registerExecutionWorkers,
  registerPrivacyWorkers,
  registerTrajectoryWorkers,
  startTimeFriendBoss,
  STOPWATCH_CAP_QUEUE,
  TRAJECTORY_GENERATE_REVIEW_QUEUE,
} from "./index.js";
import { accountDeletionRequests, users } from "@time-friend/db/schema";

const USER_ID = "00000000-0000-7000-8000-000000000001";

describe("pg-boss execution jobs", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let boss: ReturnType<typeof createTimeFriendBoss>;
  let execution: ExecutionService;
  let tasks: TaskService;
  let transactions: PostgresTransactionContext;
  let scheduler: PgBossExecutionJobScheduler;
  let now: Date;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrate(database.db, { migrationsFolder: new URL("../../db/migrations", import.meta.url).pathname });
    boss = createTimeFriendBoss(container.getConnectionUri());
    await startTimeFriendBoss(boss);
  });

  beforeEach(async () => {
    await Promise.all([
      boss.offWork(POMODORO_EXPIRE_QUEUE),
      boss.offWork(STOPWATCH_CAP_QUEUE),
      boss.offWork(TRAJECTORY_GENERATE_REVIEW_QUEUE),
      boss.offWork(ACCOUNT_DELETE_QUEUE),
    ]);
    await boss.deleteAllJobs();
    await database.db.execute(
      sql`TRUNCATE TABLE account_deletion_requests, progress_entries, focus_adjustments, focus_segments, focus_sessions, idempotency_records, task_events, items, groups, lists, folders, users CASCADE`,
    );
    await database.db.execute(
      sql`INSERT INTO users (id, email, name) VALUES (${USER_ID}::uuid, 'queue@example.com', 'Queue')`,
    );
    now = new Date("2099-08-22T08:00:00.000Z");
    scheduler = new PgBossExecutionJobScheduler(boss);
    transactions = new PostgresTransactionContext();
    tasks = new TaskService({
      store: new PostgresTaskStore(database.db, transactions),
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });
    execution = new ExecutionService({
      store: new PostgresExecutionStore(database.db, transactions, scheduler),
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });
    await registerExecutionWorkers(boss, execution);
  });

  afterAll(async () => {
    await boss?.stop({ graceful: true, timeout: 10_000 });
    await database?.close();
    await container?.stop();
  });

  it("enqueues the deadline in the same transaction as the focus session", async () => {
    const started = await execution.startFocus(USER_ID, { mode: "pomodoro", plannedSeconds: 60 });
    const jobs = await boss.findJobs<{ userId: string; sessionId: string; expectedRevision: number }>(POMODORO_EXPIRE_QUEUE);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ userId: USER_ID, sessionId: started.session.id, expectedRevision: 1 });
    expect(jobs[0]?.startAfter).toEqual(new Date("2099-08-22T08:01:00.000Z"));
  });

  it("rolls the pg-boss insert back when the business transaction fails", async () => {
    const rollbackScheduler: ExecutionJobScheduler = {
      async schedule(transaction: TimeFriendTransaction, job: FocusDeadlineJob) {
        await scheduler.schedule(transaction, job);
        throw new Error("simulated transaction failure");
      },
    };
    const failing = new ExecutionService({
      store: new PostgresExecutionStore(database.db, transactions, rollbackScheduler),
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });

    await expect(failing.startFocus(USER_ID, { mode: "pomodoro", plannedSeconds: 60 })).rejects.toThrow(
      "simulated transaction failure",
    );
    await expect(execution.listFocusSessions({ userId: USER_ID })).resolves.toEqual([]);
    await expect(boss.findJobs(POMODORO_EXPIRE_QUEUE)).resolves.toEqual([]);
  });

  it("processes a deadline idempotently and leaves stale jobs harmless", async () => {
    const list = await tasks.createTaskList(USER_ID, { name: "收集箱", isInbox: true });
    const task = await tasks.createItem(USER_ID, { kind: "task", title: "自动截止", listId: list.id });
    const started = await execution.startFocus(USER_ID, { taskId: task.id, mode: "pomodoro", plannedSeconds: 60 });
    now = new Date("2099-08-22T08:01:05.000Z");
    const data = { userId: USER_ID, sessionId: started.session.id, expectedRevision: 1 };
    await boss.send(POMODORO_EXPIRE_QUEUE, data);

    const expired = await waitFor(async () => {
      const sessions = await execution.listFocusSessions({ userId: USER_ID });
      return sessions[0]?.state === "awaiting_feedback" ? sessions[0] : null;
    });
    expect(expired).toMatchObject({ state: "awaiting_feedback", effectiveSeconds: 60, revision: 2 });

    await boss.send(POMODORO_EXPIRE_QUEUE, data);
    await waitFor(async () => {
      const jobs = await boss.findJobs(POMODORO_EXPIRE_QUEUE);
      return jobs.filter((job) => job.state === "completed").length >= 2 ? true : null;
    });
    const sessions = await execution.listFocusSessions({ userId: USER_ID });
    expect(sessions[0]).toMatchObject({ state: "awaiting_feedback", revision: 2 });
  });

  it("carries a user correction through product memory into the next week's queued Agent run", async () => {
    const list = await tasks.createTaskList(USER_ID, { name: "产品" });
    const task = await tasks.createItem(USER_ID, {
      kind: "task",
      title: "推进轨迹队列",
      listId: list.id,
      plannedOn: "2099-08-22",
    });
    for (let index = 0; index < 3; index += 1) {
      await execution.createManualProgress(USER_ID, task.id, { outcome: "progressed", note: `证据 ${index + 1}` });
    }
    now = new Date(now.getTime() + 1_000);
    const trajectory = new TrajectoryService({
      store: new PostgresTrajectoryStore(database.db),
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });
    let generation = 0;
    const runner: AgentRunner = {
      async generateWeeklyReview(input) {
        generation += 1;
        const memories = await input.tools.getConfirmedMemories();
        if (generation === 1) expect(memories).toEqual([]);
        if (generation === 2) {
          expect(memories).toEqual([
            expect.objectContaining({
              memoryType: "classification",
              value: expect.objectContaining({ classification: "maintenance" }),
              revision: 1,
            }),
          ]);
        }
        return {
          review: {
            schemaVersion: "1",
            claims: [
              {
                type: "progress",
                statement: generation === 1 ? "似乎在持续推进轨迹队列" : "已继承用户确认的维持事务分类",
                rationale: generation === 1 ? "任务与进展形成了连续证据" : "本周证据结合上一周用户确认的产品记忆",
                confidence: "medium",
                evidence: [{ entityType: "task", entityId: task.id, role: "supports" }],
                proposedDirection: null,
                memoryCandidate: null,
              },
            ],
            suggestedCommitments: [],
            limitations: [],
          },
          provider: "openai",
          model: "test-model",
          sdkTraceId: "queue-trace",
          usage: { inputTokens: 10, outputTokens: 10 },
          durationMs: 10,
        };
      },
    };
    const reviewStore = new PostgresTrajectoryReviewStore(
      database.db,
      transactions,
      new PgBossTrajectoryReviewJobScheduler(boss),
    );
    const reviews = new TrajectoryReviewService({
      snapshots: trajectory,
      store: reviewStore,
      runner,
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
      model: "test-model",
    });
    const period = await trajectory.ensureCurrentWeek(USER_ID);
    const run = await reviews.requestGeneration(USER_ID, period.id);

    expect(run.status).toBe("queued");
    const jobs = await boss.findJobs<{ runId: string }>(TRAJECTORY_GENERATE_REVIEW_QUEUE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ runId: run.id });

    await registerTrajectoryWorkers(boss, reviews);
    const completed = await waitFor(async () => {
      const current = await reviews.getRun(USER_ID, run.id);
      return current?.status === "succeeded" ? current : null;
    });
    expect(completed).toMatchObject({ attempts: 1, sdkTraceId: "queue-trace" });

    const firstReview = await reviews.getReviewForPeriod(USER_ID, period.id);
    const feedback = new TrajectoryFeedbackService({
      store: reviewStore,
      periods: trajectory,
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });
    const corrected = await feedback.correctClaim(USER_ID, firstReview!.claims[0]!.id, {
      kind: "maintenance",
      detail: "这是维持事务，不应被解释为方向推进",
      remember: true,
    });
    expect(corrected.futureEffect).toContain("维持事务");
    await feedback.confirmReview(USER_ID, firstReview!.review!.id);

    now = new Date("2099-08-25T08:00:00.000Z");
    for (let index = 0; index < 3; index += 1) {
      await execution.createManualProgress(USER_ID, task.id, { outcome: "progressed", note: `第二周证据 ${index + 1}` });
    }
    now = new Date(now.getTime() + 1_000);
    const nextPeriod = await trajectory.ensureCurrentWeek(USER_ID);
    expect(nextPeriod.id).not.toBe(period.id);
    const nextRun = await reviews.requestGeneration(USER_ID, nextPeriod.id);
    expect(nextRun.status).toBe("queued");
    await waitFor(async () => {
      const current = await reviews.getRun(USER_ID, nextRun.id);
      return current?.status === "succeeded" ? current : null;
    });
    const nextReview = await reviews.getReviewForPeriod(USER_ID, nextPeriod.id);
    expect(nextReview?.claims[0]).toMatchObject({ statement: "已继承用户确认的维持事务分类" });
    expect(generation).toBe(2);
  });

  it("enqueues account erasure in the freeze transaction and processes it asynchronously", async () => {
    const privacy = new AccountPrivacyService({
      store: new PostgresAccountPrivacyStore(
        database.db,
        transactions,
        new PgBossAccountDeletionJobScheduler(boss),
      ),
      clock: { now: () => new Date(now) },
      ids: { next: randomUUID },
    });
    const requested = await privacy.requestDeletion(USER_ID);

    const jobs = await boss.findJobs<{ requestId: string }>(ACCOUNT_DELETE_QUEUE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ requestId: requested.id });

    await registerPrivacyWorkers(boss, privacy);
    await waitFor(async () => {
      const [receipt] = await database.db
        .select()
        .from(accountDeletionRequests)
        .where(sql`${accountDeletionRequests.id} = ${requested.id}`);
      return receipt?.status === "completed" ? receipt : null;
    });
    await expect(database.db.select().from(users).where(sql`${users.id} = ${USER_ID}`)).resolves.toEqual([]);
  });
});

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for pg-boss worker");
}
