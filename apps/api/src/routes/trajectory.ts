import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  agentRunIdParamsSchema,
  agentRunSchema,
  apiProblemSchema,
  generateTrajectoryReviewBodySchema,
  idempotencyHeadersSchema,
  periodIdParamsSchema,
  trajectoryWeekPageSchema,
  trajectoryWeekSchema,
  trajectoryWeeksQuerySchema,
} from "@time-friend/contracts";
import { DomainError, type AgentRunRecord } from "@time-friend/domain";

import { toPublicAgentRun, toPublicWeeklyReview } from "../trajectory-mappers.js";
import type { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerTrajectoryRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/v1/trajectory/weeks",
    { schema: { querystring: trajectoryWeeksQuerySchema, response: { 200: trajectoryWeekPageSchema, ...errorResponses } } },
    async (request) => {
      const user = requireUser(request);
      const items = await dependencies.trajectory.listWeeks(user.id, request.query);
      return {
        items,
        nextCursor: items.length === request.query.limit ? items.at(-1)!.period.startsAt : null,
      };
    },
  );

  app.get(
    "/api/v1/trajectory/weeks/:periodId",
    { schema: { params: periodIdParamsSchema, response: { 200: trajectoryWeekSchema, ...errorResponses } } },
    async (request) => {
      const user = requireUser(request);
      const [week, review] = await Promise.all([
        dependencies.trajectory.getWeek(user.id, request.params.periodId),
        dependencies.trajectoryReviews.getReviewForPeriod(user.id, request.params.periodId),
      ]);
      return {
        ...week,
        review: review ? toPublicWeeklyReview(review) : null,
      };
    },
  );

  app.post(
    "/api/v1/trajectory/weeks/:periodId/generate",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: periodIdParamsSchema,
        body: generateTrajectoryReviewBodySchema,
        response: { 200: agentRunSchema, 202: agentRunSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      if (!user.agentEnabled) throw new DomainError("AGENT_DISABLED", "Agent 分析已关闭");
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /trajectory/weeks/:periodId/generate",
        { params: request.params, body: request.body },
        async () => {
          const run = await dependencies.trajectoryReviews.requestGeneration(
            user.id,
            request.params.periodId,
            request.body.forceLowData,
          );
          return {
            statusCode: run.status === "waiting_for_data" || run.status === "succeeded" ? 200 : 202,
            body: toPublicAgentRun(run),
          };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/api/v1/agent-runs/:runId",
    { schema: { params: agentRunIdParamsSchema, response: { 200: agentRunSchema, ...errorResponses } } },
    async (request) => {
      const run = await dependencies.trajectoryReviews.getRun(requireUser(request).id, request.params.runId);
      if (!run) throw new DomainError("RESOURCE_NOT_FOUND", "Agent 运行不存在");
      return toPublicAgentRun(run);
    },
  );

  app.get(
    "/api/v1/agent-runs/:runId/events",
    { schema: { params: agentRunIdParamsSchema } },
    async (request, reply) => {
      const user = requireUser(request);
      const initial = await dependencies.trajectoryReviews.getRun(user.id, request.params.runId);
      if (!initial) throw new DomainError("RESOURCE_NOT_FOUND", "Agent 运行不存在");

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      writeRunEvent(reply.raw, initial);
      if (isTerminal(initial)) {
        reply.raw.end();
        return reply;
      }

      let closed = false;
      let lastUpdatedAt = initial.updatedAt;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearTimeout(deadline);
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      const poll = setInterval(() => {
        void dependencies.trajectoryReviews
          .getRun(user.id, request.params.runId)
          .then((run) => {
            if (!run) return close();
            if (run.updatedAt !== lastUpdatedAt) {
              lastUpdatedAt = run.updatedAt;
              writeRunEvent(reply.raw, run);
            }
            if (isTerminal(run)) close();
          })
          .catch(close);
      }, 1_000);
      const deadline = setTimeout(close, 10 * 60_000);
      request.raw.once("close", close);
      return reply;
    },
  );
}

function writeRunEvent(stream: NodeJS.WritableStream, run: AgentRunRecord): void {
  stream.write(`event: status\ndata: ${JSON.stringify(toPublicAgentRun(run))}\n\n`);
}

function isTerminal(run: AgentRunRecord): boolean {
  return run.status === "waiting_for_data" || run.status === "succeeded" || run.status === "failed";
}
