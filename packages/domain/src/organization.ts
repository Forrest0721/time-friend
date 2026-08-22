import { assertOwnedBy, assertRevision, DomainError } from "./errors.js";
import { positionAfter } from "./position.js";
import { CommandContext, normalizeRequiredText, toIso } from "./primitives.js";

interface VersionedEntity {
  id: string;
  userId: string;
  positionKey: string;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Folder extends VersionedEntity {
  name: string;
}

export type LearningPolicy = "include" | "exclude";

export interface TaskList extends VersionedEntity {
  folderId: string | null;
  name: string;
  isInbox: boolean;
  learningPolicy: LearningPolicy;
}

export interface TaskGroup extends VersionedEntity {
  listId: string;
  name: string;
}

type CreateBase = {
  id?: string;
  positionKey?: string;
};

export function createFolder(
  input: CreateBase & { name: string },
  context: CommandContext,
  existingPositions: readonly string[] = [],
): Folder {
  const now = toIso(context.clock.now());
  return {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    name: normalizeRequiredText(input.name, "name"),
    positionKey: input.positionKey ?? positionAfter(existingPositions),
    archivedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateFolder(
  current: Folder,
  patch: { name?: string; archived?: boolean; positionKey?: string; expectedRevision?: number },
  context: CommandContext,
): Folder {
  assertOwnedBy(context.userId, current.userId);
  assertRevision(patch.expectedRevision, current.revision);
  const now = toIso(context.clock.now());
  return {
    ...current,
    name: patch.name === undefined ? current.name : normalizeRequiredText(patch.name, "name"),
    positionKey: patch.positionKey ?? current.positionKey,
    archivedAt: patch.archived === undefined ? current.archivedAt : patch.archived ? now : null,
    revision: current.revision + 1,
    updatedAt: now,
  };
}

export function createTaskList(
  input: CreateBase & {
    name: string;
    folderId?: string | null;
    isInbox?: boolean;
    learningPolicy?: LearningPolicy;
  },
  context: CommandContext,
  options: {
    folder?: Folder | null;
    inboxAlreadyExists?: boolean;
    existingPositions?: readonly string[];
  } = {},
): TaskList {
  const folderId = input.folderId ?? null;
  assertFolderAssignment(folderId, options.folder, context.userId);
  if (input.isInbox && options.inboxAlreadyExists) {
    throw new DomainError("INVALID_RELATION", "收集箱已存在");
  }
  if (input.isInbox && folderId !== null) {
    throw new DomainError("INBOX_IMMUTABLE", "收集箱不能放入文件夹");
  }
  const now = toIso(context.clock.now());
  return {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    folderId,
    name: normalizeRequiredText(input.name, "name"),
    positionKey: input.positionKey ?? positionAfter(options.existingPositions ?? []),
    isInbox: input.isInbox ?? false,
    learningPolicy: input.learningPolicy ?? "include",
    archivedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTaskList(
  current: TaskList,
  patch: {
    name?: string;
    folderId?: string | null;
    folder?: Folder | null;
    learningPolicy?: LearningPolicy;
    archived?: boolean;
    positionKey?: string;
    expectedRevision?: number;
  },
  context: CommandContext,
): TaskList {
  assertOwnedBy(context.userId, current.userId);
  assertRevision(patch.expectedRevision, current.revision);
  if (current.isInbox && (patch.archived === true || (patch.folderId !== undefined && patch.folderId !== null))) {
    throw new DomainError("INBOX_IMMUTABLE", "收集箱不能归档或移动到文件夹");
  }
  const folderId = patch.folderId === undefined ? current.folderId : patch.folderId;
  if (patch.folderId !== undefined) {
    assertFolderAssignment(folderId, patch.folder, context.userId);
  }
  const now = toIso(context.clock.now());
  return {
    ...current,
    folderId,
    name: patch.name === undefined ? current.name : normalizeRequiredText(patch.name, "name"),
    learningPolicy: patch.learningPolicy ?? current.learningPolicy,
    positionKey: patch.positionKey ?? current.positionKey,
    archivedAt: patch.archived === undefined ? current.archivedAt : patch.archived ? now : null,
    revision: current.revision + 1,
    updatedAt: now,
  };
}

export function createTaskGroup(
  input: CreateBase & { listId: string; name: string },
  context: CommandContext,
  list: TaskList,
  existingPositions: readonly string[] = [],
): TaskGroup {
  assertActiveList(list, input.listId, context.userId);
  const now = toIso(context.clock.now());
  return {
    id: input.id ?? context.ids.next(),
    userId: context.userId,
    listId: input.listId,
    name: normalizeRequiredText(input.name, "name"),
    positionKey: input.positionKey ?? positionAfter(existingPositions),
    archivedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTaskGroup(
  current: TaskGroup,
  patch: {
    name?: string;
    listId?: string;
    list?: TaskList;
    archived?: boolean;
    positionKey?: string;
    expectedRevision?: number;
  },
  context: CommandContext,
): TaskGroup {
  assertOwnedBy(context.userId, current.userId);
  assertRevision(patch.expectedRevision, current.revision);
  const listId = patch.listId ?? current.listId;
  if (patch.listId !== undefined) {
    if (!patch.list) {
      throw new DomainError("INVALID_RELATION", "移动分组时必须提供目标清单");
    }
    assertActiveList(patch.list, listId, context.userId);
  }
  const now = toIso(context.clock.now());
  return {
    ...current,
    listId,
    name: patch.name === undefined ? current.name : normalizeRequiredText(patch.name, "name"),
    positionKey: patch.positionKey ?? current.positionKey,
    archivedAt: patch.archived === undefined ? current.archivedAt : patch.archived ? now : null,
    revision: current.revision + 1,
    updatedAt: now,
  };
}

function assertFolderAssignment(folderId: string | null, folder: Folder | null | undefined, userId: string): void {
  if (folderId === null) return;
  if (!folder || folder.id !== folderId || folder.archivedAt !== null) {
    throw new DomainError("INVALID_RELATION", "目标文件夹不存在或已归档");
  }
  assertOwnedBy(userId, folder.userId);
}

function assertActiveList(list: TaskList, listId: string, userId: string): void {
  assertOwnedBy(userId, list.userId);
  if (list.id !== listId || list.archivedAt !== null) {
    throw new DomainError("INVALID_RELATION", "目标清单不存在或已归档");
  }
}
