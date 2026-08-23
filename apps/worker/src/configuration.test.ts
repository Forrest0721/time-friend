import { describe, expect, it } from "vitest";

import { loadWorkerConfiguration } from "./configuration.js";

describe("worker configuration", () => {
  it("normalizes the required database and Agent model settings", () => {
    expect(loadWorkerConfiguration({ DATABASE_URL: " postgres://local/test ", TRAJECTORY_MODEL: " gpt-test " })).toEqual({
      databaseURL: "postgres://local/test",
      trajectoryModel: "gpt-test",
    });
  });

  it("fails fast instead of starting a partially configured worker", () => {
    expect(() => loadWorkerConfiguration({ DATABASE_URL: "postgres://local/test" })).toThrow("TRAJECTORY_MODEL is required");
  });

  it("loads model prices only as a complete non-negative pair", () => {
    expect(loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_MODEL: "gpt-test",
      TRAJECTORY_INPUT_USD_PER_MILLION_TOKENS: "1.25",
      TRAJECTORY_OUTPUT_USD_PER_MILLION_TOKENS: "10",
    }).trajectoryPricing).toEqual({ inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 });
    expect(() => loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_MODEL: "gpt-test",
      TRAJECTORY_INPUT_USD_PER_MILLION_TOKENS: "1",
    })).toThrow("configured together");
  });
});
