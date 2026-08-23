import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";

import { DomainError } from "./errors.js";
import type { FocusMode, FocusState } from "./focus.js";
import type { ProgressOutcome } from "./progress.js";

export const PERIOD_FACTS_SCHEMA_VERSION = "1";

export interface WeeklyPeriod {
  kind: "week";
  timezone: string;
  localStartDate: string;
  localEndDate: string;
  startsAt: string;
  endsAt: string;
}

export interface TrajectoryListInput {
  id: string;
  name: string;
}

export interface TrajectoryTaskInput {
  id: string;
  listId: string;
  title: string;
  contentText: string;
  status: "pending" | "completed" | "abandoned";
  plannedOn: string | null;
  completedAt: string | null;
  abandonedAt: string | null;
}

export interface TrajectoryFocusSessionInput {
  id: string;
  taskId: string | null;
  mode: FocusMode;
  state: FocusState;
  effectiveSeconds: number | null;
}

export interface TrajectoryFocusSegmentInput {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface TrajectoryProgressInput {
  id: string;
  taskId: string | null;
  focusSessionId: string | null;
  outcome: ProgressOutcome;
  note: string | null;
  nextStep: string | null;
  occurredAt: string;
}

export interface TrajectoryTaskEventInput {
  id: string;
  taskId: string;
  eventType: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface PeriodFactsInput {
  period: WeeklyPeriod;
  sourceWatermark: string;
  lists: readonly TrajectoryListInput[];
  tasks: readonly TrajectoryTaskInput[];
  focusSessions: readonly TrajectoryFocusSessionInput[];
  focusSegments: readonly TrajectoryFocusSegmentInput[];
  progressEntries: readonly TrajectoryProgressInput[];
  taskEvents: readonly TrajectoryTaskEventInput[];
}

export interface PeriodFacts {
  schemaVersion: typeof PERIOD_FACTS_SCHEMA_VERSION;
  focus: {
    totalSeconds: number;
    sessionCount: number;
    pomodoroCount: number;
    unlinkedSeconds: number;
    byList: Array<{ listId: string; listName: string; seconds: number }>;
  };
  progress: {
    completed: number;
    progressed: number;
    blocked: number;
    maintenance: number;
  };
  tasks: {
    completedIds: string[];
    abandonedIds: string[];
    plannedButUnfinishedIds: string[];
  };
  dataQuality: {
    evidenceCount: number;
    unlinkedFocusRatio: number;
    hasEnoughData: boolean;
  };
}

export interface PeriodFactsResult {
  facts: PeriodFacts;
  inputHash: string;
}

export function weekPeriodContaining(instant: Date | string, timezone: string): WeeklyPeriod {
  try {
    const value = typeof instant === "string" ? Temporal.Instant.from(instant) : Temporal.Instant.fromEpochMilliseconds(instant.getTime());
    const localDate = value.toZonedDateTimeISO(timezone).toPlainDate();
    const localStart = localDate.subtract({ days: localDate.dayOfWeek - 1 });
    const localEnd = localStart.add({ days: 6 });
    const startsAt = localStart.toZonedDateTime({ timeZone: timezone }).toInstant();
    const endsAt = localStart.add({ days: 7 }).toZonedDateTime({ timeZone: timezone }).toInstant();
    return {
      kind: "week",
      timezone,
      localStartDate: localStart.toString(),
      localEndDate: localEnd.toString(),
      startsAt: startsAt.toString(),
      endsAt: endsAt.toString(),
    };
  } catch (error) {
    throw new DomainError("INVALID_TIMEZONE", "无效的时区或时间", {
      timezone,
      cause: error instanceof Error ? error.message : "unknown",
    });
  }
}

export function previousWeeklyPeriod(period: WeeklyPeriod): WeeklyPeriod {
  assertWeeklyPeriod(period);
  return weekPeriodContaining(Temporal.Instant.from(period.startsAt).subtract({ milliseconds: 1 }).toString(), period.timezone);
}

export function intersectSeconds(
  interval: { startedAt: string; endedAt: string },
  period: Pick<WeeklyPeriod, "startsAt" | "endsAt">,
): number {
  const start = Math.max(toEpochMilliseconds(interval.startedAt), toEpochMilliseconds(period.startsAt));
  const end = Math.min(toEpochMilliseconds(interval.endedAt), toEpochMilliseconds(period.endsAt));
  return Math.max(0, Math.floor((end - start) / 1_000));
}

export function computePeriodFacts(input: PeriodFactsInput): PeriodFactsResult {
  assertWeeklyPeriod(input.period);
  const watermarkMs = toEpochMilliseconds(input.sourceWatermark);
  const periodStartMs = toEpochMilliseconds(input.period.startsAt);
  const periodEndMs = toEpochMilliseconds(input.period.endsAt);
  if (watermarkMs < periodStartMs) throw new DomainError("INVALID_PERIOD", "事实水位早于周期开始");

  const lists = new Map(input.lists.map((list) => [list.id, list]));
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const segmentsBySession = new Map<string, TrajectoryFocusSegmentInput[]>();
  for (const segment of input.focusSegments) {
    const entries = segmentsBySession.get(segment.sessionId) ?? [];
    entries.push(segment);
    segmentsBySession.set(segment.sessionId, entries);
  }

  let totalSeconds = 0;
  let pomodoroCount = 0;
  let unlinkedSeconds = 0;
  let sessionCount = 0;
  const secondsByList = new Map<string, number>();

  for (const session of [...input.focusSessions].sort(byId)) {
    if (session.state === "canceled") continue;
    const segments = (segmentsBySession.get(session.id) ?? []).map((segment) => ({
      ...segment,
      endMs: Math.min(segment.endedAt === null ? watermarkMs : toEpochMilliseconds(segment.endedAt), watermarkMs),
      startMs: toEpochMilliseconds(segment.startedAt),
    }));
    const includedSeconds = allocateEffectiveSecondsToPeriod(session.effectiveSeconds, segments, periodStartMs, periodEndMs);
    if (includedSeconds <= 0) continue;
    totalSeconds += includedSeconds;
    sessionCount += 1;
    if (session.mode === "pomodoro") pomodoroCount += 1;
    const task = session.taskId === null ? undefined : tasks.get(session.taskId);
    if (!task || !lists.has(task.listId)) {
      unlinkedSeconds += includedSeconds;
      continue;
    }
    secondsByList.set(task.listId, (secondsByList.get(task.listId) ?? 0) + includedSeconds);
  }

  const progress = { completed: 0, progressed: 0, blocked: 0, maintenance: 0 };
  let qualifyingProgressCount = 0;
  const includedProgress = input.progressEntries
    .filter((entry) => within(entry.occurredAt, periodStartMs, periodEndMs))
    .filter((entry) => entry.taskId === null || tasks.has(entry.taskId))
    .sort(byId);
  for (const entry of includedProgress) {
    if (entry.outcome === "note") continue;
    progress[entry.outcome] += 1;
    if (entry.outcome === "completed" || entry.outcome === "progressed" || entry.outcome === "blocked") qualifyingProgressCount += 1;
  }

  const completedIds = input.tasks.filter((task) => task.completedAt !== null && within(task.completedAt, periodStartMs, periodEndMs)).map(id).sort();
  const abandonedIds = input.tasks.filter((task) => task.abandonedAt !== null && within(task.abandonedAt, periodStartMs, periodEndMs)).map(id).sort();
  const plannedButUnfinishedIds = input.tasks
    .filter(
      (task) =>
        task.plannedOn !== null &&
        task.plannedOn >= input.period.localStartDate &&
        task.plannedOn <= input.period.localEndDate &&
        !endedBefore(task.completedAt, periodEndMs) &&
        !endedBefore(task.abandonedAt, periodEndMs),
    )
    .map(id)
    .sort();

  const facts: PeriodFacts = {
    schemaVersion: PERIOD_FACTS_SCHEMA_VERSION,
    focus: {
      totalSeconds,
      sessionCount,
      pomodoroCount,
      unlinkedSeconds,
      byList: [...secondsByList.entries()]
        .map(([listId, seconds]) => ({ listId, listName: lists.get(listId)!.name, seconds }))
        .sort((left, right) => right.seconds - left.seconds || left.listId.localeCompare(right.listId)),
    },
    progress,
    tasks: { completedIds, abandonedIds, plannedButUnfinishedIds },
    dataQuality: {
      evidenceCount: sessionCount + includedProgress.length,
      unlinkedFocusRatio: totalSeconds === 0 ? 0 : roundRatio(unlinkedSeconds / totalSeconds),
      hasEnoughData: sessionCount >= 3 || qualifyingProgressCount >= 3,
    },
  };

  return { facts, inputHash: hashCanonical(periodFactsHashInput(input)) };
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DomainError("INVALID_PERIOD", "事实输入包含非有限数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new DomainError("INVALID_PERIOD", "事实输入包含不可序列化值");
}

export function allocateEffectiveSecondsToPeriod(
  effectiveSeconds: number | null,
  segments: readonly { startMs: number; endMs: number }[],
  periodStartMs: number,
  periodEndMs: number,
): number {
  const ordered = [...segments].filter((segment) => segment.endMs > segment.startMs).sort((left, right) => left.startMs - right.startMs);
  const totalMs = ordered.reduce((total, segment) => total + segment.endMs - segment.startMs, 0);
  if (totalMs <= 0) return 0;
  const allocatedTotalSeconds = effectiveSeconds ?? Math.floor(totalMs / 1_000);
  if (allocatedTotalSeconds <= 0) return 0;

  let cumulativeMs = 0;
  let included = 0n;
  const total = BigInt(totalMs);
  const effective = BigInt(allocatedTotalSeconds);
  for (const segment of ordered) {
    const segmentLength = segment.endMs - segment.startMs;
    const intersectionStart = Math.max(segment.startMs, periodStartMs);
    const intersectionEnd = Math.min(segment.endMs, periodEndMs);
    if (intersectionEnd > intersectionStart) {
      const from = BigInt(cumulativeMs + intersectionStart - segment.startMs);
      const to = BigInt(cumulativeMs + intersectionEnd - segment.startMs);
      included += (effective * to) / total - (effective * from) / total;
    }
    cumulativeMs += segmentLength;
  }
  return Number(included);
}

function periodFactsHashInput(input: PeriodFactsInput): unknown {
  return {
    schemaVersion: PERIOD_FACTS_SCHEMA_VERSION,
    period: input.period,
    sourceWatermark: input.sourceWatermark,
    lists: [...input.lists].sort(byId),
    tasks: [...input.tasks].sort(byId),
    focusSessions: [...input.focusSessions].sort(byId),
    focusSegments: [...input.focusSegments].sort(byId),
    progressEntries: [...input.progressEntries].sort(byId),
    taskEvents: [...input.taskEvents].sort(byId),
  };
}

function assertWeeklyPeriod(period: WeeklyPeriod): void {
  const start = toEpochMilliseconds(period.startsAt);
  const end = toEpochMilliseconds(period.endsAt);
  if (period.kind !== "week" || start >= end || period.localStartDate > period.localEndDate) {
    throw new DomainError("INVALID_PERIOD", "无效的周周期");
  }
}

function toEpochMilliseconds(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new DomainError("INVALID_DATE", "无效时间", { value });
  return result;
}

function within(value: string, startMs: number, endMs: number): boolean {
  const instant = toEpochMilliseconds(value);
  return instant >= startMs && instant < endMs;
}

function endedBefore(value: string | null, endMs: number): boolean {
  return value !== null && toEpochMilliseconds(value) < endMs;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function id<T extends { id: string }>(value: T): string {
  return value.id;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
