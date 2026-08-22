import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  apiProblemSchema,
  idempotencyHeadersSchema,
  updateAgentPreferenceBodySchema,
  userAgentPreferenceSchema,
} from "@time-friend/contracts";

import type { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

const errorResponses = {
  400: apiProblemSchema,
  401: apiProblemSchema,
  404: apiProblemSchema,
  500: apiProblemSchema,
};

export function registerSettingsRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.patch(
    "/api/v1/settings/agent",
    {
      schema: {
        headers: idempotencyHeadersSchema,
        body: updateAgentPreferenceBodySchema,
        response: { 200: userAgentPreferenceSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(
        dependencies,
        request,
        user.id,
        "PATCH /settings/agent",
        request.body,
        async () => ({
          statusCode: 200,
          body: await dependencies.preferences.setAgentEnabled(user.id, request.body.agentEnabled),
        }),
      );
      return reply.status(result.statusCode).send(result.body);
    },
  );
}
