import type { Clock } from "./primitives.js";
import type { AgentRunRecord } from "./trajectory-generation.js";
import type { PeriodRecord } from "./trajectory-service.js";

export interface AutoReviewUserStore {
  listEnabledUserIds(afterUserId: string | null, limit: number): Promise<string[]>;
}

export interface WeeklyReviewScheduleResult {
  usersScanned: number;
  runsRequested: number;
}

export class WeeklyReviewSchedulerService {
  constructor(
    private readonly dependencies: {
      users: AutoReviewUserStore;
      periods: {
        ensureWeekContaining(userId: string, instant: Date | string): Promise<PeriodRecord>;
      };
      reviews: {
        requestGeneration(userId: string, periodId: string, forceLowData?: boolean): Promise<AgentRunRecord>;
      };
      clock: Clock;
      pageSize?: number;
    },
  ) {}

  async scheduleEndedWeeks(): Promise<WeeklyReviewScheduleResult> {
    const now = this.dependencies.clock.now();
    const pageSize = Math.min(Math.max(this.dependencies.pageSize ?? 200, 1), 1_000);
    let afterUserId: string | null = null;
    let usersScanned = 0;
    let runsRequested = 0;

    for (;;) {
      const userIds = await this.dependencies.users.listEnabledUserIds(afterUserId, pageSize);
      if (userIds.length === 0) break;
      for (const userId of userIds) {
        const current = await this.dependencies.periods.ensureWeekContaining(userId, now);
        const previousInstant = new Date(Date.parse(current.startsAt) - 1);
        const previous = await this.dependencies.periods.ensureWeekContaining(userId, previousInstant);
        await this.dependencies.reviews.requestGeneration(userId, previous.id, false);
        usersScanned += 1;
        runsRequested += 1;
      }
      afterUserId = userIds.at(-1)!;
      if (userIds.length < pageSize) break;
    }

    return { usersScanned, runsRequested };
  }
}
