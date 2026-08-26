import { OpenAIProvider, type ModelProvider } from "@openai/agents";
import OpenAI from "openai";

import {
  AgentExecutionError,
  type AgentRunTarget,
  type TrajectoryProvider,
} from "@time-friend/domain";

import type {
  ProviderPricing,
  ProviderRuntimeConfiguration,
} from "./configuration.js";

export interface ResolvedTrajectoryProvider {
  modelProvider: ModelProvider;
  pricing?: ProviderPricing;
  sdkTracingEnabled: boolean;
}

export interface TrajectoryProviderRegistry {
  resolve(target: AgentRunTarget): ResolvedTrajectoryProvider;
  close(): Promise<void>;
}

export function createTrajectoryProviderRegistry(
  configuration: ProviderRuntimeConfiguration,
): TrajectoryProviderRegistry {
  const providers = new Map<
    TrajectoryProvider,
    {
      provider: OpenAIProvider;
      pricing?: ProviderPricing;
      sdkTracingEnabled: boolean;
    }
  >();
  if (configuration.openai) {
    providers.set("openai", {
      provider: createProvider(
        configuration.openai.apiKey,
        undefined,
        configuration.requestTimeoutMs,
      ),
      ...(configuration.openai.pricing
        ? { pricing: configuration.openai.pricing }
        : {}),
      sdkTracingEnabled: true,
    });
  }
  if (configuration.deepseek) {
    providers.set("deepseek", {
      provider: createProvider(
        configuration.deepseek.apiKey,
        configuration.deepseek.baseURL,
        configuration.requestTimeoutMs,
      ),
      ...(configuration.deepseek.pricing
        ? { pricing: configuration.deepseek.pricing }
        : {}),
      sdkTracingEnabled: false,
    });
  }
  return {
    resolve(target) {
      const resolved = providers.get(target.provider);
      if (!resolved)
        throw new AgentExecutionError("AGENT_PROVIDER_NOT_CONFIGURED", false);
      return {
        modelProvider: resolved.provider,
        ...(resolved.pricing ? { pricing: resolved.pricing } : {}),
        sdkTracingEnabled: resolved.sdkTracingEnabled,
      };
    },
    async close() {
      await Promise.all(
        [...providers.values()].map(({ provider }) => provider.close()),
      );
    },
  };
}

function createProvider(
  apiKey: string,
  baseURL: string | undefined,
  timeout: number,
): OpenAIProvider {
  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout,
    maxRetries: 0,
  });
  return new OpenAIProvider({
    openAIClient: client,
    useResponses: true,
    useResponsesWebSocket: false,
  });
}
