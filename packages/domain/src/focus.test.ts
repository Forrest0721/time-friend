import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  activeFocusSeconds,
  adjustFocusBoundaries,
  adjustFocusDuration,
  attachDeferredFocusFeedback,
  cancelFocus,
  capStopwatch,
  completeFocusFeedback,
  expirePomodoro,
  finishFocus,
  pauseFocus,
  resumeFocus,
  softDeleteFocus,
  startFocus,
} from "./focus.js";
import { CommandContext } from "./primitives.js";

function setup(initial = "2026-08-22T08:00:00.000Z") {
  let now = new Date(initial);
  let sequence = 0;
  const context: CommandContext = {
    userId: "user-1",
    clock: { now: () => new Date(now) },
    ids: { next: () => `id-${++sequence}` },
  };
  return {
    context,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

describe("focus domain", () => {
  it("starts a recoverable pomodoro with a persisted open segment", () => {
    const { context } = setup();
    const result = startFocus({ mode: "pomodoro", taskId: "task-1" }, context);

    expect(result.session).toMatchObject({
      state: "running",
      plannedSeconds: 1_500,
      expectedEndAt: "2026-08-22T08:25:00.000Z",
      baseActiveSeconds: 0,
    });
    expect(result.openedSegment).toMatchObject({ sessionId: result.session.id, endedAt: null, closeReason: null });
  });

  it("excludes paused time and derives the live duration from timestamps", () => {
    const fixture = setup();
    const started = startFocus({ mode: "pomodoro" }, fixture.context);
    fixture.setNow("2026-08-22T08:10:00.000Z");
    const paused = pauseFocus(started.session, started.openedSegment!, fixture.context, 1);
    fixture.setNow("2026-08-22T08:15:00.000Z");
    const resumed = resumeFocus(paused.session, fixture.context, 2);

    expect(paused.session.baseActiveSeconds).toBe(600);
    expect(resumed.session.expectedEndAt).toBe("2026-08-22T08:30:00.000Z");
    expect(activeFocusSeconds(resumed.session, resumed.openedSegment!, new Date("2026-08-22T08:20:00.000Z"))).toBe(900);

    fixture.setNow("2026-08-22T08:25:00.000Z");
    const finished = finishFocus(resumed.session, resumed.openedSegment!, fixture.context, 3);
    expect(finished.session).toMatchObject({ state: "awaiting_feedback", baseActiveSeconds: 1_200, effectiveSeconds: 1_200 });
    expect(completeFocusFeedback(finished.session, fixture.context, 4).state).toBe("completed");
  });

  it("preserves active seconds across arbitrary pause and resume sequences", () => {
    fc.assert(fc.property(
      fc.array(
        fc.record({ activeSeconds: fc.integer({ min: 0, max: 3_600 }), pausedSeconds: fc.integer({ min: 0, max: 3_600 }) }),
        { minLength: 1, maxLength: 20 },
      ),
      (intervals) => {
        const fixture = setup("2026-08-22T00:00:00.000Z");
        let clockMs = Date.parse("2026-08-22T00:00:00.000Z");
        let mutation = startFocus({ mode: "stopwatch" }, fixture.context);
        let expectedSeconds = 0;

        intervals.forEach((interval, index) => {
          clockMs += interval.activeSeconds * 1_000;
          fixture.setNow(new Date(clockMs).toISOString());
          const paused = pauseFocus(mutation.session, mutation.openedSegment!, fixture.context, mutation.session.revision);
          expectedSeconds += interval.activeSeconds;
          expect(paused.session.baseActiveSeconds).toBe(expectedSeconds);
          mutation = paused;

          if (index < intervals.length - 1) {
            clockMs += interval.pausedSeconds * 1_000;
            fixture.setNow(new Date(clockMs).toISOString());
            mutation = resumeFocus(mutation.session, fixture.context, mutation.session.revision);
          }
        });

        const finished = finishFocus(mutation.session, null, fixture.context, mutation.session.revision);
        expect(finished.session).toMatchObject({ baseActiveSeconds: expectedSeconds, effectiveSeconds: expectedSeconds });
      },
    ));
  });

  it("expires a late pomodoro at its authoritative deadline", () => {
    const fixture = setup();
    const started = startFocus({ mode: "pomodoro", plannedSeconds: 60 }, fixture.context);
    fixture.setNow("2026-08-22T08:02:30.000Z");
    const expired = expirePomodoro(started.session, started.openedSegment!, fixture.context, 1);

    expect(expired.closedSegment).toMatchObject({ endedAt: "2026-08-22T08:01:00.000Z", closeReason: "pomodoro_elapsed" });
    expect(expired.session).toMatchObject({ state: "awaiting_feedback", baseActiveSeconds: 60, effectiveSeconds: 60 });
  });

  it("supports explicit pomodoro overtime without corrupting the planned duration", () => {
    const fixture = setup();
    const started = startFocus({ mode: "pomodoro", plannedSeconds: 60 }, fixture.context);
    fixture.setNow("2026-08-22T08:01:00.000Z");
    const expired = expirePomodoro(started.session, started.openedSegment!, fixture.context, 1);
    const overtime = resumeFocus(expired.session, fixture.context, 2);
    expect(overtime.session.expectedEndAt).toBeNull();

    fixture.setNow("2026-08-22T08:01:30.000Z");
    const finished = finishFocus(overtime.session, overtime.openedSegment!, fixture.context, 3);
    expect(finished.session.effectiveSeconds).toBe(90);
  });

  it("caps a stopwatch at twelve hours and requires confirmation before continuing", () => {
    const fixture = setup();
    const started = startFocus({ mode: "stopwatch" }, fixture.context);
    fixture.setNow("2026-08-22T21:00:00.000Z");
    const capped = capStopwatch(started.session, started.openedSegment!, fixture.context, 1);

    expect(capped.session).toMatchObject({ state: "needs_attention", baseActiveSeconds: 43_200 });
    const continued = resumeFocus(capped.session, fixture.context, 2);
    expect(continued.session.expectedEndAt).toBe("2026-08-23T09:00:00.000Z");
    expect(activeFocusSeconds(continued.session, continued.openedSegment!, new Date("2026-08-22T22:00:00.000Z"))).toBe(46_800);
  });

  it("records duration corrections and permits deletion only after termination", () => {
    const fixture = setup();
    const started = startFocus({ mode: "stopwatch" }, fixture.context);
    expect(() => softDeleteFocus(started.session, fixture.context, 1)).toThrowError(
      expect.objectContaining({ code: "INVALID_FOCUS_TRANSITION" }),
    );
    fixture.setNow("2026-08-22T08:10:00.000Z");
    const finished = finishFocus(started.session, started.openedSegment!, fixture.context, 1);
    const completed = completeFocusFeedback(finished.session, fixture.context, 2);
    const adjusted = adjustFocusDuration(completed, 540, "  忘记暂停  ", fixture.context, 3);

    expect(adjusted.session.effectiveSeconds).toBe(540);
    expect(adjusted.adjustment).toMatchObject({ kind: "duration", beforeSeconds: 600, afterSeconds: 540, reason: "忘记暂停" });
    expect(softDeleteFocus(adjusted.session, fixture.context, 4).deletedAt).not.toBeNull();
  });

  it("corrects persisted boundaries, recalculates segments and preserves an explicit duration override", () => {
    const fixture = setup();
    const started = startFocus({ mode: "stopwatch" }, fixture.context);
    fixture.setNow("2026-08-22T08:10:00.000Z");
    const finished = finishFocus(started.session, started.openedSegment!, fixture.context, 1);
    const completed = completeFocusFeedback(finished.session, fixture.context, 2);

    const corrected = adjustFocusBoundaries(
      completed,
      [finished.closedSegment!],
      {
        startedAt: "2026-08-22T08:01:00.000Z",
        endedAt: "2026-08-22T08:09:00.000Z",
        reason: "实际晚一分钟开始，也提前一分钟结束",
      },
      fixture.context,
      3,
    );
    expect(corrected.session).toMatchObject({
      startedAt: "2026-08-22T08:01:00.000Z",
      endedAt: "2026-08-22T08:09:00.000Z",
      baseActiveSeconds: 480,
      effectiveSeconds: 480,
      revision: 4,
    });
    expect(corrected.adjustment).toMatchObject({
      kind: "boundaries",
      beforeSeconds: 600,
      afterSeconds: 480,
      beforeStartedAt: "2026-08-22T08:00:00.000Z",
      afterEndedAt: "2026-08-22T08:09:00.000Z",
    });

    const durationOverride = adjustFocusDuration(corrected.session, 420, "去掉走神时间", fixture.context, 4);
    const movedAgain = adjustFocusBoundaries(
      durationOverride.session,
      corrected.segments,
      {
        startedAt: "2026-08-22T08:03:00.000Z",
        endedAt: "2026-08-22T08:09:00.000Z",
        reason: "再次核对开始时间",
      },
      fixture.context,
      5,
    );
    expect(movedAgain.session).toMatchObject({ baseActiveSeconds: 360, effectiveSeconds: 420 });
  });

  it("allows exactly a completed session to attach deferred feedback", () => {
    const fixture = setup();
    const started = startFocus({ mode: "stopwatch" }, fixture.context);
    expect(() => attachDeferredFocusFeedback(started.session, fixture.context, 1)).toThrowError(
      expect.objectContaining({ code: "INVALID_FOCUS_TRANSITION" }),
    );
    fixture.setNow("2026-08-22T08:01:00.000Z");
    const finished = finishFocus(started.session, started.openedSegment!, fixture.context, 1);
    const completed = completeFocusFeedback(finished.session, fixture.context, 2);
    expect(attachDeferredFocusFeedback(completed, fixture.context, 3)).toMatchObject({ state: "completed", revision: 4 });
  });

  it("rejects stale revisions and illegal state transitions", () => {
    const fixture = setup();
    const started = startFocus({ mode: "stopwatch" }, fixture.context);
    expect(() => pauseFocus(started.session, started.openedSegment!, fixture.context, 9)).toThrowError(
      expect.objectContaining({ code: "REVISION_CONFLICT" }),
    );
    const canceled = cancelFocus(started.session, started.openedSegment!, fixture.context, 1);
    expect(() => resumeFocus(canceled.session, fixture.context, 2)).toThrowError(
      expect.objectContaining({ code: "INVALID_FOCUS_TRANSITION" }),
    );
  });
});
