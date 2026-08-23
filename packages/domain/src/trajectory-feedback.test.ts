import { describe, expect, it } from "vitest";

import type { AgentRunRecord, WeeklyReviewView } from "./trajectory-generation.js";
import { isDirectionTransitionAllowed, normalizeClaimCorrection, planReviewConfirmation } from "./trajectory-feedback.js";

describe("planReviewConfirmation", () => {
  it("requires every Agent claim to be explicitly handled", () => {
    expect(() => planReviewConfirmation(view("pending"), NOW, ids())).toThrow("请先处理全部 Agent 判断");
  });

  it("turns an accepted direction and opted-in candidate into versioned knowledge", () => {
    const result = planReviewConfirmation(view("accepted"), NOW, ids());

    expect(result.directions).toEqual([
      expect.objectContaining({ name: "让时间投入可解释", state: "active", revision: 1 }),
    ]);
    expect(result.contributionEdges).toEqual([
      expect.objectContaining({ sourceId: EVIDENCE_ID, relation: "direct", source: "user_confirmed" }),
    ]);
    expect(result.memories).toEqual([
      expect.objectContaining({ memoryType: "direction", value: { summary: "持续建设时间轨迹产品" }, status: "active" }),
    ]);
    expect(result.confirmedCandidateIds).toEqual([CANDIDATE_ID]);
  });

  it("rejects candidates attached to rejected claims without creating knowledge", () => {
    const result = planReviewConfirmation(view("rejected"), NOW, ids());

    expect(result.memories).toEqual([]);
    expect(result.directions).toEqual([]);
    expect(result.contributionEdges).toEqual([]);
    expect(result.rejectedCandidateIds).toEqual([CANDIDATE_ID]);
  });

  it("keeps user-excluded evidence auditable without turning it into a contribution edge", () => {
    const input = view("accepted");
    input.claims[0]!.evidence[0]!.excludedAt = NOW;
    input.claims[0]!.evidence[0]!.exclusionReason = "关联到错误方向";

    const result = planReviewConfirmation(input, NOW, ids());

    expect(result.directions).toHaveLength(1);
    expect(result.contributionEdges).toEqual([]);
  });
});

describe("direction lifecycle", () => {
  it("allows pausing and resuming but keeps ended directions terminal", () => {
    expect(isDirectionTransitionAllowed("active", "paused")).toBe(true);
    expect(isDirectionTransitionAllowed("paused", "active")).toBe(true);
    expect(isDirectionTransitionAllowed("active", "ended")).toBe(true);
    expect(isDirectionTransitionAllowed("ended", "active")).toBe(false);
    expect(isDirectionTransitionAllowed("replaced", "paused")).toBe(false);
  });
});

describe("structured claim corrections", () => {
  it("turns maintenance and exploration into explicit reusable classifications", () => {
    expect(normalizeClaimCorrection("maintenance", "例行周报", false)).toMatchObject({
      decision: { action: "edit", correctionKind: "maintenance", remember: true, memoryType: "classification", memoryValue: { classification: "maintenance" } },
    });
    expect(normalizeClaimCorrection("exploration", "", false)).toMatchObject({
      decision: { action: "edit", correctionKind: "exploration", remember: true, memoryType: "classification", memoryValue: { classification: "exploration" } },
    });
  });

  it("requires concrete detail for renamed directions, wrong associations and category exclusions", () => {
    expect(() => normalizeClaimCorrection("direction_name", "", true)).toThrow("请补充这次校正的具体内容");
    expect(normalizeClaimCorrection("direction_name", "见时产品验证", false)).toMatchObject({
      decision: { userRevision: "见时产品验证", memoryType: "direction", remember: true },
      futureEffect: expect.stringContaining("见时产品验证"),
    });
    expect(normalizeClaimCorrection("wrong", "", true)).toEqual({
      decision: { action: "reject", correctionKind: "wrong" },
      futureEffect: "本次判断会被否定，不形成方向或长期记忆。",
    });
  });
});

const USER_ID = "00000000-0000-7000-8000-000000000001";
const PERIOD_ID = "00000000-0000-7000-8000-000000000002";
const SNAPSHOT_ID = "00000000-0000-7000-8000-000000000003";
const RUN_ID = "00000000-0000-7000-8000-000000000004";
const REVIEW_ID = "00000000-0000-7000-8000-000000000005";
const CLAIM_ID = "00000000-0000-7000-8000-000000000006";
const EVIDENCE_ID = "00000000-0000-7000-8000-000000000007";
const CANDIDATE_ID = "00000000-0000-7000-8000-000000000008";
const NOW = "2026-08-22T08:00:00.000Z";

function view(status: "pending" | "accepted" | "rejected"): WeeklyReviewView {
  return {
    run: run(),
    review: {
      id: REVIEW_ID,
      userId: USER_ID,
      periodId: PERIOD_ID,
      snapshotId: SNAPSHOT_ID,
      agentRunId: RUN_ID,
      version: 1,
      status: status === "pending" ? "pending" : "partially_confirmed",
      limitations: [],
      createdAt: NOW,
      confirmedAt: null,
    },
    claims: [
      {
        id: CLAIM_ID,
        userId: USER_ID,
        reviewVersionId: REVIEW_ID,
        claimType: "direction",
        statement: "似乎在持续推进轨迹产品",
        rationale: "行动形成连续证据",
        confidence: "medium",
        status,
        userRevision: null,
        position: 0,
        proposedDirection: { name: "让时间投入可解释", relation: "direct" },
        evidence: [
          {
            id: "00000000-0000-7000-8000-000000000009",
            userId: USER_ID,
            claimId: CLAIM_ID,
            entityType: "task",
            entityId: EVIDENCE_ID,
            role: "supports",
            excerpt: null,
            excludedAt: null,
            exclusionReason: null,
          },
        ],
        memoryCandidate: {
          id: CANDIDATE_ID,
          userId: USER_ID,
          reviewClaimId: CLAIM_ID,
          memoryType: "direction",
          proposedValue: { summary: "持续建设时间轨迹产品" },
          status: "pending",
        },
      },
    ],
    commitments: [],
  };
}

function run(): AgentRunRecord {
  return {
    id: RUN_ID,
    userId: USER_ID,
    periodSnapshotId: SNAPSHOT_ID,
    workflowName: "trajectory.weekly-review.v1",
    workflowVersion: "1",
    provider: "openai",
    model: "test",
    promptVersion: "1",
    outputSchemaVersion: "1",
    inputHash: "a".repeat(64),
    forceLowData: false,
    status: "succeeded",
    rawOutput: null,
    sdkTraceId: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    attempts: 1,
    errorCode: null,
    errorDetailRedacted: null,
    startedAt: NOW,
    finishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ids() {
  let value = 100;
  return { next: () => `00000000-0000-7000-8000-${String(++value).padStart(12, "0")}` };
}
