import { assertOwnedBy, assertRevision, DomainError } from "./errors.js";
import { CommandContext, toIso } from "./primitives.js";

export type ProgressSource = "focus_end" | "manual";
export type ProgressOutcome = "completed" | "progressed" | "blocked" | "maintenance" | "note";

export interface ProgressEntry {
  id: string;
  userId: string;
  taskId: string | null;
  focusSessionId: string | null;
  source: ProgressSource;
  outcome: ProgressOutcome;
  note: string | null;
  nextStep: string | null;
  occurredAt: string;
  recordedAt: string;
  updatedAt: string;
  revision: number;
  deletedAt: string | null;
}

export function createProgress(
  input: {
    id?: string;
    taskId: string | null;
    focusSessionId?: string | null;
    source: ProgressSource;
    outcome: ProgressOutcome;
    note?: string | null;
    nextStep?: string | null;
    occurredAt?: string;
  },
  context: CommandContext,
): ProgressEntry {
  validateSourceOutcome(input.source, input.outcome);
  if (input.source === "manual" && input.taskId === null) {
    throw new DomainError("INVALID_RELATION", "手工进展必须关联任务");
  }
  const now = toIso(context.clock.now());
  const note = optionalText(input.note, 2_000, "进展正文");
  if (input.outcome === "note" && note === null) throw new DomainError("INVALID_RELATION", "备注进展必须填写正文");
  return {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    taskId: input.taskId,
    focusSessionId: input.focusSessionId ?? null,
    source: input.source,
    outcome: input.outcome,
    note,
    nextStep: optionalText(input.nextStep, 1_000, "下一步"),
    occurredAt: input.occurredAt ?? now,
    recordedAt: now,
    updatedAt: now,
    revision: 1,
    deletedAt: null,
  };
}

export function updateProgress(
  current: ProgressEntry,
  patch: { outcome?: ProgressOutcome; note?: string | null; nextStep?: string | null; expectedRevision?: number },
  context: CommandContext,
): ProgressEntry {
  assertProgress(current, context.userId, patch.expectedRevision);
  const outcome = patch.outcome ?? current.outcome;
  validateSourceOutcome(current.source, outcome);
  const note = patch.note === undefined ? current.note : optionalText(patch.note, 2_000, "进展正文");
  if (outcome === "note" && note === null) throw new DomainError("INVALID_RELATION", "备注进展必须填写正文");
  return {
    ...current,
    outcome,
    note,
    nextStep: patch.nextStep === undefined ? current.nextStep : optionalText(patch.nextStep, 1_000, "下一步"),
    revision: current.revision + 1,
    updatedAt: toIso(context.clock.now()),
  };
}

export function softDeleteProgress(
  current: ProgressEntry,
  context: CommandContext,
  expectedRevision?: number,
): ProgressEntry {
  assertProgress(current, context.userId, expectedRevision);
  const now = toIso(context.clock.now());
  return {
    ...current,
    deletedAt: now,
    revision: current.revision + 1,
    updatedAt: now,
  };
}

function validateSourceOutcome(source: ProgressSource, outcome: ProgressOutcome): void {
  if (source === "manual" && outcome === "completed") {
    throw new DomainError("INVALID_RELATION", "手工进展不能直接表示完成任务");
  }
  if (source === "focus_end" && outcome === "note") {
    throw new DomainError("INVALID_RELATION", "专注反馈必须选择结构化结果");
  }
}

function optionalText(value: string | null | undefined, maxLength: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) throw new DomainError("INVALID_RELATION", `${field}过长`);
  return normalized;
}

function assertProgress(entry: ProgressEntry, userId: string, expectedRevision?: number): void {
  assertOwnedBy(userId, entry.userId);
  assertRevision(expectedRevision, entry.revision);
  if (entry.deletedAt !== null) throw new DomainError("RESOURCE_NOT_FOUND", "进展记录不存在");
}
