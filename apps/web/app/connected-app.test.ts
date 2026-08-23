import { describe, expect, it } from "vitest";

import { formatDuration, optimisticItemFrom, optimisticTaskTransition } from "./connected-app";
import type { CreateItemOutboxEntry } from "./client-db";
import { contentDocumentToText, textToContentDocument } from "./content-document";

describe("connected app content helpers", () => {
  it("round-trips paragraphs and checked/unchecked items through the shared content document", () => {
    const source = "产品背景\n- [ ] 校验队列\n- [x] 完成接口";
    const document = textToContentDocument(source);

    expect(document).toEqual({
      type: "doc",
      schemaVersion: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "产品背景" }] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "校验队列" }] }] },
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "完成接口" }] }] },
          ],
        },
      ],
    });
    expect(contentDocumentToText(document)).toBe(source);
  });

  it("formats short and long effective durations without negative values", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(125)).toBe("02:05");
    expect(formatDuration(3_725)).toBe("1h 02m");
  });

  it("creates a contract-shaped optimistic task without inventing server state", () => {
    const entry: CreateItemOutboxEntry = {
      id: "019c0000-0000-7000-8000-000000000001",
      userId: "00000000-0000-7000-8000-000000000001",
      idempotencyKey: "019c0000-0000-7000-8000-000000000002",
      body: {
        id: "019c0000-0000-7000-8000-000000000003",
        listId: "019c0000-0000-7000-8000-000000000004",
        groupId: null,
        parentTaskId: null,
        kind: "task",
        title: "写下第一条任务",
        priority: "high",
        plannedOn: "2026-08-24",
      },
      state: "pending",
      attempts: 0,
      lastError: null,
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };

    expect(optimisticItemFrom(entry, "019c0000-0000-7000-8000-000000000005")).toMatchObject({
      id: entry.body.id,
      userId: "019c0000-0000-7000-8000-000000000005",
      status: "pending",
      priority: "high",
      plannedOn: "2026-08-24",
      revision: 1,
      deletedAt: null,
    });
  });

  it("applies task state transitions immediately while retaining a rollback snapshot", () => {
    const source = optimisticItemFrom({
      id: crypto.randomUUID(), userId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      body: { id: crypto.randomUUID(), listId: crypto.randomUUID(), kind: "task", title: "提交版本" },
      state: "pending", attempts: 0, lastError: null, createdAt: "2026-08-23T12:00:00.000Z", updatedAt: "2026-08-23T12:00:00.000Z",
    }, crypto.randomUUID());
    const completed = optimisticTaskTransition(source, "complete", "2026-08-23T12:01:00.000Z");
    expect(completed).toMatchObject({ status: "completed", revision: 2, completedAt: "2026-08-23T12:01:00.000Z", abandonedAt: null });
    expect(source).toMatchObject({ status: "pending", revision: 1, completedAt: null });
  });
});
