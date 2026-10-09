import { DomainError } from "./errors.js";

export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface UserDateTimePreference {
  userId: string;
  timezone: string;
  weekStartsOn: WeekStartsOn;
  revision: number;
  updatedAt: string;
}

export interface UserAgentPreference {
  userId: string;
  agentEnabled: boolean;
  revision: number;
  updatedAt: string;
}

export interface UserPreferenceUpdateResult<T> {
  preference: T;
  updated: boolean;
}

export interface UserPreferenceStore {
  updateDateTimePreferences(
    userId: string,
    patch: { timezone?: string; weekStartsOn?: WeekStartsOn },
    expectedRevision: number,
    now: string,
  ): Promise<UserPreferenceUpdateResult<UserDateTimePreference> | null>;
  setAgentEnabled(
    userId: string,
    enabled: boolean,
    expectedRevision: number,
    now: string,
  ): Promise<UserPreferenceUpdateResult<UserAgentPreference> | null>;
}

export class UserPreferenceService {
  constructor(
    private readonly dependencies: {
      store: UserPreferenceStore;
      clock: { now(): Date };
    },
  ) {}

  async updateDateTimePreferences(
    userId: string,
    patch: { timezone?: string; weekStartsOn?: number },
    expectedRevision: number,
  ): Promise<UserDateTimePreference> {
    if (patch.timezone === undefined && patch.weekStartsOn === undefined) {
      throw new DomainError("INVALID_RELATION", "至少需要修改一项日期与时间设置");
    }
    const timezone = patch.timezone?.trim();
    if (timezone !== undefined && !isValidTimeZone(timezone)) {
      throw new DomainError("INVALID_TIMEZONE", "时区必须是有效的 IANA 时区");
    }
    if (patch.weekStartsOn !== undefined && (!Number.isInteger(patch.weekStartsOn) || patch.weekStartsOn < 0 || patch.weekStartsOn > 6)) {
      throw new DomainError("INVALID_DATE", "一周开始日必须是 0 到 6 的整数");
    }
    const result = await this.dependencies.store.updateDateTimePreferences(
      userId,
      {
        ...(timezone === undefined ? {} : { timezone }),
        ...(patch.weekStartsOn === undefined ? {} : { weekStartsOn: patch.weekStartsOn as WeekStartsOn }),
      },
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
    return requireUpdatedPreference(result, expectedRevision);
  }

  async setAgentEnabled(userId: string, enabled: boolean, expectedRevision: number): Promise<UserAgentPreference> {
    const result = await this.dependencies.store.setAgentEnabled(
      userId,
      enabled,
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
    return requireUpdatedPreference(result, expectedRevision);
  }
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function requireUpdatedPreference<T extends { revision: number }>(
  result: UserPreferenceUpdateResult<T> | null,
  expectedRevision: number,
): T {
  if (!result) throw new DomainError("RESOURCE_NOT_FOUND", "用户不存在");
  if (!result.updated) {
    throw new DomainError("REVISION_CONFLICT", "设置已在其他位置更新", {
      expected: expectedRevision,
      actual: result.preference.revision,
    });
  }
  return result.preference;
}
