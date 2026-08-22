import type { FastifyRequest } from "fastify";

import { ApiDependencies, AuthenticatedUser, IdempotentResult } from "../types.js";

export function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authenticatedUser) throw new Error("authentication hook invariant violated");
  return request.authenticatedUser;
}

export function mutate<T>(
  dependencies: ApiDependencies,
  request: FastifyRequest & { headers: { "idempotency-key": string } },
  userId: string,
  routeKey: string,
  requestBody: unknown,
  operation: () => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  return dependencies.idempotency.execute({
    userId,
    routeKey,
    idempotencyKey: request.headers["idempotency-key"],
    requestBody,
    operation,
  });
}
