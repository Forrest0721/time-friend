import { DomainError } from "./errors.js";
import {
  CreateItemInput,
  deleteItem,
  Item,
  TaskEventDraft,
  TaskPriority,
  TaskStatus,
  transitionTask,
  updateItem,
  createItem,
} from "./items.js";
import {
  createFolder,
  createTaskGroup,
  createTaskList,
  Folder,
  LearningPolicy,
  TaskGroup,
  TaskList,
  updateFolder,
  updateTaskGroup,
  updateTaskList,
} from "./organization.js";
import { rebalancePositions } from "./position.js";
import { Clock, IdGenerator, toIso } from "./primitives.js";

export interface TaskEvent extends TaskEventDraft {
  id: string;
  userId: string;
  recordedAt: string;
  dedupeKey: string | null;
}

export interface TaskStoreTransaction {
  listFolders(userId: string): Promise<Folder[]>;
  findFolder(userId: string, id: string): Promise<Folder | null>;
  saveFolder(folder: Folder, previousRevision: number | null): Promise<void>;
  listTaskLists(userId: string): Promise<TaskList[]>;
  findTaskList(userId: string, id: string): Promise<TaskList | null>;
  saveTaskList(list: TaskList, previousRevision: number | null): Promise<void>;
  listTaskGroups(userId: string, listId?: string): Promise<TaskGroup[]>;
  findTaskGroup(userId: string, id: string): Promise<TaskGroup | null>;
  saveTaskGroup(group: TaskGroup, previousRevision: number | null): Promise<void>;
  listItems(input: { userId: string; listId?: string; groupId?: string | null; parentTaskId?: string | null; status?: TaskStatus; includeDeleted?: boolean }): Promise<Item[]>;
  findItem(userId: string, id: string): Promise<Item | null>;
  saveItem(item: Item, previousRevision: number | null): Promise<void>;
  saveMovedTaskTree(
    root: Item,
    rootPreviousRevision: number,
    children: readonly { before: Item; after: Item }[],
  ): Promise<void>;
  appendTaskEvents(events: readonly TaskEvent[]): Promise<void>;
  listTaskEvents(userId: string, taskId: string): Promise<TaskEvent[]>;
}

export interface TaskStore {
  transaction<T>(work: (transaction: TaskStoreTransaction) => Promise<T>): Promise<T>;
}

export interface TaskServiceDependencies {
  store: TaskStore;
  clock: Clock;
  ids: IdGenerator;
}

export class TaskService {
  constructor(private readonly dependencies: TaskServiceDependencies) {}

  async getTaskData(userId: string): Promise<{ folders: Folder[]; lists: TaskList[]; groups: TaskGroup[]; items: Item[] }> {
    return this.dependencies.store.transaction(async (transaction) => {
      // A transaction is pinned to one PostgreSQL connection. Keep reads
      // sequential so the service also remains valid with pg 9, which rejects
      // overlapping queries on the same client.
      const folders = await transaction.listFolders(userId);
      const lists = await transaction.listTaskLists(userId);
      const allGroups = await transaction.listTaskGroups(userId);
      const allItems = await transaction.listItems({ userId });
      const activeListIds = new Set(lists.map((list) => list.id));
      const groups = allGroups.filter((group) => activeListIds.has(group.listId));
      const items = allItems.filter((item) => activeListIds.has(item.listId));
      return { folders, lists, groups, items };
    });
  }

  async getItem(userId: string, id: string): Promise<Item> {
    return this.dependencies.store.transaction((transaction) => requireResource(transaction.findItem(userId, id), "内容不存在"));
  }

  async listItems(input: {
    userId: string;
    listId?: string;
    groupId?: string | null;
    parentTaskId?: string | null;
    status?: TaskStatus;
  }): Promise<Item[]> {
    return this.dependencies.store.transaction((transaction) => transaction.listItems(input));
  }

  async listTaskEvents(userId: string, taskId: string): Promise<TaskEvent[]> {
    return this.dependencies.store.transaction(async (transaction) => {
      await requireResource(transaction.findItem(userId, taskId), "任务不存在");
      return transaction.listTaskEvents(userId, taskId);
    });
  }

  async createFolder(userId: string, input: { name: string; id?: string }): Promise<Folder> {
    return this.dependencies.store.transaction(async (transaction) => {
      const existing = await transaction.listFolders(userId);
      const folder = createFolder(input, this.context(userId), existing.map((entry) => entry.positionKey));
      await transaction.saveFolder(folder, null);
      return folder;
    });
  }

  async updateFolder(
    userId: string,
    id: string,
    patch: { name?: string; archived?: boolean; positionKey?: string; expectedRevision?: number },
  ): Promise<Folder> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findFolder(userId, id), "文件夹不存在");
      const next = updateFolder(current, patch, this.context(userId));
      if (patch.archived === true && current.archivedAt === null) {
        const lists = await transaction.listTaskLists(userId);
        for (const list of lists.filter((entry) => entry.folderId === current.id)) {
          const detached = updateTaskList(list, { folderId: null, expectedRevision: list.revision }, this.context(userId));
          await transaction.saveTaskList(detached, list.revision);
        }
      }
      await transaction.saveFolder(next, current.revision);
      return next;
    });
  }

  async createTaskList(
    userId: string,
    input: { name: string; folderId?: string | null; isInbox?: boolean; learningPolicy?: LearningPolicy; id?: string },
  ): Promise<TaskList> {
    return this.dependencies.store.transaction(async (transaction) => {
      const existing = await transaction.listTaskLists(userId);
      const folder = input.folderId ? await transaction.findFolder(userId, input.folderId) : null;
      const list = createTaskList(input, this.context(userId), {
        folder,
        inboxAlreadyExists: existing.some((entry) => entry.isInbox && entry.archivedAt === null),
        existingPositions: existing.map((entry) => entry.positionKey),
      });
      await transaction.saveTaskList(list, null);
      return list;
    });
  }

  async updateTaskList(
    userId: string,
    id: string,
    patch: {
      name?: string;
      folderId?: string | null;
      learningPolicy?: LearningPolicy;
      archived?: boolean;
      positionKey?: string;
      expectedRevision?: number;
    },
  ): Promise<TaskList> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findTaskList(userId, id), "清单不存在");
      const folder = patch.folderId ? await transaction.findFolder(userId, patch.folderId) : null;
      const next = updateTaskList(current, { ...patch, folder }, this.context(userId));
      await transaction.saveTaskList(next, current.revision);
      return next;
    });
  }

  async createTaskGroup(userId: string, input: { listId: string; name: string; id?: string }): Promise<TaskGroup> {
    return this.dependencies.store.transaction(async (transaction) => {
      const list = await requireResource(transaction.findTaskList(userId, input.listId), "清单不存在");
      const existing = await transaction.listTaskGroups(userId, input.listId);
      const group = createTaskGroup(input, this.context(userId), list, existing.map((entry) => entry.positionKey));
      await transaction.saveTaskGroup(group, null);
      return group;
    });
  }

  async updateTaskGroup(
    userId: string,
    id: string,
    patch: { name?: string; archived?: boolean; positionKey?: string; expectedRevision?: number },
  ): Promise<TaskGroup> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findTaskGroup(userId, id), "分组不存在");
      const next = updateTaskGroup(current, patch, this.context(userId));
      if (patch.archived === true && current.archivedAt === null) {
        const list = await requireResource(transaction.findTaskList(userId, current.listId), "清单不存在");
        const groupedItems = await transaction.listItems({ userId, listId: current.listId, groupId: current.id });
        for (const item of groupedItems) {
          const parent = item.parentTaskId ? await transaction.findItem(userId, item.parentTaskId) : null;
          const mutation = updateItem(
            item,
            { groupId: null, expectedRevision: item.revision },
            { list, group: null, parent },
            this.context(userId),
          );
          await transaction.saveItem(mutation.item, item.revision);
          await transaction.appendTaskEvents(this.materializeEvents(userId, mutation.events));
        }
      }
      await transaction.saveTaskGroup(next, current.revision);
      return next;
    });
  }

  async createItem(userId: string, input: CreateItemInput): Promise<Item> {
    return this.dependencies.store.transaction(async (transaction) => {
      const list = await requireResource(transaction.findTaskList(userId, input.listId), "清单不存在");
      const group = input.groupId ? await transaction.findTaskGroup(userId, input.groupId) : null;
      const parent = input.parentTaskId ? await transaction.findItem(userId, input.parentTaskId) : null;
      const existing = await transaction.listItems({
        userId,
        listId: input.listId,
        groupId: input.groupId ?? null,
        parentTaskId: input.parentTaskId ?? null,
      });
      const mutation = createItem(input, { list, group, parent }, this.context(userId), existing.map((entry) => entry.positionKey));
      await transaction.saveItem(mutation.item, null);
      await transaction.appendTaskEvents(this.materializeEvents(userId, mutation.events));
      return mutation.item;
    });
  }

  async updateItem(
    userId: string,
    id: string,
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
  ): Promise<Item> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findItem(userId, id), "内容不存在");
      const listId = patch.listId ?? current.listId;
      const groupId = patch.groupId === undefined ? current.groupId : patch.groupId;
      const parentTaskId = patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId;
      const list = await requireResource(transaction.findTaskList(userId, listId), "清单不存在");
      const group = groupId ? await transaction.findTaskGroup(userId, groupId) : null;
      const parent = parentTaskId ? await transaction.findItem(userId, parentTaskId) : null;
      const mutation = updateItem(current, patch, { list, group, parent }, this.context(userId));
      const children =
        current.kind === "task" && current.parentTaskId === null
          ? await transaction.listItems({ userId, parentTaskId: current.id })
          : [];
      if (mutation.item.parentTaskId !== null && children.length > 0) {
        throw new DomainError("INVALID_RELATION", "有子任务的任务不能变为子任务");
      }

      if (mutation.item.listId !== current.listId && children.length > 0) {
        const childMutations = children.map((child) => ({
          before: child,
          mutation: updateItem(
            child,
            {
              listId: mutation.item.listId,
              groupId: null,
              expectedRevision: child.revision,
            },
            { list, group: null, parent: mutation.item },
            this.context(userId),
          ),
        }));
        await transaction.saveMovedTaskTree(
          mutation.item,
          current.revision,
          childMutations.map(({ before, mutation: childMutation }) => ({ before, after: childMutation.item })),
        );
        await transaction.appendTaskEvents(
          this.materializeEvents(userId, [
            ...mutation.events,
            ...childMutations.flatMap(({ mutation: childMutation }) => childMutation.events),
          ]),
        );
      } else {
        await transaction.saveItem(mutation.item, current.revision);
        await transaction.appendTaskEvents(this.materializeEvents(userId, mutation.events));
      }
      return mutation.item;
    });
  }

  async transitionTask(
    userId: string,
    id: string,
    command: "complete" | "reopen" | "abandon" | "resume",
    expectedRevision?: number,
  ): Promise<Item> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findItem(userId, id), "任务不存在");
      const mutation = transitionTask(current, command, this.context(userId), expectedRevision);
      await transaction.saveItem(mutation.item, current.revision);
      await transaction.appendTaskEvents(this.materializeEvents(userId, mutation.events));
      return mutation.item;
    });
  }

  async deleteItem(userId: string, id: string, expectedRevision?: number): Promise<Item> {
    return this.dependencies.store.transaction(async (transaction) => {
      const current = await requireResource(transaction.findItem(userId, id), "内容不存在");
      const mutation = deleteItem(current, this.context(userId), expectedRevision);
      const childMutations =
        current.kind === "task" && current.parentTaskId === null
          ? (await transaction.listItems({ userId, parentTaskId: current.id })).map((child) => ({
              child,
              mutation: deleteItem(child, this.context(userId), child.revision),
            }))
          : [];
      for (const { child, mutation: childMutation } of childMutations) {
        await transaction.saveItem(childMutation.item, child.revision);
      }
      await transaction.saveItem(mutation.item, current.revision);
      await transaction.appendTaskEvents(
        this.materializeEvents(userId, [
          ...childMutations.flatMap(({ mutation: childMutation }) => childMutation.events),
          ...mutation.events,
        ]),
      );
      return mutation.item;
    });
  }

  async reorderFolders(userId: string, ids: readonly string[]): Promise<void> {
    await this.dependencies.store.transaction(async (transaction) => {
      const current = await transaction.listFolders(userId);
      await applyReorder(ids, current, (entity) => transaction.saveFolder(entity, entity.revision - 1), this.context(userId));
    });
  }

  async reorderTaskLists(userId: string, ids: readonly string[]): Promise<void> {
    await this.dependencies.store.transaction(async (transaction) => {
      const current = await transaction.listTaskLists(userId);
      await applyReorder(ids, current, (entity) => transaction.saveTaskList(entity, entity.revision - 1), this.context(userId));
    });
  }

  async reorderTaskGroups(userId: string, listId: string, ids: readonly string[]): Promise<void> {
    await this.dependencies.store.transaction(async (transaction) => {
      const current = await transaction.listTaskGroups(userId, listId);
      await applyReorder(ids, current, (entity) => transaction.saveTaskGroup(entity, entity.revision - 1), this.context(userId));
    });
  }

  async reorderItems(
    userId: string,
    scope: { listId: string; groupId: string | null; parentTaskId: string | null },
    ids: readonly string[],
  ): Promise<void> {
    await this.dependencies.store.transaction(async (transaction) => {
      const list = await requireResource(transaction.findTaskList(userId, scope.listId), "清单不存在");
      if (list.archivedAt !== null) throw new DomainError("INVALID_RELATION", "不能排序已归档清单中的内容");
      if (scope.groupId !== null) {
        const group = await requireResource(transaction.findTaskGroup(userId, scope.groupId), "分组不存在");
        if (group.listId !== scope.listId || group.archivedAt !== null) {
          throw new DomainError("INVALID_RELATION", "分组必须属于目标清单且未归档");
        }
      }
      if (scope.parentTaskId !== null) {
        const parent = await requireResource(transaction.findItem(userId, scope.parentTaskId), "父任务不存在");
        if (parent.listId !== scope.listId || parent.parentTaskId !== null || parent.kind !== "task") {
          throw new DomainError("INVALID_RELATION", "父任务必须是同一清单中的顶层任务");
        }
      }
      const current = await transaction.listItems({ userId, ...scope });
      await applyReorder(ids, current, (entity) => transaction.saveItem(entity, entity.revision - 1), this.context(userId));
    });
  }

  private context(userId: string) {
    return { userId, clock: this.dependencies.clock, ids: this.dependencies.ids };
  }

  private materializeEvents(userId: string, drafts: readonly TaskEventDraft[]): TaskEvent[] {
    const recordedAt = toIso(this.dependencies.clock.now());
    return drafts.map((draft) => ({
      ...draft,
      id: this.dependencies.ids.next(),
      userId,
      recordedAt,
      dedupeKey: null,
    }));
  }
}

async function requireResource<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const value = await promise;
  if (!value) throw new DomainError("RESOURCE_NOT_FOUND", message);
  return value;
}

async function applyReorder<T extends { id: string; positionKey: string; revision: number; updatedAt: string }>(
  ids: readonly string[],
  current: readonly T[],
  save: (entity: T) => Promise<void>,
  context: { clock: Clock },
): Promise<void> {
  const activeIds = current.map((entity) => entity.id);
  if (ids.length !== activeIds.length || ids.some((id) => !activeIds.includes(id)) || new Set(ids).size !== ids.length) {
    throw new DomainError("INVALID_RELATION", "排序必须且只能包含当前范围内的全部对象");
  }
  const positions = rebalancePositions(ids);
  const updatedAt = toIso(context.clock.now());
  for (const entity of current) {
    await save({ ...entity, positionKey: positions.get(entity.id)!, revision: entity.revision + 1, updatedAt });
  }
}
