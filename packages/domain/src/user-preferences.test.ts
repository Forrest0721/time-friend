import { describe, expect, it } from "vitest";

import { UserPreferenceService } from "./user-preferences.js";

describe("UserPreferenceService", () => {
  it("updates Agent consent with a server timestamp", async () => {
    const service = new UserPreferenceService({
      store: {
        setAgentEnabled: async (userId, agentEnabled, updatedAt) => ({ userId, agentEnabled, updatedAt }),
      },
      clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
    });

    await expect(service.setAgentEnabled("user-a", false)).resolves.toEqual({
      userId: "user-a",
      agentEnabled: false,
      updatedAt: "2026-08-22T08:00:00.000Z",
    });
  });

  it("does not invent preferences for a missing user", async () => {
    const service = new UserPreferenceService({
      store: { setAgentEnabled: async () => null },
      clock: { now: () => new Date() },
    });

    await expect(service.setAgentEnabled("missing", true)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});
