import type { FastifyInstance } from "fastify";

import { DomainError } from "@time-friend/domain";

const domainStatus: Record<DomainError["code"], number> = {
  EMPTY_NAME: 400,
  EMPTY_TITLE: 400,
  INVALID_CONTENT: 400,
  CONTENT_TOO_LARGE: 413,
  INVALID_DATE: 400,
  INVALID_TIMEZONE: 400,
  INVALID_PERIOD: 400,
  INVALID_RELATION: 400,
  INVALID_ITEM_KIND: 400,
  INVALID_TASK_TRANSITION: 409,
  INVALID_FOCUS_TRANSITION: 409,
  ACTIVE_FOCUS_EXISTS: 409,
  AGENT_DISABLED: 400,
  INBOX_IMMUTABLE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  REVISION_CONFLICT: 409,
  RESOURCE_NOT_FOUND: 404,
  CROSS_USER_ACCESS: 404,
};

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      const status = domainStatus[error.code];
      reply.status(status).send({
        type: `https://time-friend.app/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
        title: error.message,
        status,
        code: error.code,
        requestId: request.id,
        ...(error.code === "REVISION_CONFLICT" && error.details ? { latest: error.details } : {}),
      });
      return;
    }

    const candidate = error as Error & { code?: string; validation?: unknown };
    const databaseCode = candidate.code;
    if (databaseCode === "23505") {
      reply.status(409).send(problem(request.id, 409, "CONFLICT", "资源已存在或发生并发冲突"));
      return;
    }
    if (databaseCode === "23503" || databaseCode === "23514") {
      reply.status(400).send(problem(request.id, 400, "INVALID_RELATION", "请求违反数据约束"));
      return;
    }
    if (candidate.validation) {
      reply.status(400).send(problem(request.id, 400, "VALIDATION_ERROR", "请求参数不合法"));
      return;
    }

    request.log.error({ err: { name: candidate.name, message: candidate.message, code: databaseCode } }, "request failed");
    reply.status(500).send(problem(request.id, 500, "INTERNAL_ERROR", "服务器错误"));
  });
}

export function problem(requestId: string, status: number, code: string, title: string) {
  return {
    type: `https://time-friend.app/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    requestId,
  };
}
