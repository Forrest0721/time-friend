import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

import {
  createDatabaseClient,
  DatabaseClient,
  PostgresAccountPrivacyStore,
  PostgresExecutionStore,
  PostgresIdempotencyExecutor,
  PostgresTaskStore,
  PostgresTrajectoryStore,
  PostgresTransactionContext,
  PostgresUserPreferenceStore,
  runMigrations,
} from "@time-friend/db";
import { AccountPrivacyService, ExecutionService, systemClock, TaskService, TrajectoryService, UserPreferenceService } from "@time-friend/domain";

import { createApp } from "./app.js";
import { createTimeFriendAuth, handleAuthRequest, resolveAuthenticatedUser } from "./auth.js";

describe("Better Auth integration", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await runMigrations(database.db, new URL("../../../packages/db/migrations", import.meta.url).pathname);
    const transactions = new PostgresTransactionContext();
    const tasks = new TaskService({
      store: new PostgresTaskStore(database.db, transactions),
      clock: systemClock,
      ids: { next: uuidv7 },
    });
    const execution = new ExecutionService({
      store: new PostgresExecutionStore(database.db, transactions),
      clock: systemClock,
      ids: { next: uuidv7 },
    });
    const trajectory = new TrajectoryService({
      store: new PostgresTrajectoryStore(database.db),
      clock: systemClock,
      ids: { next: uuidv7 },
    });
    const auth = createTimeFriendAuth(database.db, {
      baseURL: "http://localhost:4000",
      secret: "integration-test-secret-that-is-at-least-32-characters",
      trustedOrigins: ["http://localhost:3000"],
      secureCookies: false,
      onUserCreated: async (userId) => {
        await tasks.createTaskList(userId, { name: "收集箱", isInbox: true });
      },
    });
    app = await createApp(
      {
        tasks,
        execution,
        trajectory,
        trajectoryReviews: {
          requestGeneration: async () => {
            throw new Error("not used in auth integration test");
          },
          getRun: async () => null,
          getReviewForPeriod: async () => null,
          listReviews: async () => [],
        },
        trajectoryFeedback: {
          decideClaim: async () => {
            throw new Error("not used in auth integration test");
          },
          excludeEvidence: async () => {
            throw new Error("not used in auth integration test");
          },
          confirmReview: async () => {
            throw new Error("not used in auth integration test");
          },
          listMemories: async () => [],
          reviseMemory: async () => {
            throw new Error("not used in auth integration test");
          },
          deactivateMemory: async () => {
            throw new Error("not used in auth integration test");
          },
          deleteMemory: async () => undefined,
          listDirections: async () => [],
          updateDirection: async () => {
            throw new Error("not used in auth integration test");
          },
          createCommitment: async () => {
            throw new Error("not used in auth integration test");
          },
          confirmCommitment: async () => {
            throw new Error("not used in auth integration test");
          },
          updateCommitment: async () => {
            throw new Error("not used in auth integration test");
          },
          setCommitmentStatus: async () => {
            throw new Error("not used in auth integration test");
          },
        },
        preferences: new UserPreferenceService({
          store: new PostgresUserPreferenceStore(database.db),
          clock: systemClock,
        }),
        privacy: new AccountPrivacyService({
          store: new PostgresAccountPrivacyStore(database.db, transactions),
          clock: systemClock,
          ids: { next: uuidv7 },
        }),
        idempotency: new PostgresIdempotencyExecutor(database.db, transactions),
        resolveSession: (request) => resolveAuthenticatedUser(auth, request),
        handleAuthRequest: (request) => handleAuthRequest(auth, request),
      },
      { logger: false, allowedOrigins: ["http://localhost:3000"] },
    );
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
    await container?.stop();
  });

  it("creates a database session and default inbox during email sign-up", async () => {
    const signUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3000" },
      payload: { name: "新用户", email: "new-user@example.com", password: "password-1234" },
    });

    expect(signUp.statusCode).toBe(200);
    const setCookie = signUp.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookie = Array.isArray(setCookie) ? setCookie.map((value) => value.split(";")[0]).join("; ") : setCookie!.split(";")[0];
    const bootstrap = await app.inject({ method: "GET", url: "/api/v1/bootstrap", headers: { cookie } });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      user: { email: "new-user@example.com", timezone: "Asia/Shanghai", weekStartsOn: 1, agentEnabled: true },
      lists: [{ name: "收集箱", isInbox: true, folderId: null }],
    });
  });
});
