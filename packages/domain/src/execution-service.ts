import {
  adjustFocusBoundaries,
  adjustFocusDuration,
  attachDeferredFocusFeedback,
  cancelFocus,
  capStopwatch,
  completeFocusFeedback,
  expirePomodoro,
  finishFocus,
  FocusAdjustment,
  FocusMode,
  FocusMutation,
  FocusSegment,
  FocusSession,
  pauseFocus,
  resumeFocus,
  retargetFocus,
  softDeleteFocus,
  startFocus,
} from "./focus.js";
import { DomainError } from "./errors.js";
import { Item, TaskEventDraft, transitionTask as transitionTaskState } from "./items.js";
import { Clock, IdGenerator, toIso } from "./primitives.js";
import {
  createProgress,
  ProgressEntry,
  ProgressOutcome,
  softDeleteProgress,
  updateProgress,
} from "./progress.js";
import { TaskEvent } from "./task-service.js";

export interface ExecutionStoreTransaction {
  findActiveFocusSession(userId: string): Promise<FocusSession | null>;
  lockFocusSession(userId: string, id: string): Promise<FocusSession | null>;
  listFocusSessions(input: { userId: string; taskId?: string; from?: string; to?: string }): Promise<FocusSession[]>;
  saveFocusSession(session: FocusSession, previousRevision: number | null): Promise<void>;
  findOpenFocusSegment(userId: string, sessionId: string): Promise<FocusSegment | null>;
  listFocusSegments(userId: string, sessionId: string, lock?: boolean): Promise<FocusSegment[]>;
  insertFocusSegment(segment: FocusSegment): Promise<void>;
  closeFocusSegment(segment: FocusSegment): Promise<void>;
  updateFocusSegment(segment: FocusSegment): Promise<void>;
  insertFocusAdjustment(adjustment: FocusAdjustment): Promise<void>;
  findProgressEntry(userId: string, id: string, lock?: boolean): Promise<ProgressEntry | null>;
  listProgressEntries(input: {
    userId: string;
    taskId?: string;
    focusSessionId?: string;
    from?: string;
    to?: string;
  }): Promise<ProgressEntry[]>;
  saveProgressEntry(entry: ProgressEntry, previousRevision: number | null): Promise<void>;
  findItem(userId: string, id: string): Promise<Item | null>;
  saveItem(item: Item, previousRevision: number | null): Promise<void>;
  appendTaskEvents(events: readonly TaskEvent[]): Promise<void>;
  scheduleFocusDeadline(job: FocusDeadlineJob): Promise<void>;
}

export interface FocusDeadlineJob {
  name: "pomodoro.expire" | "focus.cap-stopwatch";
  data: { userId: string; sessionId: string; expectedRevision: number };
  startAfter: string;
  singletonKey: string;
}

export interface ExecutionStore {
  transaction<T>(work: (transaction: ExecutionStoreTransaction) => Promise<T>): Promise<T>;
}

export interface ExecutionServiceDependencies {
  store: ExecutionStore;
  clock: Clock;
  ids: IdGenerator;
}

export interface FocusSessionView {
  session: FocusSession;
  openSegment: FocusSegment | null;
  serverNow: string;
}

export interface FocusRecord {
  session: FocusSession;
  progress: ProgressEntry | null;
}

export interface TaskExecutionSummary {
  totalFocusSeconds: number;
  sessionCount: number;
  pomodoroCount: number;
  recentProgress: ProgressEntry[];
}

interface FocusOutcomeInput {
  outcome: Exclude<ProgressOutcome, "note">;
  note?: string | null;
  nextStep?: string | null;
  completeTask?: boolean;
}

export class ExecutionService {
  constructor(private readonly dependencies: ExecutionServiceDependencies) {}

  async getActiveFocusSession(userId: string): Promise<FocusSessionView | null> {
    return this.dependencies.store.transaction(async (transaction) => {
      const session = await transaction.findActiveFocusSession(userId);
      if (!session) return null;
      const openSegment = session.state === "running" ? await transaction.findOpenFocusSegment(userId, session.id) : null;
      return this.view(session, openSegment);
    });
  }

  async listFocusSessions(input: { userId: string; taskId?: string; from?: string; to?: string }): Promise<FocusSession[]> {
    return this.dependencies.store.transaction((transaction) => transaction.listFocusSessions(input));
  }

  async listProgressEntries(input: { userId: string; taskId?: string; focusSessionId?: string }): Promise<ProgressEntry[]> {
    return this.dependencies.store.transaction((transaction) => transaction.listProgressEntries(input));
  }

  async listFocusRecords(input: {
    userId: string;
    taskId?: string;
    from?: string;
    to?: string;
  }): Promise<FocusRecord[]> {
    return this.dependencies.store.transaction(async (transaction) => {
      const sessions = await transaction.listFocusSessions(input);
      const progress = await transaction.listProgressEntries({ userId: input.userId, from: input.from, to: input.to });
      const bySession = new Map(
        progress.filter((entry) => entry.focusSessionId !== null).map((entry) => [entry.focusSessionId!, entry]),
      );
      return sessions.map((session) => ({ session, progress: bySession.get(session.id) ?? null }));
    });
  }

  async getTaskExecutionSummary(userId: string, taskId: string): Promise<TaskExecutionSummary> {
    return this.dependencies.store.transaction(async (transaction) => {
      await this.requireTask(transaction, userId, taskId);
      const sessions = await transaction.listFocusSessions({ userId, taskId });
      const counted = sessions.filter((session) => session.state === "completed" || session.state === "awaiting_feedback");
      const progress = await transaction.listProgressEntries({ userId, taskId });
      return {
        totalFocusSeconds: counted.reduce(
          (total, session) => total + (session.effectiveSeconds ?? session.baseActiveSeconds),
          0,
        ),
        sessionCount: counted.length,
        pomodoroCount: counted.filter((session) => session.mode === "pomodoro").length,
        recentProgress: progress.slice(0, 10),
      };
    });
  }

  async startFocus(
    userId: string,
    input: { id?: string; taskId?: string | null; mode: FocusMode; plannedSeconds?: number | null },
  ): Promise<FocusSessionView> {
    return this.dependencies.store.transaction(async (transaction) => {
      const active = await transaction.findActiveFocusSession(userId);
      if (active) throw new DomainError("ACTIVE_FOCUS_EXISTS", "已有进行中的专注", { sessionId: active.id });
      const task = input.taskId ? await this.requireTask(transaction, userId, input.taskId) : null;
      const mutation = startFocus(input, this.context(userId));
      await transaction.saveFocusSession(mutation.session, null);
      await transaction.insertFocusSegment(mutation.openedSegment!);
      await this.appendFocusEvent(transaction, mutation.session, task, "focus_started", { action: "started" });
      await this.scheduleDeadline(transaction, mutation.session);
      return this.view(mutation.session, mutation.openedSegment!);
    });
  }

  pauseFocus(userId: string, id: string, expectedRevision: number): Promise<FocusSessionView> {
    return this.mutateFocus(userId, id, "focus_paused", (session, open) => {
      if (!open) throw new DomainError("INVALID_RELATION", "运行中的专注缺少开放时间段");
      return pauseFocus(session, open, this.context(userId), expectedRevision);
    });
  }

  async resumeFocus(userId: string, id: string, expectedRevision: number): Promise<FocusSessionView> {
    return this.dependencies.store.transaction(async (transaction) => {
      const session = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const active = await transaction.findActiveFocusSession(userId);
      if (active && active.id !== session.id) {
        throw new DomainError("ACTIVE_FOCUS_EXISTS", "已有进行中的专注", { sessionId: active.id });
      }
      const mutation = resumeFocus(session, this.context(userId), expectedRevision);
      await this.persistFocusMutation(transaction, session, mutation);
      const task = mutation.session.taskId ? await this.requireTask(transaction, userId, mutation.session.taskId) : null;
      await this.appendFocusEvent(transaction, mutation.session, task, "focus_started", { action: "resumed" });
      await this.scheduleDeadline(transaction, mutation.session);
      return this.view(mutation.session, mutation.openedSegment!);
    });
  }

  finishFocus(userId: string, id: string, expectedRevision: number): Promise<FocusSessionView> {
    return this.mutateFocus(userId, id, "focus_finished", (session, open) =>
      finishFocus(session, open, this.context(userId), expectedRevision),
    );
  }

  cancelFocus(userId: string, id: string, expectedRevision: number): Promise<FocusSessionView> {
    return this.mutateFocus(userId, id, "focus_finished", (session, open) =>
      cancelFocus(session, open, this.context(userId), expectedRevision),
    );
  }

  async expirePomodoro(userId: string, id: string, expectedRevision: number): Promise<{ applied: boolean; session: FocusSession }> {
    return this.deadlineTransition(userId, id, expectedRevision, (session, open) => {
      if (!open) throw new DomainError("INVALID_RELATION", "运行中的专注缺少开放时间段");
      return expirePomodoro(session, open, this.context(userId), expectedRevision);
    });
  }

  async capStopwatch(userId: string, id: string, expectedRevision: number): Promise<{ applied: boolean; session: FocusSession }> {
    return this.deadlineTransition(userId, id, expectedRevision, (session, open) => {
      if (!open) throw new DomainError("INVALID_RELATION", "运行中的专注缺少开放时间段");
      return capStopwatch(session, open, this.context(userId), expectedRevision);
    });
  }

  async submitFocusFeedback(
    userId: string,
    id: string,
    input: {
      outcome: Exclude<ProgressOutcome, "note"> | null;
      note?: string | null;
      nextStep?: string | null;
      completeTask?: boolean;
      effectiveSeconds?: number;
      adjustmentReason?: string;
      expectedRevision: number;
    },
  ): Promise<{ session: FocusSession; progress: ProgressEntry | null; task: Item | null }> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      if (input.completeTask && input.outcome !== "completed") {
        throw new DomainError("INVALID_RELATION", "只有完成反馈才能同时完成任务");
      }
      let pending = current;
      let adjustment: FocusAdjustment | null = null;
      if (input.effectiveSeconds !== undefined) {
        if (!input.adjustmentReason) throw new DomainError("INVALID_RELATION", "修正有效时长时必须填写原因");
        const adjusted = adjustFocusDuration(
          pending,
          input.effectiveSeconds,
          input.adjustmentReason,
          this.context(userId),
          input.expectedRevision,
        );
        pending = adjusted.session;
        adjustment = adjusted.adjustment;
      }
      const session = completeFocusFeedback(
        pending,
        this.context(userId),
        input.effectiveSeconds === undefined ? input.expectedRevision : pending.revision,
      );
      const outcome = input.outcome === null
        ? { progress: null, task: session.taskId ? await this.requireTask(transaction, userId, session.taskId) : null, events: [] }
        : await this.recordFocusOutcome(transaction, session, {
            outcome: input.outcome,
            note: input.note,
            nextStep: input.nextStep,
            completeTask: input.completeTask,
          });
      const taskEvents = [...outcome.events];
      if (adjustment) {
        await transaction.insertFocusAdjustment(adjustment);
        if (outcome.task) {
          taskEvents.push({
            taskId: outcome.task.id,
            eventType: "focus_adjusted",
            actorType: "user",
            occurredAt: adjustment.createdAt,
            payload: { sessionId: session.id, beforeSeconds: adjustment.beforeSeconds, afterSeconds: adjustment.afterSeconds },
          });
        }
      }
      await transaction.saveFocusSession(session, current.revision);
      await transaction.appendTaskEvents(this.materializeEvents(userId, taskEvents));
      return { session, progress: outcome.progress, task: outcome.task };
    });
  }

  async addDeferredFocusFeedback(
    userId: string,
    id: string,
    input: FocusOutcomeInput & { expectedRevision: number },
  ): Promise<{ session: FocusSession; progress: ProgressEntry; task: Item | null }> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const existing = await transaction.listProgressEntries({ userId, focusSessionId: id });
      if (existing.length > 0) throw new DomainError("FOCUS_FEEDBACK_EXISTS", "这段专注已经记录过结果");
      const session = attachDeferredFocusFeedback(current, this.context(userId), input.expectedRevision);
      const outcome = await this.recordFocusOutcome(transaction, session, input);
      await transaction.saveFocusSession(session, current.revision);
      await transaction.appendTaskEvents(this.materializeEvents(userId, outcome.events));
      return { session, progress: outcome.progress, task: outcome.task };
    });
  }

  async adjustFocusDuration(
    userId: string,
    id: string,
    input: { effectiveSeconds: number; reason: string; expectedRevision: number },
  ): Promise<FocusSession> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const mutation = adjustFocusDuration(current, input.effectiveSeconds, input.reason, this.context(userId), input.expectedRevision);
      await transaction.saveFocusSession(mutation.session, current.revision);
      await transaction.insertFocusAdjustment(mutation.adjustment);
      const task = current.taskId ? await this.requireTask(transaction, userId, current.taskId) : null;
      await this.appendFocusEvent(transaction, mutation.session, task, "focus_adjusted", {
        beforeSeconds: mutation.adjustment.beforeSeconds,
        afterSeconds: mutation.adjustment.afterSeconds,
      });
      return mutation.session;
    });
  }

  async adjustFocusBoundaries(
    userId: string,
    id: string,
    input: { startedAt: string; endedAt: string; reason: string; expectedRevision: number },
  ): Promise<FocusSession> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const segments = await transaction.listFocusSegments(userId, id, true);
      const mutation = adjustFocusBoundaries(current, segments, input, this.context(userId), input.expectedRevision);
      for (const segment of mutation.segments) await transaction.updateFocusSegment(segment);
      await transaction.saveFocusSession(mutation.session, current.revision);
      await transaction.insertFocusAdjustment(mutation.adjustment);
      const task = current.taskId ? await this.requireTask(transaction, userId, current.taskId) : null;
      await this.appendFocusEvent(transaction, mutation.session, task, "focus_adjusted", {
        kind: "boundaries",
        beforeStartedAt: mutation.adjustment.beforeStartedAt,
        afterStartedAt: mutation.adjustment.afterStartedAt,
        beforeEndedAt: mutation.adjustment.beforeEndedAt,
        afterEndedAt: mutation.adjustment.afterEndedAt,
        beforeSeconds: mutation.adjustment.beforeSeconds,
        afterSeconds: mutation.adjustment.afterSeconds,
      });
      return mutation.session;
    });
  }

  async retargetFocus(
    userId: string,
    id: string,
    input: { taskId: string | null; expectedRevision: number },
  ): Promise<FocusSession> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const oldTask = current.taskId ? await this.requireTask(transaction, userId, current.taskId) : null;
      const newTask = input.taskId ? await this.requireTask(transaction, userId, input.taskId) : null;
      const session = retargetFocus(current, input.taskId, this.context(userId), input.expectedRevision);
      await transaction.saveFocusSession(session, current.revision);
      const drafts: TaskEventDraft[] = [];
      if (oldTask) drafts.push(this.focusEventDraft(oldTask.id, "focus_retargeted", session, { beforeTaskId: oldTask.id, afterTaskId: input.taskId }));
      if (newTask && newTask.id !== oldTask?.id) {
        drafts.push(this.focusEventDraft(newTask.id, "focus_retargeted", session, { beforeTaskId: oldTask?.id ?? null, afterTaskId: newTask.id }));
      }
      await transaction.appendTaskEvents(this.materializeEvents(userId, drafts));
      return session;
    });
  }

  async deleteFocus(userId: string, id: string, expectedRevision: number): Promise<FocusSession> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const session = softDeleteFocus(current, this.context(userId), expectedRevision);
      const progressEntries = await transaction.listProgressEntries({ userId, focusSessionId: id });
      for (const progress of progressEntries) {
        await transaction.saveProgressEntry(softDeleteProgress(progress, this.context(userId), progress.revision), progress.revision);
      }
      await transaction.saveFocusSession(session, current.revision);
      const task = current.taskId ? await this.requireTask(transaction, userId, current.taskId) : null;
      await this.appendFocusEvent(transaction, session, task, "focus_deleted", {});
      return session;
    });
  }

  async createManualProgress(
    userId: string,
    taskId: string,
    input: { id?: string; outcome: Exclude<ProgressOutcome, "completed">; note?: string | null; nextStep?: string | null },
  ): Promise<ProgressEntry> {
    return this.dependencies.store.transaction(async (transaction) => {
      await this.requireTask(transaction, userId, taskId);
      const progress = createProgress({ ...input, taskId, source: "manual" }, this.context(userId));
      await transaction.saveProgressEntry(progress, null);
      await transaction.appendTaskEvents(
        this.materializeEvents(userId, [
          {
            taskId,
            eventType: "progress_created",
            actorType: "user",
            occurredAt: progress.occurredAt,
            payload: { progressEntryId: progress.id, outcome: progress.outcome },
          },
        ]),
      );
      return progress;
    });
  }

  async updateProgress(
    userId: string,
    id: string,
    patch: { outcome?: ProgressOutcome; note?: string | null; nextStep?: string | null; expectedRevision: number },
  ): Promise<ProgressEntry> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findProgressEntry(userId, id, true), "进展记录不存在");
      const progress = updateProgress(current, patch, this.context(userId));
      await transaction.saveProgressEntry(progress, current.revision);
      if (progress.taskId) {
        await transaction.appendTaskEvents(
          this.materializeEvents(userId, [
            {
              taskId: progress.taskId,
              eventType: "progress_updated",
              actorType: "user",
              occurredAt: progress.updatedAt,
              payload: { progressEntryId: progress.id, beforeOutcome: current.outcome, afterOutcome: progress.outcome },
            },
          ]),
        );
      }
      return progress;
    });
  }

  async deleteProgress(userId: string, id: string, expectedRevision: number): Promise<ProgressEntry> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findProgressEntry(userId, id, true), "进展记录不存在");
      const progress = softDeleteProgress(current, this.context(userId), expectedRevision);
      await transaction.saveProgressEntry(progress, current.revision);
      if (progress.taskId) {
        await transaction.appendTaskEvents(
          this.materializeEvents(userId, [
            {
              taskId: progress.taskId,
              eventType: "progress_deleted",
              actorType: "user",
              occurredAt: progress.updatedAt,
              payload: { progressEntryId: progress.id },
            },
          ]),
        );
      }
      return progress;
    });
  }

  private async mutateFocus(
    userId: string,
    id: string,
    eventType: "focus_paused" | "focus_finished",
    mutate: (session: FocusSession, open: FocusSegment | null) => FocusMutation,
  ): Promise<FocusSessionView> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      const open = await transaction.findOpenFocusSegment(userId, id);
      const mutation = mutate(current, open);
      await this.persistFocusMutation(transaction, current, mutation);
      const task = mutation.session.taskId ? await this.requireTask(transaction, userId, mutation.session.taskId) : null;
      await this.appendFocusEvent(transaction, mutation.session, task, eventType, { state: mutation.session.state });
      return this.view(mutation.session, mutation.openedSegment ?? null);
    });
  }

  private async recordFocusOutcome(
    transaction: ExecutionStoreTransaction,
    session: FocusSession,
    input: FocusOutcomeInput,
  ): Promise<{ progress: ProgressEntry; task: Item | null; events: TaskEventDraft[] }> {
    if (input.completeTask && input.outcome !== "completed") {
      throw new DomainError("INVALID_RELATION", "只有完成反馈才能同时完成任务");
    }
    const task = session.taskId ? await this.requireTask(transaction, session.userId, session.taskId) : null;
    if (input.completeTask && !task) throw new DomainError("INVALID_RELATION", "未关联任务的专注不能完成任务");
    if (session.endedAt === null) throw new DomainError("INVALID_RELATION", "未结束专注不能记录结果");

    const progress = createProgress(
      {
        taskId: session.taskId,
        focusSessionId: session.id,
        source: "focus_end",
        outcome: input.outcome,
        note: input.note,
        nextStep: input.nextStep,
        occurredAt: session.endedAt,
      },
      this.context(session.userId),
    );
    const events: TaskEventDraft[] = [];
    let updatedTask = task;
    if (input.completeTask && task) {
      if (task.status === "pending") {
        const completed = transitionTaskState(task, "complete", this.context(session.userId), task.revision);
        updatedTask = completed.item;
        await transaction.saveItem(completed.item, task.revision);
        events.push(...completed.events);
      } else if (task.status !== "completed") {
        throw new DomainError("INVALID_TASK_TRANSITION", "已放弃任务不能由专注反馈完成");
      }
    }
    await transaction.saveProgressEntry(progress, null);
    if (task) {
      events.push({
        taskId: task.id,
        eventType: "progress_created",
        actorType: "user",
        occurredAt: progress.occurredAt,
        payload: { progressEntryId: progress.id, focusSessionId: session.id, outcome: progress.outcome },
      });
    }
    return { progress, task: updatedTask, events };
  }

  private async deadlineTransition(
    userId: string,
    id: string,
    expectedRevision: number,
    mutate: (session: FocusSession, open: FocusSegment | null) => FocusMutation,
  ): Promise<{ applied: boolean; session: FocusSession }> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.lockFocusSession(userId, id), "专注记录不存在");
      if (current.revision !== expectedRevision || current.state !== "running") return { applied: false, session: current };
      const open = await transaction.findOpenFocusSegment(userId, id);
      const mutation = mutate(current, open);
      await this.persistFocusMutation(transaction, current, mutation);
      const task = mutation.session.taskId ? await this.requireTask(transaction, userId, mutation.session.taskId) : null;
      await this.appendFocusEvent(transaction, mutation.session, task, "focus_finished", { reason: mutation.closedSegment?.closeReason });
      return { applied: true, session: mutation.session };
    });
  }

  private async persistFocusMutation(
    transaction: ExecutionStoreTransaction,
    current: FocusSession,
    mutation: FocusMutation,
  ): Promise<void> {
    if (mutation.closedSegment) await transaction.closeFocusSegment(mutation.closedSegment);
    if (mutation.openedSegment) await transaction.insertFocusSegment(mutation.openedSegment);
    await transaction.saveFocusSession(mutation.session, current.revision);
  }

  private async scheduleDeadline(transaction: ExecutionStoreTransaction, session: FocusSession): Promise<void> {
    if (session.state !== "running" || session.expectedEndAt === null) return;
    const name = session.mode === "pomodoro" ? "pomodoro.expire" : "focus.cap-stopwatch";
    await transaction.scheduleFocusDeadline({
      name,
      data: { userId: session.userId, sessionId: session.id, expectedRevision: session.revision },
      startAfter: session.expectedEndAt,
      singletonKey: `${session.id}:${session.revision}`,
    });
  }

  private async requireTask(transaction: ExecutionStoreTransaction, userId: string, taskId: string): Promise<Item> {
    const item = await requireResource(transaction.findItem(userId, taskId), "任务不存在");
    if (item.kind !== "task") throw new DomainError("INVALID_ITEM_KIND", "笔记不能作为专注或进展目标");
    return item;
  }

  private async appendFocusEvent(
    transaction: ExecutionStoreTransaction,
    session: FocusSession,
    task: Item | null,
    eventType: TaskEventDraft["eventType"],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!task) return;
    await transaction.appendTaskEvents(
      this.materializeEvents(session.userId, [this.focusEventDraft(task.id, eventType, session, payload)]),
    );
  }

  private focusEventDraft(
    taskId: string,
    eventType: TaskEventDraft["eventType"],
    session: FocusSession,
    payload: Readonly<Record<string, unknown>>,
  ): TaskEventDraft {
    return {
      taskId,
      eventType,
      actorType: "user",
      occurredAt: toIso(this.dependencies.clock.now()),
      payload: { sessionId: session.id, mode: session.mode, ...payload },
    };
  }

  private materializeEvents(userId: string, drafts: readonly TaskEventDraft[]): TaskEvent[] {
    const recordedAt = toIso(this.dependencies.clock.now());
    return drafts.map((draft) => ({ ...draft, id: this.dependencies.ids.next(), userId, recordedAt, dedupeKey: null }));
  }

  private context(userId: string) {
    return { userId, clock: this.dependencies.clock, ids: this.dependencies.ids };
  }

  private view(session: FocusSession, openSegment: FocusSegment | null): FocusSessionView {
    return { session, openSegment, serverNow: toIso(this.dependencies.clock.now()) };
  }
}

async function requireResource<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) throw new DomainError("RESOURCE_NOT_FOUND", message);
  return value;
}
