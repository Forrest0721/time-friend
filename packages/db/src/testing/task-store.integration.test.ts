import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import { DomainError, TaskService, TaskStore, TaskStoreTransaction } from "@time-friend/domain";

import { createDatabaseClient, DatabaseClient } from "../client.js";
import { PostgresIdempotencyExecutor } from "../idempotency.js";
import { PostgresTaskStore } from "../repositories/task-store.js";
import { folders, idempotencyRecords, items, lists, taskEvents, users } from "../schema/index.js";
import { PostgresTransactionContext } from "../transaction-context.js";

const USER_A = "00000000-0000-7000-8000-000000000001";
const USER_B = "00000000-0000-7000-8000-000000000002";

describe("PostgresTaskStore", () => {
  let container: StartedPostgreSqlContainer;
  let client: DatabaseClient;
  let service: TaskService;
  let idempotency: PostgresIdempotencyExecutor;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    client = createDatabaseClient(container.getConnectionUri());
    await migrate(client.db, { migrationsFolder: new URL("../../migrations", import.meta.url).pathname });
  });

  beforeEach(async () => {
    await client.db.execute(sql`TRUNCATE TABLE idempotency_records, task_events, items, groups, lists, folders, users CASCADE`);
    await client.db.insert(users).values([
      { id: USER_A, email: "a@example.com", name: "A" },
      { id: USER_B, email: "b@example.com", name: "B" },
    ]);
    const transactions = new PostgresTransactionContext();
    service = new TaskService({
      store: new PostgresTaskStore(client.db, transactions),
      clock: { now: () => new Date("2026-08-18T08:00:00.000Z") },
      ids: { next: uuidv7 },
    });
    idempotency = new PostgresIdempotencyExecutor(client.db, transactions);
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it("runs the migration and enforces one active inbox at the database boundary", async () => {
    const inbox = await service.createTaskList(USER_A, { name: "收集箱", isInbox: true });

    await expect(service.createTaskList(USER_A, { name: "另一个收集箱", isInbox: true })).rejects.toMatchObject({
      code: "INVALID_RELATION",
    });
    await expect(
      client.db.insert(lists).values({
        id: randomUUID(),
        userId: USER_A,
        name: "绕过领域层的收集箱",
        positionKey: `${inbox.positionKey}z`,
        isInbox: true,
      }),
    ).rejects.toThrow();
  });

  it("commits task state and append-only events in the same transaction", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const task = await service.createItem(USER_A, { kind: "task", title: "完成 API", listId: list.id });
    const completed = await service.transitionTask(USER_A, task.id, "complete", 1);

    expect(completed).toMatchObject({ status: "completed", revision: 2, completedAt: "2026-08-18T08:00:00.000Z" });
    const rows = await client.db.select().from(taskEvents).where(sql`${taskEvents.userId} = ${USER_A} AND ${taskEvents.taskId} = ${task.id}`);
    expect(rows.map((row) => row.eventType)).toEqual(["created", "completed"]);
  });

  it("distinguishes notes from tasks with database checks", async () => {
    const list = await service.createTaskList(USER_A, { name: "资料" });
    const note = await service.createItem(USER_A, { kind: "note", title: "访谈笔记", listId: list.id });

    expect(note).toMatchObject({ status: null, priority: null });
    await expect(
      client.db.insert(items).values({
        id: randomUUID(),
        userId: USER_A,
        listId: list.id,
        kind: "note",
        title: "非法笔记",
        status: null,
        priority: 5,
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        positionKey: "a0",
      }),
    ).rejects.toThrow();
  });

  it("prevents a group from being assigned across lists even when bypassing the service", async () => {
    const first = await service.createTaskList(USER_A, { name: "清单 A" });
    const second = await service.createTaskList(USER_A, { name: "清单 B" });
    const group = await service.createTaskGroup(USER_A, { listId: second.id, name: "B 分组" });

    await expect(
      client.db.insert(items).values({
        id: randomUUID(),
        userId: USER_A,
        listId: first.id,
        groupId: group.id,
        kind: "task",
        title: "跨清单任务",
        status: "pending",
        priority: 0,
        contentDoc: { type: "doc", schemaVersion: 1, content: [] },
        positionKey: "a0",
      }),
    ).rejects.toThrow();
  });

  it("keeps tenant scope in every repository lookup", async () => {
    const list = await service.createTaskList(USER_A, { name: "私有" });
    const task = await service.createItem(USER_A, { kind: "task", title: "仅 A 可见", listId: list.id });
    const store = new PostgresTaskStore(client.db);

    await expect(store.transaction((transaction) => transaction.findItem(USER_B, task.id))).resolves.toBeNull();
  });

  it("rejects stale revisions and preserves the latest value", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const task = await service.createItem(USER_A, { kind: "task", title: "初始标题", listId: list.id });
    const updated = await service.updateItem(USER_A, task.id, { title: "最新标题", expectedRevision: 1 });

    await expect(service.updateItem(USER_A, task.id, { title: "陈旧覆盖", expectedRevision: 1 })).rejects.toBeInstanceOf(DomainError);
    const store = new PostgresTaskStore(client.db);
    const latest = await store.transaction((transaction) => transaction.findItem(USER_A, task.id));
    expect(latest).toMatchObject({ title: "最新标题", revision: updated.revision });
  });

  it("soft-deletes content while retaining its immutable audit trail", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const task = await service.createItem(USER_A, { kind: "task", title: "待删除", listId: list.id });
    await service.deleteItem(USER_A, task.id, 1);

    const store = new PostgresTaskStore(client.db);
    await expect(store.transaction((transaction) => transaction.findItem(USER_A, task.id))).resolves.toBeNull();
    const deletedRows = await client.db.select().from(items).where(sql`${items.id} = ${task.id}`);
    const eventRows = await client.db.select().from(taskEvents).where(sql`${taskEvents.taskId} = ${task.id}`);
    expect(deletedRows[0]?.deletedAt).toEqual(new Date("2026-08-18T08:00:00.000Z"));
    expect(eventRows.map((row) => row.eventType)).toEqual(["created", "deleted"]);
  });

  it("moves a parent task and its children to another list atomically", async () => {
    const source = await service.createTaskList(USER_A, { name: "来源" });
    const target = await service.createTaskList(USER_A, { name: "目标" });
    const sourceGroup = await service.createTaskGroup(USER_A, { listId: source.id, name: "来源分组" });
    const targetGroup = await service.createTaskGroup(USER_A, { listId: target.id, name: "目标分组" });
    const parent = await service.createItem(USER_A, {
      kind: "task",
      title: "父任务",
      listId: source.id,
      groupId: sourceGroup.id,
    });
    const child = await service.createItem(USER_A, {
      kind: "task",
      title: "子任务",
      listId: source.id,
      groupId: sourceGroup.id,
      parentTaskId: parent.id,
    });

    await service.updateItem(USER_A, parent.id, {
      listId: target.id,
      groupId: targetGroup.id,
      expectedRevision: parent.revision,
    });

    const store = new PostgresTaskStore(client.db);
    const movedParent = await store.transaction((transaction) => transaction.findItem(USER_A, parent.id));
    const movedChild = await store.transaction((transaction) => transaction.findItem(USER_A, child.id));
    expect(movedParent).toMatchObject({ listId: target.id, groupId: targetGroup.id, revision: 2 });
    expect(movedChild).toMatchObject({ listId: target.id, groupId: null, parentTaskId: parent.id, revision: 2 });
    const childTimeline = await service.listTaskEvents(USER_A, child.id);
    expect(childTimeline.map((event) => event.eventType)).toEqual(["created", "moved"]);
  });

  it("soft-deletes children with their parent instead of leaving hidden orphans", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const parent = await service.createItem(USER_A, { kind: "task", title: "父任务", listId: list.id });
    const child = await service.createItem(USER_A, {
      kind: "task",
      title: "子任务",
      listId: list.id,
      parentTaskId: parent.id,
    });

    await service.deleteItem(USER_A, parent.id, parent.revision);

    const store = new PostgresTaskStore(client.db);
    await expect(store.transaction((transaction) => transaction.findItem(USER_A, parent.id))).resolves.toBeNull();
    await expect(store.transaction((transaction) => transaction.findItem(USER_A, child.id))).resolves.toBeNull();
  });

  it("keeps content reachable when its group or folder is archived", async () => {
    const folder = await service.createFolder(USER_A, { name: "工作" });
    const list = await service.createTaskList(USER_A, { name: "项目", folderId: folder.id });
    const group = await service.createTaskGroup(USER_A, { listId: list.id, name: "本周" });
    const task = await service.createItem(USER_A, { kind: "task", title: "保留任务", listId: list.id, groupId: group.id });

    await service.updateTaskGroup(USER_A, group.id, { archived: true, expectedRevision: group.revision });
    await service.updateFolder(USER_A, folder.id, { archived: true, expectedRevision: folder.revision });

    const [storedTask] = await client.db.select().from(items).where(sql`${items.id} = ${task.id}`);
    const [storedList] = await client.db.select().from(lists).where(sql`${lists.id} = ${list.id}`);
    const [storedFolder] = await client.db.select().from(folders).where(sql`${folders.id} = ${folder.id}`);
    expect(storedTask?.groupId).toBeNull();
    expect(storedList?.folderId).toBeNull();
    expect(storedFolder?.archivedAt).not.toBeNull();
  });

  it("reorders every content item in an explicit list scope", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const first = await service.createItem(USER_A, { kind: "task", title: "第一项", listId: list.id });
    const second = await service.createItem(USER_A, { kind: "note", title: "第二项", listId: list.id });

    await service.reorderItems(USER_A, { listId: list.id, groupId: null, parentTaskId: null }, [second.id, first.id]);

    const ordered = await service.listItems({ userId: USER_A, listId: list.id, groupId: null, parentTaskId: null });
    expect(ordered.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it("rolls back state when event persistence fails", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    const postgresStore = new PostgresTaskStore(client.db);
    const failingStore: TaskStore = {
      transaction: <T>(work: (transaction: TaskStoreTransaction) => Promise<T>) =>
        postgresStore.transaction((transaction) =>
          work(
            new Proxy(transaction, {
              get(target, property) {
                if (property === "appendTaskEvents") return async () => Promise.reject(new Error("simulated event write failure"));
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ),
    };
    const failingService = new TaskService({
      store: failingStore,
      clock: { now: () => new Date("2026-08-18T08:00:00.000Z") },
      ids: { next: uuidv7 },
    });

    await expect(failingService.createItem(USER_A, { kind: "task", title: "孤立事件不能出现", listId: list.id })).rejects.toThrow(
      "simulated event write failure",
    );
    const count = await client.db.select({ id: items.id }).from(items).where(sql`${items.userId} = ${USER_A}`);
    expect(count).toHaveLength(0);
  });

  it("atomically replays an idempotent command without duplicating the task", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    let calls = 0;
    const execute = () =>
      idempotency.execute({
        userId: USER_A,
        routeKey: "POST /items",
        idempotencyKey: "create-task-001",
        requestBody: { listId: list.id, title: "幂等任务" },
        operation: async () => {
          calls += 1;
          return { statusCode: 201, body: await service.createItem(USER_A, { kind: "task", title: "幂等任务", listId: list.id }) };
        },
      });

    const [first, replay] = await Promise.all([execute(), execute()]);
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
    const persistedItems = await client.db.select().from(items).where(sql`${items.userId} = ${USER_A}`);
    const records = await client.db.select().from(idempotencyRecords).where(sql`${idempotencyRecords.userId} = ${USER_A}`);
    expect(persistedItems).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    await idempotency.execute({
      userId: USER_A,
      routeKey: "POST /folders",
      idempotencyKey: "folder-create-001",
      requestBody: { name: "工作" },
      operation: async () => ({ statusCode: 201, body: await service.createFolder(USER_A, { name: "工作" }) }),
    });

    await expect(
      idempotency.execute({
        userId: USER_A,
        routeKey: "POST /folders",
        idempotencyKey: "folder-create-001",
        requestBody: { name: "个人" },
        operation: async () => ({ statusCode: 201, body: await service.createFolder(USER_A, { name: "个人" }) }),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rolls back business writes when an idempotent operation fails", async () => {
    const list = await service.createTaskList(USER_A, { name: "产品" });
    await expect(
      idempotency.execute({
        userId: USER_A,
        routeKey: "POST /items",
        idempotencyKey: "create-task-fail",
        requestBody: { listId: list.id, title: "不能残留" },
        operation: async () => {
          await service.createItem(USER_A, { kind: "task", title: "不能残留", listId: list.id });
          throw new Error("simulated response failure");
        },
      }),
    ).rejects.toThrow("simulated response failure");

    const persistedItems = await client.db.select().from(items).where(sql`${items.userId} = ${USER_A}`);
    const records = await client.db.select().from(idempotencyRecords).where(sql`${idempotencyRecords.userId} = ${USER_A}`);
    expect(persistedItems).toHaveLength(0);
    expect(records).toHaveLength(0);
  });
});
