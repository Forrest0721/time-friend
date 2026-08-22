import { z } from "zod";

export const reviewEvidenceRefSchema = z.strictObject({
  entityType: z.enum(["task", "focus_session", "progress_entry", "task_event", "memory"]),
  entityId: z.uuid(),
  role: z.enum(["supports", "contradicts", "context"]),
});

export const memoryCandidateValueSchema = z.strictObject({
  summary: z.string().trim().min(1).max(240),
  subjectEntityType: z.enum(["list", "task", "progress_entry"]).nullable(),
  subjectEntityId: z.uuid().nullable(),
  directionName: z.string().trim().min(1).max(80).nullable(),
  classification: z.enum(["direct", "support", "maintenance", "exploration", "unrelated"]).nullable(),
  rule: z.string().trim().min(1).max(300).nullable(),
});

export const weeklyReviewOutputSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  claims: z
    .array(
      z.strictObject({
        type: z.enum(["direction", "progress", "deviation", "blocker", "pattern"]),
        statement: z.string().trim().min(1).max(240),
        rationale: z.string().trim().min(1).max(500),
        confidence: z.enum(["low", "medium", "high"]),
        evidence: z.array(reviewEvidenceRefSchema).min(1).max(12),
        proposedDirection: z
          .strictObject({
            name: z.string().trim().min(1).max(80),
            relation: z.enum(["direct", "support", "maintenance", "exploration", "unrelated"]),
          })
          .nullable(),
        memoryCandidate: z
          .strictObject({
            type: z.enum(["direction", "mapping", "classification", "preference", "exclusion"]),
            value: memoryCandidateValueSchema,
          })
          .nullable(),
      }),
    )
    .max(5),
  suggestedCommitments: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(160),
        reason: z.string().trim().max(300),
        evidenceIds: z.array(z.uuid()).max(8),
      }),
    )
    .max(3),
  limitations: z.array(z.string().trim().min(1).max(200)).max(5),
});

export type WeeklyReviewOutput = z.infer<typeof weeklyReviewOutputSchema>;
