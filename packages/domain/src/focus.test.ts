import { describe, expect, it } from "vitest";

import {
  activeFocusSeconds,
  adjustFocusDuration,
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
    expect(adjusted.adjustment).toMatchObject({ beforeSeconds: 600, afterSeconds: 540, reason: "忘记暂停" });
    expect(softDeleteFocus(adjusted.session, fixture.context, 4).deletedAt).not.toBeNull();
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
