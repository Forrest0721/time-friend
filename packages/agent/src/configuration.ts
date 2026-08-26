import {
  hashCanonical,
  type AgentRunTarget,
  type TrajectoryProvider,
} from "@time-friend/domain";

const DEEPSEEK_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash"]);

export interface ProviderPricing {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface ProviderRuntimeConfiguration {
  requestTimeoutMs: number;
  openai?: { apiKey: string; pricing?: ProviderPricing };
  deepseek?: { apiKey: string; baseURL: string; pricing?: ProviderPricing };
}

export function loadTrajectoryRunTarget(
  environment: NodeJS.ProcessEnv,
): AgentRunTarget {
  return createTrajectoryRunTarget({
    provider: requiredEnvironment(environment, "TRAJECTORY_PROVIDER"),
    model: requiredEnvironment(environment, "TRAJECTORY_MODEL"),
  });
}

export function createTrajectoryRunTarget(input: {
  provider: string;
  model: string;
}): AgentRunTarget {
  const provider = parseProvider(input.provider);
  const model = input.model.trim();
  if (!model) throw new Error("TRAJECTORY_MODEL is required");
  if (provider === "deepseek" && !DEEPSEEK_MODELS.has(model)) {
    throw new Error(
      "TRAJECTORY_MODEL must be deepseek-v4-pro or deepseek-v4-flash for DeepSeek",
    );
  }
  const targetWithoutHash = {
    provider,
    model,
    transport: "responses" as const,
    configVersion: 1 as const,
  };
  return { ...targetWithoutHash, configHash: hashCanonical(targetWithoutHash) };
}

export function loadProviderRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): ProviderRuntimeConfiguration {
  const requestTimeoutMs =
    optionalPositiveInteger(environment, "TRAJECTORY_REQUEST_TIMEOUT_MS") ??
    120_000;
  const openaiKey = optionalEnvironment(environment, "OPENAI_API_KEY");
  const deepseekKey = optionalEnvironment(environment, "DEEPSEEK_API_KEY");
  return {
    requestTimeoutMs,
    ...(openaiKey
      ? {
          openai: {
            apiKey: openaiKey,
            ...optionalPricing(environment, "OPENAI"),
          },
        }
      : {}),
    ...(deepseekKey
      ? {
          deepseek: {
            apiKey: deepseekKey,
            baseURL: parseDeepSeekBaseURL(
              optionalEnvironment(environment, "DEEPSEEK_BASE_URL") ??
                "https://api.deepseek.com",
            ),
            ...optionalPricing(environment, "DEEPSEEK"),
          },
        }
      : {}),
  };
}

function parseProvider(value: string): TrajectoryProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "openai" && normalized !== "deepseek") {
    throw new Error("TRAJECTORY_PROVIDER must be openai or deepseek");
  }
  return normalized;
}

function optionalPricing(
  environment: NodeJS.ProcessEnv,
  provider: "OPENAI" | "DEEPSEEK",
): { pricing?: ProviderPricing } {
  const input = optionalNonNegativeNumber(
    environment,
    `TRAJECTORY_${provider}_INPUT_USD_PER_MILLION_TOKENS`,
  );
  const output = optionalNonNegativeNumber(
    environment,
    `TRAJECTORY_${provider}_OUTPUT_USD_PER_MILLION_TOKENS`,
  );
  if ((input === undefined) !== (output === undefined)) {
    throw new Error(
      `both ${provider.toLowerCase()} trajectory token prices must be configured together`,
    );
  }
  return input === undefined || output === undefined
    ? {}
    : {
        pricing: {
          inputUsdPerMillionTokens: input,
          outputUsdPerMillionTokens: output,
        },
      };
}

function parseDeepSeekBaseURL(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.deepseek.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "DEEPSEEK_BASE_URL must use the official https://api.deepseek.com endpoint",
    );
  }
  if (
    url.pathname !== "/" &&
    url.pathname !== "/v1" &&
    url.pathname !== "/v1/"
  ) {
    throw new Error("DEEPSEEK_BASE_URL path must be / or /v1");
  }
  return url.toString().replace(/\/$/u, "");
}

function optionalPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number | undefined {
  const raw = optionalEnvironment(environment, name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 15 * 60_000)
    throw new Error(
      `${name} must be a positive integer no greater than 900000`,
    );
  return value;
}

function optionalNonNegativeNumber(
  environment: NodeJS.ProcessEnv,
  name: string,
): number | undefined {
  const raw = optionalEnvironment(environment, name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be a non-negative number`);
  return value;
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = optionalEnvironment(environment, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}
