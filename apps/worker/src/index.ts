import { v7 as uuidv7 } from "uuid";
import pino from "pino";

import { createTrajectoryProviderRegistry, TrajectoryAgentRunner } from "@time-friend/agent";
import {
  createDatabaseClient,
  PostgresAccountPrivacyStore,
  PostgresAutoReviewUserStore,
  PostgresExecutionStore,
  PostgresTrajectoryReviewStore,
  PostgresTrajectoryStore,
  PostgresTransactionContext,
} from "@time-friend/db";
import { AccountPrivacyService, ExecutionService, systemClock, TrajectoryReviewService, TrajectoryService, WeeklyReviewSchedulerService } from "@time-friend/domain";
import {
  createTimeFriendBoss,
  registerPrivacyWorkers,
  registerExecutionWorkers,
  registerTrajectoryWorkers,
  startTimeFriendBoss,
} from "@time-friend/queue";
import { recordFailure } from "@time-friend/observability";

import { loadWorkerConfiguration } from "./configuration.js";

const { databaseURL, trajectoryTarget, providerRuntime } = loadWorkerConfiguration(process.env);
const logger = pino({ name: "time-friend-worker" });
const providers = createTrajectoryProviderRegistry(providerRuntime);
providers.resolve(trajectoryTarget);
const trajectoryRunner = new TrajectoryAgentRunner({ providers, requestTimeoutMs: providerRuntime.requestTimeoutMs });
const database = createDatabaseClient(databaseURL);
const boss = createTimeFriendBoss(databaseURL, (error) => logger.error({ err: { name: error.name, message: error.message } }, "pg-boss runtime error"));
await startTimeFriendBoss(boss);
logger.info("worker queues started");
const transactions = new PostgresTransactionContext();

const execution = new ExecutionService({
  store: new PostgresExecutionStore(database.db, transactions),
  clock: systemClock,
  ids: { next: uuidv7 },
});
await registerExecutionWorkers(boss, execution);

const trajectory = new TrajectoryService({
  store: new PostgresTrajectoryStore(database.db),
  clock: systemClock,
  ids: { next: uuidv7 },
});
const trajectoryReviews = new TrajectoryReviewService({
  snapshots: trajectory,
  store: new PostgresTrajectoryReviewStore(database.db, transactions),
  clock: systemClock,
  ids: { next: uuidv7 },
  target: trajectoryTarget,
  onRunFailure: (event) => recordFailure("trajectory.review", event),
});
const weeklyScheduler = new WeeklyReviewSchedulerService({
  users: new PostgresAutoReviewUserStore(database.db),
  periods: trajectory,
  reviews: trajectoryReviews,
  clock: systemClock,
});
await registerTrajectoryWorkers(boss, trajectoryReviews, trajectoryRunner, weeklyScheduler);
const privacy = new AccountPrivacyService({
  store: new PostgresAccountPrivacyStore(database.db, transactions),
  clock: systemClock,
  ids: { next: uuidv7 },
});
await registerPrivacyWorkers(boss, privacy);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await boss.stop({ graceful: true, timeout: 30_000 });
  await providers.close();
  await database.close();
  logger.info("worker stopped");
}

process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
