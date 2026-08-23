import { assertOwnedBy, assertRevision, DomainError } from "./errors.js";
import { CommandContext, toIso } from "./primitives.js";

export const STOPWATCH_CAP_SECONDS = 12 * 60 * 60;

export type FocusMode = "pomodoro" | "stopwatch";
export type FocusState = "running" | "paused" | "awaiting_feedback" | "completed" | "canceled" | "needs_attention";
export type FocusSegmentCloseReason = "pause" | "finish" | "pomodoro_elapsed" | "limit" | "cancel";

export interface FocusSession {
  id: string;
  userId: string;
  taskId: string | null;
  mode: FocusMode;
  state: FocusState;
  plannedSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  expectedEndAt: string | null;
  baseActiveSeconds: number;
  effectiveSeconds: number | null;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FocusSegment {
  id: string;
  userId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  closeReason: FocusSegmentCloseReason | null;
  createdAt: string;
}

export interface FocusAdjustment {
  id: string;
  userId: string;
  sessionId: string;
  kind: "duration" | "boundaries";
  beforeSeconds: number;
  afterSeconds: number;
  beforeStartedAt: string | null;
  afterStartedAt: string | null;
  beforeEndedAt: string | null;
  afterEndedAt: string | null;
  reason: string;
  createdAt: string;
}

export interface FocusMutation {
  session: FocusSession;
  openedSegment?: FocusSegment;
  closedSegment?: FocusSegment;
}

export interface FocusBoundaryMutation {
  session: FocusSession;
  segments: FocusSegment[];
  adjustment: FocusAdjustment;
}

export function startFocus(
  input: { id?: string; taskId?: string | null; mode: FocusMode; plannedSeconds?: number | null },
  context: CommandContext,
): FocusMutation {
  const plannedSeconds = normalizePlannedSeconds(input.mode, input.plannedSeconds);
  const now = toIso(context.clock.now());
  const session: FocusSession = {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    taskId: input.taskId ?? null,
    mode: input.mode,
    state: "running",
    plannedSeconds,
    startedAt: now,
    endedAt: null,
    expectedEndAt: addSeconds(now, plannedSeconds ?? STOPWATCH_CAP_SECONDS),
    baseActiveSeconds: 0,
    effectiveSeconds: null,
    revision: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { session, openedSegment: openSegment(session, context) };
}

export function pauseFocus(
  current: FocusSession,
  open: FocusSegment,
  context: CommandContext,
  expectedRevision?: number,
): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "running") throw invalidTransition(current.state, "pause");
  const closedSegment = closeSegment(current, open, "pause", context.clock.now());
  const now = closedSegment.endedAt!;
  return {
    session: {
      ...current,
      state: "paused",
      expectedEndAt: null,
      baseActiveSeconds: current.baseActiveSeconds + segmentSeconds(closedSegment),
      revision: current.revision + 1,
      updatedAt: now,
    },
    closedSegment,
  };
}

export function resumeFocus(current: FocusSession, context: CommandContext, expectedRevision?: number): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  const continuingOvertime = current.state === "awaiting_feedback" && current.mode === "pomodoro";
  if (current.state !== "paused" && current.state !== "needs_attention" && !continuingOvertime) {
    throw invalidTransition(current.state, "resume");
  }
  const now = toIso(context.clock.now());
  const remainingBeforeCap =
    current.state === "needs_attention" || continuingOvertime
      ? STOPWATCH_CAP_SECONDS
      : current.mode === "pomodoro"
        ? Math.max(1, current.plannedSeconds! - current.baseActiveSeconds)
        : Math.max(1, STOPWATCH_CAP_SECONDS - current.baseActiveSeconds);
  const session: FocusSession = {
    ...current,
    state: "running",
    endedAt: null,
    effectiveSeconds: null,
    expectedEndAt: continuingOvertime ? null : addSeconds(now, remainingBeforeCap),
    revision: current.revision + 1,
    updatedAt: now,
  };
  return { session, openedSegment: openSegment(session, context) };
}

export function finishFocus(
  current: FocusSession,
  open: FocusSegment | null,
  context: CommandContext,
  expectedRevision?: number,
): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "running" && current.state !== "paused" && current.state !== "needs_attention") {
    throw invalidTransition(current.state, "finish");
  }
  if (current.state === "running" && !open) throw new DomainError("INVALID_RELATION", "运行中的专注缺少开放时间段");
  if (current.state !== "running" && open) throw new DomainError("INVALID_RELATION", "非运行专注不能存在开放时间段");
  const closedSegment = open ? closeSegment(current, open, "finish", context.clock.now()) : undefined;
  const endedAt = closedSegment?.endedAt ?? toIso(context.clock.now());
  const baseActiveSeconds = current.baseActiveSeconds + (closedSegment ? segmentSeconds(closedSegment) : 0);
  return {
    session: {
      ...current,
      state: "awaiting_feedback",
      endedAt,
      expectedEndAt: null,
      baseActiveSeconds,
      effectiveSeconds: baseActiveSeconds,
      revision: current.revision + 1,
      updatedAt: endedAt,
    },
    ...(closedSegment ? { closedSegment } : {}),
  };
}

export function expirePomodoro(
  current: FocusSession,
  open: FocusSegment,
  context: CommandContext,
  expectedRevision?: number,
): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.mode !== "pomodoro" || current.state !== "running" || current.expectedEndAt === null) {
    throw invalidTransition(current.state, "pomodoro elapsed");
  }
  const cutoff = new Date(current.expectedEndAt);
  const closedSegment = closeSegment(current, open, "pomodoro_elapsed", cutoff);
  const baseActiveSeconds = current.baseActiveSeconds + segmentSeconds(closedSegment);
  return {
    session: {
      ...current,
      state: "awaiting_feedback",
      endedAt: current.expectedEndAt,
      expectedEndAt: null,
      baseActiveSeconds,
      effectiveSeconds: baseActiveSeconds,
      revision: current.revision + 1,
      updatedAt: toIso(context.clock.now()),
    },
    closedSegment,
  };
}

export function capStopwatch(
  current: FocusSession,
  open: FocusSegment,
  context: CommandContext,
  expectedRevision?: number,
): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.mode !== "stopwatch" || current.state !== "running" || current.expectedEndAt === null) {
    throw invalidTransition(current.state, "stopwatch limit");
  }
  const closedSegment = closeSegment(current, open, "limit", new Date(current.expectedEndAt));
  return {
    session: {
      ...current,
      state: "needs_attention",
      expectedEndAt: null,
      baseActiveSeconds: current.baseActiveSeconds + segmentSeconds(closedSegment),
      revision: current.revision + 1,
      updatedAt: toIso(context.clock.now()),
    },
    closedSegment,
  };
}

export function cancelFocus(
  current: FocusSession,
  open: FocusSegment | null,
  context: CommandContext,
  expectedRevision?: number,
): FocusMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "running" && current.state !== "paused") throw invalidTransition(current.state, "cancel");
  if (current.state === "running" && !open) throw new DomainError("INVALID_RELATION", "运行中的专注缺少开放时间段");
  if (current.state === "paused" && open) throw new DomainError("INVALID_RELATION", "暂停中的专注不能存在开放时间段");
  const closedSegment = open ? closeSegment(current, open, "cancel", context.clock.now()) : undefined;
  const now = closedSegment?.endedAt ?? toIso(context.clock.now());
  return {
    session: {
      ...current,
      state: "canceled",
      endedAt: now,
      expectedEndAt: null,
      baseActiveSeconds: current.baseActiveSeconds + (closedSegment ? segmentSeconds(closedSegment) : 0),
      effectiveSeconds: null,
      revision: current.revision + 1,
      updatedAt: now,
    },
    ...(closedSegment ? { closedSegment } : {}),
  };
}

export function completeFocusFeedback(
  current: FocusSession,
  context: CommandContext,
  expectedRevision?: number,
): FocusSession {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "awaiting_feedback") throw invalidTransition(current.state, "feedback");
  const now = toIso(context.clock.now());
  return { ...current, state: "completed", revision: current.revision + 1, updatedAt: now };
}

export function adjustFocusDuration(
  current: FocusSession,
  afterSeconds: number,
  reason: string,
  context: CommandContext,
  expectedRevision?: number,
): { session: FocusSession; adjustment: FocusAdjustment } {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "awaiting_feedback" && current.state !== "completed") {
    throw invalidTransition(current.state, "adjust duration");
  }
  assertWholeSeconds(afterSeconds, "有效时长");
  if (afterSeconds > 24 * 60 * 60) throw new DomainError("INVALID_RELATION", "单次有效时长不能超过 24 小时");
  const now = toIso(context.clock.now());
  const beforeSeconds = current.effectiveSeconds ?? current.baseActiveSeconds;
  return {
    session: { ...current, effectiveSeconds: afterSeconds, revision: current.revision + 1, updatedAt: now },
    adjustment: {
      id: context.ids.next(),
      userId: context.userId,
      sessionId: current.id,
      kind: "duration",
      beforeSeconds,
      afterSeconds,
      beforeStartedAt: null,
      afterStartedAt: null,
      beforeEndedAt: null,
      afterEndedAt: null,
      reason: normalizeAdjustmentReason(reason),
      createdAt: now,
    },
  };
}

export function adjustFocusBoundaries(
  current: FocusSession,
  currentSegments: readonly FocusSegment[],
  input: { startedAt: string; endedAt: string; reason: string },
  context: CommandContext,
  expectedRevision?: number,
): FocusBoundaryMutation {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "awaiting_feedback" && current.state !== "completed") {
    throw invalidTransition(current.state, "adjust boundaries");
  }
  if (current.endedAt === null || currentSegments.length === 0) {
    throw new DomainError("INVALID_RELATION", "已结束专注必须包含可审计的时间段");
  }

  const segments = [...currentSegments].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  for (const segment of segments) {
    if (segment.userId !== current.userId || segment.sessionId !== current.id || segment.endedAt === null) {
      throw new DomainError("INVALID_RELATION", "专注时间段与会话不匹配");
    }
  }
  const first = segments[0]!;
  const last = segments.at(-1)!;
  if (first.startedAt !== current.startedAt || last.endedAt !== current.endedAt) {
    throw new DomainError("INVALID_RELATION", "专注边界与时间段不一致，不能静默修正");
  }

  const startedAt = normalizeInstant(input.startedAt, "开始时间");
  const endedAt = normalizeInstant(input.endedAt, "结束时间");
  if (startedAt === current.startedAt && endedAt === current.endedAt) {
    throw new DomainError("INVALID_RELATION", "开始时间和结束时间均未变化");
  }
  if (Date.parse(startedAt) > Date.parse(first.endedAt!)) {
    throw new DomainError("INVALID_RELATION", "开始时间不能晚于第一段专注的结束时间");
  }
  if (Date.parse(endedAt) < Date.parse(last.startedAt)) {
    throw new DomainError("INVALID_RELATION", "结束时间不能早于最后一段专注的开始时间");
  }
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new DomainError("INVALID_RELATION", "结束时间不能早于开始时间");
  }

  const adjustedSegments = segments.map((segment, index) => ({
    ...segment,
    startedAt: index === 0 ? startedAt : segment.startedAt,
    endedAt: index === segments.length - 1 ? endedAt : segment.endedAt,
  }));
  const baseActiveSeconds = adjustedSegments.reduce((total, segment) => total + segmentSeconds(segment), 0);
  if (baseActiveSeconds > 24 * 60 * 60) {
    throw new DomainError("INVALID_RELATION", "修正后的单次有效时长不能超过 24 小时");
  }

  const now = toIso(context.clock.now());
  const beforeSeconds = current.effectiveSeconds ?? current.baseActiveSeconds;
  const hasDurationOverride = current.effectiveSeconds !== null && current.effectiveSeconds !== current.baseActiveSeconds;
  const afterSeconds = hasDurationOverride ? current.effectiveSeconds! : baseActiveSeconds;
  return {
    session: {
      ...current,
      startedAt,
      endedAt,
      baseActiveSeconds,
      effectiveSeconds: afterSeconds,
      revision: current.revision + 1,
      updatedAt: now,
    },
    segments: adjustedSegments,
    adjustment: {
      id: context.ids.next(),
      userId: context.userId,
      sessionId: current.id,
      kind: "boundaries",
      beforeSeconds,
      afterSeconds,
      beforeStartedAt: current.startedAt,
      afterStartedAt: startedAt,
      beforeEndedAt: current.endedAt,
      afterEndedAt: endedAt,
      reason: normalizeAdjustmentReason(input.reason),
      createdAt: now,
    },
  };
}

export function attachDeferredFocusFeedback(
  current: FocusSession,
  context: CommandContext,
  expectedRevision?: number,
): FocusSession {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "completed") throw invalidTransition(current.state, "add deferred feedback");
  return { ...current, revision: current.revision + 1, updatedAt: toIso(context.clock.now()) };
}

export function retargetFocus(
  current: FocusSession,
  taskId: string | null,
  context: CommandContext,
  expectedRevision?: number,
): FocusSession {
  assertSession(current, context.userId, expectedRevision);
  if (current.state === "canceled") throw invalidTransition(current.state, "retarget");
  const now = toIso(context.clock.now());
  return { ...current, taskId, revision: current.revision + 1, updatedAt: now };
}

export function softDeleteFocus(current: FocusSession, context: CommandContext, expectedRevision?: number): FocusSession {
  assertSession(current, context.userId, expectedRevision);
  if (current.state !== "completed" && current.state !== "canceled") throw invalidTransition(current.state, "delete");
  const now = toIso(context.clock.now());
  return { ...current, deletedAt: now, revision: current.revision + 1, updatedAt: now };
}

export function activeFocusSeconds(session: FocusSession, open: FocusSegment | null, at: Date): number {
  if (session.state !== "running" || !open) return session.effectiveSeconds ?? session.baseActiveSeconds;
  const elapsed = Math.max(0, Math.floor((at.getTime() - new Date(open.startedAt).getTime()) / 1000));
  const live = session.baseActiveSeconds + elapsed;
  if (session.expectedEndAt === null) return live;
  const segmentCap = Math.max(
    0,
    Math.floor((new Date(session.expectedEndAt).getTime() - new Date(open.startedAt).getTime()) / 1000),
  );
  return Math.min(live, session.baseActiveSeconds + segmentCap);
}

function normalizePlannedSeconds(mode: FocusMode, value: number | null | undefined): number | null {
  if (mode === "stopwatch") {
    if (value !== undefined && value !== null) throw new DomainError("INVALID_RELATION", "正计时不能设置计划时长");
    return null;
  }
  const seconds = value ?? 25 * 60;
  assertWholeSeconds(seconds, "番茄时长");
  if (seconds < 60 || seconds > STOPWATCH_CAP_SECONDS) {
    throw new DomainError("INVALID_RELATION", "番茄时长必须在 1 分钟到 12 小时之间");
  }
  return seconds;
}

function openSegment(session: FocusSession, context: CommandContext): FocusSegment {
  const now = toIso(context.clock.now());
  return {
    id: context.ids.next(),
    userId: context.userId,
    sessionId: session.id,
    startedAt: now,
    endedAt: null,
    closeReason: null,
    createdAt: now,
  };
}

function closeSegment(
  session: FocusSession,
  open: FocusSegment,
  reason: FocusSegmentCloseReason,
  endedAt: Date,
): FocusSegment {
  if (open.userId !== session.userId || open.sessionId !== session.id || open.endedAt !== null) {
    throw new DomainError("INVALID_RELATION", "开放时间段与专注会话不匹配");
  }
  if (endedAt.getTime() < new Date(open.startedAt).getTime()) {
    throw new DomainError("INVALID_RELATION", "时间段结束时间不能早于开始时间");
  }
  return { ...open, endedAt: toIso(endedAt), closeReason: reason };
}

function segmentSeconds(segment: FocusSegment): number {
  if (segment.endedAt === null) throw new DomainError("INVALID_RELATION", "未关闭时间段不能汇总");
  return Math.max(0, Math.floor((new Date(segment.endedAt).getTime() - new Date(segment.startedAt).getTime()) / 1000));
}

function assertSession(session: FocusSession, userId: string, expectedRevision?: number): void {
  assertOwnedBy(userId, session.userId);
  assertRevision(expectedRevision, session.revision);
  if (session.deletedAt !== null) throw new DomainError("RESOURCE_NOT_FOUND", "专注记录不存在");
}

function invalidTransition(state: FocusState, command: string): DomainError {
  return new DomainError("INVALID_FOCUS_TRANSITION", `不能从 ${state} 执行 ${command}`);
}

function assertWholeSeconds(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new DomainError("INVALID_RELATION", `${field}必须是非负整数秒`);
}

function normalizeAdjustmentReason(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new DomainError("INVALID_RELATION", "调整原因不能为空");
  if (normalized.length > 500) throw new DomainError("INVALID_RELATION", "调整原因过长");
  return normalized;
}

function normalizeInstant(value: string, field: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new DomainError("INVALID_RELATION", `${field}不是有效时间`);
  return new Date(time).toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
