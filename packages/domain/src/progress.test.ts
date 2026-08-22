import { describe, expect, it } from "vitest";

import { createProgress, softDeleteProgress, updateProgress } from "./progress.js";
import { makeContext } from "./test-helpers.js";

describe("progress domain", () => {
  it("creates trimmed manual progress as trajectory-ready evidence", () => {
    const entry = createProgress(
      {
        taskId: "task-1",
        source: "manual",
        outcome: "progressed",
        note: "  API 已经打通  ",
        nextStep: "  接前端  ",
      },
      makeContext(),
    );

    expect(entry).toMatchObject({
      source: "manual",
      outcome: "progressed",
      note: "API 已经打通",
      nextStep: "接前端",
      revision: 1,
      deletedAt: null,
    });
  });

  it("enforces source-specific outcomes and note content", () => {
    const context = makeContext();
    expect(() => createProgress({ taskId: "task-1", source: "manual", outcome: "completed" }, context)).toThrowError(
      expect.objectContaining({ code: "INVALID_RELATION" }),
    );
    expect(() => createProgress({ taskId: "task-1", source: "focus_end", outcome: "note" }, context)).toThrowError(
      expect.objectContaining({ code: "INVALID_RELATION" }),
    );
    expect(() => createProgress({ taskId: "task-1", source: "manual", outcome: "note", note: "  " }, context)).toThrowError(
      expect.objectContaining({ code: "INVALID_RELATION" }),
    );
  });

  it("edits and soft-deletes with revision protection while preserving recordedAt", () => {
    const context = makeContext();
    const entry = createProgress({ taskId: "task-1", source: "manual", outcome: "blocked", note: "等待权限" }, context);
    expect(() => updateProgress(entry, { outcome: "progressed", expectedRevision: 9 }, context)).toThrowError(
      expect.objectContaining({ code: "REVISION_CONFLICT" }),
    );
    const updated = updateProgress(entry, { outcome: "progressed", note: "权限已开通", expectedRevision: 1 }, context);
    const deleted = softDeleteProgress(updated, context, 2);

    expect(updated).toMatchObject({ outcome: "progressed", note: "权限已开通", revision: 2, recordedAt: entry.recordedAt });
    expect(deleted).toMatchObject({ revision: 3, recordedAt: entry.recordedAt });
    expect(deleted.deletedAt).not.toBeNull();
  });
});
