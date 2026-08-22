import { v7 as uuidv7 } from "uuid";

import { OpenAITrajectoryAgentRunner } from "@time-friend/agent";
import {
  createDatabaseClient,
  PostgresAccountPrivacyStore,
  PostgresExecutionStore,
  PostgresIdempotencyExecutor,
  PostgresTaskStore,
  PostgresTrajectoryReviewStore,
  PostgresTrajectoryStore,
  PostgresTransactionContext,
  PostgresUserPreferenceStore,
} from "@time-friend/db";
import {
  AccountPrivacyService,
  ExecutionService,
  systemClock,
  TaskService,
  TrajectoryFeedbackService,
  TrajectoryReviewService,
  TrajectoryService,
  UserPreferenceService,
} from "@time-friend/domain";
import {
  createTimeFriendBoss,
  PgBossExecutionJobScheduler,
  PgBossAccountDeletionJobScheduler,
  PgBossTrajectoryReviewJobScheduler,
  startTimeFriendBoss,
} from "@time-friend/queue";

import { createApp } from "./app.js";
import { createTimeFriendAuth, handleAuthRequest, resolveAuthenticatedUser } from "./auth.js";

const configuration = loadConfiguration();
const database = createDatabaseClient(configuration.databaseURL);
const boss = createTimeFriendBoss(configuration.databaseURL);
await startTimeFriendBoss(boss);
const transactions = new PostgresTransactionContext();
const tasks = new TaskService({
  store: new PostgresTaskStore(database.db, transactions),
  clock: systemClock,
  ids: { next: uuidv7 },
});
const execution = new ExecutionService({
  store: new PostgresExecutionStore(database.db, transactions, new PgBossExecutionJobScheduler(boss)),
  clock: systemClock,
  ids: { next: uuidv7 },
});
const trajectory = new TrajectoryService({
  store: new PostgresTrajectoryStore(database.db),
  clock: systemClock,
  ids: { next: uuidv7 },
});
const trajectoryReviewStore = new PostgresTrajectoryReviewStore(
  database.db,
  transactions,
  new PgBossTrajectoryReviewJobScheduler(boss),
);
const trajectoryReviews = new TrajectoryReviewService({
  snapshots: trajectory,
  store: trajectoryReviewStore,
  runner: new OpenAITrajectoryAgentRunner({ model: configuration.trajectoryModel }),
  clock: systemClock,
  ids: { next: uuidv7 },
  model: configuration.trajectoryModel,
});
const trajectoryFeedback = new TrajectoryFeedbackService({
  store: trajectoryReviewStore,
  periods: trajectory,
  clock: systemClock,
  ids: { next: uuidv7 },
});
const preferences = new UserPreferenceService({
  store: new PostgresUserPreferenceStore(database.db),
  clock: systemClock,
});
const privacy = new AccountPrivacyService({
  store: new PostgresAccountPrivacyStore(database.db, transactions, new PgBossAccountDeletionJobScheduler(boss)),
  clock: systemClock,
  ids: { next: uuidv7 },
});
const auth = createTimeFriendAuth(database.db, {
  baseURL: configuration.authURL,
  secret: configuration.authSecret,
  trustedOrigins: configuration.allowedOrigins,
  secureCookies: configuration.authURL.startsWith("https://"),
  onUserCreated: async (userId) => {
    await tasks.createTaskList(userId, { name: "收集箱", isInbox: true });
  },
});
const app = await createApp(
  {
    tasks,
    execution,
    trajectory,
    trajectoryReviews,
    trajectoryFeedback,
    preferences,
    privacy,
    idempotency: new PostgresIdempotencyExecutor(database.db, transactions),
    resolveSession: (request) => resolveAuthenticatedUser(auth, request),
    handleAuthRequest: (request) => handleAuthRequest(auth, request),
  },
  {
    logger: true,
    allowedOrigins: configuration.allowedOrigins,
    exposeDocumentation: configuration.nodeEnv !== "production",
  },
);

await app.listen({ port: configuration.port, host: configuration.host });

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await database.close();
}

process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());

function loadConfiguration() {
  const databaseURL = requiredEnvironment("DATABASE_URL");
  const authSecret = requiredEnvironment("BETTER_AUTH_SECRET");
  if (authSecret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const authURL = requiredEnvironment("BETTER_AUTH_URL");
  const trajectoryModel = requiredEnvironment("TRAJECTORY_MODEL");
  const allowedOrigins = requiredEnvironment("WEB_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) throw new Error("WEB_ORIGINS must contain at least one origin");
  const port = Number(process.env.PORT ?? "4000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");
  return {
    databaseURL,
    authSecret,
    authURL,
    trajectoryModel,
    allowedOrigins,
    port,
    host: process.env.HOST ?? "0.0.0.0",
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
