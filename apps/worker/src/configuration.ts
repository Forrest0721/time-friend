import {
  loadProviderRuntimeConfiguration,
  loadTrajectoryRunTarget,
  type ProviderRuntimeConfiguration,
} from "@time-friend/agent";
import type { AgentRunTarget } from "@time-friend/domain";

export interface WorkerConfiguration {
  databaseURL: string;
  trajectoryTarget: AgentRunTarget;
  providerRuntime: ProviderRuntimeConfiguration;
}

export function loadWorkerConfiguration(environment: NodeJS.ProcessEnv): WorkerConfiguration {
  return {
    databaseURL: requiredEnvironment(environment, "DATABASE_URL"),
    trajectoryTarget: loadTrajectoryRunTarget(environment),
    providerRuntime: loadProviderRuntimeConfiguration(environment),
  };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
