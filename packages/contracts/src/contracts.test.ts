import { describe, expect, it } from "vitest";

import {
  adjustFocusBoundariesBodySchema,
  createFocusBodySchema,
  createItemBodySchema,
  focusFeedbackBodySchema,
  moveItemBodySchema,
  reorderItemsBodySchema,
  updateItemBodySchema,
  updateTaskListBodySchema,
} from "./index.js";

const listId = "00000000-0000-7000-8000-000000000001";

describe("task API contracts", () => {
  it("accepts quick-add with title as the only task-specific field", () => {
    expect(createItemBodySchema.parse({ listId, kind: "task", title: "快速记录" })).toMatchObject({ title: "快速记录" });
  });

  it("rejects status mutation through generic item patch", () => {
    expect(() => updateItemBodySchema.parse({ status: "completed", expectedRevision: 1 })).toThrow();
  });

  it("separates movement from generic item editing", () => {
    expect(() => updateItemBodySchema.parse({ listId, expectedRevision: 1 })).toThrow();
    expect(
      moveItemBodySchema.parse({
        listId,
        groupId: null,
        parentTaskId: null,
        positionKey: "a0",
        expectedRevision: 1,
      }),
    ).toMatchObject({ listId, positionKey: "a0" });
  });

  it("requires optimistic revisions for every update", () => {
    expect(() => updateTaskListBodySchema.parse({ name: "新名称" })).toThrow();
    expect(updateTaskListBodySchema.parse({ name: "新名称", expectedRevision: 1 })).toMatchObject({ expectedRevision: 1 });
  });

  it("strictly rejects unknown high-risk fields", () => {
    expect(() => createItemBodySchema.parse({ listId, kind: "task", title: "任务", userId: listId })).toThrow();
  });

  it("requires an explicit, duplicate-free item ordering scope", () => {
    const itemId = "00000000-0000-7000-8000-000000000002";
    expect(reorderItemsBodySchema.parse({ listId, groupId: null, parentTaskId: null, ids: [itemId] })).toMatchObject({
      groupId: null,
      parentTaskId: null,
    });
    expect(() => reorderItemsBodySchema.parse({ listId, groupId: null, parentTaskId: null, ids: [itemId, itemId] })).toThrow();
  });

  it("enforces timer mode and feedback command invariants", () => {
    expect(() => createFocusBodySchema.parse({ mode: "stopwatch", plannedSeconds: 1_500 })).toThrow();
    expect(createFocusBodySchema.parse({ mode: "pomodoro" })).toMatchObject({ mode: "pomodoro" });
    expect(() =>
      focusFeedbackBodySchema.parse({ outcome: "progressed", completeTask: true, expectedRevision: 1 }),
    ).toThrow();
    expect(() =>
      focusFeedbackBodySchema.parse({ outcome: "blocked", effectiveSeconds: 300, expectedRevision: 1 }),
    ).toThrow();
    expect(focusFeedbackBodySchema.parse({ outcome: null, expectedRevision: 1 })).toMatchObject({
      outcome: null,
      completeTask: false,
    });
  });

  it("compares corrected focus boundaries as instants rather than offset strings", () => {
    expect(adjustFocusBoundariesBodySchema.parse({
      startedAt: "2026-08-23T10:00:00+08:00",
      endedAt: "2026-08-23T03:00:00Z",
      reason: "统一时区后核对",
      expectedRevision: 1,
    })).toMatchObject({ reason: "统一时区后核对" });
    expect(() => adjustFocusBoundariesBodySchema.parse({
      startedAt: "2026-08-23T04:00:00Z",
      endedAt: "2026-08-23T10:00:00+08:00",
      reason: "时间倒置",
      expectedRevision: 1,
    })).toThrow();
  });
});
