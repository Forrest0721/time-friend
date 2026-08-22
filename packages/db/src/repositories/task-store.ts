import { and, asc, eq, isNull, SQL } from "drizzle-orm";

import {
  DomainError,
  Folder,
  Item,
  TaskEvent,
  TaskGroup,
  TaskList,
  TaskStatus,
  TaskStore,
  TaskStoreTransaction,
} from "@time-friend/domain";

import { TimeFriendDatabase } from "../client.js";
import { folders, groups, items, lists, taskEvents } from "../schema/index.js";
import { PostgresTransactionContext, TimeFriendTransaction } from "../transaction-context.js";

type DatabaseExecutor = TimeFriendDatabase | TimeFriendTransaction;

export class PostgresTaskStore implements TaskStore {
  constructor(
    private readonly database: TimeFriendDatabase,
    private readonly transactions = new PostgresTransactionContext(),
  ) {}

  transaction<T>(work: (transaction: TaskStoreTransaction) => Promise<T>): Promise<T> {
    return this.transactions.run(this.database, (transaction) => work(new PostgresTaskStoreTransaction(transaction)));
  }
}

export class PostgresTaskStoreTransaction implements TaskStoreTransaction {
  constructor(private readonly database: DatabaseExecutor) {}

  async listFolders(userId: string): Promise<Folder[]> {
    const rows = await this.database.select().from(folders).where(and(eq(folders.userId, userId), isNull(folders.archivedAt))).orderBy(asc(folders.positionKey));
    return rows.map(toFolder);
  }

  async findFolder(userId: string, id: string): Promise<Folder | null> {
    const [row] = await this.database.select().from(folders).where(and(eq(folders.userId, userId), eq(folders.id, id))).limit(1);
    return row ? toFolder(row) : null;
  }

  async saveFolder(folder: Folder, previousRevision: number | null): Promise<void> {
    if (previousRevision === null) {
      await this.database.insert(folders).values(folderToRow(folder));
      return;
    }
    const updated = await this.database
      .update(folders)
      .set(folderToRow(folder))
      .where(and(eq(folders.userId, folder.userId), eq(folders.id, folder.id), eq(folders.revision, previousRevision)))
      .returning({ id: folders.id });
    assertUpdated(updated, folder);
  }

  async listTaskLists(userId: string): Promise<TaskList[]> {
    const rows = await this.database.select().from(lists).where(and(eq(lists.userId, userId), isNull(lists.archivedAt))).orderBy(asc(lists.positionKey));
    return rows.map(toTaskList);
  }

  async findTaskList(userId: string, id: string): Promise<TaskList | null> {
    const [row] = await this.database.select().from(lists).where(and(eq(lists.userId, userId), eq(lists.id, id))).limit(1);
    return row ? toTaskList(row) : null;
  }

  async saveTaskList(list: TaskList, previousRevision: number | null): Promise<void> {
    if (previousRevision === null) {
      await this.database.insert(lists).values(taskListToRow(list));
      return;
    }
    const updated = await this.database
      .update(lists)
      .set(taskListToRow(list))
      .where(and(eq(lists.userId, list.userId), eq(lists.id, list.id), eq(lists.revision, previousRevision)))
      .returning({ id: lists.id });
    assertUpdated(updated, list);
  }

  async listTaskGroups(userId: string, listId?: string): Promise<TaskGroup[]> {
    const predicates: SQL[] = [eq(groups.userId, userId), isNull(groups.archivedAt)];
    if (listId !== undefined) predicates.push(eq(groups.listId, listId));
    const rows = await this.database.select().from(groups).where(and(...predicates)).orderBy(asc(groups.positionKey));
    return rows.map(toTaskGroup);
  }

  async findTaskGroup(userId: string, id: string): Promise<TaskGroup | null> {
    const [row] = await this.database.select().from(groups).where(and(eq(groups.userId, userId), eq(groups.id, id))).limit(1);
    return row ? toTaskGroup(row) : null;
  }

  async saveTaskGroup(group: TaskGroup, previousRevision: number | null): Promise<void> {
    if (previousRevision === null) {
      await this.database.insert(groups).values(taskGroupToRow(group));
      return;
    }
    const updated = await this.database
      .update(groups)
      .set(taskGroupToRow(group))
      .where(and(eq(groups.userId, group.userId), eq(groups.id, group.id), eq(groups.revision, previousRevision)))
      .returning({ id: groups.id });
    assertUpdated(updated, group);
  }

  async listItems(input: {
    userId: string;
    listId?: string;
    groupId?: string | null;
    parentTaskId?: string | null;
    status?: TaskStatus;
    includeDeleted?: boolean;
  }): Promise<Item[]> {
    const predicates: SQL[] = [eq(items.userId, input.userId)];
    if (!input.includeDeleted) predicates.push(isNull(items.deletedAt));
    if (input.listId !== undefined) predicates.push(eq(items.listId, input.listId));
    if (input.groupId !== undefined) predicates.push(input.groupId === null ? isNull(items.groupId) : eq(items.groupId, input.groupId));
    if (input.parentTaskId !== undefined) {
      predicates.push(input.parentTaskId === null ? isNull(items.parentTaskId) : eq(items.parentTaskId, input.parentTaskId));
    }
    if (input.status !== undefined) predicates.push(eq(items.status, input.status));
    const rows = await this.database.select().from(items).where(and(...predicates)).orderBy(asc(items.positionKey));
    return rows.map(toItem);
  }

  async findItem(userId: string, id: string): Promise<Item | null> {
    const [row] = await this.database.select().from(items).where(and(eq(items.userId, userId), eq(items.id, id), isNull(items.deletedAt))).limit(1);
    return row ? toItem(row) : null;
  }

  async saveItem(item: Item, previousRevision: number | null): Promise<void> {
    if (previousRevision === null) {
      await this.database.insert(items).values(itemToRow(item));
      return;
    }
    const updated = await this.database
      .update(items)
      .set(itemToRow(item))
      .where(and(eq(items.userId, item.userId), eq(items.id, item.id), eq(items.revision, previousRevision)))
      .returning({ id: items.id });
    assertUpdated(updated, item);
  }

  async saveMovedTaskTree(
    root: Item,
    rootPreviousRevision: number,
    children: readonly { before: Item; after: Item }[],
  ): Promise<void> {
    for (const child of children) {
      const stagedChild = { ...child.after, listId: child.before.listId };
      await this.saveItem(stagedChild, child.before.revision);
    }
    await this.saveItem(root, rootPreviousRevision);
  }

  async appendTaskEvents(events: readonly TaskEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.database.insert(taskEvents).values(events.map(taskEventToRow));
  }

  async listTaskEvents(userId: string, taskId: string): Promise<TaskEvent[]> {
    const rows = await this.database
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.userId, userId), eq(taskEvents.taskId, taskId)))
      .orderBy(asc(taskEvents.occurredAt), asc(taskEvents.recordedAt), asc(taskEvents.id));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      taskId: row.taskId,
      eventType: row.eventType as TaskEvent["eventType"],
      actorType: row.actorType,
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      payload: row.payload,
      dedupeKey: row.dedupeKey,
    }));
  }
}

function assertUpdated(updated: readonly { id: string }[], entity: { id: string; revision: number }): void {
  if (updated.length !== 1) {
    throw new DomainError("REVISION_CONFLICT", "资源已在其他位置更新", { id: entity.id, attemptedRevision: entity.revision });
  }
}

type FolderRow = typeof folders.$inferSelect;
type TaskListRow = typeof lists.$inferSelect;
type TaskGroupRow = typeof groups.$inferSelect;
type ItemRow = typeof items.$inferSelect;

function toFolder(row: FolderRow): Folder {
  return { ...row, archivedAt: isoOrNull(row.archivedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function folderToRow(folder: Folder): typeof folders.$inferInsert {
  return { ...folder, archivedAt: dateOrNull(folder.archivedAt), createdAt: new Date(folder.createdAt), updatedAt: new Date(folder.updatedAt) };
}

function toTaskList(row: TaskListRow): TaskList {
  return { ...row, archivedAt: isoOrNull(row.archivedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function taskListToRow(list: TaskList): typeof lists.$inferInsert {
  return { ...list, archivedAt: dateOrNull(list.archivedAt), createdAt: new Date(list.createdAt), updatedAt: new Date(list.updatedAt) };
}

function toTaskGroup(row: TaskGroupRow): TaskGroup {
  return { ...row, archivedAt: isoOrNull(row.archivedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function taskGroupToRow(group: TaskGroup): typeof groups.$inferInsert {
  return { ...group, archivedAt: dateOrNull(group.archivedAt), createdAt: new Date(group.createdAt), updatedAt: new Date(group.updatedAt) };
}

function toItem(row: ItemRow): Item {
  return {
    ...row,
    priority: row.priority as Item["priority"],
    completedAt: isoOrNull(row.completedAt),
    abandonedAt: isoOrNull(row.abandonedAt),
    deletedAt: isoOrNull(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function itemToRow(item: Item): typeof items.$inferInsert {
  return {
    ...item,
    completedAt: dateOrNull(item.completedAt),
    abandonedAt: dateOrNull(item.abandonedAt),
    deletedAt: dateOrNull(item.deletedAt),
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  };
}

function taskEventToRow(taskEvent: TaskEvent): typeof taskEvents.$inferInsert {
  return {
    ...taskEvent,
    occurredAt: new Date(taskEvent.occurredAt),
    recordedAt: new Date(taskEvent.recordedAt),
  };
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
