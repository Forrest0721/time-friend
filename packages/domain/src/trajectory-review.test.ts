import { describe, expect, it } from "vitest";

import { validateGeneratedReview, type GeneratedReview } from "./trajectory-review.js";

const EVIDENCE_ID = "00000000-0000-7000-8000-000000000001";

describe("trajectory review validation", () => {
  it("removes unsupported claims and commitments after independent validation", async () => {
    const result = await validateGeneratedReview(reviewFixture(), async () => ({
      valid: [],
      invalid: [{ entityType: "task", entityId: EVIDENCE_ID, role: "supports", reason: "not_found" }],
    }));
    expect(result.review.claims).toEqual([]);
    expect(result.review.suggestedCommitments).toEqual([]);
    expect(result.removedClaims).toEqual([{ position: 0, reason: "invalid_evidence" }]);
  });

  it("fails the complete review when evidence crosses scope or an excluded list", async () => {
    await expect(
      validateGeneratedReview(reviewFixture(), async () => ({
        valid: [],
        invalid: [{ entityType: "task", entityId: EVIDENCE_ID, role: "supports", reason: "out_of_scope" }],
      })),
    ).rejects.toThrow("TRAJECTORY_EVIDENCE_SCOPE_VIOLATION");
  });

  it("blocks diagnostic claims without blocking ordinary uncertainty language", async () => {
    const review = reviewFixture();
    review.claims[0]!.statement = "你患有焦虑，需要治疗";
    const result = await validateGeneratedReview(review, async () => ({ valid: review.claims[0]!.evidence, invalid: [] }));
    expect(result.review.claims).toHaveLength(0);
    expect(result.removedClaims[0]?.reason).toBe("prohibited_diagnosis");
  });
});

function reviewFixture(): GeneratedReview {
  return {
    schemaVersion: "1",
    claims: [
      {
        type: "direction",
        statement: "你本周可能主要在推进产品验证",
        rationale: "相关任务有持续投入",
        confidence: "medium",
        evidence: [{ entityType: "task", entityId: EVIDENCE_ID, role: "supports" }],
        proposedDirection: null,
        memoryCandidate: null,
      },
    ],
    suggestedCommitments: [{ title: "继续验证", reason: "保持连续性", evidenceIds: [EVIDENCE_ID] }],
    limitations: [],
  };
}
