import { z } from "zod";

export const uuidSchema = z.uuid();
export const nonBlankTextSchema = z.string().trim().min(1).max(500);
export const positionKeySchema = z.string().min(1).max(256);
export const revisionSchema = z.int().positive();
export const dateOnlySchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const idParamsSchema = z.strictObject({ id: uuidSchema });
export const idempotencyHeadersSchema = z.looseObject({
  "idempotency-key": z.string().min(8).max(200),
});
export const paginationQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const emptyResponseSchema = z.null();

export const apiProblemSchema = z.strictObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  code: z.string().min(1),
  requestId: z.string().min(1),
  latest: z.record(z.string(), z.unknown()).optional(),
});

export type ApiProblem = z.infer<typeof apiProblemSchema>;
