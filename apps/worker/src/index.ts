import { createServer } from "node:http";

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
if (!providerRuntime[trajectoryTarget.provider]) {
  logger.warn(
    { provider: trajectoryTarget.provider },
    "trajectory provider key is not configured; non-Agent jobs remain available",
  );
}
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

const healthPort = parseHealthPort(process.env.HEALTH_PORT ?? "4001");
const healthHost = process.env.HEALTH_HOST?.trim() || "127.0.0.1";
const healthServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(healthPort, healthHost, () => {
    healthServer.off("error", reject);
    resolve();
  });
});
logger.info({ host: healthHost, port: healthPort }, "worker health server started");

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => error ? reject(error) : resolve());
  });
  await boss.stop({ graceful: true, timeout: 30_000 });
  await providers.close();
  await database.close();
  logger.info("worker stopped");
}

process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());

function parseHealthPort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("HEALTH_PORT must be a valid TCP port");
  }
  return value;
}
