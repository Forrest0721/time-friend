import { describe, expect, it, vi } from "vitest";

import type { UserPreferenceStore } from "./user-preferences.js";
import { UserPreferenceService } from "./user-preferences.js";

const now = "2026-10-09T08:00:00.000Z";

describe("UserPreferenceService", () => {
  it("updates date preferences with a validated timezone and week start", async () => {
    const store = preferenceStore();
    vi.mocked(store.updateDateTimePreferences).mockResolvedValue({
      updated: true,
      preference: {
        userId: "user-a",
        timezone: "Europe/London",
        weekStartsOn: 0,
        revision: 2,
        updatedAt: now,
      },
    });
    const service = createService(store);

    await expect(service.updateDateTimePreferences(
      "user-a",
      { timezone: " Europe/London ", weekStartsOn: 0 },
      1,
    )).resolves.toMatchObject({ timezone: "Europe/London", weekStartsOn: 0, revision: 2 });
    expect(store.updateDateTimePreferences).toHaveBeenCalledWith(
      "user-a",
      { timezone: "Europe/London", weekStartsOn: 0 },
      1,
      now,
    );
  });

  it("rejects invalid IANA zones and week starts before persistence", async () => {
    const store = preferenceStore();
    const service = createService(store);

    await expect(service.updateDateTimePreferences("user-a", { timezone: "Mars/Olympus" }, 1))
      .rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
    await expect(service.updateDateTimePreferences("user-a", { weekStartsOn: 7 }, 1))
      .rejects.toMatchObject({ code: "INVALID_DATE" });
    expect(store.updateDateTimePreferences).not.toHaveBeenCalled();
  });

  it("reports a stale settings revision instead of overwriting", async () => {
    const store = preferenceStore();
    vi.mocked(store.updateDateTimePreferences).mockResolvedValue({
      updated: false,
      preference: {
        userId: "user-a",
        timezone: "Asia/Shanghai",
        weekStartsOn: 1,
        revision: 4,
        updatedAt: now,
      },
    });
    const service = createService(store);

    await expect(service.updateDateTimePreferences("user-a", { weekStartsOn: 6 }, 3))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", details: { expected: 3, actual: 4 } });
  });

  it("updates Agent consent through the same revision boundary", async () => {
    const store = preferenceStore();
    vi.mocked(store.setAgentEnabled).mockResolvedValue({
      updated: true,
      preference: { userId: "user-a", agentEnabled: false, revision: 3, updatedAt: now },
    });
    const service = createService(store);

    await expect(service.setAgentEnabled("user-a", false, 2)).resolves.toEqual({
      userId: "user-a",
      agentEnabled: false,
      revision: 3,
      updatedAt: now,
    });
  });

  it("does not invent preferences for a missing user", async () => {
    const store = preferenceStore();
    vi.mocked(store.updateDateTimePreferences).mockResolvedValue(null);
    const service = createService(store);

    await expect(service.updateDateTimePreferences("missing", { weekStartsOn: 1 }, 1))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

function createService(store: UserPreferenceStore) {
  return new UserPreferenceService({ store, clock: { now: () => new Date(now) } });
}

function preferenceStore(): UserPreferenceStore {
  return {
    updateDateTimePreferences: vi.fn(),
    setAgentEnabled: vi.fn(),
  };
}
