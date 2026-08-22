import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  apiProblemSchema,
  bootstrapSchema,
  createFolderBodySchema,
  createItemBodySchema,
  createTaskGroupBodySchema,
  createTaskListBodySchema,
  deleteItemQuerySchema,
  emptyResponseSchema,
  folderSchema,
  idempotencyHeadersSchema,
  idParamsSchema,
  itemIdParamsSchema,
  itemPageSchema,
  itemSchema,
  listIdParamsSchema,
  listItemsQuerySchema,
  moveItemBodySchema,
  paginationQuerySchema,
  reorderBodySchema,
  reorderItemsBodySchema,
  taskCommandBodySchema,
  taskEventPageSchema,
  taskGroupSchema,
  taskListSchema,
  updateFolderBodySchema,
  updateItemBodySchema,
  updateTaskGroupBodySchema,
  updateTaskListBodySchema,
} from "@time-friend/contracts";

import { paginateByPosition, paginateEvents } from "../cursor.js";
import { toDomainPriority, toItemDto } from "../mappers.js";
import { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  409: apiProblemSchema,
  413: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerTaskRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/v1/bootstrap",
    { schema: { response: { 200: bootstrapSchema, ...errorResponses } } },
    async (request) => {
      const authenticatedUser = requireUser(request);
      const [data, activeFocusSession, reviews] = await Promise.all([
        dependencies.tasks.getTaskData(authenticatedUser.id),
        dependencies.execution.getActiveFocusSession(authenticatedUser.id),
        dependencies.trajectoryReviews.listReviews(authenticatedUser.id, 50),
      ]);
      return {
        user: authenticatedUser,
        ...data,
        items: data.items.map(toItemDto),
        activeFocusSession,
        pendingReviews: reviews.filter(
          (entry) => entry.review?.status === "pending" || entry.review?.status === "partially_confirmed",
        ).length,
      };
    },
  );

  app.post(
    "/api/v1/folders",
    { schema: { headers: idempotencyHeadersSchema, body: createFolderBodySchema, response: { 201: folderSchema, ...errorResponses } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /folders", request.body, async () => ({
        statusCode: 201,
        body: await dependencies.tasks.createFolder(user.id, request.body),
      }));
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/folders/:id",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: idParamsSchema,
        body: updateFolderBodySchema,
        response: { 200: folderSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "PATCH /folders/:id", { params: request.params, body: request.body }, async () => ({
        statusCode: 200,
        body: await dependencies.tasks.updateFolder(user.id, request.params.id, request.body),
      }));
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/folders/reorder",
    { schema: { headers: idempotencyHeadersSchema, body: reorderBodySchema, response: { 204: emptyResponseSchema, ...errorResponses } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /folders/reorder", request.body, async () => {
        await dependencies.tasks.reorderFolders(user.id, request.body.ids);
        return { statusCode: 204, body: null };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/lists",
    { schema: { headers: idempotencyHeadersSchema, body: createTaskListBodySchema, response: { 201: taskListSchema, ...errorResponses } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /lists", request.body, async () => ({
        statusCode: 201,
        body: await dependencies.tasks.createTaskList(user.id, request.body),
      }));
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/lists/:id",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: idParamsSchema,
        body: updateTaskListBodySchema,
        response: { 200: taskListSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "PATCH /lists/:id", { params: request.params, body: request.body }, async () => {
        const body = await dependencies.tasks.updateTaskList(user.id, request.params.id, request.body);
        await dependencies.trajectory.markAllSnapshotsStale(user.id);
        return { statusCode: 200, body };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/lists/reorder",
    { schema: { headers: idempotencyHeadersSchema, body: reorderBodySchema, response: { 204: emptyResponseSchema, ...errorResponses } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /lists/reorder", request.body, async () => {
        await dependencies.tasks.reorderTaskLists(user.id, request.body.ids);
        return { statusCode: 204, body: null };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/lists/:listId/groups",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: listIdParamsSchema,
        body: createTaskGroupBodySchema,
        response: { 201: taskGroupSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /lists/:listId/groups", { params: request.params, body: request.body }, async () => ({
        statusCode: 201,
        body: await dependencies.tasks.createTaskGroup(user.id, { ...request.body, listId: request.params.listId }),
      }));
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/groups/:id",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: idParamsSchema,
        body: updateTaskGroupBodySchema,
        response: { 200: taskGroupSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "PATCH /groups/:id", { params: request.params, body: request.body }, async () => ({
        statusCode: 200,
        body: await dependencies.tasks.updateTaskGroup(user.id, request.params.id, request.body),
      }));
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/lists/:listId/groups/reorder",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: listIdParamsSchema,
        body: reorderBodySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /lists/:listId/groups/reorder", { params: request.params, body: request.body }, async () => {
        await dependencies.tasks.reorderTaskGroups(user.id, request.params.listId, request.body.ids);
        return { statusCode: 204, body: null };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/api/v1/items",
    { schema: { querystring: listItemsQuerySchema, response: { 200: itemPageSchema, ...errorResponses } } },
    async (request) => {
      const user = requireUser(request);
      const rows = await dependencies.tasks.listItems({
        userId: user.id,
        listId: request.query.listId,
        groupId: request.query.groupId === "ungrouped" ? null : request.query.groupId,
        parentTaskId: request.query.parentTaskId === "top-level" ? null : request.query.parentTaskId,
        status: request.query.status,
      });
      const page = paginateByPosition(rows, request.query.cursor, request.query.limit);
      return { items: page.items.map(toItemDto), nextCursor: page.nextCursor };
    },
  );

  app.get(
    "/api/v1/items/:itemId",
    { schema: { params: itemIdParamsSchema, response: { 200: itemSchema, ...errorResponses } } },
    async (request) => toItemDto(await dependencies.tasks.getItem(requireUser(request).id, request.params.itemId)),
  );

  app.post(
    "/api/v1/items",
    { schema: { headers: idempotencyHeadersSchema, body: createItemBodySchema, response: { 201: itemSchema, ...errorResponses } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /items", request.body, async () => {
        const item = await dependencies.tasks.createItem(user.id, {
            ...request.body,
            priority: toDomainPriority(request.body.priority),
          });
        await markItemSnapshotsStale(dependencies, user.id, item);
        return { statusCode: 201, body: toItemDto(item) };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/items/reorder",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        body: reorderItemsBodySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /items/reorder", request.body, async () => {
        const { ids, ...scope } = request.body;
        await dependencies.tasks.reorderItems(user.id, scope, ids);
        return { statusCode: 204, body: null };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/items/:itemId/move",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: itemIdParamsSchema,
        body: moveItemBodySchema,
        response: { 200: itemSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /items/:itemId/move",
        { params: request.params, body: request.body },
        async () => {
          const before = await dependencies.tasks.getItem(user.id, request.params.itemId);
          const item = await dependencies.tasks.updateItem(user.id, request.params.itemId, request.body);
          await markItemSnapshotsStale(dependencies, user.id, item, before.plannedOn);
          return { statusCode: 200, body: toItemDto(item) };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/items/:itemId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: itemIdParamsSchema,
        body: updateItemBodySchema,
        response: { 200: itemSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "PATCH /items/:itemId", { params: request.params, body: request.body }, async () => {
        const before = await dependencies.tasks.getItem(user.id, request.params.itemId);
        const item = await dependencies.tasks.updateItem(user.id, request.params.itemId, {
            ...request.body,
            priority: toDomainPriority(request.body.priority),
          });
        await markItemSnapshotsStale(dependencies, user.id, item, before.plannedOn);
        return { statusCode: 200, body: toItemDto(item) };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.delete(
    "/api/v1/items/:itemId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: itemIdParamsSchema,
        querystring: deleteItemQuerySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "DELETE /items/:itemId", { params: request.params, query: request.query }, async () => {
        const item = await dependencies.tasks.deleteItem(user.id, request.params.itemId, request.query.expectedRevision);
        await markItemSnapshotsStale(dependencies, user.id, item);
        return { statusCode: 204, body: null };
      });
      return reply.status(result.statusCode).send(result.body);
    },
  );

  for (const command of ["complete", "reopen", "abandon", "resume"] as const) {
    app.post(
      `/api/v1/tasks/:itemId/${command}`,
      {
        schema: {
          headers: idempotencyHeadersSchema,
          params: itemIdParamsSchema,
          body: taskCommandBodySchema,
          response: { 200: itemSchema, ...errorResponses },
        },
      },
      async (request, reply) => {
        const user = requireUser(request);
        const result = await mutate(dependencies, request, user.id, `POST /tasks/:itemId/${command}`, { params: request.params, body: request.body }, async () => {
          const item = await dependencies.tasks.transitionTask(user.id, request.params.itemId, command, request.body.expectedRevision);
          await markItemSnapshotsStale(dependencies, user.id, item);
          return { statusCode: 200, body: toItemDto(item) };
        });
        return reply.status(result.statusCode).send(result.body);
      },
    );
  }

  app.get(
    "/api/v1/tasks/:itemId/timeline",
    {
      schema: {
        params: itemIdParamsSchema,
        querystring: paginationQuerySchema,
        response: { 200: taskEventPageSchema, ...errorResponses },
      },
    },
    async (request) => {
      const events = await dependencies.tasks.listTaskEvents(requireUser(request).id, request.params.itemId);
      return paginateEvents(events, request.query.cursor, request.query.limit);
    },
  );
}

async function markItemSnapshotsStale(
  dependencies: ApiDependencies,
  userId: string,
  item: { id: string; updatedAt: string; plannedOn: string | null },
  previousPlannedOn?: string | null,
): Promise<void> {
  const localDates = new Set([item.plannedOn, previousPlannedOn].filter((value): value is string => value !== null && value !== undefined));
  await Promise.all([
    dependencies.trajectory.markSnapshotsContainingEntity(userId, "task", item.id),
    dependencies.trajectory.markSnapshotsStale(userId, item.updatedAt),
    ...[...localDates].map((date) => dependencies.trajectory.markSnapshotsStaleForLocalDate(userId, date)),
  ]);
}
