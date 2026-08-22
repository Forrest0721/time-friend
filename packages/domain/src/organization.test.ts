import { describe, expect, it } from "vitest";

import { DomainError } from "./errors.js";
import { createFolder, createTaskGroup, createTaskList, updateFolder, updateTaskGroup, updateTaskList } from "./organization.js";
import { makeContext } from "./test-helpers.js";

describe("organization domain", () => {
  it("creates trimmed folders with monotonic fractional positions", () => {
    const context = makeContext();
    const first = createFolder({ name: "  工作  " }, context);
    const second = createFolder({ name: "个人" }, context, [first.positionKey]);

    expect(first.name).toBe("工作");
    expect(first.positionKey < second.positionKey).toBe(true);
    expect(first.revision).toBe(1);
  });

  it("rejects blank names and revision conflicts", () => {
    const context = makeContext();
    expect(() => createFolder({ name: "  " }, context)).toThrowError(expect.objectContaining({ code: "EMPTY_NAME" }));

    const folder = createFolder({ name: "工作" }, context);
    expect(() => updateFolder(folder, { name: "新名称", expectedRevision: 9 }, context)).toThrowError(
      expect.objectContaining({ code: "REVISION_CONFLICT" }),
    );
  });

  it("creates one inbox and prevents moving or archiving it", () => {
    const context = makeContext();
    const inbox = createTaskList({ name: "收集箱", isInbox: true }, context);

    expect(inbox.folderId).toBeNull();
    expect(() => createTaskList({ name: "另一个收集箱", isInbox: true }, context, { inboxAlreadyExists: true })).toThrowError(
      expect.objectContaining({ code: "INVALID_RELATION" }),
    );
    expect(() => updateTaskList(inbox, { archived: true }, context)).toThrowError(expect.objectContaining({ code: "INBOX_IMMUTABLE" }));
  });

  it("requires active same-user folders and lists", () => {
    const context = makeContext();
    const foreignFolder = createFolder({ name: "他人" }, makeContext("user-2"));

    expect(() =>
      createTaskList({ name: "工作", folderId: foreignFolder.id }, context, { folder: foreignFolder }),
    ).toThrowError(expect.objectContaining({ code: "CROSS_USER_ACCESS" }));

    const folder = createFolder({ name: "工作" }, context);
    const archivedFolder = updateFolder(folder, { archived: true }, context);
    expect(() =>
      createTaskList({ name: "项目", folderId: archivedFolder.id }, context, { folder: archivedFolder }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RELATION" }));
  });

  it("moves groups only to active same-user lists", () => {
    const context = makeContext();
    const source = createTaskList({ name: "来源" }, context);
    const target = createTaskList({ name: "目标" }, context, { existingPositions: [source.positionKey] });
    const group = createTaskGroup({ name: "本周", listId: source.id }, context, source);
    const moved = updateTaskGroup(group, { listId: target.id, list: target, expectedRevision: 1 }, context);

    expect(moved.listId).toBe(target.id);
    expect(moved.revision).toBe(2);
    expect(() => updateTaskGroup(group, { listId: target.id }, context)).toThrowError(expect.objectContaining({ code: "INVALID_RELATION" }));
  });

  it("preserves DomainError identity", () => {
    const context = makeContext();
    try {
      createFolder({ name: "" }, context);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
    }
  });
});
