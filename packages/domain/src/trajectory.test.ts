import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  computePeriodFacts,
  intersectSeconds,
  previousWeeklyPeriod,
  weekPeriodContaining,
  type PeriodFactsInput,
} from "./trajectory.js";

const WEEK = weekPeriodContaining("2026-08-19T12:00:00Z", "Asia/Shanghai");

describe("weekly trajectory period", () => {
  it("uses Monday boundaries in the user's timezone", () => {
    expect(WEEK).toEqual({
      kind: "week",
      timezone: "Asia/Shanghai",
      localStartDate: "2026-08-17",
      localEndDate: "2026-08-23",
      startsAt: "2026-08-16T16:00:00Z",
      endsAt: "2026-08-23T16:00:00Z",
    });
    expect(previousWeeklyPeriod(WEEK)).toMatchObject({ localStartDate: "2026-08-10", localEndDate: "2026-08-16" });
  });

  it("honors daylight-saving boundaries instead of assuming 168 hours", () => {
    const spring = weekPeriodContaining("2026-03-05T12:00:00Z", "America/New_York");
    const autumn = weekPeriodContaining("2026-10-30T12:00:00Z", "America/New_York");
    expect((Date.parse(spring.endsAt) - Date.parse(spring.startsAt)) / 3_600_000).toBe(167);
    expect((Date.parse(autumn.endsAt) - Date.parse(autumn.startsAt)) / 3_600_000).toBe(169);
  });

  it("calculates half-open intersections", () => {
    expect(intersectSeconds({ startedAt: "2026-08-16T15:59:30Z", endedAt: "2026-08-16T16:00:30Z" }, WEEK)).toBe(30);
    expect(intersectSeconds({ startedAt: WEEK.endsAt, endedAt: "2026-08-23T16:01:00Z" }, WEEK)).toBe(0);
  });
});

describe("period facts", () => {
  it("computes deterministic facts, list allocation and the low-data rule", () => {
    const input = fixture();
    const result = computePeriodFacts(input);
    expect(result.facts).toEqual({
      schemaVersion: "1",
      focus: {
        totalSeconds: 1_200,
        sessionCount: 3,
        pomodoroCount: 1,
        unlinkedSeconds: 300,
        byList: [{ listId: "list-a", listName: "产品", seconds: 900 }],
      },
      progress: { completed: 1, progressed: 1, blocked: 0, maintenance: 0 },
      tasks: { completedIds: ["task-a"], abandonedIds: [], plannedButUnfinishedIds: ["task-b"] },
      dataQuality: { evidenceCount: 5, unlinkedFocusRatio: 0.25, hasEnoughData: true },
    });
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(computePeriodFacts({ ...input, lists: [...input.lists].reverse(), focusSessions: [...input.focusSessions].reverse() })).toEqual(result);
  });

  it("proportionally allocates corrected effective time across a week boundary without losing seconds", () => {
    const previous = previousWeeklyPeriod(WEEK);
    const base = fixture();
    const session = { id: "cross", taskId: "task-a", mode: "stopwatch" as const, state: "completed" as const, effectiveSeconds: 90 };
    const segment = { id: "cross-segment", sessionId: "cross", startedAt: "2026-08-16T15:59:00Z", endedAt: "2026-08-16T16:01:00Z" };
    const currentSeconds = computePeriodFacts({ ...base, focusSessions: [session], focusSegments: [segment], progressEntries: [] }).facts.focus.totalSeconds;
    const previousSeconds = computePeriodFacts({ ...base, period: previous, focusSessions: [session], focusSegments: [segment], progressEntries: [] }).facts.focus.totalSeconds;
    expect([previousSeconds, currentSeconds]).toEqual([45, 45]);
  });

  it("keeps canonical hashes invariant under object key and entity ordering", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }), (values) => {
        const left = values.map((value, index) => ({ id: String(index), value }));
        const right = [...left].reverse();
        const source = fixture();
        const first = computePeriodFacts({ ...source, lists: left.map(({ id, value }) => ({ id, name: value })) }).inputHash;
        const second = computePeriodFacts({ ...source, lists: right.map(({ id, value }) => ({ id, name: value })) }).inputHash;
        expect(first).toBe(second);
      }),
    );
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });

  it("never allocates more focus time than a session's effective total", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400 }), fc.integer({ min: 1, max: 86_400 }), (rawSeconds, effectiveSeconds) => {
        const start = Date.parse(WEEK.startsAt) - Math.floor(rawSeconds / 2) * 1_000;
        const source = fixture();
        const result = computePeriodFacts({
          ...source,
          focusSessions: [{ id: "property", taskId: null, mode: "stopwatch", state: "completed", effectiveSeconds }],
          focusSegments: [
            {
              id: "property-segment",
              sessionId: "property",
              startedAt: new Date(start).toISOString(),
              endedAt: new Date(start + rawSeconds * 1_000).toISOString(),
            },
          ],
          progressEntries: [],
        });
        expect(result.facts.focus.totalSeconds).toBeGreaterThanOrEqual(0);
        expect(result.facts.focus.totalSeconds).toBeLessThanOrEqual(effectiveSeconds);
      }),
    );
  });
});

function fixture(): PeriodFactsInput {
  return {
    period: WEEK,
    sourceWatermark: WEEK.endsAt,
    lists: [{ id: "list-a", name: "产品" }],
    tasks: [
      {
        id: "task-a",
        listId: "list-a",
        title: "任务 A",
        contentText: "",
        status: "completed",
        plannedOn: "2026-08-18",
        completedAt: "2026-08-20T10:00:00Z",
        abandonedAt: null,
      },
      {
        id: "task-b",
        listId: "list-a",
        title: "任务 B",
        contentText: "",
        status: "pending",
        plannedOn: "2026-08-21",
        completedAt: null,
        abandonedAt: null,
      },
    ],
    focusSessions: [
      { id: "focus-a", taskId: "task-a", mode: "pomodoro", state: "completed", effectiveSeconds: 600 },
      { id: "focus-b", taskId: "task-a", mode: "stopwatch", state: "completed", effectiveSeconds: 300 },
      { id: "focus-c", taskId: null, mode: "stopwatch", state: "completed", effectiveSeconds: 300 },
    ],
    focusSegments: [
      { id: "segment-a", sessionId: "focus-a", startedAt: "2026-08-18T08:00:00Z", endedAt: "2026-08-18T08:10:00Z" },
      { id: "segment-b", sessionId: "focus-b", startedAt: "2026-08-19T08:00:00Z", endedAt: "2026-08-19T08:05:00Z" },
      { id: "segment-c", sessionId: "focus-c", startedAt: "2026-08-20T08:00:00Z", endedAt: "2026-08-20T08:05:00Z" },
    ],
    progressEntries: [
      { id: "progress-a", taskId: "task-a", focusSessionId: "focus-a", outcome: "completed", note: null, nextStep: null, occurredAt: "2026-08-18T08:10:00Z" },
      { id: "progress-b", taskId: "task-b", focusSessionId: null, outcome: "progressed", note: null, nextStep: null, occurredAt: "2026-08-19T08:10:00Z" },
    ],
    taskEvents: [],
  };
}
