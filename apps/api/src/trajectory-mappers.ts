import type { AgentRunRecord, WeeklyReviewView } from "@time-friend/domain";

export type PublicAgentRun = Omit<AgentRunRecord, "rawOutput" | "errorDetailRedacted">;

export function toPublicAgentRun(run: AgentRunRecord): PublicAgentRun {
  return {
    id: run.id,
    userId: run.userId,
    periodSnapshotId: run.periodSnapshotId,
    workflowName: run.workflowName,
    workflowVersion: run.workflowVersion,
    status: run.status,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    outputSchemaVersion: run.outputSchemaVersion,
    inputHash: run.inputHash,
    forceLowData: run.forceLowData,
    sdkTraceId: run.sdkTraceId,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    durationMs: run.durationMs,
    attempts: run.attempts,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  };
}

export function toPublicWeeklyReview(view: WeeklyReviewView): Omit<WeeklyReviewView, "run"> & { run: PublicAgentRun } {
  return { ...view, run: toPublicAgentRun(view.run) };
}
