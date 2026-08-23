import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  adjustFocusBoundariesBodySchema,
  adjustFocusBodySchema,
  apiProblemSchema,
  createFocusBodySchema,
  createManualProgressBodySchema,
  deferredFocusFeedbackBodySchema,
  deferredFocusFeedbackResultSchema,
  deleteFocusQuerySchema,
  deleteProgressQuerySchema,
  emptyResponseSchema,
  focusCommandBodySchema,
  focusFeedbackBodySchema,
  focusFeedbackResultSchema,
  focusSessionIdParamsSchema,
  focusSessionPageSchema,
  focusSessionSchema,
  focusSessionsQuerySchema,
  focusSessionViewSchema,
  idempotencyHeadersSchema,
  itemIdParamsSchema,
  paginationQuerySchema,
  progressEntrySchema,
  progressIdParamsSchema,
  progressPageSchema,
  retargetFocusBodySchema,
  taskExecutionSummarySchema,
  updateProgressBodySchema,
} from "@time-friend/contracts";
import { recordProductEvent } from "@time-friend/observability";

import { paginateByTimeDescending } from "../cursor.js";
import { toItemDto } from "../mappers.js";
import { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  409: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerExecutionRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/v1/focus-sessions/active",
    { schema: { response: { 200: focusSessionViewSchema.nullable(), ...errorResponses } } },
    async (request) => dependencies.execution.getActiveFocusSession(requireUser(request).id),
  );

  app.get(
    "/api/v1/focus-sessions",
    { schema: { querystring: focusSessionsQuerySchema, response: { 200: focusSessionPageSchema, ...errorResponses } } },
    async (request) => {
      const user = requireUser(request);
      const { cursor, limit, ...filters } = request.query;
      const records = await dependencies.execution.listFocusRecords({ userId: user.id, ...filters });
      return paginateByTimeDescending(records, (record) => record.session.startedAt, (record) => record.session.id, cursor, limit);
    },
  );

  app.post(
    "/api/v1/focus-sessions",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        body: createFocusBodySchema,
        response: { 201: focusSessionViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /focus-sessions", request.body, async () => {
        const body = await dependencies.execution.startFocus(user.id, request.body);
        await markFocusSnapshotsStale(dependencies, user.id, body.session);
        return { statusCode: 201, body };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  for (const command of ["pause", "resume", "finish", "cancel"] as const) {
    app.post(
      `/api/v1/focus-sessions/:sessionId/${command}`,
      {
        schema: {
          headers: idempotencyHeadersSchema,
          params: focusSessionIdParamsSchema,
          body: focusCommandBodySchema,
          response: { 200: focusSessionViewSchema, ...errorResponses },
        },
      },
      async (request, reply) => {
        const user = requireUser(request);
        const operation =
          command === "pause"
            ? dependencies.execution.pauseFocus
            : command === "resume"
              ? dependencies.execution.resumeFocus
              : command === "finish"
                ? dependencies.execution.finishFocus
                : dependencies.execution.cancelFocus;
        const result = await mutate(
          dependencies,
          request,
          user.id,
          `POST /focus-sessions/:sessionId/${command}`,
          { params: request.params, body: request.body },
          async () => {
            const body = await operation.call(dependencies.execution, user.id, request.params.sessionId, request.body.expectedRevision);
            await markFocusSnapshotsStale(dependencies, user.id, body.session);
            return { statusCode: 200, body };
          },
        );
        return reply.status(result.statusCode).send(result.body);
      },
    );
  }

  app.post(
    "/api/v1/focus-sessions/:sessionId/feedback",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        body: focusFeedbackBodySchema,
        response: { 200: focusFeedbackResultSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /focus-sessions/:sessionId/feedback",
        { params: request.params, body: request.body },
        async () => {
          const feedback = await dependencies.execution.submitFocusFeedback(user.id, request.params.sessionId, request.body);
          await Promise.all([
            markFocusSnapshotsStale(dependencies, user.id, feedback.session),
            feedback.progress
              ? markProgressSnapshotsStale(dependencies, user.id, feedback.progress)
              : Promise.resolve(),
            feedback.task
              ? dependencies.trajectory.markSnapshotsContainingEntity(user.id, "task", feedback.task.id)
              : Promise.resolve(0),
          ]);
          return { statusCode: 200, body: { ...feedback, task: feedback.task ? toItemDto(feedback.task) : null } };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/focus-sessions/:sessionId/progress",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        body: deferredFocusFeedbackBodySchema,
        response: { 201: deferredFocusFeedbackResultSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /focus-sessions/:sessionId/progress",
        { params: request.params, body: request.body },
        async () => {
          const feedback = await dependencies.execution.addDeferredFocusFeedback(user.id, request.params.sessionId, request.body);
          await Promise.all([
            markFocusSnapshotsStale(dependencies, user.id, feedback.session),
            markProgressSnapshotsStale(dependencies, user.id, feedback.progress),
            feedback.task
              ? dependencies.trajectory.markSnapshotsContainingEntity(user.id, "task", feedback.task.id)
              : Promise.resolve(0),
          ]);
          return { statusCode: 201, body: { ...feedback, task: feedback.task ? toItemDto(feedback.task) : null } };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/focus-sessions/:sessionId/effective-time",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        body: adjustFocusBodySchema,
        response: { 200: focusSessionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /focus-sessions/:sessionId/effective-time",
        { params: request.params, body: request.body },
        async () => {
          const body = await dependencies.execution.adjustFocusDuration(user.id, request.params.sessionId, request.body);
          recordProductEvent("focus_adjusted", { kind: "duration" });
          await markFocusSnapshotsStale(dependencies, user.id, body);
          return { statusCode: 200, body };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/focus-sessions/:sessionId/boundaries",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        body: adjustFocusBoundariesBodySchema,
        response: { 200: focusSessionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /focus-sessions/:sessionId/boundaries",
        { params: request.params, body: request.body },
        async () => {
          const body = await dependencies.execution.adjustFocusBoundaries(user.id, request.params.sessionId, request.body);
          recordProductEvent("focus_adjusted", { kind: "boundaries" });
          await markFocusSnapshotsStale(dependencies, user.id, body);
          return { statusCode: 200, body };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/focus-sessions/:sessionId/task",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        body: retargetFocusBodySchema,
        response: { 200: focusSessionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /focus-sessions/:sessionId/task",
        { params: request.params, body: request.body },
        async () => {
          const body = await dependencies.execution.retargetFocus(user.id, request.params.sessionId, request.body);
          await markFocusSnapshotsStale(dependencies, user.id, body);
          return { statusCode: 200, body };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.delete(
    "/api/v1/focus-sessions/:sessionId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: focusSessionIdParamsSchema,
        querystring: deleteFocusQuerySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "DELETE /focus-sessions/:sessionId",
        { params: request.params, query: request.query },
        async () => {
          const session = await dependencies.execution.deleteFocus(user.id, request.params.sessionId, request.query.expectedRevision);
          await markFocusSnapshotsStale(dependencies, user.id, session);
          return { statusCode: 204, body: null };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/api/v1/tasks/:itemId/progress",
    {
      schema: {
        params: itemIdParamsSchema,
        querystring: paginationQuerySchema,
        response: { 200: progressPageSchema, ...errorResponses },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const progress = await dependencies.execution.listProgressEntries({ userId: user.id, taskId: request.params.itemId });
      return paginateByTimeDescending(progress, (entry) => entry.occurredAt, (entry) => entry.id, request.query.cursor, request.query.limit);
    },
  );

  app.get(
    "/api/v1/tasks/:itemId/execution-summary",
    {
      schema: {
        params: itemIdParamsSchema,
        response: { 200: taskExecutionSummarySchema, ...errorResponses },
      },
    },
    async (request) => dependencies.execution.getTaskExecutionSummary(requireUser(request).id, request.params.itemId),
  );

  app.post(
    "/api/v1/tasks/:itemId/progress",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: itemIdParamsSchema,
        body: createManualProgressBodySchema,
        response: { 201: progressEntrySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /tasks/:itemId/progress",
        { params: request.params, body: request.body },
        async () => {
          const body = await dependencies.execution.createManualProgress(user.id, request.params.itemId, request.body);
          await markProgressSnapshotsStale(dependencies, user.id, body);
          return { statusCode: 201, body };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/progress/:progressId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: progressIdParamsSchema,
        body: updateProgressBodySchema,
        response: { 200: progressEntrySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /progress/:progressId",
        { params: request.params, body: request.body },
        async () => {
          const body = await dependencies.execution.updateProgress(user.id, request.params.progressId, request.body);
          await markProgressSnapshotsStale(dependencies, user.id, body);
          return { statusCode: 200, body };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.delete(
    "/api/v1/progress/:progressId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: progressIdParamsSchema,
        querystring: deleteProgressQuerySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "DELETE /progress/:progressId",
        { params: request.params, query: request.query },
        async () => {
          const progress = await dependencies.execution.deleteProgress(user.id, request.params.progressId, request.query.expectedRevision);
          await markProgressSnapshotsStale(dependencies, user.id, progress);
          return { statusCode: 204, body: null };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );
}

async function markFocusSnapshotsStale(
  dependencies: ApiDependencies,
  userId: string,
  session: { id: string; startedAt: string; endedAt: string | null },
): Promise<void> {
  await Promise.all([
    dependencies.trajectory.markSnapshotsContainingEntity(userId, "focus_session", session.id),
    dependencies.trajectory.markSnapshotsStale(userId, session.startedAt),
    session.endedAt ? dependencies.trajectory.markSnapshotsStale(userId, session.endedAt) : Promise.resolve(0),
  ]);
}

async function markProgressSnapshotsStale(
  dependencies: ApiDependencies,
  userId: string,
  progress: { id: string; occurredAt: string },
): Promise<void> {
  await Promise.all([
    dependencies.trajectory.markSnapshotsContainingEntity(userId, "progress_entry", progress.id),
    dependencies.trajectory.markSnapshotsStale(userId, progress.occurredAt),
  ]);
}
