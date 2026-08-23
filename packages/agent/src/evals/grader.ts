import { containsProhibitedDiagnosis, validateGeneratedReview, type GeneratedReview } from "@time-friend/domain";

import { containsUnverifiedMetric } from "../openai-runner.js";
import { weeklyReviewOutputSchema } from "../schema.js";
import type { AgentEvaluationCase } from "./cases.js";

export interface AgentEvaluationResult {
  id: string;
  schemaValid: boolean;
  acceptedClaims: number;
  policySafe: boolean;
  uniqueEvidence: boolean;
  meetsBaseline: boolean;
}

export async function gradeAgentEvaluationCase(fixture: AgentEvaluationCase): Promise<AgentEvaluationResult> {
  const parsed = weeklyReviewOutputSchema.safeParse(fixture.candidate);
  if (!parsed.success) return result(fixture, false, 0, true, true);
  const evidenceIds = new Set(fixture.weeklyData.evidence.map((entry) => entry.id));
  const allRefs = parsed.data.claims.flatMap((claim) => claim.evidence);
  const uniqueEvidence = new Set(allRefs.map((entry) => `${entry.entityType}:${entry.entityId}:${entry.role}`)).size === allRefs.length;
  const texts = [
    ...parsed.data.claims.flatMap((claim) => [claim.statement, claim.rationale]),
    ...parsed.data.suggestedCommitments.flatMap((entry) => [entry.title, entry.reason]),
  ];
  const policySafe = texts.every((text) => !containsProhibitedDiagnosis(text) && !containsUnverifiedMetric(text));
  const validated = await validateGeneratedReview(parsed.data as GeneratedReview, async (review) => ({
    valid: review.claims.flatMap((claim) => claim.evidence).filter((entry) => evidenceIds.has(entry.entityId)),
    invalid: review.claims.flatMap((claim) => claim.evidence).filter((entry) => !evidenceIds.has(entry.entityId)).map((entry) => ({ ...entry, reason: "not_found" as const })),
  }));
  return result(fixture, true, validated.review.claims.length, policySafe, uniqueEvidence);
}

function result(fixture: AgentEvaluationCase, schemaValid: boolean, acceptedClaims: number, policySafe: boolean, uniqueEvidence: boolean): AgentEvaluationResult {
  const actual = { schemaValid, acceptedClaims, policySafe, uniqueEvidence };
  return { id: fixture.id, ...actual, meetsBaseline: Object.entries(fixture.baseline).every(([key, value]) => actual[key as keyof typeof actual] === value) };
}
