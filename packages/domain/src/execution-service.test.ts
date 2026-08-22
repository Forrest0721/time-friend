import { describe, expect, it } from "vitest";

import { ExecutionService, ExecutionStoreTransaction } from "./execution-service.js";
import { FocusAdjustment, FocusSegment, FocusSession } from "./focus.js";
import { Item } from "./items.js";
import { ProgressEntry } from "./progress.js";
import { TaskEvent } from "./task-service.js";

function setup() {
  let now = new Date("2026-08-22T08:00:00.000Z");
  let sequence = 0;
  const store = new MemoryExecutionStore();
  const service = new ExecutionService({
    store: { transaction: (work) => work(store) },
    clock: { now: () => new Date(now) },
    ids: { next: () => `id-${++sequence}` },
  });
  return {
    service,
    store,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

describe("ExecutionService", () => {
  it("prevents a second active session and rejects notes as focus targets", async () => {
    const fixture = setup();
    fixture.store.items.push(itemFixture({ id: "task-1" }), itemFixture({ id: "note-1", kind: "note", status: null, priority: null }));

    await fixture.service.startFocus("user-1", { taskId: "task-1", mode: "stopwatch" });
    expect(fixture.store.scheduledDeadlines[0]).toMatchObject({
      name: "focus.cap-stopwatch",
      data: { userId: "user-1", expectedRevision: 1 },
      startAfter: "2026-08-22T20:00:00.000Z",
    });
    await expect(fixture.service.startFocus("user-1", { mode: "pomodoro" })).rejects.toMatchObject({ code: "ACTIVE_FOCUS_EXISTS" });
    await expect(fixture.service.startFocus("user-2", { taskId: "note-1", mode: "pomodoro" })).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    fixture.store.items.push(itemFixture({ id: "note-2", userId: "user-2", kind: "note", status: null, priority: null }));
    await expect(fixture.service.startFocus("user-2", { taskId: "note-2", mode: "pomodoro" })).rejects.toMatchObject({
      code: "INVALID_ITEM_KIND",
    });
  });

  it("runs pause, resume, finish and feedback in one audited flow", async () => {
    const fixture = setup();
    fixture.store.items.push(itemFixture({ id: "task-1" }));
    const started = await fixture.service.startFocus("user-1", { taskId: "task-1", mode: "stopwatch" });
    fixture.setNow("2026-08-22T08:10:00.000Z");
    const paused = await fixture.service.pauseFocus("user-1", started.session.id, 1);
    fixture.setNow("2026-08-22T08:15:00.000Z");
    const resumed = await fixture.service.resumeFocus("user-1", started.session.id, 2);
    fixture.setNow("2026-08-22T08:20:00.000Z");
    const finished = await fixture.service.finishFocus("user-1", started.session.id, 3);
    const feedback = await fixture.service.submitFocusFeedback("user-1", started.session.id, {
      outcome: "completed",
      note: "完成 API",
      completeTask: true,
      expectedRevision: 4,
    });

    expect(paused.session.baseActiveSeconds).toBe(600);
    expect(resumed.session.state).toBe("running");
    expect(finished.session.effectiveSeconds).toBe(900);
    expect(feedback.session.state).toBe("completed");
    expect(feedback.progress).toMatchObject({ outcome: "completed", taskId: "task-1" });
    expect(feedback.task?.status).toBe("completed");
    await expect(fixture.service.getTaskExecutionSummary("user-1", "task-1")).resolves.toMatchObject({
      totalFocusSeconds: 900,
      sessionCount: 1,
      pomodoroCount: 0,
      recentProgress: [expect.objectContaining({ outcome: "completed" })],
    });
    await expect(fixture.service.listFocusRecords({ userId: "user-1" })).resolves.toEqual([
      expect.objectContaining({ session: expect.objectContaining({ id: started.session.id }), progress: feedback.progress }),
    ]);
    expect(fixture.store.events.map((event) => event.eventType)).toEqual([
      "focus_started",
      "focus_paused",
      "focus_started",
      "focus_finished",
      "completed",
      "progress_created",
    ]);
  });

  it("preserves unlinked focus feedback as structured progress evidence", async () => {
    const fixture = setup();
    const started = await fixture.service.startFocus("user-1", { mode: "pomodoro", plannedSeconds: 60 });
    fixture.setNow("2026-08-22T08:01:00.000Z");
    await fixture.service.finishFocus("user-1", started.session.id, 1);
    const feedback = await fixture.service.submitFocusFeedback("user-1", started.session.id, {
      outcome: "maintenance",
      expectedRevision: 2,
    });

    expect(feedback.progress).toMatchObject({ taskId: null, outcome: "maintenance", source: "focus_end" });
    expect(fixture.store.events).toHaveLength(0);
  });

  it("treats stale deadline jobs as successful no-ops", async () => {
    const fixture = setup();
    const started = await fixture.service.startFocus("user-1", { mode: "pomodoro", plannedSeconds: 60 });
    fixture.setNow("2026-08-22T08:00:30.000Z");
    await fixture.service.pauseFocus("user-1", started.session.id, 1);
    const result = await fixture.service.expirePomodoro("user-1", started.session.id, 1);

    expect(result).toMatchObject({ applied: false, session: { state: "paused", revision: 2 } });
  });

  it("creates, edits and deletes manual progress with immutable task events", async () => {
    const fixture = setup();
    fixture.store.items.push(itemFixture({ id: "task-1" }));
    const created = await fixture.service.createManualProgress("user-1", "task-1", {
      outcome: "blocked",
      note: "等待接口",
    });
    const updated = await fixture.service.updateProgress("user-1", created.id, {
      outcome: "progressed",
      note: "接口已完成",
      expectedRevision: 1,
    });
    await fixture.service.deleteProgress("user-1", created.id, 2);

    expect(updated).toMatchObject({ outcome: "progressed", revision: 2 });
    expect(fixture.store.progress[0]?.deletedAt).not.toBeNull();
    expect(fixture.store.events.map((event) => event.eventType)).toEqual(["progress_created", "progress_updated", "progress_deleted"]);
  });
});

class MemoryExecutionStore implements ExecutionStoreTransaction {
  sessions: FocusSession[] = [];
  segments: FocusSegment[] = [];
  adjustments: FocusAdjustment[] = [];
  progress: ProgressEntry[] = [];
  items: Item[] = [];
  events: TaskEvent[] = [];
  scheduledDeadlines: Array<Parameters<ExecutionStoreTransaction["scheduleFocusDeadline"]>[0]> = [];

  async findActiveFocusSession(userId: string) {
    return this.sessions.find(
      (session) => session.userId === userId && session.deletedAt === null && ["running", "paused", "needs_attention"].includes(session.state),
    ) ?? null;
  }

  async lockFocusSession(userId: string, id: string) {
    return this.sessions.find((session) => session.userId === userId && session.id === id && session.deletedAt === null) ?? null;
  }

  async listFocusSessions(input: { userId: string; taskId?: string; from?: string; to?: string }) {
    return this.sessions.filter(
      (session) =>
        session.userId === input.userId &&
        session.deletedAt === null &&
        (input.taskId === undefined || session.taskId === input.taskId),
    );
  }

  async saveFocusSession(session: FocusSession, previousRevision: number | null) {
    const index = this.sessions.findIndex((entry) => entry.id === session.id && entry.userId === session.userId);
    if (previousRevision === null) this.sessions.push(session);
    else this.sessions[index] = session;
  }

  async findOpenFocusSegment(userId: string, sessionId: string) {
    return this.segments.find((segment) => segment.userId === userId && segment.sessionId === sessionId && segment.endedAt === null) ?? null;
  }

  async insertFocusSegment(segment: FocusSegment) {
    this.segments.push(segment);
  }

  async closeFocusSegment(segment: FocusSegment) {
    const index = this.segments.findIndex((entry) => entry.id === segment.id);
    this.segments[index] = segment;
  }

  async insertFocusAdjustment(adjustment: FocusAdjustment) {
    this.adjustments.push(adjustment);
  }

  async findProgressEntry(userId: string, id: string) {
    return this.progress.find((entry) => entry.userId === userId && entry.id === id && entry.deletedAt === null) ?? null;
  }

  async listProgressEntries(input: { userId: string; taskId?: string; focusSessionId?: string; from?: string; to?: string }) {
    return this.progress.filter(
      (entry) =>
        entry.userId === input.userId &&
        entry.deletedAt === null &&
        (input.taskId === undefined || entry.taskId === input.taskId) &&
        (input.focusSessionId === undefined || entry.focusSessionId === input.focusSessionId),
    );
  }

  async saveProgressEntry(entry: ProgressEntry, previousRevision: number | null) {
    const index = this.progress.findIndex((current) => current.id === entry.id && current.userId === entry.userId);
    if (previousRevision === null) this.progress.push(entry);
    else this.progress[index] = entry;
  }

  async findItem(userId: string, id: string) {
    return this.items.find((item) => item.userId === userId && item.id === id && item.deletedAt === null) ?? null;
  }

  async saveItem(item: Item) {
    const index = this.items.findIndex((entry) => entry.userId === item.userId && entry.id === item.id);
    this.items[index] = item;
  }

  async appendTaskEvents(events: readonly TaskEvent[]) {
    this.events.push(...events);
  }

  async scheduleFocusDeadline(job: Parameters<ExecutionStoreTransaction["scheduleFocusDeadline"]>[0]) {
    this.scheduledDeadlines.push(job);
  }
}

function itemFixture(overrides: Partial<Item> = {}): Item {
  return {
    id: "task-1",
    userId: "user-1",
    listId: "list-1",
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
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}
