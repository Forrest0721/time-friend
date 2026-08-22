export interface WorkerConfiguration {
  databaseURL: string;
  trajectoryModel: string;
}

export function loadWorkerConfiguration(environment: NodeJS.ProcessEnv): WorkerConfiguration {
  return {
    databaseURL: requiredEnvironment(environment, "DATABASE_URL"),
    trajectoryModel: requiredEnvironment(environment, "TRAJECTORY_MODEL"),
  };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
