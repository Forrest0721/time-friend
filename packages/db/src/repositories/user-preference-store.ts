import { and, eq, sql } from "drizzle-orm";

import type {
  UserAgentPreference,
  UserDateTimePreference,
  UserPreferenceStore,
  UserPreferenceUpdateResult,
  WeekStartsOn,
} from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import { users } from "../schema/index.js";

export class PostgresUserPreferenceStore implements UserPreferenceStore {
  constructor(private readonly database: TimeFriendDatabase) {}

  async updateDateTimePreferences(
    userId: string,
    patch: { timezone?: string; weekStartsOn?: WeekStartsOn },
    expectedRevision: number,
    now: string,
  ): Promise<UserPreferenceUpdateResult<UserDateTimePreference> | null> {
    const [updated] = await this.database
      .update(users)
      .set({
        ...patch,
        settingsRevision: sql`${users.settingsRevision} + 1`,
        updatedAt: new Date(now),
      })
      .where(and(eq(users.id, userId), eq(users.settingsRevision, expectedRevision)))
      .returning(dateTimeSelection);
    if (updated) return { preference: mapDateTimePreference(updated), updated: true };
    const [current] = await this.database
      .select(dateTimeSelection)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return current ? { preference: mapDateTimePreference(current), updated: false } : null;
  }

  async setAgentEnabled(
    userId: string,
    enabled: boolean,
    expectedRevision: number,
    now: string,
  ): Promise<UserPreferenceUpdateResult<UserAgentPreference> | null> {
    const [updated] = await this.database
      .update(users)
      .set({
        agentEnabled: enabled,
        settingsRevision: sql`${users.settingsRevision} + 1`,
        updatedAt: new Date(now),
      })
      .where(and(eq(users.id, userId), eq(users.settingsRevision, expectedRevision)))
      .returning(agentSelection);
    if (updated) return { preference: mapAgentPreference(updated), updated: true };
    const [current] = await this.database.select(agentSelection).from(users).where(eq(users.id, userId)).limit(1);
    return current ? { preference: mapAgentPreference(current), updated: false } : null;
  }
}

const dateTimeSelection = {
  userId: users.id,
  timezone: users.timezone,
  weekStartsOn: users.weekStartsOn,
  revision: users.settingsRevision,
  updatedAt: users.updatedAt,
};

const agentSelection = {
  userId: users.id,
  agentEnabled: users.agentEnabled,
  revision: users.settingsRevision,
  updatedAt: users.updatedAt,
};

function mapDateTimePreference(row: {
  userId: string;
  timezone: string;
  weekStartsOn: number;
  revision: number;
  updatedAt: Date;
}): UserDateTimePreference {
  return { ...row, weekStartsOn: row.weekStartsOn as WeekStartsOn, updatedAt: row.updatedAt.toISOString() };
}

function mapAgentPreference(row: {
  userId: string;
  agentEnabled: boolean;
  revision: number;
  updatedAt: Date;
}): UserAgentPreference {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}
