import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AgentRunner,
  type GeneratedReviewResult,
  TrajectoryFeedbackService,
  TrajectoryReviewService,
  TrajectoryService,
} from "@time-friend/domain";

import { createDatabaseClient, type DatabaseClient } from "../client.js";
import { PostgresTrajectoryReviewStore, type TrajectoryReviewJobScheduler } from "../repositories/trajectory-review-store.js";
import { PostgresTrajectoryStore } from "../repositories/trajectory-store.js";
import {
  agentRuns,
  confirmedMemories,
  contributionEdges,
  directions,
  items,
  lists,
  progressEntries,
  reviewClaims,
  reviewVersions,
  users,
} from "../schema/index.js";
import { PostgresTransactionContext } from "../transaction-context.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";
const LIST_A = "00000000-0000-7000-8000-000000000011";
const LIST_B = "00000000-0000-7000-8000-000000000012";
const TASK_A = "00000000-0000-7000-8000-000000000021";
const TASK_B = "00000000-0000-7000-8000-000000000022";

describe("PostgresTrajectoryReviewStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let trajectory: TrajectoryService;
  let scheduledRunIds: string[];
  let runner: AgentRunner;
  let reviews: TrajectoryReviewService;
  let store: PostgresTrajectoryReviewStore;
  let feedback: TrajectoryFeedbackService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await migrate(client.db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE users CASCADE`);
    await client.db.insert(users).values([
      { id: USER_A, email: "review-a@example.com", name: "A", timezone: "Asia/Shanghai" },
      { id: USER_B, email: "review-b@example.com", name: "B", timezone: "Asia/Shanghai" },
    ]);
    scheduledRunIds = [];
    const scheduler: TrajectoryReviewJobScheduler = {
      async schedule(_transaction, runId) {
        scheduledRunIds.push(runId);
      },
    };
    trajectory = new TrajectoryService({
      store: new PostgresTrajectoryStore(client.db),
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
      ids: { next: randomUUID },
    });
    runner = { generateWeeklyReview: vi.fn(generateReview) };
    store = new PostgresTrajectoryReviewStore(client.db, new PostgresTransactionContext(), scheduler);
    reviews = new TrajectoryReviewService({
      snapshots: trajectory,
      store,
      runner,
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
      ids: { next: randomUUID },
      model: "test-model",
    });
    feedback = new TrajectoryFeedbackService({
      store,
      periods: trajectory,
      clock: { now: () => new Date("2026-08-22T08:01:00.000Z") },
      ids: { next: randomUUID },
    });
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("keeps low-data requests waiting and idempotent without scheduling a model run", async () => {
    await seedTask(false);
    const period = await trajectory.ensureCurrentWeek(USER_A);

    const first = await reviews.requestGeneration(USER_A, period.id);
    const second = await reviews.requestGeneration(USER_A, period.id);

    expect(first).toMatchObject({ status: "waiting_for_data", id: second.id });
    expect(scheduledRunIds).toEqual([]);
    expect(runner.generateWeeklyReview).not.toHaveBeenCalled();
    await expect(reviews.getRun(USER_B, first.id)).resolves.toBeNull();
  });

  it("persists frozen evidence, raw output and the independently validated review", async () => {
    await seedTask(true);
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);

    expect(run.status).toBe("queued");
    expect(scheduledRunIds).toEqual([run.id]);
    const view = await reviews.executeGeneration(run.id);

    expect(view?.run).toMatchObject({ status: "succeeded", attempts: 1, sdkTraceId: "trace-test" });
    expect(view?.review).toMatchObject({ periodId: period.id, version: 1, status: "pending" });
    expect(view?.claims).toHaveLength(1);
    expect(view?.claims[0]).toMatchObject({ statement: "似乎在持续推进轨迹功能", status: "pending" });
    expect(view?.claims[0]?.evidence).toEqual([
      expect.objectContaining({ entityType: "task", entityId: TASK_A, role: "supports" }),
    ]);
    expect(view?.commitments).toHaveLength(1);

    const [storedRun] = await client.db.select().from(agentRuns).where(sql`${agentRuns.id} = ${run.id}`);
    expect(storedRun?.rawOutputJson?.claims).toHaveLength(1);
    await expect(reviews.getReviewForPeriod(USER_A, period.id)).resolves.toMatchObject({ review: { id: view?.review?.id } });
    await expect(reviews.getReviewForPeriod(USER_B, period.id)).resolves.toBeNull();
  });

  it("fails a queued run without invoking the model after Agent analysis is disabled", async () => {
    await seedTask(true);
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);
    await client.db.update(users).set({ agentEnabled: false }).where(sql`${users.id} = ${USER_A}`);

    await expect(reviews.executeGeneration(run.id)).resolves.toBeNull();
    expect(runner.generateWeeklyReview).not.toHaveBeenCalled();
    await expect(reviews.getRun(USER_A, run.id)).resolves.toMatchObject({
      status: "failed",
      errorCode: "AGENT_DISABLED",
    });
  });

  it("fails the whole run when the model cites evidence from another tenant", async () => {
    await seedTask(true);
    await client.db.insert(lists).values({ id: LIST_B, userId: USER_B, name: "B", positionKey: "a0" });
    await client.db.insert(items).values({
      id: TASK_B,
      userId: USER_B,
      listId: LIST_B,
      kind: "task",
      title: "其他用户任务",
      status: "pending",
      plannedOn: "2026-08-20",
      contentDoc: { type: "doc", schemaVersion: 1, content: [] },
      contentText: "",
      positionKey: "a0",
    });
    const periodB = await trajectory.ensureCurrentWeek(USER_B);
    await trajectory.generateSnapshot(USER_B, periodB.id);
    runner = {
      generateWeeklyReview: vi.fn(async (input) => {
        const result = await generateReview(input);
        result.review.claims[0]!.evidence[0]!.entityId = TASK_B;
        return result;
      }),
    };
    reviews = new TrajectoryReviewService({
      snapshots: trajectory,
      store: new PostgresTrajectoryReviewStore(client.db, new PostgresTransactionContext()),
      runner,
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
      ids: { next: randomUUID },
      model: "test-model",
    });
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);

    await expect(reviews.executeGeneration(run.id)).rejects.toThrow("TRAJECTORY_EVIDENCE_SCOPE_VIOLATION");
    await expect(reviews.getRun(USER_A, run.id)).resolves.toMatchObject({
      status: "failed",
      errorCode: "TRAJECTORY_EVIDENCE_SCOPE_VIOLATION",
    });
    await expect(client.db.select().from(reviewVersions)).resolves.toEqual([]);
    await expect(client.db.select().from(reviewClaims)).resolves.toEqual([]);
  });

  it("writes knowledge only after explicit user decisions and keeps memory revisions auditable", async () => {
    await seedTask(true);
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);
    const generated = await reviews.executeGeneration(run.id);
    const claim = generated!.claims[0]!;

    await feedback.decideClaim(USER_A, claim.id, { action: "accept", remember: true });
    const confirmed = await feedback.confirmReview(USER_A, generated!.review!.id);
    const replayed = await feedback.confirmReview(USER_A, generated!.review!.id);

    expect(confirmed.review?.status).toBe("confirmed");
    expect(replayed.review?.id).toBe(confirmed.review?.id);
    expect(await client.db.select().from(directions)).toHaveLength(1);
    expect(await client.db.select().from(contributionEdges)).toHaveLength(1);
    expect(await client.db.select().from(confirmedMemories)).toHaveLength(1);

    const [memory] = await feedback.listMemories(USER_A, "active");
    const revised = await feedback.reviseMemory(USER_A, memory!.id, { summary: "修正后的产品方向" }, 1);
    expect(revised).toMatchObject({ revision: 2, supersedesId: memory!.id, status: "active" });
    expect(await feedback.listMemories(USER_A, "all")).toEqual([
      expect.objectContaining({ id: revised.id, status: "active", revision: 2 }),
      expect.objectContaining({ id: memory!.id, status: "superseded", revision: 1 }),
    ]);
    const context = await store.getRunContext(run.id);
    const activeForAgent = await store
      .createAgentTools(USER_A, context!.period, { ...context!.snapshot, sourceWatermark: "2026-08-22T08:02:00.000Z" })
      .getConfirmedMemories();
    expect(activeForAgent).toEqual([expect.objectContaining({ id: revised.id, revision: 2 })]);

    const commitment = confirmed.commitments[0]!;
    const committed = await feedback.confirmCommitment(USER_A, commitment.id, commitment.revision);
    expect(committed).toMatchObject({ status: "confirmed", revision: 2 });
    expect(committed.targetPeriodId).not.toBeNull();
    await expect(feedback.setCommitmentStatus(USER_A, committed.id, "paused", 2)).resolves.toMatchObject({
      status: "paused",
      revision: 3,
    });

    await feedback.deactivateMemory(USER_A, revised.id, 2);
    await expect(feedback.listMemories(USER_A, "active")).resolves.toEqual([]);
  });

  it("preserves an excluded evidence reference and optionally teaches the Agent an exclusion rule", async () => {
    await seedTask(true);
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);
    const generated = await reviews.executeGeneration(run.id);
    const claim = generated!.claims[0]!;
    const evidence = claim.evidence[0]!;

    await expect(
      feedback.excludeEvidence(USER_B, evidence.id, { reason: "不属于这个方向", remember: true }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const corrected = await feedback.excludeEvidence(USER_A, evidence.id, {
      reason: "这是维持事务，不支持该方向",
      remember: true,
    });
    expect(corrected.claims[0]!.evidence[0]).toMatchObject({
      id: evidence.id,
      exclusionReason: "这是维持事务，不支持该方向",
    });
    expect(corrected.claims[0]!.evidence[0]!.excludedAt).not.toBeNull();
    expect(await feedback.listMemories(USER_A, "active")).toEqual([
      expect.objectContaining({ memoryType: "exclusion", value: expect.objectContaining({ entityId: TASK_A }) }),
    ]);

    await feedback.decideClaim(USER_A, claim.id, { action: "accept", remember: false });
    await feedback.confirmReview(USER_A, generated!.review!.id);
    await expect(client.db.select().from(contributionEdges)).resolves.toEqual([]);
  });

  it("versions direction lifecycle changes as Agent-readable product memory", async () => {
    await seedTask(true);
    const period = await trajectory.ensureCurrentWeek(USER_A);
    const run = await reviews.requestGeneration(USER_A, period.id);
    const generated = await reviews.executeGeneration(run.id);
    await feedback.decideClaim(USER_A, generated!.claims[0]!.id, { action: "accept", remember: true });
    await feedback.confirmReview(USER_A, generated!.review!.id);
    const [direction] = await feedback.listDirections(USER_A, "active");

    const paused = await feedback.updateDirection(USER_A, direction!.id, { state: "paused" }, direction!.revision);
    expect(paused).toMatchObject({ state: "paused", revision: 2 });
    await expect(feedback.listDirections(USER_A, "active")).resolves.toEqual([]);
    await expect(feedback.listDirections(USER_A, "all")).resolves.toEqual([
      expect.objectContaining({ id: direction!.id, state: "paused" }),
    ]);

    const ended = await feedback.updateDirection(USER_A, direction!.id, { state: "ended" }, paused.revision);
    expect(ended).toMatchObject({ state: "ended", revision: 3 });
    await expect(
      feedback.updateDirection(USER_A, direction!.id, { state: "active" }, ended.revision),
    ).rejects.toMatchObject({ code: "INVALID_RELATION" });
    const stateMemories = (await feedback.listMemories(USER_A, "all")).filter(
      (memory) => memory.memoryType === "direction_state",
    );
    expect(stateMemories).toEqual([
      expect.objectContaining({ status: "active", value: expect.objectContaining({ state: "ended" }), revision: 2 }),
      expect.objectContaining({ status: "superseded", value: expect.objectContaining({ state: "paused" }), revision: 1 }),
    ]);
  });

  async function seedTask(enoughData: boolean): Promise<void> {
    await client.db.insert(lists).values({ id: LIST_A, userId: USER_A, name: "产品", positionKey: "a0", learningPolicy: "include" });
    await client.db.insert(items).values({
      id: TASK_A,
      userId: USER_A,
      listId: LIST_A,
      kind: "task",
      title: "推进轨迹功能",
      status: "pending",
      plannedOn: "2026-08-20",
      contentDoc: { type: "doc", schemaVersion: 1, content: [] },
      contentText: "补齐生成和证据校验",
      positionKey: "a0",
    });
    if (!enoughData) return;
    await client.db.insert(progressEntries).values(
      ["progressed", "blocked", "progressed"].map((outcome, index) => ({
        id: randomUUID(),
        userId: USER_A,
        taskId: TASK_A,
        source: "manual" as const,
        outcome: outcome as "progressed" | "blocked",
        note: `轨迹证据 ${index + 1}`,
        occurredAt: new Date(`2026-08-${20 + index}T07:00:00.000Z`),
        recordedAt: new Date(`2026-08-${20 + index}T07:00:00.000Z`),
      })),
    );
  }
});

async function generateReview(input: Parameters<AgentRunner["generateWeeklyReview"]>[0]): Promise<GeneratedReviewResult> {
  const searchResults = await input.tools.searchEvidence({ query: "推进轨迹功能", scope: ["task"], limit: 5 });
  expect(searchResults).toEqual([expect.objectContaining({ entityId: TASK_A, title: "推进轨迹功能" })]);
  return {
    review: {
      schemaVersion: "1",
      claims: [
        {
          type: "direction",
          statement: "似乎在持续推进轨迹功能",
          rationale: "任务和进展记录形成了连续证据",
          confidence: "medium",
          evidence: [{ entityType: "task", entityId: TASK_A, role: "supports" }],
          proposedDirection: { name: "让时间投入变得可解释", relation: "direct" },
          memoryCandidate: { type: "direction", value: { summary: "持续建设时间轨迹产品" } },
        },
      ],
      suggestedCommitments: [{ title: "完成轨迹生成闭环", reason: "延续已有投入", evidenceIds: [TASK_A] }],
      limitations: [],
    },
    provider: "openai",
    model: "test-model",
    sdkTraceId: "trace-test",
    usage: { inputTokens: 100, outputTokens: 50 },
    durationMs: 20,
  };
}
