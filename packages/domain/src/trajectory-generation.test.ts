import { describe, expect, it, vi } from "vitest";

import type { GeneratedReview, GeneratedReviewResult, TrajectoryAgentTools } from "./trajectory-review.js";
import { TrajectoryReviewService, type AgentRunRecord, type MaterializedReview, type TrajectoryReviewStore } from "./trajectory-generation.js";
import type { PeriodRecord, PeriodSnapshot } from "./trajectory-service.js";

describe("TrajectoryReviewService", () => {
  it("does not call or enqueue the model below the data threshold unless forced", async () => {
    const fixture = setup(false);
    const run = await fixture.service.requestGeneration(USER_ID, PERIOD_ID, false);
    expect(run.status).toBe("waiting_for_data");
    expect(fixture.store.scheduledRunIds).toEqual([]);
    expect(fixture.runner.generateWeeklyReview).not.toHaveBeenCalled();
  });

  it("persists model output before validation and reuses it on a validating retry", async () => {
    const fixture = setup(true);
    const run = await fixture.service.requestGeneration(USER_ID, PERIOD_ID, false);
    const first = await fixture.service.executeGeneration(run.id);
    expect(first?.review?.status).toBe("pending");
    expect(fixture.store.sequence).toEqual(["claim", "save-output", "persist-review"]);

    fixture.store.run = { ...fixture.store.run!, status: "validating", rawOutput: generatedResult.review };
    fixture.store.review = null;
    await fixture.service.executeGeneration(run.id);
    expect(fixture.runner.generateWeeklyReview).toHaveBeenCalledTimes(1);
  });

  it("fails generation when independent evidence validation removes every claim", async () => {
    const fixture = setup(true);
    fixture.store.tools.validateReviewEvidence = vi.fn(async () => ({
      valid: [],
      invalid: [{ ...generatedResult.review.claims[0]!.evidence[0]!, reason: "not_found" as const }],
    }));
    const run = await fixture.service.requestGeneration(USER_ID, PERIOD_ID, false);
    await expect(fixture.service.executeGeneration(run.id)).rejects.toThrow("NO_VALID_CLAIMS");
    expect(fixture.store.run).toMatchObject({ status: "failed", errorCode: "NO_VALID_CLAIMS" });
  });
});

const USER_ID = "00000000-0000-7000-8000-000000000001";
const PERIOD_ID = "00000000-0000-7000-8000-000000000002";
const SNAPSHOT_ID = "00000000-0000-7000-8000-000000000003";
const EVIDENCE_ID = "00000000-0000-7000-8000-000000000004";

const period: PeriodRecord = {
  id: PERIOD_ID,
  userId: USER_ID,
  kind: "week",
  timezone: "Asia/Shanghai",
  localStartDate: "2026-08-17",
  localEndDate: "2026-08-23",
  startsAt: "2026-08-16T16:00:00.000Z",
  endsAt: "2026-08-23T16:00:00.000Z",
  createdAt: "2026-08-16T16:00:00.000Z",
};

function snapshot(enough: boolean): PeriodSnapshot {
  return {
    id: SNAPSHOT_ID,
    userId: USER_ID,
    periodId: PERIOD_ID,
    version: 1,
    status: "current",
    sourceWatermark: "2026-08-22T08:00:00.000Z",
    inputHash: "a".repeat(64),
    schemaVersion: "1",
    metrics: {
      schemaVersion: "1",
      focus: { totalSeconds: 0, sessionCount: enough ? 3 : 0, pomodoroCount: 0, unlinkedSeconds: 0, byList: [] },
      progress: { completed: 0, progressed: 0, blocked: 0, maintenance: 0 },
      tasks: { completedIds: [], abandonedIds: [], plannedButUnfinishedIds: [] },
      dataQuality: { evidenceCount: enough ? 3 : 0, unlinkedFocusRatio: 0, hasEnoughData: enough },
    },
    entityIndex: { taskIds: [EVIDENCE_ID], focusSessionIds: [], progressEntryIds: [], taskEventIds: [] },
    createdAt: "2026-08-22T08:00:00.000Z",
  };
}

const generatedResult: GeneratedReviewResult = {
  review: {
    schemaVersion: "1",
    claims: [
      {
        type: "direction",
        statement: "似乎在推进产品验证",
        rationale: "行动形成连续证据",
        confidence: "medium",
        evidence: [{ entityType: "task", entityId: EVIDENCE_ID, role: "supports" }],
        proposedDirection: null,
        memoryCandidate: null,
      },
    ],
    suggestedCommitments: [],
    limitations: [],
  },
  provider: "openai",
  model: "test-model",
  sdkTraceId: "trace",
  usage: { inputTokens: 10, outputTokens: 20 },
  durationMs: 50,
};

function setup(enough: boolean) {
  const store = new MemoryReviewStore();
  const runner = { generateWeeklyReview: vi.fn(async () => generatedResult) };
  let id = 10;
  const service = new TrajectoryReviewService({
    snapshots: { generateSnapshot: vi.fn(async () => snapshot(enough)) },
    store,
    runner,
    clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
    ids: { next: () => `00000000-0000-7000-8000-${String(++id).padStart(12, "0")}` },
    model: "test-model",
  });
  return { service, store, runner };
}

class MemoryReviewStore implements TrajectoryReviewStore {
  run: AgentRunRecord | null = null;
  review: MaterializedReview | null = null;
  sequence: string[] = [];
  scheduledRunIds: string[] = [];
  tools: TrajectoryAgentTools = {
    getPeriodSnapshot: vi.fn(async () => ({ period, snapshot: snapshot(true) })),
    searchEvidence: vi.fn(async () => []),
    getConfirmedMemories: vi.fn(async () => []),
    comparePeriods: vi.fn(async () => ({ currentSnapshotId: SNAPSHOT_ID, previousSnapshotId: null, focusSecondsDelta: null, sessionCountDelta: null, progressCountDelta: null })),
    proposeContributionEdges: vi.fn(async (value) => ({ candidateId: "candidate", ...value })),
    validateReviewEvidence: vi.fn(async (review: GeneratedReview) => ({ valid: review.claims.flatMap((claim) => claim.evidence), invalid: [] })),
  };

  async requestRun(input: AgentRunRecord) {
    this.run ??= input;
    if (this.run.status === "queued" && !this.scheduledRunIds.includes(this.run.id)) this.scheduledRunIds.push(this.run.id);
    return this.run;
  }
  async getRun(userId: string, runId: string) {
    return this.run?.userId === userId && this.run.id === runId ? this.run : null;
  }
  async claimRun(runId: string, now: string) {
    if (!this.run || this.run.id !== runId || !["queued", "failed", "validating"].includes(this.run.status)) return null;
    this.sequence.push("claim");
    if (this.run.status !== "validating") this.run = { ...this.run, status: "running", attempts: this.run.attempts + 1, startedAt: now };
    return this.run;
  }
  async getRunContext() {
    return this.run ? { run: this.run, period, snapshot: snapshot(true) } : null;
  }
  createAgentTools() {
    return this.tools;
  }
  async saveAgentOutput(_runId: string, result: GeneratedReviewResult, now: string) {
    this.sequence.push("save-output");
    this.run = { ...this.run!, status: "validating", rawOutput: result.review, sdkTraceId: result.sdkTraceId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs: result.durationMs, updatedAt: now };
    return this.run;
  }
  async persistValidatedReview(_runId: string, materialized: MaterializedReview, now: string) {
    this.sequence.push("persist-review");
    this.review = materialized;
    this.run = { ...this.run!, status: "succeeded", finishedAt: now, updatedAt: now };
    return this.view();
  }
  async failRun(_runId: string, errorCode: string, errorDetailRedacted: string, now: string) {
    this.run = { ...this.run!, status: "failed", errorCode, errorDetailRedacted, updatedAt: now };
  }
  async getReviewForPeriod() {
    return this.review ? this.view() : null;
  }
  async listReviews() {
    return this.review ? [this.view()] : [];
  }
  private view() {
    return {
      run: this.run!,
      review: this.review!.review,
      claims: this.review!.claims.map((claim) => ({
        ...claim,
        evidence: this.review!.evidence.filter((entry) => entry.claimId === claim.id),
        memoryCandidate: this.review!.memoryCandidates.find((entry) => entry.reviewClaimId === claim.id) ?? null,
      })),
      commitments: this.review!.commitments,
    };
  }
}
