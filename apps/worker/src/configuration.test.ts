import { describe, expect, it } from "vitest";

import { loadWorkerConfiguration } from "./configuration.js";

describe("worker configuration", () => {
  it("normalizes the required database and Agent model settings", () => {
    expect(loadWorkerConfiguration({ DATABASE_URL: " postgres://local/test ", TRAJECTORY_PROVIDER: " OPENAI ", TRAJECTORY_MODEL: " gpt-test " })).toEqual({
      databaseURL: "postgres://local/test",
      trajectoryTarget: {
        provider: "openai",
        model: "gpt-test",
        transport: "responses",
        configVersion: 1,
        configHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      providerRuntime: { requestTimeoutMs: 120_000 },
    });
  });

  it("fails fast instead of starting a partially configured worker", () => {
    expect(() => loadWorkerConfiguration({ DATABASE_URL: "postgres://local/test", TRAJECTORY_MODEL: "gpt-test" })).toThrow("TRAJECTORY_PROVIDER is required");
  });

  it("loads model prices only as a complete non-negative pair", () => {
    expect(loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_PROVIDER: "openai",
      TRAJECTORY_MODEL: "gpt-test",
      OPENAI_API_KEY: "test-key",
      TRAJECTORY_OPENAI_INPUT_USD_PER_MILLION_TOKENS: "1.25",
      TRAJECTORY_OPENAI_OUTPUT_USD_PER_MILLION_TOKENS: "10",
    }).providerRuntime.openai?.pricing).toEqual({ inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 });
    expect(() => loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_PROVIDER: "openai",
      TRAJECTORY_MODEL: "gpt-test",
      OPENAI_API_KEY: "test-key",
      TRAJECTORY_OPENAI_INPUT_USD_PER_MILLION_TOKENS: "1",
    })).toThrow("configured together");
  });

  it("accepts only the supported DeepSeek Responses models and official endpoint", () => {
    expect(loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_PROVIDER: "deepseek",
      TRAJECTORY_MODEL: "deepseek-v4-pro",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1/",
      TRAJECTORY_REQUEST_TIMEOUT_MS: "90000",
    })).toMatchObject({
      trajectoryTarget: { provider: "deepseek", model: "deepseek-v4-pro", transport: "responses" },
      providerRuntime: { requestTimeoutMs: 90_000, deepseek: { baseURL: "https://api.deepseek.com/v1" } },
    });
    expect(() => loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_PROVIDER: "deepseek",
      TRAJECTORY_MODEL: "deepseek-chat",
    })).toThrow("deepseek-v4-pro or deepseek-v4-flash");
    expect(() => loadWorkerConfiguration({
      DATABASE_URL: "postgres://local/test",
      TRAJECTORY_PROVIDER: "deepseek",
      TRAJECTORY_MODEL: "deepseek-v4-pro",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: "https://example.com",
    })).toThrow("official");
  });
});
