import { RunContext } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";

import type { AgentToolCallAudit, GeneratedReview, GenerateWeeklyReviewInput, TrajectoryAgentTools } from "@time-friend/domain";

import { containsUnverifiedMetric, createTrajectoryReviewAgent, estimateModelCostMicrousd, OpenAITrajectoryAgentRunner, type AgentRuntime } from "./openai-runner.js";
import { weeklyReviewOutputSchema } from "./schema.js";
import { createTrajectoryTools } from "./tools.js";

const PERIOD_ID = "00000000-0000-7000-8000-000000000001";
const SNAPSHOT_ID = "00000000-0000-7000-8000-000000000002";
const EVIDENCE_ID = "00000000-0000-7000-8000-000000000003";

describe("OpenAITrajectoryAgentRunner", () => {
  it("runs one structured agent with an eight-turn cap and redacted tracing boundary", async () => {
    const run = vi.fn<AgentRuntime["run"]>(async () => ({
      finalOutput: outputFixture(),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    const runner = new OpenAITrajectoryAgentRunner({
      model: "test-model",
      runtime: { run },
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145),
      traceId: () => "trace_test",
      pricing: { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10 },
    });
    const result = await runner.generateWeeklyReview(inputFixture());

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ name: "TrajectoryReviewAgent" }), expect.stringContaining(SNAPSHOT_ID), {
      maxTurns: 8,
    });
    expect(result).toMatchObject({ model: "test-model", provider: "openai", sdkTraceId: "trace_test", durationMs: 45, estimatedCostMicrousd: 213, toolCalls: [] });
  });

  it("exposes only bounded read-only tools and rejects a foreign snapshot id", async () => {
    const input = inputFixture();
    const audit: AgentToolCallAudit[] = [];
    const tools = createTrajectoryTools(input, audit, () => 100);
    expect(tools.map((entry) => entry.name)).toEqual([
      "get_period_snapshot",
      "search_evidence",
      "get_confirmed_memories",
      "compare_periods",
      "propose_contribution_edges",
      "validate_review_evidence",
    ]);
    const getSnapshot = tools[0]!;
    if (getSnapshot.type !== "function") throw new Error("expected function tool");
    await expect(
      getSnapshot.invoke(new RunContext(), JSON.stringify({ snapshotId: "00000000-0000-7000-8000-000000000099" })),
    ).rejects.toThrow("SNAPSHOT_OUT_OF_SCOPE");
    expect(input.tools.getPeriodSnapshot).not.toHaveBeenCalled();
    expect(audit).toEqual([expect.objectContaining({ name: "get_period_snapshot", status: "failed", durationMs: 0, errorCode: "SNAPSHOT_OUT_OF_SCOPE" })]);
  });

  it("enforces schema cardinality and output policy guardrails", async () => {
    const invalid = { ...outputFixture(), claims: Array.from({ length: 6 }, () => outputFixture().claims[0]) };
    expect(weeklyReviewOutputSchema.safeParse(invalid).success).toBe(false);
    expect(containsUnverifiedMetric("本周投入 4 小时")).toBe(true);
    expect(containsUnverifiedMetric("本周似乎保持了稳定投入")).toBe(false);

    const agent = createTrajectoryReviewAgent(inputFixture(), "test-model");
    const diagnostic = outputFixture();
    diagnostic.claims[0]!.statement = "你患有焦虑";
    const result = await agent.outputGuardrails[0]!.execute({
      agent,
      agentOutput: diagnostic,
      context: new RunContext(),
    });
    expect(result.tripwireTriggered).toBe(true);
  });

  it("estimates micro-dollar cost from configurable per-million token prices", () => {
    expect(estimateModelCostMicrousd(
      { inputTokens: 1_000, outputTokens: 200 },
      { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 },
    )).toBe(3_600);
    expect(estimateModelCostMicrousd({ inputTokens: 1_000, outputTokens: 200 })).toBeNull();
  });
});

function inputFixture(): GenerateWeeklyReviewInput {
  const tools: TrajectoryAgentTools = {
    getPeriodSnapshot: vi.fn(),
    searchEvidence: vi.fn(async () => []),
    getConfirmedMemories: vi.fn(async () => []),
    comparePeriods: vi.fn(async () => ({
      currentSnapshotId: SNAPSHOT_ID,
      previousSnapshotId: null,
      focusSecondsDelta: null,
      sessionCountDelta: null,
      progressCountDelta: null,
    })),
    proposeContributionEdges: vi.fn(async (value) => ({ candidateId: "candidate", ...value })),
    validateReviewEvidence: vi.fn(async (review: GeneratedReview) => ({ valid: review.claims.flatMap((claim) => claim.evidence), invalid: [] })),
  };
  const period = {
    id: PERIOD_ID,
    userId: "00000000-0000-7000-8000-000000000010",
    kind: "week" as const,
    timezone: "Asia/Shanghai",
    localStartDate: "2026-08-17",
    localEndDate: "2026-08-23",
    startsAt: "2026-08-16T16:00:00.000Z",
    endsAt: "2026-08-23T16:00:00.000Z",
    createdAt: "2026-08-16T16:00:00.000Z",
  };
  const metrics = {
    schemaVersion: "1" as const,
    focus: { totalSeconds: 0, sessionCount: 0, pomodoroCount: 0, unlinkedSeconds: 0, byList: [] },
    progress: { completed: 0, progressed: 0, blocked: 0, maintenance: 0 },
    tasks: { completedIds: [], abandonedIds: [], plannedButUnfinishedIds: [] },
    dataQuality: { evidenceCount: 0, unlinkedFocusRatio: 0, hasEnoughData: false },
  };
  return {
    userId: period.userId,
    period,
    snapshot: {
      id: SNAPSHOT_ID,
      userId: period.userId,
      periodId: period.id,
      version: 1,
      status: "current",
      sourceWatermark: "2026-08-22T08:00:00.000Z",
      inputHash: "a".repeat(64),
      schemaVersion: "1",
      metrics,
      entityIndex: { taskIds: [], focusSessionIds: [], progressEntryIds: [], taskEventIds: [] },
      createdAt: "2026-08-22T08:00:00.000Z",
    },
    forceLowData: false,
    tools,
  };
}

function outputFixture() {
  return {
    schemaVersion: "1" as const,
    claims: [
      {
        type: "direction" as const,
        statement: "本周似乎在推进产品验证",
        rationale: "相关行动形成连续证据",
        confidence: "medium" as const,
        evidence: [{ entityType: "task" as const, entityId: EVIDENCE_ID, role: "supports" as const }],
        proposedDirection: null,
        memoryCandidate: null,
      },
    ],
    suggestedCommitments: [{ title: "继续验证", reason: "保持连续投入", evidenceIds: [EVIDENCE_ID] }],
    limitations: [],
  };
}
