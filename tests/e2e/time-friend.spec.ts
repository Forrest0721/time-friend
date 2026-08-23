import { expect, test, type BrowserContext, type Route } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:4000";
const USER_ID = "00000000-0000-7000-8000-000000000001";
const LIST_ID = "00000000-0000-7000-8000-000000000011";
const SECOND_LIST_ID = "00000000-0000-7000-8000-000000000012";
const FOLDER_ID = "00000000-0000-7000-8000-000000000013";
const TASK_ID = "00000000-0000-7000-8000-000000000021";
const SECOND_TASK_ID = "00000000-0000-7000-8000-000000000022";
const FOCUS_ID = "00000000-0000-7000-8000-000000000031";
const PERIOD_ID = "00000000-0000-7000-8000-000000000041";
const REVIEW_ID = "00000000-0000-7000-8000-000000000051";
const CLAIM_ID = "00000000-0000-7000-8000-000000000052";
const EVIDENCE_ID = "00000000-0000-7000-8000-000000000053";
const COMMITMENT_ID = "00000000-0000-7000-8000-000000000054";
const NOW = "2026-08-23T04:00:00.000Z";

test("核心闭环：快速创建任务、专注、结束反馈并进入轨迹", async ({ context, page }) => {
  const api = await installMockApi(context);
  await page.goto("/");

  await page.getByLabel("标题").fill("完成第一版闭环");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("完成第一版闭环", { exact: true })).toBeVisible();
  await expect(page.locator(".connected-message[role='status']")).toContainText("任务已同步");

  await page.locator(".connected-focus-mini").click();
  await expect(page.getByRole("heading", { name: "专注", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "结束并记录" }).click();
  await expect(page.getByRole("heading", { name: "这段时间，发生了什么？" })).toBeVisible();
  await page.getByPlaceholder("留下一句进展，或说明阻塞").fill("核心路径已经跑通");
  await page.getByRole("button", { name: "记入轨迹" }).click();

  await expect(page.locator(".connected-message[role='status']")).toContainText("这段真实投入已经进入轨迹");
  expect(api.createdItems).toHaveLength(1);
  expect(api.feedbackCount).toBe(1);
});

test("刷新后按服务端时间恢复活动计时，不从零重新开始", async ({ context, page }) => {
  const startedAt = new Date(Date.now() - 95_000).toISOString();
  await installMockApi(context, { activeFocus: focusView("running", 1, startedAt, TASK_ID, "stopwatch", null) });
  await page.goto("/");
  await openFocus(page);

  const timer = page.locator(".connected-timer b");
  await expect(timer).toHaveText(/^01:(3[0-9]|4[0-9])$/);
  await page.reload();
  await openFocus(page);
  await expect(timer).toHaveText(/^01:(3[0-9]|4[0-9]|5[0-9])$/);
});

test("两个标签页同时开始专注时，服务端单活动会话约束阻止第二次创建", async ({ context, page }) => {
  const api = await installMockApi(context);
  const second = await context.newPage();
  await Promise.all([page.goto("/"), second.goto("/")]);
  await Promise.all([openFocus(page), openFocus(second)]);

  await page.getByRole("button", { name: "开始专注" }).click();
  await expect(page.getByRole("button", { name: "结束并记录" })).toBeVisible();
  await second.getByRole("button", { name: "开始专注" }).click();
  await expect(second.locator(".connected-message[role='status']")).toContainText("已有正在进行的专注");
  expect(api.startAttempts).toBe(2);
});

test("断网创建保存在 IndexedDB，恢复网络后使用原幂等请求自动同步", async ({ context, page }) => {
  const api = await installMockApi(context);
  await page.goto("/");
  api.failCreates = true;
  await context.setOffline(true);

  await page.getByLabel("标题").fill("离线也不能丢失");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("尚未同步，内容已保存在本机")).toBeVisible();

  api.failCreates = false;
  await context.setOffline(false);
  await expect(page.locator(".connected-message[role='status']")).toContainText("任务已同步");
  await expect(page.getByText("离线也不能丢失", { exact: true })).toBeVisible();
  expect(api.createdItems).toHaveLength(1);
  expect(new Set(api.createIdempotencyKeys).size).toBe(1);
});

test("Agent 关闭时事实、任务和专注仍可用，且不会提供生成入口", async ({ context, page }) => {
  await installMockApi(context, { agentEnabled: false, items: [itemFixture(TASK_ID, "保留真实行动")] });
  await page.goto("/");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /轨迹/ }).click();

  await page.getByRole("button", { name: "长期记忆" }).click();
  await expect(page.getByRole("heading", { name: "长期记忆", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回周轨迹" }).click();

  await expect(page.getByText("Agent 分析已关闭", { exact: true })).toBeVisible();
  await expect(page.getByText("真实投入")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 Agent 解释" })).toBeDisabled();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /任务/ }).click();
  await expect(page.getByText("保留真实行动", { exact: true })).toBeVisible();
});

test("已有清单可以移入文件夹，并在重新加载组织数据后显示在文件夹内", async ({ context, page }) => {
  const api = await installMockApi(context, {
    folders: [folderFixture(FOLDER_ID, "工作")],
    lists: [listFixture(LIST_ID, "收集箱", { isInbox: true }), listFixture(SECOND_LIST_ID, "见时产品")],
  });
  await page.goto("/");

  page.once("dialog", (dialog) => dialog.accept("1"));
  await page.getByTitle("移动到文件夹").click();

  await expect(page.locator(".connected-organization-heading", { hasText: "工作" }).locator("xpath=following-sibling::*[1]"))
    .toContainText("见时产品");
  expect(api.listMoveBodies).toEqual([{ folderId: FOLDER_ID, expectedRevision: 1 }]);
});

test("任务详情可以调整为一层子任务，并在刷新数据后保留关系", async ({ context, page }) => {
  const api = await installMockApi(context, {
    items: [itemFixture(TASK_ID, "主任务"), itemFixture(SECOND_TASK_ID, "待归入的任务")],
  });
  await page.goto("/");

  await page.getByText("待归入的任务", { exact: true }).click();
  const detail = page.locator(".connected-detail");
  await detail.getByLabel("父任务").selectOption(TASK_ID);
  await detail.getByRole("button", { name: "保存内容" }).click();

  await expect(page.locator(".connected-subtasks")).toContainText("待归入的任务");
  expect(api.moveBodies).toEqual([expect.objectContaining({ parentTaskId: TASK_ID })]);
});

test("关闭详情前最后一次编辑也会写入本机草稿并可恢复", async ({ context, page }) => {
  await installMockApi(context, { items: [itemFixture(TASK_ID, "需要补充说明")] });
  await page.goto("/");

  await page.getByText("需要补充说明", { exact: true }).click();
  const detail = page.locator(".connected-detail");
  await detail.locator("[contenteditable='true']").fill("尚未提交的最后一句");
  await detail.locator(".connected-detail-top button").click();
  await page.getByText("需要补充说明", { exact: true }).click();

  await expect(page.locator(".connected-detail [contenteditable='true']")).toContainText("尚未提交的最后一句");
});

test("URL 保存当前模块、清单和任务，刷新后恢复详情上下文", async ({ context, page }) => {
  await installMockApi(context, { items: [itemFixture(TASK_ID, "刷新后仍选中")] });
  await page.goto("/");
  await page.getByText("刷新后仍选中", { exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`view=tasks.*list=${LIST_ID}.*item=${TASK_ID}`));
  await page.reload();
  await expect(page.locator(".connected-detail .connected-title-input")).toHaveValue("刷新后仍选中");
});

test("周轨迹可展开证据、结构化校正、确认重点并把重点带回任务页", async ({ context, page }) => {
  const api = await installMockApi(context, {
    items: [itemFixture(TASK_ID, "完成轨迹闭环")],
    review: reviewFixture(),
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /轨迹/ }).click();

  await page.getByRole("button", { name: "查看 1 条证据" }).click();
  const drawer = page.getByRole("dialog", { name: "本周主要在推进见时闭环" });
  await expect(drawer).toContainText("完成轨迹闭环");
  await expect(drawer).toContainText("正计时 · 1h 00m");
  await drawer.getByRole("button", { name: "关闭证据抽屉" }).click();

  await page.locator(".connected-claim-corrections select").selectOption("maintenance");
  await page.getByRole("button", { name: "应用校正" }).click();
  await expect(page.getByRole("status")).toContainText("以后同类记录会优先视为维持事务");
  await page.getByRole("button", { name: "保留" }).click();
  await page.getByRole("button", { name: "确认这份周轨迹" }).click();

  expect(api.correctionKinds).toEqual(["maintenance"]);
  expect(api.confirmedReviews).toBe(1);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /任务/ }).click();
  await expect(page.locator(".connected-task-commitment-hint")).toContainText("继续完成轨迹闭环");
});

async function openFocus(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /专注/ }).click();
  await expect(page.getByRole("heading", { name: "专注", exact: true })).toBeVisible();
}

interface MockOptions {
  activeFocus?: ReturnType<typeof focusView> | null;
  agentEnabled?: boolean;
  folders?: ReturnType<typeof folderFixture>[];
  lists?: ReturnType<typeof listFixture>[];
  items?: ReturnType<typeof itemFixture>[];
  review?: ReturnType<typeof reviewFixture> | null;
}

async function installMockApi(context: BrowserContext, options: MockOptions = {}) {
  const state = {
    activeFocus: options.activeFocus ?? null,
    folders: [...(options.folders ?? [])],
    lists: [...(options.lists ?? [listFixture(LIST_ID, "收集箱", { isInbox: true })])],
    items: [...(options.items ?? [])],
    records: [] as Array<{ session: ReturnType<typeof focusSession>; progress: null }>,
    createdItems: [] as ReturnType<typeof itemFixture>[],
    createIdempotencyKeys: [] as string[],
    failCreates: false,
    startAttempts: 0,
    feedbackCount: 0,
    listMoveBodies: [] as Array<{ folderId: string | null; expectedRevision: number }>,
    moveBodies: [] as Array<{ listId: string; groupId: string | null; parentTaskId: string | null }>,
    review: options.review ?? null,
    currentCommitments: [] as ReturnType<typeof commitmentFixture>[],
    correctionKinds: [] as string[],
    confirmedReviews: 0,
  };
  await context.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/get-session") return json(route, { user: { id: USER_ID } });
    if (path === "/api/v1/bootstrap") return json(route, bootstrapFixture(state.folders, state.lists, state.items, state.activeFocus, options.agentEnabled ?? true));
    if (path === "/api/v1/commitments/current") return json(route, { items: state.currentCommitments });
    if (path === "/api/v1/telemetry/events") return route.fulfill({ status: 204 });
    if (path === "/api/v1/items" && method === "POST") {
      const body = request.postDataJSON() as { id: string; title: string; kind: "task" | "note"; listId: string; plannedOn?: string | null; priority?: "none" | "low" | "medium" | "high" | null };
      state.createIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      if (state.failCreates) return route.abort("internetdisconnected");
      const created = itemFixture(body.id, body.title, body);
      state.items.push(created);
      state.createdItems.push(created);
      return json(route, created, 201);
    }
    const listRoute = path.match(/^\/api\/v1\/lists\/([^/]+)$/);
    if (listRoute && method === "PATCH") {
      const body = request.postDataJSON() as { folderId: string | null; expectedRevision: number };
      state.listMoveBodies.push(body);
      const index = state.lists.findIndex((list) => list.id === listRoute[1]);
      if (index < 0) return json(route, { code: "NOT_FOUND", title: "清单不存在" }, 404);
      const updated = { ...state.lists[index]!, folderId: body.folderId, revision: state.lists[index]!.revision + 1, updatedAt: new Date().toISOString() };
      state.lists[index] = updated;
      return json(route, updated);
    }
    const itemRoute = path.match(/^\/api\/v1\/items\/([^/]+)(\/move)?$/);
    if (itemRoute && method === "POST" && itemRoute[2] === "/move") {
      const body = request.postDataJSON() as { listId: string; groupId: string | null; parentTaskId: string | null };
      state.moveBodies.push(body);
      const index = state.items.findIndex((item) => item.id === itemRoute[1]);
      if (index < 0) return json(route, { code: "NOT_FOUND", title: "内容不存在" }, 404);
      const updated = { ...state.items[index]!, ...body, revision: state.items[index]!.revision + 1, updatedAt: new Date().toISOString() };
      state.items[index] = updated;
      return json(route, updated);
    }
    if (itemRoute && method === "PATCH" && !itemRoute[2]) {
      const body = request.postDataJSON() as Partial<ReturnType<typeof itemFixture>>;
      const index = state.items.findIndex((item) => item.id === itemRoute[1]);
      if (index < 0) return json(route, { code: "NOT_FOUND", title: "内容不存在" }, 404);
      const updated = { ...state.items[index]!, ...body, revision: state.items[index]!.revision + 1, updatedAt: new Date().toISOString() };
      state.items[index] = updated;
      return json(route, updated);
    }
    if (path === "/api/v1/focus-sessions" && method === "GET") return json(route, { items: state.records, nextCursor: null });
    if (path === "/api/v1/focus-sessions" && method === "POST") {
      state.startAttempts += 1;
      if (state.activeFocus) return json(route, { code: "FOCUS_ALREADY_ACTIVE", title: "已有正在进行的专注" }, 409);
      const body = request.postDataJSON() as { taskId?: string | null; mode: "pomodoro" | "stopwatch"; plannedSeconds?: number | null };
      state.activeFocus = focusView("running", 1, new Date().toISOString(), body.taskId ?? null, body.mode, body.plannedSeconds ?? null);
      return json(route, state.activeFocus, 201);
    }
    if (path === `/api/v1/focus-sessions/${FOCUS_ID}/finish` && method === "POST") {
      state.activeFocus = focusView("awaiting_feedback", 2, state.activeFocus?.session.startedAt ?? new Date().toISOString(), state.activeFocus?.session.taskId ?? null);
      return json(route, state.activeFocus);
    }
    if (path === `/api/v1/focus-sessions/${FOCUS_ID}/feedback` && method === "POST") {
      state.feedbackCount += 1;
      const completed = focusSession("completed", 3, state.activeFocus?.session.startedAt ?? new Date().toISOString(), state.activeFocus?.session.taskId ?? null);
      state.records.unshift({ session: completed, progress: null });
      state.activeFocus = null;
      return json(route, { session: completed, task: state.items.find((item) => item.id === completed.taskId) ?? null });
    }
    if (path === "/api/v1/trajectory/weeks" && method === "GET") return json(route, { items: [weekSummary()] });
    if (path === `/api/v1/trajectory/weeks/${PERIOD_ID}` && method === "GET") return json(route, { ...weekSummary(), review: state.review });
    if (path === "/api/v1/memories" && method === "GET") return json(route, { items: [] });
    if (path === "/api/v1/directions" && method === "GET") return json(route, { items: [] });
    if (path === `/api/v1/review-claims/${CLAIM_ID}/correct` && method === "POST" && state.review) {
      const body = request.postDataJSON() as { kind: string };
      state.correctionKinds.push(body.kind);
      state.review = {
        ...state.review,
        claims: state.review.claims.map((claim) => claim.id === CLAIM_ID
          ? { ...claim, status: "edited" as const, correctionKind: body.kind, userRevision: "这部分投入属于维持事务" }
          : claim),
      };
      return json(route, { review: state.review, futureEffect: "以后同类记录会优先视为维持事务，仍可逐条纠正。" });
    }
    if (path === `/api/v1/commitments/${COMMITMENT_ID}/confirm` && method === "POST" && state.review) {
      const updated = { ...state.review.commitments[0]!, status: "confirmed" as const, revision: 2, updatedAt: new Date().toISOString() };
      state.review = { ...state.review, commitments: [updated] };
      state.currentCommitments = [updated];
      return json(route, updated);
    }
    if (path === `/api/v1/reviews/${REVIEW_ID}/confirm` && method === "POST" && state.review) {
      state.confirmedReviews += 1;
      state.review = { ...state.review, review: { ...state.review.review!, status: "confirmed" as const, confirmedAt: new Date().toISOString() } };
      return json(route, state.review);
    }
    return json(route, { code: "MOCK_ROUTE_MISSING", title: `${method} ${path} 未配置` }, 501);
  });
  return state;
}

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function bootstrapFixture(
  folders: ReturnType<typeof folderFixture>[],
  lists: ReturnType<typeof listFixture>[],
  items: ReturnType<typeof itemFixture>[],
  activeFocus: ReturnType<typeof focusView> | null,
  agentEnabled: boolean,
) {
  return {
    user: { id: USER_ID, email: "forrest@example.com", name: "Forrest", timezone: "Asia/Shanghai", weekStartsOn: 1, agentEnabled },
    folders,
    lists,
    groups: [],
    items,
    activeFocusSession: activeFocus,
    pendingReviews: 0,
  };
}

function folderFixture(id: string, name: string) {
  return { id, userId: USER_ID, name, positionKey: "a0", archivedAt: null, revision: 1, createdAt: NOW, updatedAt: NOW };
}

function listFixture(id: string, name: string, input: Partial<{ folderId: string | null; isInbox: boolean }> = {}) {
  return { id, userId: USER_ID, folderId: input.folderId ?? null, name, positionKey: `a${id.slice(-4)}`, isInbox: input.isInbox ?? false, learningPolicy: "include" as const, archivedAt: null, revision: 1, createdAt: NOW, updatedAt: NOW };
}

function itemFixture(id: string, title: string, input: Partial<{ kind: "task" | "note"; listId: string; groupId: string | null; parentTaskId: string | null; plannedOn: string | null; priority: "none" | "low" | "medium" | "high" | null }> = {}) {
  const kind = input.kind ?? "task";
  return {
    id,
    userId: USER_ID,
    listId: input.listId ?? LIST_ID,
    groupId: input.groupId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    kind,
    title,
    status: kind === "task" ? "pending" as const : null,
    priority: kind === "task" ? input.priority ?? "none" : null,
    plannedOn: kind === "task" ? input.plannedOn ?? null : null,
    contentDoc: { type: "doc" as const, schemaVersion: 1 as const, content: [] },
    contentText: "",
    positionKey: `a${id.slice(-4)}`,
    completedAt: null,
    abandonedAt: null,
    revision: 1,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function focusView(
  state: "running" | "awaiting_feedback",
  revision: number,
  startedAt: string,
  taskId: string | null = TASK_ID,
  mode: "pomodoro" | "stopwatch" = "pomodoro",
  plannedSeconds: number | null = 1_500,
) {
  return { session: focusSession(state, revision, startedAt, taskId, mode, plannedSeconds), openSegment: state === "running" ? { id: "segment" } : null, serverNow: new Date().toISOString() };
}

function focusSession(
  state: "running" | "awaiting_feedback" | "completed",
  revision: number,
  startedAt: string,
  taskId: string | null,
  mode: "pomodoro" | "stopwatch" = "pomodoro",
  plannedSeconds: number | null = 1_500,
) {
  return {
    id: FOCUS_ID,
    userId: USER_ID,
    taskId,
    mode,
    state,
    plannedSeconds,
    startedAt,
    endedAt: state === "running" ? null : new Date().toISOString(),
    expectedEndAt: state === "running" && plannedSeconds ? new Date(Date.parse(startedAt) + plannedSeconds * 1_000).toISOString() : null,
    baseActiveSeconds: state === "running" ? 0 : 5,
    effectiveSeconds: state === "completed" ? 5 : null,
    revision,
    deletedAt: null,
    createdAt: startedAt,
    updatedAt: new Date().toISOString(),
  };
}

function weekSummary() {
  return {
    period: { id: PERIOD_ID, localStartDate: "2026-08-17", localEndDate: "2026-08-23", startsAt: "2026-08-16T16:00:00.000Z", endsAt: "2026-08-23T16:00:00.000Z", timezone: "Asia/Shanghai" },
    snapshots: [{
      id: "00000000-0000-7000-8000-000000000042",
      version: 1,
      status: "current",
      metrics: {
        focus: { totalSeconds: 3_600, sessionCount: 3, pomodoroCount: 2, unlinkedSeconds: 0, byList: [{ listId: LIST_ID, listName: "收集箱", seconds: 3_600 }] },
        progress: { completed: 1, progressed: 2, blocked: 0, maintenance: 1 },
        tasks: { completedIds: [], abandonedIds: [], plannedButUnfinishedIds: [TASK_ID] },
        dataQuality: { evidenceCount: 5, unlinkedFocusRatio: 0, hasEnoughData: true },
      },
    }],
  };
}

function commitmentFixture() {
  return {
    id: COMMITMENT_ID,
    userId: USER_ID,
    sourceReviewId: REVIEW_ID,
    targetPeriodId: "00000000-0000-7000-8000-000000000061",
    title: "继续完成轨迹闭环",
    reason: "让下周行动继承本周选择",
    evidenceIds: [EVIDENCE_ID],
    status: "proposed" as "proposed" | "confirmed" | "paused" | "dropped" | "completed",
    position: 0,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function reviewFixture() {
  return {
    run: {
      id: "00000000-0000-7000-8000-000000000050",
      userId: USER_ID,
      periodId: PERIOD_ID,
      snapshotId: "00000000-0000-7000-8000-000000000042",
      workflowName: "trajectory.weekly-review.v1",
      workflowVersion: "1",
      status: "succeeded" as const,
      sdkTraceId: "trace-test",
      inputTokens: 100,
      outputTokens: 40,
      durationMs: 900,
      attempts: 1,
      errorCode: null,
      startedAt: NOW,
      finishedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    },
    review: {
      id: REVIEW_ID,
      userId: USER_ID,
      periodId: PERIOD_ID,
      snapshotId: "00000000-0000-7000-8000-000000000042",
      agentRunId: "00000000-0000-7000-8000-000000000050",
      version: 1,
      status: "pending" as "pending" | "partially_confirmed" | "confirmed" | "superseded",
      limitations: [],
      createdAt: NOW,
      confirmedAt: null as string | null,
    },
    claims: [{
      id: CLAIM_ID,
      userId: USER_ID,
      reviewVersionId: REVIEW_ID,
      claimType: "direction" as const,
      statement: "本周主要在推进见时闭环",
      rationale: "任务、专注和进展证据集中支持这一判断。",
      confidence: "high" as const,
      status: "pending" as "pending" | "accepted" | "edited" | "rejected",
      userRevision: null as string | null,
      correctionKind: null as string | null,
      position: 0,
      proposedDirection: { name: "见时闭环", relation: "direct" as const },
      evidence: [{
        id: EVIDENCE_ID,
        userId: USER_ID,
        claimId: CLAIM_ID,
        entityType: "focus_session" as const,
        entityId: FOCUS_ID,
        role: "supports" as const,
        excerpt: null,
        excludedAt: null,
        exclusionReason: null,
        detail: { title: "完成轨迹闭环", occurredAt: NOW, taskId: TASK_ID, listId: LIST_ID, metrics: { mode: "stopwatch", periodSeconds: 3_600 } },
      }],
      memoryCandidate: null,
    }],
    commitments: [commitmentFixture()],
  };
}
