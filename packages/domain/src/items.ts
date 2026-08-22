import { ContentDocument, emptyContentDocument, extractContentText, validateContentDocument } from "./content.js";
import { assertOwnedBy, assertRevision, DomainError } from "./errors.js";
import { TaskGroup, TaskList } from "./organization.js";
import { positionAfter } from "./position.js";
import { CommandContext, normalizeRequiredText, toIso } from "./primitives.js";

export type ItemKind = "task" | "note";
export type TaskStatus = "pending" | "completed" | "abandoned";
export type TaskPriority = 0 | 1 | 3 | 5;

export interface Item {
  id: string;
  userId: string;
  listId: string;
  groupId: string | null;
  parentTaskId: string | null;
  kind: ItemKind;
  title: string;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  plannedOn: string | null;
  contentDoc: ContentDocument;
  contentText: string;
  positionKey: string;
  completedAt: string | null;
  abandonedAt: string | null;
  revision: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskEventType =
  | "created"
  | "title_changed"
  | "content_changed"
  | "moved"
  | "planned_on_changed"
  | "priority_changed"
  | "completed"
  | "reopened"
  | "abandoned"
  | "resumed"
  | "deleted"
  | "subtask_created"
  | "subtask_deleted"
  | "subtask_completed"
  | "focus_started"
  | "focus_paused"
  | "focus_finished"
  | "focus_retargeted"
  | "focus_adjusted"
  | "focus_deleted"
  | "progress_created"
  | "progress_updated"
  | "progress_deleted";

export interface TaskEventDraft {
  taskId: string;
  eventType: TaskEventType;
  actorType: "user" | "system";
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface ItemMutation {
  item: Item;
  events: readonly TaskEventDraft[];
}

export interface ItemRelations {
  list: TaskList;
  group?: TaskGroup | null;
  parent?: Item | null;
}

export interface CreateItemInput {
  id?: string;
  listId: string;
  groupId?: string | null;
  parentTaskId?: string | null;
  kind: ItemKind;
  title: string;
  priority?: TaskPriority | null;
  plannedOn?: string | null;
  contentDoc?: unknown;
  positionKey?: string;
}

export function createItem(
  input: CreateItemInput,
  relations: ItemRelations,
  context: CommandContext,
  existingPositions: readonly string[] = [],
): ItemMutation {
  validateRelations(input, relations, context.userId);
  validateKindFields(input.kind, input.priority ?? null, input.plannedOn ?? null, input.parentTaskId ?? null);
  const now = toIso(context.clock.now());
  const contentDoc = input.contentDoc === undefined ? emptyContentDocument() : validateContentDocument(input.contentDoc);
  const item: Item = {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    listId: input.listId,
    groupId: input.groupId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    kind: input.kind,
    title: normalizeRequiredText(input.title, "title"),
    status: input.kind === "task" ? "pending" : null,
    priority: input.kind === "task" ? input.priority ?? 0 : null,
    plannedOn: input.kind === "task" ? normalizePlannedOn(input.plannedOn ?? null) : null,
    contentDoc,
    contentText: extractContentText(contentDoc),
    positionKey: input.positionKey ?? positionAfter(existingPositions),
    completedAt: null,
    abandonedAt: null,
    revision: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (item.kind === "note") return { item, events: [] };

  const events: TaskEventDraft[] = [event(item.id, "created", now, { parentTaskId: item.parentTaskId })];
  if (relations.parent) {
    events.push(event(relations.parent.id, "subtask_created", now, { subtaskId: item.id, title: item.title }));
  }
  return { item, events };
}

export function updateItem(
  current: Item,
  patch: {
    title?: string;
    listId?: string;
    groupId?: string | null;
    parentTaskId?: string | null;
    priority?: TaskPriority | null;
    plannedOn?: string | null;
    contentDoc?: unknown;
    positionKey?: string;
    expectedRevision?: number;
  },
  relations: ItemRelations,
  context: CommandContext,
): ItemMutation {
  assertMutableItem(current, context.userId);
  assertRevision(patch.expectedRevision, current.revision);
  const target = {
    kind: current.kind,
    listId: patch.listId ?? current.listId,
    groupId: patch.groupId === undefined ? current.groupId : patch.groupId,
    parentTaskId: patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId,
    priority: patch.priority === undefined ? current.priority : patch.priority,
    plannedOn: patch.plannedOn === undefined ? current.plannedOn : patch.plannedOn,
  };
  validateRelations(target, relations, context.userId);
  validateKindFields(target.kind, target.priority, target.plannedOn, target.parentTaskId);

  const now = toIso(context.clock.now());
  const contentDoc = patch.contentDoc === undefined ? current.contentDoc : validateContentDocument(patch.contentDoc);
  const item: Item = {
    ...current,
    listId: target.listId,
    groupId: target.groupId,
    parentTaskId: target.parentTaskId,
    title: patch.title === undefined ? current.title : normalizeRequiredText(patch.title, "title"),
    priority: current.kind === "task" ? target.priority : null,
    plannedOn: current.kind === "task" ? normalizePlannedOn(target.plannedOn) : null,
    contentDoc,
    contentText: extractContentText(contentDoc),
    positionKey: patch.positionKey ?? current.positionKey,
    revision: current.revision + 1,
    updatedAt: now,
  };
  if (item.kind === "note") return { item, events: [] };

  const events: TaskEventDraft[] = [];
  if (item.title !== current.title) events.push(event(item.id, "title_changed", now, { before: current.title, after: item.title }));
  if (item.contentText !== current.contentText || JSON.stringify(item.contentDoc) !== JSON.stringify(current.contentDoc)) {
    events.push(event(item.id, "content_changed", now, {}));
  }
  if (item.listId !== current.listId || item.groupId !== current.groupId || item.parentTaskId !== current.parentTaskId) {
    events.push(event(item.id, "moved", now, {
      before: { listId: current.listId, groupId: current.groupId, parentTaskId: current.parentTaskId },
      after: { listId: item.listId, groupId: item.groupId, parentTaskId: item.parentTaskId },
    }));
    if (item.parentTaskId !== current.parentTaskId) {
      if (current.parentTaskId) {
        events.push(event(current.parentTaskId, "subtask_deleted", now, { subtaskId: item.id, reason: "reparented" }));
      }
      if (item.parentTaskId) {
        events.push(event(item.parentTaskId, "subtask_created", now, { subtaskId: item.id, title: item.title, reason: "reparented" }));
      }
    }
  }
  if (item.plannedOn !== current.plannedOn) events.push(event(item.id, "planned_on_changed", now, { before: current.plannedOn, after: item.plannedOn }));
  if (item.priority !== current.priority) events.push(event(item.id, "priority_changed", now, { before: current.priority, after: item.priority }));
  return { item, events };
}

export function transitionTask(
  current: Item,
  command: "complete" | "reopen" | "abandon" | "resume",
  context: CommandContext,
  expectedRevision?: number,
): ItemMutation {
  assertMutableItem(current, context.userId);
  assertRevision(expectedRevision, current.revision);
  if (current.kind !== "task" || current.status === null) throw new DomainError("INVALID_ITEM_KIND", "笔记不能改变完成状态");

  const transitions: Record<TaskStatus, Partial<Record<typeof command, TaskStatus>>> = {
    pending: { complete: "completed", abandon: "abandoned" },
    completed: { reopen: "pending" },
    abandoned: { resume: "pending" },
  };
  const nextStatus = transitions[current.status][command];
  if (!nextStatus) {
    throw new DomainError("INVALID_TASK_TRANSITION", `不能从 ${current.status} 执行 ${command}`);
  }
  const now = toIso(context.clock.now());
  const item: Item = {
    ...current,
    status: nextStatus,
    completedAt: nextStatus === "completed" ? now : null,
    abandonedAt: nextStatus === "abandoned" ? now : null,
    revision: current.revision + 1,
    updatedAt: now,
  };
  const eventType: TaskEventType =
    command === "complete" ? "completed" : command === "abandon" ? "abandoned" : command === "reopen" ? "reopened" : "resumed";
  const events: TaskEventDraft[] = [event(item.id, eventType, now, { before: current.status, after: nextStatus })];
  if (item.parentTaskId && command === "complete") {
    events.push(event(item.parentTaskId, "subtask_completed", now, { subtaskId: item.id }));
  }
  return { item, events };
}

export function deleteItem(current: Item, context: CommandContext, expectedRevision?: number): ItemMutation {
  assertMutableItem(current, context.userId);
  assertRevision(expectedRevision, current.revision);
  const now = toIso(context.clock.now());
  const item: Item = {
    ...current,
    deletedAt: now,
    revision: current.revision + 1,
    updatedAt: now,
  };
  if (item.kind === "note") return { item, events: [] };
  const events: TaskEventDraft[] = [event(item.id, "deleted", now, {})];
  if (item.parentTaskId) events.push(event(item.parentTaskId, "subtask_deleted", now, { subtaskId: item.id }));
  return { item, events };
}

function validateRelations(
  input: { listId: string; groupId?: string | null; parentTaskId?: string | null; kind: ItemKind },
  relations: ItemRelations,
  userId: string,
): void {
  assertOwnedBy(userId, relations.list.userId);
  if (relations.list.id !== input.listId || relations.list.archivedAt !== null) {
    throw new DomainError("INVALID_RELATION", "目标清单不存在或已归档");
  }
  const groupId = input.groupId ?? null;
  if (groupId !== null) {
    if (!relations.group || relations.group.id !== groupId || relations.group.listId !== input.listId || relations.group.archivedAt !== null) {
      throw new DomainError("INVALID_RELATION", "分组必须属于目标清单且未归档");
    }
    assertOwnedBy(userId, relations.group.userId);
  }
  const parentTaskId = input.parentTaskId ?? null;
  if (parentTaskId !== null) {
    const parent = relations.parent;
    if (!parent || parent.id !== parentTaskId || parent.kind !== "task" || parent.parentTaskId !== null || parent.listId !== input.listId || parent.deletedAt !== null) {
      throw new DomainError("INVALID_RELATION", "父任务必须是同一清单中的顶层任务");
    }
    assertOwnedBy(userId, parent.userId);
  }
}

function validateKindFields(kind: ItemKind, priority: TaskPriority | null, plannedOn: string | null, parentTaskId: string | null): void {
  if (kind === "note" && (priority !== null || plannedOn !== null || parentTaskId !== null)) {
    throw new DomainError("INVALID_ITEM_KIND", "笔记不能设置任务状态、优先级、日期或父任务");
  }
}

function normalizePlannedOn(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DomainError("INVALID_DATE", "计划日期格式必须为 YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new DomainError("INVALID_DATE", "计划日期不存在");
  }
  return value;
}

function assertMutableItem(item: Item, userId: string): void {
  assertOwnedBy(userId, item.userId);
  if (item.deletedAt !== null) throw new DomainError("RESOURCE_NOT_FOUND", "内容不存在");
}

function event(taskId: string, eventType: TaskEventType, occurredAt: string, payload: Readonly<Record<string, unknown>>): TaskEventDraft {
  return { taskId, eventType, actorType: "user", occurredAt, payload };
}
