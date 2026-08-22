import { CommandContext } from "./primitives.js";

export function makeContext(userId = "user-1", now = "2026-08-18T08:00:00.000Z"): CommandContext {
  let sequence = 0;
  return {
    userId,
    clock: { now: () => new Date(now) },
    ids: { next: () => `00000000-0000-7000-8000-${String(++sequence).padStart(12, "0")}` },
  };
}
