import { and, eq } from "drizzle-orm";

import type { UserAgentPreference, UserPreferenceStore } from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import { users } from "../schema/index.js";

export class PostgresUserPreferenceStore implements UserPreferenceStore {
  constructor(private readonly database: TimeFriendDatabase) {}

  async setAgentEnabled(userId: string, enabled: boolean, now: string): Promise<UserAgentPreference | null> {
    const [updated] = await this.database
      .update(users)
      .set({ agentEnabled: enabled, updatedAt: new Date(now) })
      .where(and(eq(users.id, userId), eq(users.agentEnabled, !enabled)))
      .returning({ userId: users.id, agentEnabled: users.agentEnabled, updatedAt: users.updatedAt });
    if (updated) return { ...updated, updatedAt: updated.updatedAt.toISOString() };
    const [current] = await this.database
      .select({ userId: users.id, agentEnabled: users.agentEnabled, updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return current ? { ...current, updatedAt: current.updatedAt.toISOString() } : null;
  }
}
