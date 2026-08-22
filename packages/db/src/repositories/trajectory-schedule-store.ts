import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type { AutoReviewUserStore } from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import { users } from "../schema/index.js";

export class PostgresAutoReviewUserStore implements AutoReviewUserStore {
  constructor(private readonly database: TimeFriendDatabase) {}

  async listEnabledUserIds(afterUserId: string | null, limit: number): Promise<string[]> {
    const condition = afterUserId
      ? and(eq(users.agentEnabled, true), isNull(users.frozenAt), gt(users.id, afterUserId))
      : and(eq(users.agentEnabled, true), isNull(users.frozenAt));
    const rows = await this.database
      .select({ id: users.id })
      .from(users)
      .where(condition)
      .orderBy(asc(users.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
