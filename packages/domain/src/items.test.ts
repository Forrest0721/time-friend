import { describe, expect, it } from "vitest";

import { createItem, deleteItem, transitionTask, updateItem } from "./items.js";
import { createTaskGroup, createTaskList } from "./organization.js";
import { makeContext } from "./test-helpers.js";

function setup(userId = "user-1") {
  const context = makeContext(userId);
  const list = createTaskList({ name: "产品" }, context);
  const group = createTaskGroup({ name: "本周", listId: list.id }, context, list);
  return { context, list, group };
}

describe("items domain", () => {
  it("creates a task with defaults and an immutable creation event", () => {
    const { context, list, group } = setup();
    const result = createItem(
      { kind: "task", title: "  完成技术方案  ", listId: list.id, groupId: group.id },
      { list, group },
      context,
    );

    expect(result.item).toMatchObject({ title: "完成技术方案", status: "pending", priority: 0, plannedOn: null });
    expect(result.events).toEqual([
      expect.objectContaining({ taskId: result.item.id, eventType: "created", payload: { parentTaskId: null } }),
    ]);
  });

  it("creates notes without task-only fields or task events", () => {
    const { context, list } = setup();
    const result = createItem({ kind: "note", title: "研究笔记", listId: list.id }, { list }, context);

    expect(result.item).toMatchObject({ status: null, priority: null, plannedOn: null, parentTaskId: null });
    expect(result.events).toEqual([]);
    expect(() =>
      createItem({ kind: "note", title: "错误笔记", listId: list.id, priority: 3 }, { list }, context),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ITEM_KIND" }));
  });

  it("allows exactly one subtask level in the same list", () => {
    const { context, list } = setup();
    const parent = createItem({ kind: "task", title: "父任务", listId: list.id }, { list }, context).item;
    const child = createItem(
      { kind: "task", title: "子任务", listId: list.id, parentTaskId: parent.id },
      { list, parent },
      context,
    );

    expect(child.item.parentTaskId).toBe(parent.id);
    expect(child.events.map((entry) => entry.eventType)).toEqual(["created", "subtask_created"]);
    expect(() =>
      createItem(
        { kind: "task", title: "孙任务", listId: list.id, parentTaskId: child.item.id },
        { list, parent: child.item },
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RELATION" }));
  });

  it("rejects cross-list groups and cross-user parents", () => {
    const { context, list } = setup();
    const otherList = createTaskList({ name: "另一个清单" }, context);
    const otherGroup = createTaskGroup({ name: "其他分组", listId: otherList.id }, context, otherList);
    const other = setup("user-2");
    const foreignParent = createItem({ kind: "task", title: "他人任务", listId: other.list.id }, { list: other.list }, other.context).item;

    expect(() =>
      createItem({ kind: "task", title: "错误分组", listId: list.id, groupId: otherGroup.id }, { list, group: otherGroup }, context),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RELATION" }));
    expect(() =>
      createItem({ kind: "task", title: "越权子任务", listId: list.id, parentTaskId: foreignParent.id }, { list, parent: foreignParent }, context),
    ).toThrowError(expect.objectContaining({ code: "CROSS_USER_ACCESS" }));
  });

  it("validates real calendar dates", () => {
    const { context, list } = setup();
    expect(() =>
      createItem({ kind: "task", title: "不存在日期", listId: list.id, plannedOn: "2026-02-30" }, { list }, context),
    ).toThrowError(expect.objectContaining({ code: "INVALID_DATE" }));
  });

  it("records every trajectory-relevant task edit as a typed event", () => {
    const { context, list, group } = setup();
    const current = createItem({ kind: "task", title: "旧标题", listId: list.id }, { list }, context).item;
    const result = updateItem(
      current,
      {
        title: "新标题",
        groupId: group.id,
        plannedOn: "2026-08-21",
        priority: 5,
        contentDoc: {
          type: "doc",
          schemaVersion: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
        },
        expectedRevision: 1,
      },
      { list, group },
      context,
    );

    expect(result.item.contentText).toBe("正文");
    expect(result.events.map((entry) => entry.eventType)).toEqual([
      "title_changed",
      "content_changed",
      "moved",
      "planned_on_changed",
      "priority_changed",
    ]);
  });

  it("records both parent timelines when a subtask is reparented", () => {
    const { context, list } = setup();
    const firstParent = createItem({ kind: "task", title: "父任务 A", listId: list.id }, { list }, context).item;
    const secondParent = createItem({ kind: "task", title: "父任务 B", listId: list.id }, { list }, context).item;
    const child = createItem(
      { kind: "task", title: "子任务", listId: list.id, parentTaskId: firstParent.id },
      { list, parent: firstParent },
      context,
    ).item;

    const result = updateItem(
      child,
      { parentTaskId: secondParent.id, expectedRevision: 1 },
      { list, parent: secondParent },
      context,
    );

    expect(result.events).toEqual([
      expect.objectContaining({ taskId: child.id, eventType: "moved" }),
      expect.objectContaining({ taskId: firstParent.id, eventType: "subtask_deleted", payload: expect.objectContaining({ reason: "reparented" }) }),
      expect.objectContaining({ taskId: secondParent.id, eventType: "subtask_created", payload: expect.objectContaining({ reason: "reparented" }) }),
    ]);
  });

  it("enforces the task state machine and keeps completed distinct from abandoned", () => {
    const { context, list } = setup();
    const pending = createItem({ kind: "task", title: "任务", listId: list.id }, { list }, context).item;
    const completed = transitionTask(pending, "complete", context).item;

    expect(completed).toMatchObject({ status: "completed", abandonedAt: null, completedAt: "2026-08-18T08:00:00.000Z" });
    expect(() => transitionTask(completed, "abandon", context)).toThrowError(expect.objectContaining({ code: "INVALID_TASK_TRANSITION" }));

    const reopened = transitionTask(completed, "reopen", context).item;
    const abandoned = transitionTask(reopened, "abandon", context).item;
    expect(abandoned).toMatchObject({ status: "abandoned", completedAt: null, abandonedAt: "2026-08-18T08:00:00.000Z" });
    expect(transitionTask(abandoned, "resume", context).item).toMatchObject({ status: "pending", completedAt: null, abandonedAt: null });
  });

  it("soft-deletes items with revision protection and parent audit", () => {
    const { context, list } = setup();
    const parent = createItem({ kind: "task", title: "父任务", listId: list.id }, { list }, context).item;
    const child = createItem({ kind: "task", title: "子任务", listId: list.id, parentTaskId: parent.id }, { list, parent }, context).item;

    expect(() => deleteItem(child, context, 99)).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    const deleted = deleteItem(child, context, 1);
    expect(deleted.item.deletedAt).toBe("2026-08-18T08:00:00.000Z");
    expect(deleted.events.map((entry) => entry.eventType)).toEqual(["deleted", "subtask_deleted"]);
  });
});
