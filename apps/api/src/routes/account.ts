import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  accountDataExportSchema,
  accountDeletionRequestSchema,
  apiProblemSchema,
  idempotencyHeadersSchema,
  requestAccountDeletionBodySchema,
} from "@time-friend/contracts";

import type { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerAccountRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/v1/account/export",
    { schema: { response: { 200: accountDataExportSchema, ...errorResponses } } },
    async (request) => dependencies.privacy.exportData(requireUser(request).id),
  );

  app.delete(
    "/api/v1/account",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        body: requestAccountDeletionBodySchema,
        response: { 202: accountDeletionRequestSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "DELETE /account",
        request.body,
        async () => {
          const deletion = await dependencies.privacy.requestDeletion(user.id);
          return {
            statusCode: 202,
            body: {
              id: deletion.id,
              status: deletion.status,
              requestedAt: deletion.requestedAt,
              completedAt: deletion.completedAt,
            },
          };
        },
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );
}
