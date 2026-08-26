import type { PeriodRecord, PeriodSnapshot } from "./trajectory-service.js";

export const TRAJECTORY_WORKFLOW_NAME = "trajectory.weekly-review.v1";
export const TRAJECTORY_WORKFLOW_VERSION = "1";
export const TRAJECTORY_PROMPT_VERSION = "1";
export const WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION = "1";

export type TrajectoryProvider = "openai" | "deepseek";
export type AgentTransport = "responses";

export interface AgentRunTarget {
  provider: TrajectoryProvider;
  model: string;
  transport: AgentTransport;
  configVersion: 1;
  configHash: string;
}

export type AgentExecutionErrorCode =
  | "AGENT_PROVIDER_AUTH_FAILED"
  | "AGENT_MODEL_NOT_FOUND"
  | "AGENT_PROVIDER_INCOMPATIBLE_REQUEST"
  | "AGENT_PROVIDER_NOT_CONFIGURED"
  | "AGENT_TIMEOUT"
  | "AGENT_INVALID_OUTPUT"
  | "AGENT_TARGET_MISMATCH"
  | "AGENT_PROVIDER_TEMPORARY";

export class AgentExecutionError extends Error {
  constructor(
    public readonly code: AgentExecutionErrorCode,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "AgentExecutionError";
  }
}

export type ReviewClaimType = "direction" | "progress" | "deviation" | "blocker" | "pattern";
export type ReviewConfidence = "low" | "medium" | "high";
export type EvidenceEntityType = "task" | "focus_session" | "progress_entry" | "task_event" | "memory";
export type EvidenceRole = "supports" | "contradicts" | "context";
export type ContributionRelation = "direct" | "support" | "maintenance" | "exploration" | "unrelated";
export type MemoryType = "direction" | "mapping" | "classification" | "preference" | "exclusion" | "direction_state";

export interface ReviewEvidenceRef {
  entityType: EvidenceEntityType;
  entityId: string;
  role: EvidenceRole;
}

export interface GeneratedReviewClaim {
  type: ReviewClaimType;
  statement: string;
  rationale: string;
  confidence: ReviewConfidence;
  evidence: ReviewEvidenceRef[];
  proposedDirection: { name: string; relation: ContributionRelation } | null;
  memoryCandidate: { type: Exclude<MemoryType, "direction_state">; value: Record<string, unknown> } | null;
}

export interface SuggestedCommitment {
  title: string;
  reason: string;
  evidenceIds: string[];
}

export interface GeneratedReview {
  schemaVersion: typeof WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION;
  claims: GeneratedReviewClaim[];
  suggestedCommitments: SuggestedCommitment[];
  limitations: string[];
}

export interface EvidenceSearchResult {
  entityType: EvidenceEntityType;
  entityId: string;
  title: string;
  excerpt: string | null;
  occurredAt: string;
  taskId: string | null;
  listId: string | null;
}

export interface ConfirmedMemoryView {
  id: string;
  memoryType: MemoryType;
  value: Record<string, unknown>;
  effectiveFrom: string;
  revision: number;
}

export interface PeriodComparison {
  currentSnapshotId: string;
  previousSnapshotId: string | null;
  focusSecondsDelta: number | null;
  sessionCountDelta: number | null;
  progressCountDelta: number | null;
}

export interface EvidenceValidationResult {
  valid: ReviewEvidenceRef[];
  invalid: Array<ReviewEvidenceRef & { reason: "not_found" | "out_of_scope" | "excluded" }>;
}

export interface TrajectoryAgentTools {
  getPeriodSnapshot(): Promise<{ period: PeriodRecord; snapshot: PeriodSnapshot }>;
  searchEvidence(input: { query: string; scope: EvidenceEntityType[]; limit: number }): Promise<EvidenceSearchResult[]>;
  getConfirmedMemories(): Promise<ConfirmedMemoryView[]>;
  comparePeriods(): Promise<PeriodComparison>;
  proposeContributionEdges(input: {
    evidenceIds: string[];
    direction: string;
    relation: ContributionRelation;
  }): Promise<{ candidateId: string; evidenceIds: string[]; direction: string; relation: ContributionRelation }>;
  validateReviewEvidence(review: GeneratedReview): Promise<EvidenceValidationResult>;
}

export interface GenerateWeeklyReviewInput {
  userId: string;
  period: PeriodRecord;
  snapshot: PeriodSnapshot;
  forceLowData: boolean;
  tools: TrajectoryAgentTools;
}

export interface GeneratedReviewResult {
  review: GeneratedReview;
  provider: TrajectoryProvider;
  model: string;
  sdkTraceId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  durationMs: number;
  toolCalls?: AgentToolCallAudit[];
  estimatedCostMicrousd?: number | null;
}

export interface AgentToolCallAudit {
  name: string;
  status: "succeeded" | "failed";
  durationMs: number;
  inputHash: string;
  outputHash: string | null;
  errorCode: string | null;
}

export interface AgentRunner {
  generateWeeklyReview(input: GenerateWeeklyReviewInput, target: AgentRunTarget): Promise<GeneratedReviewResult>;
}

export interface ValidatedGeneratedReview {
  review: GeneratedReview;
  removedClaims: Array<{ position: number; reason: "missing_evidence" | "invalid_evidence" | "prohibited_diagnosis" }>;
}

export async function validateGeneratedReview(
  review: GeneratedReview,
  validateEvidence: (review: GeneratedReview) => Promise<EvidenceValidationResult>,
): Promise<ValidatedGeneratedReview> {
  const evidenceValidation = await validateEvidence(review);
  const invalidKeys = new Set(evidenceValidation.invalid.map((entry) => `${entry.entityType}:${entry.entityId}`));
  const hasSecurityViolation = evidenceValidation.invalid.some((entry) => entry.reason === "out_of_scope" || entry.reason === "excluded");
  if (hasSecurityViolation) {
    throw new Error("TRAJECTORY_EVIDENCE_SCOPE_VIOLATION");
  }
  const removedClaims: ValidatedGeneratedReview["removedClaims"] = [];
  const claims = review.claims.filter((claim, position) => {
    if (claim.evidence.length === 0) {
      removedClaims.push({ position, reason: "missing_evidence" });
      return false;
    }
    if (claim.evidence.some((entry) => invalidKeys.has(`${entry.entityType}:${entry.entityId}`))) {
      removedClaims.push({ position, reason: "invalid_evidence" });
      return false;
    }
    if (containsProhibitedDiagnosis(`${claim.statement} ${claim.rationale}`)) {
      removedClaims.push({ position, reason: "prohibited_diagnosis" });
      return false;
    }
    return true;
  });
  const validEvidenceIds = new Set(evidenceValidation.valid.map((entry) => entry.entityId));
  return {
    review: {
      ...review,
      claims,
      suggestedCommitments: review.suggestedCommitments.filter((entry) => entry.evidenceIds.every((id) => validEvidenceIds.has(id))),
    },
    removedClaims,
  };
}

export function containsProhibitedDiagnosis(value: string): boolean {
  return /(确诊|诊断为|患有.{0,8}(抑郁|焦虑|躁郁|adhd)|人格障碍|you (?:have|suffer from) (?:depression|anxiety|adhd|a personality disorder))/iu.test(value);
}
