import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  acceptReviewClaimBodySchema,
  apiProblemSchema,
  commitmentCommandBodySchema,
  commitmentIdParamsSchema,
  commitmentSchema,
  confirmReviewBodySchema,
  confirmedMemorySchema,
  createCommitmentBodySchema,
  directionIdParamsSchema,
  directionPageSchema,
  directionSchema,
  directionsQuerySchema,
  editReviewClaimBodySchema,
  emptyResponseSchema,
  evidenceIdParamsSchema,
  excludeEvidenceBodySchema,
  idempotencyHeadersSchema,
  memoriesQuerySchema,
  memoryCommandBodySchema,
  memoryDeleteQuerySchema,
  memoryIdParamsSchema,
  memoryPageSchema,
  rejectReviewClaimBodySchema,
  reviewClaimIdParamsSchema,
  reviewIdParamsSchema,
  updateCommitmentBodySchema,
  updateDirectionBodySchema,
  updateMemoryBodySchema,
  weeklyReviewViewSchema,
} from "@time-friend/contracts";

import { toPublicWeeklyReview } from "../trajectory-mappers.js";
import type { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  409: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerTrajectoryFeedbackRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/api/v1/review-claims/:claimId/accept",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reviewClaimIdParamsSchema,
        body: acceptReviewClaimBodySchema,
        response: { 200: weeklyReviewViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /review-claims/:claimId/accept",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: toPublicWeeklyReview(
            await dependencies.trajectoryFeedback.decideClaim(user.id, request.params.claimId, {
              action: "accept",
              ...request.body,
            }),
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/review-claims/:claimId/edit",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reviewClaimIdParamsSchema,
        body: editReviewClaimBodySchema,
        response: { 200: weeklyReviewViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /review-claims/:claimId/edit",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: toPublicWeeklyReview(
            await dependencies.trajectoryFeedback.decideClaim(user.id, request.params.claimId, {
              action: "edit",
              ...request.body,
            }),
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/review-claims/:claimId/reject",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reviewClaimIdParamsSchema,
        body: rejectReviewClaimBodySchema,
        response: { 200: weeklyReviewViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /review-claims/:claimId/reject",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: toPublicWeeklyReview(
            await dependencies.trajectoryFeedback.decideClaim(user.id, request.params.claimId, { action: "reject" }),
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/reviews/:reviewId/confirm",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reviewIdParamsSchema,
        body: confirmReviewBodySchema,
        response: { 200: weeklyReviewViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /reviews/:reviewId/confirm",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: toPublicWeeklyReview(await dependencies.trajectoryFeedback.confirmReview(user.id, request.params.reviewId)),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/review-evidence/:evidenceId/exclude",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: evidenceIdParamsSchema,
        body: excludeEvidenceBodySchema,
        response: { 200: weeklyReviewViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /review-evidence/:evidenceId/exclude",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: toPublicWeeklyReview(
            await dependencies.trajectoryFeedback.excludeEvidence(user.id, request.params.evidenceId, request.body),
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.get(
    "/api/v1/memories",
    { schema: { querystring: memoriesQuerySchema, response: { 200: memoryPageSchema, ...errorResponses } } },
    async (request) => ({ items: await dependencies.trajectoryFeedback.listMemories(requireUser(request).id, request.query.status) }),
  );

  app.get(
    "/api/v1/directions",
    { schema: { querystring: directionsQuerySchema, response: { 200: directionPageSchema, ...errorResponses } } },
    async (request) => ({
      items: await dependencies.trajectoryFeedback.listDirections(requireUser(request).id, request.query.state),
    }),
  );

  app.patch(
    "/api/v1/directions/:directionId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: directionIdParamsSchema,
        body: updateDirectionBodySchema,
        response: { 200: directionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { expectedRevision, ...patch } = request.body;
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /directions/:directionId",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: await dependencies.trajectoryFeedback.updateDirection(
            user.id,
            request.params.directionId,
            patch,
            expectedRevision,
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/memories/:memoryId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: memoryIdParamsSchema,
        body: updateMemoryBodySchema,
        response: { 200: confirmedMemorySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /memories/:memoryId",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: await dependencies.trajectoryFeedback.reviseMemory(
            user.id,
            request.params.memoryId,
            request.body.value,
            request.body.expectedRevision,
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/memories/:memoryId/deactivate",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: memoryIdParamsSchema,
        body: memoryCommandBodySchema,
        response: { 200: confirmedMemorySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /memories/:memoryId/deactivate",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: await dependencies.trajectoryFeedback.deactivateMemory(
            user.id,
            request.params.memoryId,
            request.body.expectedRevision,
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.delete(
    "/api/v1/memories/:memoryId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: memoryIdParamsSchema,
        querystring: memoryDeleteQuerySchema,
        response: { 204: emptyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "DELETE /memories/:memoryId",
        { params: request.params, query: request.query },
        async () => {
          await dependencies.trajectoryFeedback.deleteMemory(
            user.id,
            request.params.memoryId,
            request.query.expectedRevision,
          );
          return { statusCode: 204, body: null };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/reviews/:reviewId/commitments",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: reviewIdParamsSchema,
        body: createCommitmentBodySchema,
        response: { 201: commitmentSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /reviews/:reviewId/commitments",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 201,
          body: await dependencies.trajectoryFeedback.createCommitment(user.id, request.params.reviewId, request.body),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    "/api/v1/commitments/:commitmentId/confirm",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: commitmentIdParamsSchema,
        body: commitmentCommandBodySchema,
        response: { 200: commitmentSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "POST /commitments/:commitmentId/confirm",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: await dependencies.trajectoryFeedback.confirmCommitment(
            user.id,
            request.params.commitmentId,
            request.body.expectedRevision,
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.patch(
    "/api/v1/commitments/:commitmentId",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        params: commitmentIdParamsSchema,
        body: updateCommitmentBodySchema,
        response: { 200: commitmentSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { expectedRevision, ...patch } = request.body;
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /commitments/:commitmentId",
        { params: request.params, body: request.body },
        async () => ({
          statusCode: 200,
          body: await dependencies.trajectoryFeedback.updateCommitment(
            user.id,
            request.params.commitmentId,
            patch,
            expectedRevision,
          ),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );

  for (const status of ["paused", "dropped"] as const) {
    const command = status === "paused" ? "pause" : "drop";
    app.post(
      `/api/v1/commitments/:commitmentId/${command}`,
      {
        schema: {
          headers: idempotencyHeadersSchema,
          params: commitmentIdParamsSchema,
          body: commitmentCommandBodySchema,
          response: { 200: commitmentSchema, ...errorResponses },
        },
      },
      async (request, reply) => {
        const user = requireUser(request);
        const result = await mutate(
          dependencies,
          request,
          user.id,
          `POST /commitments/:commitmentId/${command}`,
          { params: request.params, body: request.body },
          async () => ({
            statusCode: 200,
            body: await dependencies.trajectoryFeedback.setCommitmentStatus(
              user.id,
              request.params.commitmentId,
              status,
              request.body.expectedRevision,
            ),
          }),
        );
        return reply.status(result.statusCode).send(result.body);
      },
    );
  }
}
