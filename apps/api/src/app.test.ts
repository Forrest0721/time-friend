import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentRunRecord,
  CommitmentRecord,
  ConfirmedMemoryRecord,
  FocusSessionView,
  Item,
  ProgressEntry,
  TaskEvent,
  WeeklyReviewView,
} from "@time-friend/domain";

import { createApp } from "./app.js";
import {
  AccountPrivacyApplication,
  ApiDependencies,
  ExecutionApplication,
  IdempotencyExecutor,
  TaskApplication,
  TrajectoryApplication,
  TrajectoryFeedbackApplication,
  TrajectoryReviewApplication,
  UserPreferenceApplication,
} from "./types.js";

const USER_ID = "00000000-0000-7000-8000-000000000001";
const LIST_ID = "00000000-0000-7000-8000-000000000002";
const ITEM_ID = "00000000-0000-7000-8000-000000000003";
const PERIOD_ID = "00000000-0000-7000-8000-000000000007";
const SNAPSHOT_ID = "00000000-0000-7000-8000-000000000008";
const RUN_ID = "00000000-0000-7000-8000-000000000009";
const REVIEW_ID = "00000000-0000-7000-8000-000000000010";
const CLAIM_ID = "00000000-0000-7000-8000-000000000011";
const MEMORY_ID = "00000000-0000-7000-8000-000000000012";
const COMMITMENT_ID = "00000000-0000-7000-8000-000000000013";
const EVIDENCE_ID = "00000000-0000-7000-8000-000000000014";
const DIRECTION_ID = "00000000-0000-7000-8000-000000000015";

const openApps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("task API", () => {
  it("rejects unauthenticated access with RFC-style problem details", async () => {
    const { app } = await setup({ authenticated: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("reports reviews that still need user confirmation in bootstrap", async () => {
    const { app, trajectoryReviews } = await setup();
    vi.mocked(trajectoryReviews.listReviews).mockResolvedValue([reviewViewFixture()]);

    const response = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ pendingReviews: 1 });
  });

  it("requires idempotency keys for every mutation", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "POST", url: "/api/v1/folders", payload: { name: "工作" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("strictly rejects unknown fields before invoking the application service", async () => {
    const { app, tasks } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { "idempotency-key": "create-001" },
      payload: { listId: LIST_ID, kind: "task", title: "任务", userId: USER_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(tasks.createItem).not.toHaveBeenCalled();
  });

  it("rejects cookie-authenticated mutations from an untrusted Origin", async () => {
    const { app, tasks } = await setup({ allowedOrigins: ["https://time-friend.example"] });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { "idempotency-key": "csrf-rejected-001", origin: "https://attacker.example" },
      payload: { listId: LIST_ID, kind: "task", title: "不应创建" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(tasks.createItem).not.toHaveBeenCalled();
  });

  it("maps public priority names to the domain and returns the typed item", async () => {
    const task = taskFixture({ priority: 5 });
    const { app, tasks } = await setup({ createItemResult: task });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { "idempotency-key": "create-002" },
      payload: { listId: LIST_ID, kind: "task", title: "高优先任务", priority: "high" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: ITEM_ID, priority: "high", status: "pending" });
    expect(tasks.createItem).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ priority: 5 }));
  });

  it("replays the first result for the same idempotency key", async () => {
    const { app, tasks } = await setup();
    const request = {
      method: "POST" as const,
      url: "/api/v1/items",
      headers: { "idempotency-key": "create-003" },
      payload: { listId: LIST_ID, kind: "task", title: "只创建一次" },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(tasks.createItem).toHaveBeenCalledTimes(1);
  });

  it("reorders items only within an explicit scope", async () => {
    const { app, tasks } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/items/reorder",
      headers: { "idempotency-key": "reorder-001" },
      payload: { listId: LIST_ID, groupId: null, parentTaskId: null, ids: [ITEM_ID] },
    });

    expect(response.statusCode).toBe(204);
    expect(tasks.reorderItems).toHaveBeenCalledWith(
      USER_ID,
      { listId: LIST_ID, groupId: null, parentTaskId: null },
      [ITEM_ID],
    );
  });

  it("moves an item through the semantic move command", async () => {
    const moved = taskFixture({ positionKey: "a1" });
    const { app, tasks } = await setup({ createItemResult: moved });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/items/${ITEM_ID}/move`,
      headers: { "idempotency-key": "move-001" },
      payload: { listId: LIST_ID, groupId: null, parentTaskId: null, positionKey: "a1", expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(tasks.updateItem).toHaveBeenCalledWith(
      USER_ID,
      ITEM_ID,
      { listId: LIST_ID, groupId: null, parentTaskId: null, positionKey: "a1", expectedRevision: 1 },
    );
  });

  it("exposes ordered task events through an opaque cursor", async () => {
    const events: TaskEvent[] = [0, 1, 2].map((index) => ({
      id: `00000000-0000-7000-8000-00000000000${index + 4}`,
      userId: USER_ID,
      taskId: ITEM_ID,
      eventType: index === 0 ? "created" : "title_changed",
      actorType: "user",
      occurredAt: `2026-08-18T08:00:0${index}.000Z`,
      recordedAt: `2026-08-18T08:00:0${index}.000Z`,
      payload: {},
      dedupeKey: null,
    }));
    const { app } = await setup({ events });
    const first = await app.inject({ method: "GET", url: `/api/v1/tasks/${ITEM_ID}/timeline?limit=2` });
    const firstBody = first.json<{ items: unknown[]; nextCursor: string }>();
    const second = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${ITEM_ID}/timeline?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });

    expect(firstBody.items).toHaveLength(2);
    expect(second.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("starts a typed focus session and rejects invalid mode fields", async () => {
    const { app, execution, trajectory } = await setup();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: { "idempotency-key": "focus-invalid-001" },
      payload: { mode: "stopwatch", plannedSeconds: 1_500 },
    });
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions",
      headers: { "idempotency-key": "focus-start-001" },
      payload: { taskId: ITEM_ID, mode: "pomodoro", plannedSeconds: 1_500 },
    });

    expect(invalid.statusCode).toBe(400);
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ session: { taskId: ITEM_ID, state: "running" }, openSegment: { endedAt: null } });
    expect(execution.startFocus).toHaveBeenCalledTimes(1);
    expect(trajectory.markSnapshotsStale).toHaveBeenCalledWith(USER_ID, "2026-08-18T08:00:00.000Z");
  });

  it("submits structured focus feedback and preserves public priority names", async () => {
    const item = taskFixture({ priority: 5 });
    const { app, execution } = await setup({ createItemResult: item });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/focus-sessions/00000000-0000-7000-8000-000000000004/feedback",
      headers: { "idempotency-key": "focus-feedback-001" },
      payload: { outcome: "completed", completeTask: true, expectedRevision: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      session: { state: "completed" },
      progress: { outcome: "progressed" },
      task: { priority: "high" },
    });
    expect(execution.submitFocusFeedback).toHaveBeenCalledWith(
      USER_ID,
      "00000000-0000-7000-8000-000000000004",
      expect.objectContaining({ outcome: "completed", completeTask: true, expectedRevision: 2 }),
    );
  });

  it("creates manual progress through the task timeline boundary", async () => {
    const { app, execution, trajectory } = await setup();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${ITEM_ID}/progress`,
      headers: { "idempotency-key": "progress-create-001" },
      payload: { outcome: "progressed", note: "完成接口" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ taskId: ITEM_ID, outcome: "progressed" });
    expect(execution.createManualProgress).toHaveBeenCalledWith(USER_ID, ITEM_ID, {
      outcome: "progressed",
      note: "完成接口",
    });
    expect(trajectory.markSnapshotsContainingEntity).toHaveBeenCalledWith(
      USER_ID,
      "progress_entry",
      "00000000-0000-7000-8000-000000000006",
    );
  });
});

describe("trajectory API", () => {
  it("requests an idempotent asynchronous review generation", async () => {
    const { app, trajectoryReviews } = await setup();
    vi.mocked(trajectoryReviews.requestGeneration).mockResolvedValue(agentRunFixture("queued"));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/trajectory/weeks/${PERIOD_ID}/generate`,
      headers: { "idempotency-key": "trajectory-generate-001" },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ id: RUN_ID, status: "queued", forceLowData: false });
    expect(response.json()).not.toHaveProperty("rawOutput");
    expect(trajectoryReviews.requestGeneration).toHaveBeenCalledWith(USER_ID, PERIOD_ID, false);
  });

  it("does not queue a manual review after the user disables Agent analysis", async () => {
    const { app, trajectoryReviews } = await setup({ agentEnabled: false });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/trajectory/weeks/${PERIOD_ID}/generate`,
      headers: { "idempotency-key": "trajectory-disabled-001" },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "AGENT_DISABLED" });
    expect(trajectoryReviews.requestGeneration).not.toHaveBeenCalled();
  });

  it("streams a terminal Agent run without leaking raw model output", async () => {
    const { app, trajectoryReviews } = await setup();
    vi.mocked(trajectoryReviews.getRun).mockResolvedValue({
      ...agentRunFixture("succeeded"),
      rawOutput: { schemaVersion: "1", claims: [], suggestedCommitments: [], limitations: [] },
    });

    const response = await app.inject({ method: "GET", url: `/api/v1/agent-runs/${RUN_ID}/events` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: status");
    expect(response.body).toContain('"status":"succeeded"');
    expect(response.body).not.toContain("rawOutput");
  });

  it("passes an edited claim and explicit memory choice to the feedback service", async () => {
    const { app, trajectoryFeedback } = await setup();
    vi.mocked(trajectoryFeedback.decideClaim).mockResolvedValue(reviewViewFixture("edited"));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/review-claims/${CLAIM_ID}/edit`,
      headers: { "idempotency-key": "claim-edit-001" },
      payload: {
        userRevision: "我是在验证时间管理产品",
        remember: true,
        memoryValue: { summary: "验证时间管理产品" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ review: { status: "partially_confirmed" }, claims: [{ status: "edited" }] });
    expect(trajectoryFeedback.decideClaim).toHaveBeenCalledWith(USER_ID, CLAIM_ID, {
      action: "edit",
      userRevision: "我是在验证时间管理产品",
      remember: true,
      memoryValue: { summary: "验证时间管理产品" },
    });
  });

  it("removes a mistaken evidence association through an auditable correction", async () => {
    const { app, trajectoryFeedback } = await setup();
    const corrected = reviewViewFixture();
    corrected.claims[0]!.evidence[0]!.excludedAt = "2026-08-22T08:01:00.000Z";
    corrected.claims[0]!.evidence[0]!.exclusionReason = "这是维持事务";
    vi.mocked(trajectoryFeedback.excludeEvidence).mockResolvedValue(corrected);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/review-evidence/${EVIDENCE_ID}/exclude`,
      headers: { "idempotency-key": "evidence-exclude-001" },
      payload: { reason: "这是维持事务", remember: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ claims: [{ evidence: [{ exclusionReason: "这是维持事务" }] }] });
    expect(trajectoryFeedback.excludeEvidence).toHaveBeenCalledWith(USER_ID, EVIDENCE_ID, {
      reason: "这是维持事务",
      remember: true,
    });
  });

  it("lists active product memories and forwards commitment state transitions", async () => {
    const { app, trajectoryFeedback } = await setup();
    vi.mocked(trajectoryFeedback.listMemories).mockResolvedValue([memoryFixture()]);
    vi.mocked(trajectoryFeedback.confirmCommitment).mockResolvedValue({
      ...commitmentFixture(),
      status: "confirmed",
      targetPeriodId: PERIOD_ID,
      revision: 2,
    });

    const memories = await app.inject({ method: "GET", url: "/api/v1/memories?status=active" });
    const commitment = await app.inject({
      method: "POST",
      url: `/api/v1/commitments/${COMMITMENT_ID}/confirm`,
      headers: { "idempotency-key": "commitment-confirm-001" },
      payload: { expectedRevision: 1 },
    });

    expect(memories.statusCode).toBe(200);
    expect(memories.json()).toMatchObject({ items: [{ id: MEMORY_ID, status: "active" }] });
    expect(commitment.statusCode).toBe(200);
    expect(commitment.json()).toMatchObject({ status: "confirmed", revision: 2, targetPeriodId: PERIOD_ID });
    expect(trajectoryFeedback.confirmCommitment).toHaveBeenCalledWith(USER_ID, COMMITMENT_ID, 1);
  });

  it("updates a direction lifecycle through an explicit revisioned command", async () => {
    const { app, trajectoryFeedback } = await setup();
    vi.mocked(trajectoryFeedback.updateDirection).mockResolvedValue({
      id: DIRECTION_ID,
      userId: USER_ID,
      name: "时间管理产品验证",
      description: "持续验证闭环",
      state: "paused",
      createdFromReviewId: REVIEW_ID,
      revision: 2,
      createdAt: "2026-08-22T08:01:00.000Z",
      updatedAt: "2026-08-22T08:02:00.000Z",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/directions/${DIRECTION_ID}`,
      headers: { "idempotency-key": "direction-pause-001" },
      payload: { state: "paused", expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: DIRECTION_ID, state: "paused", revision: 2 });
    expect(trajectoryFeedback.updateDirection).toHaveBeenCalledWith(USER_ID, DIRECTION_ID, { state: "paused" }, 1);
  });
});

describe("settings API", () => {
  it("updates Agent consent through an idempotent authenticated command", async () => {
    const { app, preferences } = await setup();
    vi.mocked(preferences.setAgentEnabled).mockResolvedValue({
      userId: USER_ID,
      agentEnabled: false,
      updatedAt: "2026-08-22T08:00:00.000Z",
    });

    const request = {
      method: "PATCH" as const,
      url: "/api/v1/settings/agent",
      headers: { "idempotency-key": "agent-setting-001" },
      payload: { agentEnabled: false },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ userId: USER_ID, agentEnabled: false });
    expect(replay.json()).toEqual(first.json());
    expect(preferences.setAgentEnabled).toHaveBeenCalledTimes(1);
    expect(preferences.setAgentEnabled).toHaveBeenCalledWith(USER_ID, false);
  });
});

describe("account privacy API", () => {
  it("exports only the authenticated user's portable product data", async () => {
    const { app, privacy } = await setup();
    vi.mocked(privacy.exportData).mockResolvedValue({
      schemaVersion: "1",
      generatedAt: "2026-08-22T08:00:00.000Z",
      profile: {
        id: USER_ID,
        email: "user@example.com",
        name: "用户",
        timezone: "Asia/Shanghai",
        weekStartsOn: 1,
        agentEnabled: true,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-22T08:00:00.000Z",
      },
      data: { items: [taskFixture()], focusSessions: [] },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/account/export" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: "1", profile: { id: USER_ID }, data: { items: [{ id: ITEM_ID }] } });
    expect(privacy.exportData).toHaveBeenCalledWith(USER_ID);
  });

  it("freezes the account and queues deletion only after exact confirmation", async () => {
    const { app, privacy } = await setup();
    vi.mocked(privacy.requestDeletion).mockResolvedValue({
      id: "00000000-0000-7000-8000-000000000016",
      userId: USER_ID,
      subjectHash: "redacted-subject",
      status: "queued",
      requestedAt: "2026-08-22T08:00:00.000Z",
      startedAt: null,
      completedAt: null,
      errorCode: null,
    });

    const invalid = await app.inject({
      method: "DELETE",
      url: "/api/v1/account",
      headers: { "idempotency-key": "account-delete-invalid" },
      payload: { confirmation: "delete" },
    });
    const accepted = await app.inject({
      method: "DELETE",
      url: "/api/v1/account",
      headers: { "idempotency-key": "account-delete-valid" },
      payload: { confirmation: "DELETE" },
    });

    expect(invalid.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ status: "queued" });
    expect(accepted.json()).not.toHaveProperty("subjectHash");
    expect(privacy.requestDeletion).toHaveBeenCalledOnce();
    expect(privacy.requestDeletion).toHaveBeenCalledWith(USER_ID);
  });
});

async function setup(options: { authenticated?: boolean; agentEnabled?: boolean; allowedOrigins?: string[]; createItemResult?: Item; events?: TaskEvent[] } = {}) {
  const item = options.createItemResult ?? taskFixture();
  const tasks = taskStub(item, options.events ?? []);
  const execution = executionStub(item);
  const trajectory = trajectoryStub();
  const trajectoryReviews = trajectoryReviewStub();
  const trajectoryFeedback = trajectoryFeedbackStub();
  const preferences = preferenceStub();
  const privacy = privacyStub();
  const dependencies: ApiDependencies = {
    tasks,
    execution,
    trajectory,
    trajectoryReviews,
    trajectoryFeedback,
    preferences,
    privacy,
    resolveSession: async () =>
      options.authenticated === false
        ? null
        : {
            id: USER_ID,
            email: "user@example.com",
            name: "用户",
            timezone: "Asia/Shanghai",
            weekStartsOn: 1,
            agentEnabled: options.agentEnabled ?? true,
          },
    idempotency: memoryIdempotency(),
  };
  const app = await createApp(dependencies, { logger: false, allowedOrigins: options.allowedOrigins });
  openApps.push(app);
  return { app, tasks, execution, trajectory, trajectoryReviews, trajectoryFeedback, preferences, privacy };
}

function preferenceStub(): UserPreferenceApplication {
  return { setAgentEnabled: vi.fn() };
}

function privacyStub(): AccountPrivacyApplication {
  return { exportData: vi.fn(), requestDeletion: vi.fn() };
}

function trajectoryStub(): TrajectoryApplication {
  return {
    ensureCurrentWeek: vi.fn(),
    listWeeks: vi.fn(async () => []),
    getWeek: vi.fn(),
    generateSnapshot: vi.fn(),
    markSnapshotsStale: vi.fn(async () => 0),
    markSnapshotsStaleForLocalDate: vi.fn(async () => 0),
    markSnapshotsContainingEntity: vi.fn(async () => 0),
    markAllSnapshotsStale: vi.fn(async () => 0),
  };
}

function trajectoryReviewStub(): TrajectoryReviewApplication {
  return {
    requestGeneration: vi.fn(),
    getRun: vi.fn(async () => null),
    getReviewForPeriod: vi.fn(async () => null),
    listReviews: vi.fn(async () => []),
  };
}

function trajectoryFeedbackStub(): TrajectoryFeedbackApplication {
  return {
    decideClaim: vi.fn(),
    excludeEvidence: vi.fn(),
    confirmReview: vi.fn(),
    listMemories: vi.fn(async () => []),
    reviseMemory: vi.fn(),
    deactivateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    listDirections: vi.fn(async () => []),
    updateDirection: vi.fn(),
    createCommitment: vi.fn(),
    confirmCommitment: vi.fn(),
    updateCommitment: vi.fn(),
    setCommitmentStatus: vi.fn(),
  };
}

function executionStub(item: Item): ExecutionApplication {
  const view = focusViewFixture({ taskId: item.id });
  const progress = progressFixture({ taskId: item.id, focusSessionId: view.session.id });
  return {
    getActiveFocusSession: vi.fn(async () => null),
    listFocusSessions: vi.fn(async () => [view.session]),
    listFocusRecords: vi.fn(async () => [{ session: view.session, progress }]),
    listProgressEntries: vi.fn(async () => [progress]),
    getTaskExecutionSummary: vi.fn(async () => ({
      totalFocusSeconds: 1_500,
      sessionCount: 1,
      pomodoroCount: 1,
      recentProgress: [progress],
    })),
    startFocus: vi.fn(async () => view),
    pauseFocus: vi.fn(async () => ({ ...view, session: { ...view.session, state: "paused" as const, revision: 2 }, openSegment: null })),
    resumeFocus: vi.fn(async () => view),
    finishFocus: vi.fn(async () => ({ ...view, session: { ...view.session, state: "awaiting_feedback" as const, revision: 2 }, openSegment: null })),
    cancelFocus: vi.fn(async () => ({ ...view, session: { ...view.session, state: "canceled" as const, revision: 2 }, openSegment: null })),
    submitFocusFeedback: vi.fn(async () => ({ session: { ...view.session, state: "completed" as const, revision: 3 }, progress, task: item })),
    adjustFocusDuration: vi.fn(async () => ({ ...view.session, effectiveSeconds: 300, revision: 3 })),
    retargetFocus: vi.fn(async () => view.session),
    deleteFocus: vi.fn(async () => ({ ...view.session, deletedAt: "2026-08-18T08:30:00.000Z", revision: 2 })),
    createManualProgress: vi.fn(async () => progress),
    updateProgress: vi.fn(async () => progress),
    deleteProgress: vi.fn(async () => ({ ...progress, deletedAt: "2026-08-18T08:30:00.000Z", revision: 2 })),
  };
}

function taskStub(item: Item, events: TaskEvent[]): TaskApplication {
  return {
    getTaskData: vi.fn(async () => ({ folders: [], lists: [], groups: [], items: [item] })),
    getItem: vi.fn(async () => item),
    listItems: vi.fn(async () => [item]),
    listTaskEvents: vi.fn(async () => events),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    createTaskList: vi.fn(),
    updateTaskList: vi.fn(),
    createTaskGroup: vi.fn(),
    updateTaskGroup: vi.fn(),
    createItem: vi.fn(async () => item),
    updateItem: vi.fn(async () => item),
    transitionTask: vi.fn(async () => item),
    deleteItem: vi.fn(async () => item),
    reorderFolders: vi.fn(),
    reorderTaskLists: vi.fn(),
    reorderTaskGroups: vi.fn(),
    reorderItems: vi.fn(),
  };
}

function memoryIdempotency(): IdempotencyExecutor {
  const cache = new Map<string, Awaited<ReturnType<Parameters<IdempotencyExecutor["execute"]>[0]["operation"]>>>();
  return {
    async execute(input) {
      const key = `${input.userId}:${input.routeKey}:${input.idempotencyKey}:${JSON.stringify(input.requestBody)}`;
      const cached = cache.get(key);
      if (cached) return cached as Awaited<ReturnType<typeof input.operation>>;
      const result = await input.operation();
      cache.set(key, result);
      return result;
    },
  };
}

function taskFixture(overrides: Partial<Item> = {}): Item {
  return {
    id: ITEM_ID,
    userId: USER_ID,
    listId: LIST_ID,
    groupId: null,
    parentTaskId: null,
    kind: "task",
    title: "任务",
    status: "pending",
    priority: 0,
    plannedOn: null,
    contentDoc: { type: "doc", schemaVersion: 1, content: [] },
    contentText: "",
    positionKey: "a0",
    completedAt: null,
    abandonedAt: null,
    revision: 1,
    deletedAt: null,
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
    ...overrides,
  };
}

function focusViewFixture(overrides: Partial<FocusSessionView["session"]> = {}): FocusSessionView {
  const sessionId = "00000000-0000-7000-8000-000000000004";
  return {
    session: {
      id: sessionId,
      userId: USER_ID,
      taskId: ITEM_ID,
      mode: "pomodoro",
      state: "running",
      plannedSeconds: 1_500,
      startedAt: "2026-08-18T08:00:00.000Z",
      endedAt: null,
      expectedEndAt: "2026-08-18T08:25:00.000Z",
      baseActiveSeconds: 0,
      effectiveSeconds: null,
      revision: 1,
      deletedAt: null,
      createdAt: "2026-08-18T08:00:00.000Z",
      updatedAt: "2026-08-18T08:00:00.000Z",
      ...overrides,
    },
    openSegment: {
      id: "00000000-0000-7000-8000-000000000005",
      userId: USER_ID,
      sessionId,
      startedAt: "2026-08-18T08:00:00.000Z",
      endedAt: null,
      closeReason: null,
      createdAt: "2026-08-18T08:00:00.000Z",
    },
    serverNow: "2026-08-18T08:00:00.000Z",
  };
}

function progressFixture(overrides: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    id: "00000000-0000-7000-8000-000000000006",
    userId: USER_ID,
    taskId: ITEM_ID,
    focusSessionId: "00000000-0000-7000-8000-000000000004",
    source: "focus_end",
    outcome: "progressed",
    note: "完成接口",
    nextStep: null,
    occurredAt: "2026-08-18T08:25:00.000Z",
    recordedAt: "2026-08-18T08:25:00.000Z",
    updatedAt: "2026-08-18T08:25:00.000Z",
    revision: 1,
    deletedAt: null,
    ...overrides,
  };
}

function agentRunFixture(status: AgentRunRecord["status"]): AgentRunRecord {
  return {
    id: RUN_ID,
    userId: USER_ID,
    periodSnapshotId: SNAPSHOT_ID,
    workflowName: "trajectory.weekly-review.v1",
    workflowVersion: "1",
    provider: "openai",
    model: "test-model",
    promptVersion: "1",
    outputSchemaVersion: "1",
    inputHash: "a".repeat(64),
    forceLowData: false,
    status,
    rawOutput: null,
    sdkTraceId: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    attempts: status === "queued" ? 0 : 1,
    errorCode: null,
    errorDetailRedacted: null,
    startedAt: status === "queued" ? null : "2026-08-22T08:00:00.000Z",
    finishedAt: status === "succeeded" ? "2026-08-22T08:00:01.000Z" : null,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:01.000Z",
  };
}

function reviewViewFixture(status: "pending" | "edited" = "pending"): WeeklyReviewView {
  return {
    run: agentRunFixture("succeeded"),
    review: {
      id: REVIEW_ID,
      userId: USER_ID,
      periodId: PERIOD_ID,
      snapshotId: SNAPSHOT_ID,
      agentRunId: RUN_ID,
      version: 1,
      status: status === "pending" ? "pending" : "partially_confirmed",
      limitations: [],
      createdAt: "2026-08-22T08:00:01.000Z",
      confirmedAt: null,
    },
    claims: [
      {
        id: CLAIM_ID,
        userId: USER_ID,
        reviewVersionId: REVIEW_ID,
        claimType: "direction",
        statement: "似乎在推进产品验证",
        rationale: "任务形成连续证据",
        confidence: "medium",
        status,
        userRevision: status === "edited" ? "我是在验证时间管理产品" : null,
        position: 0,
        proposedDirection: { name: "时间管理产品验证", relation: "direct" },
        evidence: [
          {
            id: EVIDENCE_ID,
            userId: USER_ID,
            claimId: CLAIM_ID,
            entityType: "task",
            entityId: ITEM_ID,
            role: "supports",
            excerpt: "任务证据",
            excludedAt: null,
            exclusionReason: null,
          },
        ],
        memoryCandidate: null,
      },
    ],
    commitments: [commitmentFixture()],
  };
}

function memoryFixture(): ConfirmedMemoryRecord {
  return {
    id: MEMORY_ID,
    userId: USER_ID,
    memoryType: "direction",
    value: { summary: "验证时间管理产品" },
    sourceCandidateId: null,
    sourceReviewId: REVIEW_ID,
    effectiveFrom: "2026-08-22T08:01:00.000Z",
    effectiveTo: null,
    status: "active",
    revision: 1,
    supersedesId: null,
    createdAt: "2026-08-22T08:01:00.000Z",
    updatedAt: "2026-08-22T08:01:00.000Z",
  };
}

function commitmentFixture(): CommitmentRecord {
  return {
    id: COMMITMENT_ID,
    userId: USER_ID,
    sourceReviewId: REVIEW_ID,
    targetPeriodId: null,
    title: "完成轨迹闭环",
    reason: "延续已有投入",
    evidenceIds: [],
    status: "proposed",
    position: 0,
    revision: 1,
    createdAt: "2026-08-22T08:00:01.000Z",
    updatedAt: "2026-08-22T08:00:01.000Z",
  };
}
