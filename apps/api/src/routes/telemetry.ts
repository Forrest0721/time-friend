import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { emptyResponseSchema, idempotencyHeadersSchema, productEventBodySchema } from "@time-friend/contracts";
import { recordProductEvent } from "@time-friend/observability";

import type { ApiDependencies } from "../types.js";
import { mutate, requireUser } from "./helpers.js";

export function registerTelemetryRoutes(instance: FastifyInstance, dependencies: ApiDependencies): void {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.post(
    "/api/v1/telemetry/events",
    { schema: { headers: idempotencyHeadersSchema, body: productEventBodySchema, response: { 204: emptyResponseSchema } } },
    async (request, reply) => {
      const user = requireUser(request);
      const result = await mutate(dependencies, request, user.id, "POST /telemetry/events", request.body, async () => {
        recordProductEvent(request.body.name, { context: request.body.context, entityType: request.body.entityType ?? "none" });
        return { statusCode: 204, body: null };
      });
      return reply.status(204).send(result.body);
    },
  );
}
