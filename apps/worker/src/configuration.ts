export interface WorkerConfiguration {
  databaseURL: string;
  trajectoryModel: string;
  trajectoryPricing?: { inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number };
}

export function loadWorkerConfiguration(environment: NodeJS.ProcessEnv): WorkerConfiguration {
  const inputPrice = optionalNonNegativeNumber(environment, "TRAJECTORY_INPUT_USD_PER_MILLION_TOKENS");
  const outputPrice = optionalNonNegativeNumber(environment, "TRAJECTORY_OUTPUT_USD_PER_MILLION_TOKENS");
  if ((inputPrice === undefined) !== (outputPrice === undefined)) {
    throw new Error("both trajectory token prices must be configured together");
  }
  return {
    databaseURL: requiredEnvironment(environment, "DATABASE_URL"),
    trajectoryModel: requiredEnvironment(environment, "TRAJECTORY_MODEL"),
    ...(inputPrice === undefined || outputPrice === undefined ? {} : { trajectoryPricing: { inputUsdPerMillionTokens: inputPrice, outputUsdPerMillionTokens: outputPrice } }),
  };
}

function optionalNonNegativeNumber(environment: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
