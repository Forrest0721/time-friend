import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { DomainError } from "@time-friend/domain";

import { TimeFriendDatabase } from "./client.js";
import { idempotencyRecords } from "./schema/index.js";
import { PostgresTransactionContext } from "./transaction-context.js";

export interface IdempotentOperationResult<T> {
  statusCode: number;
  body: T;
}

export class PostgresIdempotencyExecutor {
  constructor(
    private readonly database: TimeFriendDatabase,
    private readonly transactions: PostgresTransactionContext,
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
  ) {}

  execute<T>(input: {
    userId: string;
    routeKey: string;
    idempotencyKey: string;
    requestBody: unknown;
    operation: () => Promise<IdempotentOperationResult<T>>;
  }): Promise<IdempotentOperationResult<T>> {
    return this.transactions.run(this.database, async (transaction) => {
      const lockKey = `${input.userId}:${input.routeKey}:${input.idempotencyKey}`;
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const requestHash = hashRequest(input.requestBody);
      const [existing] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.userId, input.userId),
            eq(idempotencyRecords.routeKey, input.routeKey),
            eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同请求");
        }
        const envelope = existing.responseJson as { body: T };
        return { statusCode: existing.statusCode, body: envelope.body };
      }

      const result = await input.operation();
      await transaction.insert(idempotencyRecords).values({
        id: uuidv7(),
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        routeKey: input.routeKey,
        requestHash,
        statusCode: result.statusCode,
        responseJson: { body: result.body },
        expiresAt: new Date(Date.now() + this.ttlMs),
      });
      return result;
    });
  }
}

export function hashRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
