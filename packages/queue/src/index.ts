import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import { z } from "zod";

import type { AccountDeletionJobScheduler, ExecutionJobScheduler, TimeFriendTransaction, TrajectoryReviewJobScheduler } from "@time-friend/db";
import type { AccountPrivacyService, ExecutionService, FocusDeadlineJob, TrajectoryReviewService, WeeklyReviewSchedulerService } from "@time-friend/domain";
import { captureException, recordDuration, recordFailure, withSpan } from "@time-friend/observability";

export const POMODORO_EXPIRE_QUEUE = "pomodoro.expire";
export const STOPWATCH_CAP_QUEUE = "focus.cap-stopwatch";
export const TRAJECTORY_GENERATE_REVIEW_QUEUE = "trajectory.generate-review";
export const TRAJECTORY_SCHEDULE_WEEKS_QUEUE = "trajectory.schedule-weeks";
export const ACCOUNT_DELETE_QUEUE = "account.delete";

const focusDeadlineDataSchema = z.strictObject({
  userId: z.uuid(),
  sessionId: z.uuid(),
  expectedRevision: z.int().positive(),
});

const trajectoryReviewDataSchema = z.strictObject({
  runId: z.uuid(),
});
const accountDeletionDataSchema = z.strictObject({ requestId: z.uuid() });

export function createTimeFriendBoss(connectionString: string, onError?: (error: Error) => void): PgBoss {
  const boss = new PgBoss({ connectionString, application_name: "time-friend-jobs" });
  boss.on("error", (error) => {
    onError?.(error);
    recordFailure("queue.runtime", { queue: "pg-boss", errorType: error.name });
    captureException(error, { service: "worker", component: "pg-boss" });
  });
  return boss;
}

export async function startTimeFriendBoss(boss: PgBoss): Promise<void> {
  await boss.start();
  await boss.createQueue(POMODORO_EXPIRE_QUEUE, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
  await boss.createQueue(STOPWATCH_CAP_QUEUE, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
  await boss.createQueue(TRAJECTORY_GENERATE_REVIEW_QUEUE, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    deleteAfterSeconds: 30 * 24 * 60 * 60,
  });
  await boss.createQueue(TRAJECTORY_SCHEDULE_WEEKS_QUEUE, {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
  await boss.createQueue(ACCOUNT_DELETE_QUEUE, {
    retryLimit: 10,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    deleteAfterSeconds: 30 * 24 * 60 * 60,
  });
}

export class PgBossExecutionJobScheduler implements ExecutionJobScheduler {
  constructor(private readonly boss: PgBoss) {}

  async schedule(transaction: TimeFriendTransaction, job: FocusDeadlineJob): Promise<void> {
    await this.boss.send(job.name, job.data, {
      startAfter: new Date(job.startAfter),
      singletonKey: job.singletonKey,
      singletonSeconds: 24 * 60 * 60,
      db: fromDrizzle(transaction, sql),
    });
  }
}

export class PgBossTrajectoryReviewJobScheduler implements TrajectoryReviewJobScheduler {
  constructor(private readonly boss: PgBoss) {}

  async schedule(transaction: TimeFriendTransaction, runId: string): Promise<void> {
    await this.boss.send(
      TRAJECTORY_GENERATE_REVIEW_QUEUE,
      { runId },
      {
        singletonKey: runId,
        singletonSeconds: 30 * 24 * 60 * 60,
        db: fromDrizzle(transaction, sql),
      },
    );
  }
}

export class PgBossAccountDeletionJobScheduler implements AccountDeletionJobScheduler {
  constructor(private readonly boss: PgBoss) {}

  async schedule(transaction: TimeFriendTransaction, requestId: string): Promise<void> {
    await this.boss.send(
      ACCOUNT_DELETE_QUEUE,
      { requestId },
      {
        singletonKey: requestId,
        singletonSeconds: 30 * 24 * 60 * 60,
        db: fromDrizzle(transaction, sql),
      },
    );
  }
}

export async function registerExecutionWorkers(boss: PgBoss, execution: ExecutionService): Promise<void> {
  await boss.work(POMODORO_EXPIRE_QUEUE, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      const data = focusDeadlineDataSchema.parse(job.data);
      await observeJob(POMODORO_EXPIRE_QUEUE, () => execution.expirePomodoro(data.userId, data.sessionId, data.expectedRevision));
    }
  });
  await boss.work(STOPWATCH_CAP_QUEUE, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      const data = focusDeadlineDataSchema.parse(job.data);
      await observeJob(STOPWATCH_CAP_QUEUE, () => execution.capStopwatch(data.userId, data.sessionId, data.expectedRevision));
    }
  });
}

export async function registerTrajectoryWorkers(
  boss: PgBoss,
  trajectoryReviews: TrajectoryReviewService,
  weeklyScheduler?: WeeklyReviewSchedulerService,
): Promise<void> {
  await boss.work(TRAJECTORY_GENERATE_REVIEW_QUEUE, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      const { runId } = trajectoryReviewDataSchema.parse(job.data);
      await observeJob(TRAJECTORY_GENERATE_REVIEW_QUEUE, () => trajectoryReviews.executeGeneration(runId));
    }
  });
  if (weeklyScheduler) {
    await boss.work(TRAJECTORY_SCHEDULE_WEEKS_QUEUE, { batchSize: 1 }, async () => {
      await observeJob(TRAJECTORY_SCHEDULE_WEEKS_QUEUE, () => weeklyScheduler.scheduleEndedWeeks());
    });
    await boss.schedule(TRAJECTORY_SCHEDULE_WEEKS_QUEUE, "*/15 * * * *", null, { tz: "UTC" });
  }
}

export async function registerPrivacyWorkers(boss: PgBoss, privacy: AccountPrivacyService): Promise<void> {
  await boss.work(ACCOUNT_DELETE_QUEUE, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      const { requestId } = accountDeletionDataSchema.parse(job.data);
      await observeJob(ACCOUNT_DELETE_QUEUE, () => privacy.executeDeletion(requestId));
    }
  });
}

async function observeJob<T>(queue: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await withSpan("queue.job", { queue }, work);
  } catch (error) {
    recordFailure("queue.job", { queue });
    captureException(error, { service: "worker", queue });
    throw error;
  } finally {
    recordDuration("queue.job", Date.now() - startedAt, { queue });
  }
}
