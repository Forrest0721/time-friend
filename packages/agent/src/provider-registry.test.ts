import { describe, expect, it } from "vitest";

import { AgentExecutionError } from "@time-friend/domain";

import { createTrajectoryRunTarget } from "./configuration.js";
import { createTrajectoryProviderRegistry } from "./provider-registry.js";

describe("trajectory provider registry", () => {
  it("resolves explicitly configured OpenAI and DeepSeek Responses providers", async () => {
    const registry = createTrajectoryProviderRegistry({
      requestTimeoutMs: 120_000,
      openai: { apiKey: "openai-test" },
      deepseek: {
        apiKey: "deepseek-test",
        baseURL: "https://api.deepseek.com",
      },
    });
    expect(
      registry.resolve(
        createTrajectoryRunTarget({ provider: "openai", model: "gpt-test" }),
      ),
    ).toMatchObject({ sdkTracingEnabled: true });
    expect(
      registry.resolve(
        createTrajectoryRunTarget({
          provider: "deepseek",
          model: "deepseek-v4-pro",
        }),
      ),
    ).toMatchObject({ sdkTracingEnabled: false });
    await registry.close();
  });

  it("fails closed instead of falling back across providers", async () => {
    const registry = createTrajectoryProviderRegistry({
      requestTimeoutMs: 120_000,
      openai: { apiKey: "openai-test" },
    });
    expect(() =>
      registry.resolve(
        createTrajectoryRunTarget({
          provider: "deepseek",
          model: "deepseek-v4-flash",
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<AgentExecutionError>>({
        code: "AGENT_PROVIDER_NOT_CONFIGURED",
        retryable: false,
      }),
    );
    await registry.close();
  });
});
