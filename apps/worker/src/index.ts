import { v7 as uuidv7 } from "uuid";

import { OpenAITrajectoryAgentRunner } from "@time-friend/agent";
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

import { loadWorkerConfiguration } from "./configuration.js";

const { databaseURL, trajectoryModel } = loadWorkerConfiguration(process.env);
const database = createDatabaseClient(databaseURL);
const boss = createTimeFriendBoss(databaseURL);
await startTimeFriendBoss(boss);
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
  runner: new OpenAITrajectoryAgentRunner({ model: trajectoryModel }),
  clock: systemClock,
  ids: { next: uuidv7 },
  model: trajectoryModel,
});
const weeklyScheduler = new WeeklyReviewSchedulerService({
  users: new PostgresAutoReviewUserStore(database.db),
  periods: trajectory,
  reviews: trajectoryReviews,
  clock: systemClock,
});
await registerTrajectoryWorkers(boss, trajectoryReviews, weeklyScheduler);
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
  await database.close();
}

process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
