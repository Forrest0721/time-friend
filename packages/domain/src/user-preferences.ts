import { DomainError } from "./errors.js";

export interface UserAgentPreference {
  userId: string;
  agentEnabled: boolean;
  updatedAt: string;
}

export interface UserPreferenceStore {
  setAgentEnabled(userId: string, enabled: boolean, now: string): Promise<UserAgentPreference | null>;
}

export class UserPreferenceService {
  constructor(
    private readonly dependencies: {
      store: UserPreferenceStore;
      clock: { now(): Date };
    },
  ) {}

  async setAgentEnabled(userId: string, enabled: boolean): Promise<UserAgentPreference> {
    const preference = await this.dependencies.store.setAgentEnabled(
      userId,
      enabled,
      this.dependencies.clock.now().toISOString(),
    );
    if (!preference) throw new DomainError("RESOURCE_NOT_FOUND", "用户不存在");
    return preference;
  }
}
