import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { captureException, recordDuration, recordFailure } from "@time-friend/observability";

import { installErrorHandler, problem } from "./plugins/errors.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerExecutionRoutes } from "./routes/execution.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerTrajectoryFeedbackRoutes } from "./routes/trajectory-feedback.js";
import { registerTrajectoryRoutes } from "./routes/trajectory.js";
import { registerTelemetryRoutes } from "./routes/telemetry.js";
import { ApiDependencies } from "./types.js";

export interface CreateAppOptions {
  logger?: boolean;
  allowedOrigins?: readonly string[];
  exposeDocumentation?: boolean;
}

export async function createApp(dependencies: ApiDependencies, options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1_100_000,
    requestIdHeader: "x-request-id",
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("authenticatedUser", null);
  app.addHook("onResponse", async (request, reply) => {
    recordDuration("http.server", reply.elapsedTime, { method: request.method, route: request.routeOptions.url, status: reply.statusCode });
  });
  app.addHook("onError", async (request, reply, error) => {
    recordFailure("http.request", { method: request.method, route: request.routeOptions.url, status: reply.statusCode });
    captureException(error, { service: "api", route: request.routeOptions.url });
  });

  await app.register(cookie, {
    hook: "onRequest",
  });
  await app.register(cors, {
    origin: options.allowedOrigins ? [...options.allowedOrigins] : false,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Time Friend API", version: "1.0.0" },
    },
    transform: jsonSchemaTransform,
  });
  if (options.exposeDocumentation) {
    await app.register(swaggerUi, { routePrefix: "/documentation" });
  }

  if (dependencies.handleAuthRequest) {
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      async handler(request, reply) {
        const response = await dependencies.handleAuthRequest!(request);
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header("set-cookie", cookies);
        const body = response.body === null ? null : await response.text();
        return reply.send(body);
      },
    });
  }

  app.get("/health", async () => ({ ok: true }));
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1")) return;
    if (["POST", "PATCH", "DELETE"].includes(request.method) && options.allowedOrigins) {
      const origin = request.headers.origin;
      if (!origin || !options.allowedOrigins.includes(origin)) {
        return reply.status(403).send(problem(request.id, 403, "ORIGIN_NOT_ALLOWED", "请求来源不受信任"));
      }
    }
    const user = await dependencies.resolveSession(request);
    if (!user) {
      return reply.status(401).send(problem(request.id, 401, "UNAUTHENTICATED", "请先登录"));
    }
    request.authenticatedUser = user;
  });

  installErrorHandler(app);
  registerAccountRoutes(app, dependencies);
  registerTaskRoutes(app, dependencies);
  registerExecutionRoutes(app, dependencies);
  registerSettingsRoutes(app, dependencies);
  registerTrajectoryRoutes(app, dependencies);
  registerTrajectoryFeedbackRoutes(app, dependencies);
  registerTelemetryRoutes(app, dependencies);
  await app.ready();
  return app;
}
