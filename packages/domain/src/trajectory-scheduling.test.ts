import { describe, expect, it, vi } from "vitest";

import type { AgentRunRecord } from "./trajectory-generation.js";
import type { PeriodRecord } from "./trajectory-service.js";
import { WeeklyReviewSchedulerService } from "./trajectory-scheduling.js";

describe("WeeklyReviewSchedulerService", () => {
  it("pages enabled users and requests the week immediately before each current week", async () => {
    const listEnabledUserIds = vi
      .fn()
      .mockResolvedValueOnce(["user-a", "user-b"])
      .mockResolvedValueOnce(["user-c"]);
    const ensureWeekContaining = vi.fn(async (userId: string, instant: Date | string) => {
      const date = new Date(instant);
      const current = date.getTime() >= Date.parse("2026-08-16T16:00:00.000Z");
      return period(userId, current ? "current" : "previous", current ? "2026-08-16T16:00:00.000Z" : "2026-08-09T16:00:00.000Z");
    });
    const requestGeneration = vi.fn(async (userId: string, periodId: string) => run(userId, periodId));
    const service = new WeeklyReviewSchedulerService({
      users: { listEnabledUserIds },
      periods: { ensureWeekContaining },
      reviews: { requestGeneration },
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
      pageSize: 2,
    });

    await expect(service.scheduleEndedWeeks()).resolves.toEqual({ usersScanned: 3, runsRequested: 3 });
    expect(listEnabledUserIds).toHaveBeenNthCalledWith(1, null, 2);
    expect(listEnabledUserIds).toHaveBeenNthCalledWith(2, "user-b", 2);
    expect(requestGeneration).toHaveBeenCalledTimes(3);
    expect(requestGeneration).toHaveBeenCalledWith("user-a", "user-a-previous", false);
    expect(ensureWeekContaining).toHaveBeenCalledWith("user-a", new Date("2026-08-16T15:59:59.999Z"));
  });
});

function period(userId: string, id: string, startsAt: string): PeriodRecord {
  return {
    id: `${userId}-${id}`,
    userId,
    kind: "week",
    timezone: "Asia/Shanghai",
    localStartDate: id === "current" ? "2026-08-17" : "2026-08-10",
    localEndDate: id === "current" ? "2026-08-23" : "2026-08-16",
    startsAt,
    endsAt: id === "current" ? "2026-08-23T16:00:00.000Z" : "2026-08-16T16:00:00.000Z",
    createdAt: "2026-08-22T08:00:00.000Z",
  };
}

function run(userId: string, periodId: string): AgentRunRecord {
  return {
    id: `${userId}-${periodId}`,
    userId,
    periodSnapshotId: periodId,
    workflowName: "trajectory.weekly-review.v1",
    workflowVersion: "1",
    provider: "openai",
    model: "test",
    modelConfig: { transport: "responses", configVersion: 1 },
    modelConfigHash: "b".repeat(64),
    promptVersion: "1",
    outputSchemaVersion: "1",
    inputHash: "a".repeat(64),
    forceLowData: false,
    status: "queued",
    rawOutput: null,
    sdkTraceId: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    attempts: 0,
    errorCode: null,
    errorDetailRedacted: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
  };
}
