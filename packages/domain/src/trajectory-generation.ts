import type { Clock, IdGenerator } from "./primitives.js";
import type { PeriodRecord, PeriodSnapshot, TrajectoryService } from "./trajectory-service.js";
import {
  TRAJECTORY_PROMPT_VERSION,
  TRAJECTORY_WORKFLOW_NAME,
  TRAJECTORY_WORKFLOW_VERSION,
  validateGeneratedReview,
  WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION,
  type AgentRunner,
  type GeneratedReview,
  type GeneratedReviewResult,
  type ReviewConfidence,
  type ReviewEvidenceRef,
  type ReviewClaimType,
  type TrajectoryAgentTools,
} from "./trajectory-review.js";

export type AgentRunStatus = "waiting_for_data" | "queued" | "running" | "validating" | "succeeded" | "failed";
export type ReviewStatus = "pending" | "partially_confirmed" | "confirmed" | "superseded";
export type ReviewClaimStatus = "pending" | "accepted" | "edited" | "rejected";

export interface AgentRunRecord {
  id: string;
  userId: string;
  periodSnapshotId: string;
  workflowName: typeof TRAJECTORY_WORKFLOW_NAME;
  workflowVersion: typeof TRAJECTORY_WORKFLOW_VERSION;
  provider: string;
  model: string;
  promptVersion: typeof TRAJECTORY_PROMPT_VERSION;
  outputSchemaVersion: typeof WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION;
  inputHash: string;
  forceLowData: boolean;
  status: AgentRunStatus;
  rawOutput: GeneratedReview | null;
  sdkTraceId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  toolCalls?: import("./trajectory-review.js").AgentToolCallAudit[];
  estimatedCostMicrousd?: number | null;
  attempts: number;
  errorCode: string | null;
  errorDetailRedacted: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewVersionRecord {
  id: string;
  userId: string;
  periodId: string;
  snapshotId: string;
  agentRunId: string;
  version: number;
  status: ReviewStatus;
  limitations: string[];
  createdAt: string;
  confirmedAt: string | null;
}

export interface ReviewClaimRecord {
  id: string;
  userId: string;
  reviewVersionId: string;
  claimType: ReviewClaimType;
  statement: string;
  rationale: string;
  confidence: ReviewConfidence;
  status: ReviewClaimStatus;
  userRevision: string | null;
  correctionKind?: import("./trajectory-feedback.js").ClaimCorrectionKind | null;
  position: number;
  proposedDirection: GeneratedReview["claims"][number]["proposedDirection"];
}

export interface EvidenceRefRecord extends ReviewEvidenceRef {
  id: string;
  userId: string;
  claimId: string;
  excerpt: string | null;
  excludedAt: string | null;
  exclusionReason: string | null;
  detail?: {
    title: string;
    occurredAt: string;
    taskId: string | null;
    listId: string | null;
    metrics: Record<string, unknown>;
  } | null;
}

export interface MemoryCandidateRecord {
  id: string;
  userId: string;
  reviewClaimId: string;
  memoryType: NonNullable<GeneratedReview["claims"][number]["memoryCandidate"]>["type"];
  proposedValue: Record<string, unknown>;
  status: "pending" | "confirmed" | "rejected" | "expired";
}

export interface CommitmentRecord {
  id: string;
  userId: string;
  sourceReviewId: string;
  targetPeriodId: string | null;
  title: string;
  reason: string;
  evidenceIds: string[];
  status: "proposed" | "confirmed" | "paused" | "dropped" | "completed";
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaterializedReview {
  review: ReviewVersionRecord;
  claims: ReviewClaimRecord[];
  evidence: EvidenceRefRecord[];
  memoryCandidates: MemoryCandidateRecord[];
  commitments: CommitmentRecord[];
}

export interface WeeklyReviewView {
  run: AgentRunRecord;
  review: ReviewVersionRecord | null;
  claims: Array<ReviewClaimRecord & { evidence: EvidenceRefRecord[]; memoryCandidate: MemoryCandidateRecord | null }>;
  commitments: CommitmentRecord[];
}

export interface TrajectoryReviewStore {
  requestRun(input: AgentRunRecord): Promise<AgentRunRecord>;
  getRun(userId: string, runId: string): Promise<AgentRunRecord | null>;
  claimRun(runId: string, now: string): Promise<AgentRunRecord | null>;
  getRunContext(runId: string): Promise<{ run: AgentRunRecord; period: PeriodRecord; snapshot: PeriodSnapshot } | null>;
  createAgentTools(userId: string, period: PeriodRecord, snapshot: PeriodSnapshot): TrajectoryAgentTools;
  saveAgentOutput(runId: string, result: GeneratedReviewResult, now: string): Promise<AgentRunRecord>;
  persistValidatedReview(runId: string, materialized: MaterializedReview, now: string): Promise<WeeklyReviewView>;
  failRun(runId: string, errorCode: string, errorDetailRedacted: string, now: string): Promise<void>;
  getReviewForPeriod(userId: string, periodId: string): Promise<WeeklyReviewView | null>;
  listReviews(userId: string, limit: number, beforeCreatedAt?: string): Promise<WeeklyReviewView[]>;
}

export interface ReviewGenerationScheduler {
  schedule(runId: string): Promise<void>;
}

export class TrajectoryReviewService {
  constructor(
    private readonly dependencies: {
      snapshots: Pick<TrajectoryService, "generateSnapshot">;
      store: TrajectoryReviewStore;
      runner: AgentRunner;
      clock: Clock;
      ids: IdGenerator;
      model: string;
    },
  ) {}

  async requestGeneration(userId: string, periodId: string, forceLowData = false): Promise<AgentRunRecord> {
    const snapshot = await this.dependencies.snapshots.generateSnapshot(userId, periodId);
    const now = this.dependencies.clock.now().toISOString();
    const status: AgentRunStatus = snapshot.metrics.dataQuality.hasEnoughData || forceLowData ? "queued" : "waiting_for_data";
    const requested = await this.dependencies.store.requestRun({
      id: this.dependencies.ids.next(),
      userId,
      periodSnapshotId: snapshot.id,
      workflowName: TRAJECTORY_WORKFLOW_NAME,
      workflowVersion: TRAJECTORY_WORKFLOW_VERSION,
      provider: "openai",
      model: this.dependencies.model,
      promptVersion: TRAJECTORY_PROMPT_VERSION,
      outputSchemaVersion: WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION,
      inputHash: snapshot.inputHash,
      forceLowData,
      status,
      rawOutput: null,
      sdkTraceId: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      attempts: 0,
      errorCode: null,
      errorDetailRedacted: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return requested;
  }

  async executeGeneration(runId: string): Promise<WeeklyReviewView | null> {
    const now = this.dependencies.clock.now().toISOString();
    const claimed = await this.dependencies.store.claimRun(runId, now);
    if (!claimed) return null;
    try {
      const context = await this.dependencies.store.getRunContext(runId);
      if (!context) throw new Error("RUN_CONTEXT_NOT_FOUND");
      let output = context.run.rawOutput;
      if (!output) {
        const generated = await this.dependencies.runner.generateWeeklyReview({
          userId: context.run.userId,
          period: context.period,
          snapshot: context.snapshot,
          forceLowData: context.run.forceLowData,
          tools: this.dependencies.store.createAgentTools(context.run.userId, context.period, context.snapshot),
        });
        const validating = await this.dependencies.store.saveAgentOutput(runId, generated, this.dependencies.clock.now().toISOString());
        output = validating.rawOutput;
      }
      if (!output) throw new Error("AGENT_EMPTY_OUTPUT");
      const tools = this.dependencies.store.createAgentTools(context.run.userId, context.period, context.snapshot);
      const validated = await validateGeneratedReview(output, (review) => tools.validateReviewEvidence(review));
      if (validated.review.claims.length === 0 && !(context.run.forceLowData && validated.review.limitations.length > 0)) {
        throw new Error("NO_VALID_CLAIMS");
      }
      const materialized = materializeReview(
        context.run,
        context.period,
        validated.review,
        await this.nextReviewVersion(context.run.userId, context.period.id),
        this.dependencies.clock.now().toISOString(),
        this.dependencies.ids,
      );
      return await this.dependencies.store.persistValidatedReview(runId, materialized, this.dependencies.clock.now().toISOString());
    } catch (error) {
      await this.dependencies.store.failRun(runId, errorCode(error), redactError(error), this.dependencies.clock.now().toISOString());
      throw error;
    }
  }

  getRun(userId: string, runId: string): Promise<AgentRunRecord | null> {
    return this.dependencies.store.getRun(userId, runId);
  }

  getReviewForPeriod(userId: string, periodId: string): Promise<WeeklyReviewView | null> {
    return this.dependencies.store.getReviewForPeriod(userId, periodId);
  }

  listReviews(userId: string, limit = 20, beforeCreatedAt?: string): Promise<WeeklyReviewView[]> {
    return this.dependencies.store.listReviews(userId, Math.min(Math.max(limit, 1), 50), beforeCreatedAt);
  }

  private async nextReviewVersion(userId: string, periodId: string): Promise<number> {
    const current = await this.dependencies.store.getReviewForPeriod(userId, periodId);
    return (current?.review?.version ?? 0) + 1;
  }
}

export function materializeReview(
  run: AgentRunRecord,
  period: PeriodRecord,
  generated: GeneratedReview,
  version: number,
  now: string,
  ids: IdGenerator,
): MaterializedReview {
  const reviewId = ids.next();
  const claims: ReviewClaimRecord[] = [];
  const evidence: EvidenceRefRecord[] = [];
  const memoryCandidates: MemoryCandidateRecord[] = [];
  for (const [position, claim] of generated.claims.entries()) {
    const claimId = ids.next();
    claims.push({
      id: claimId,
      userId: run.userId,
      reviewVersionId: reviewId,
      claimType: claim.type,
      statement: claim.statement,
      rationale: claim.rationale,
      confidence: claim.confidence,
      status: "pending",
      userRevision: null,
      correctionKind: null,
      position,
      proposedDirection: claim.proposedDirection,
    });
    for (const reference of claim.evidence) {
      evidence.push({
        id: ids.next(),
        userId: run.userId,
        claimId,
        ...reference,
        excerpt: null,
        excludedAt: null,
        exclusionReason: null,
        detail: null,
      });
    }
    if (claim.memoryCandidate) {
      memoryCandidates.push({
        id: ids.next(),
        userId: run.userId,
        reviewClaimId: claimId,
        memoryType: claim.memoryCandidate.type,
        proposedValue: claim.memoryCandidate.value,
        status: "pending",
      });
    }
  }
  return {
    review: {
      id: reviewId,
      userId: run.userId,
      periodId: period.id,
      snapshotId: run.periodSnapshotId,
      agentRunId: run.id,
      version,
      status: "pending",
      limitations: generated.limitations,
      createdAt: now,
      confirmedAt: null,
    },
    claims,
    evidence,
    memoryCandidates,
    commitments: generated.suggestedCommitments.map((commitment, position) => ({
      id: ids.next(),
      userId: run.userId,
      sourceReviewId: reviewId,
      targetPeriodId: null,
      title: commitment.title,
      reason: commitment.reason,
      evidenceIds: commitment.evidenceIds,
      status: "proposed",
      position,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "AGENT_GENERATION_FAILED";
}

function redactError(error: unknown): string {
  const value = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 1_000);
}
