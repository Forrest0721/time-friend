import { DomainError } from "./errors.js";
import type { IdGenerator } from "./primitives.js";
import type {
  CommitmentRecord,
  MemoryCandidateRecord,
  ReviewClaimRecord,
  WeeklyReviewView,
} from "./trajectory-generation.js";
import type { ContributionRelation, EvidenceEntityType, MemoryType, ReviewConfidence } from "./trajectory-review.js";

export type ClaimDecision =
  | { action: "accept"; remember: boolean; memoryValue?: Record<string, unknown> }
  | { action: "edit"; userRevision: string; remember: boolean; memoryValue?: Record<string, unknown> }
  | { action: "reject" };

export interface ConfirmedMemoryRecord {
  id: string;
  userId: string;
  memoryType: MemoryType;
  value: Record<string, unknown>;
  sourceCandidateId: string | null;
  sourceReviewId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "active" | "superseded" | "deleted";
  revision: number;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectionRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  state: "candidate" | "active" | "paused" | "ended" | "replaced";
  createdFromReviewId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContributionEdgeRecord {
  id: string;
  userId: string;
  sourceType: EvidenceEntityType;
  sourceId: string;
  directionId: string;
  relation: ContributionRelation;
  confidence: ReviewConfidence;
  source: "agent_proposal" | "user_confirmed";
  validFrom: string;
  validTo: string | null;
  supersedesId: string | null;
  createdAt: string;
}

export interface ReviewConfirmationPlan {
  memories: ConfirmedMemoryRecord[];
  directions: DirectionRecord[];
  contributionEdges: ContributionEdgeRecord[];
  confirmedCandidateIds: string[];
  rejectedCandidateIds: string[];
}

export interface TrajectoryFeedbackStore {
  decideClaim(userId: string, claimId: string, decision: ClaimDecision): Promise<WeeklyReviewView>;
  excludeEvidence(
    userId: string,
    evidenceId: string,
    reason: string,
    remember: boolean,
    now: string,
    ids: IdGenerator,
  ): Promise<WeeklyReviewView>;
  confirmReview(userId: string, reviewId: string, now: string, ids: IdGenerator): Promise<WeeklyReviewView>;
  listMemories(userId: string, status: "active" | "all"): Promise<ConfirmedMemoryRecord[]>;
  reviseMemory(
    userId: string,
    memoryId: string,
    value: Record<string, unknown>,
    expectedRevision: number,
    now: string,
    ids: IdGenerator,
  ): Promise<ConfirmedMemoryRecord>;
  deactivateMemory(userId: string, memoryId: string, expectedRevision: number, now: string): Promise<ConfirmedMemoryRecord>;
  deleteMemory(userId: string, memoryId: string, expectedRevision: number, now: string): Promise<void>;
  listDirections(userId: string, state: "active" | "all"): Promise<DirectionRecord[]>;
  updateDirection(
    userId: string,
    directionId: string,
    patch: { name?: string; description?: string; state?: DirectionRecord["state"] },
    expectedRevision: number,
    now: string,
    ids: IdGenerator,
  ): Promise<DirectionRecord>;
  createCommitment(
    userId: string,
    reviewId: string,
    title: string,
    reason: string,
    targetPeriodId: string,
    now: string,
    ids: IdGenerator,
  ): Promise<CommitmentRecord>;
  updateCommitment(
    userId: string,
    commitmentId: string,
    patch: { title?: string; reason?: string; status?: CommitmentRecord["status"]; targetPeriodId?: string | null },
    expectedRevision: number,
    now: string,
  ): Promise<CommitmentRecord>;
  getCommitmentReviewPeriodEnd(userId: string, reviewId: string): Promise<string | null>;
  getCommitmentSourcePeriodEnd(userId: string, commitmentId: string): Promise<string | null>;
}

export class TrajectoryFeedbackService {
  constructor(
    private readonly dependencies: {
      store: TrajectoryFeedbackStore;
      periods: { ensureWeekContaining(userId: string, instant: Date | string): Promise<{ id: string }> };
      clock: { now(): Date };
      ids: IdGenerator;
    },
  ) {}

  decideClaim(userId: string, claimId: string, decision: ClaimDecision): Promise<WeeklyReviewView> {
    if (decision.action === "edit" && !decision.userRevision.trim()) {
      throw new DomainError("EMPTY_TITLE", "修正后的判断不能为空");
    }
    if (decision.action !== "reject" && decision.memoryValue && Object.keys(decision.memoryValue).length === 0) {
      throw new DomainError("INVALID_CONTENT", "记忆内容不能为空");
    }
    return this.dependencies.store.decideClaim(
      userId,
      claimId,
      decision.action === "edit" ? { ...decision, userRevision: decision.userRevision.trim() } : decision,
    );
  }

  excludeEvidence(userId: string, evidenceId: string, input: { reason: string; remember: boolean }): Promise<WeeklyReviewView> {
    const reason = input.reason.trim();
    if (!reason) throw new DomainError("INVALID_CONTENT", "请说明移除关联的原因");
    return this.dependencies.store.excludeEvidence(
      userId,
      evidenceId,
      reason,
      input.remember,
      this.dependencies.clock.now().toISOString(),
      this.dependencies.ids,
    );
  }

  confirmReview(userId: string, reviewId: string): Promise<WeeklyReviewView> {
    return this.dependencies.store.confirmReview(
      userId,
      reviewId,
      this.dependencies.clock.now().toISOString(),
      this.dependencies.ids,
    );
  }

  listMemories(userId: string, status: "active" | "all" = "active"): Promise<ConfirmedMemoryRecord[]> {
    return this.dependencies.store.listMemories(userId, status);
  }

  reviseMemory(
    userId: string,
    memoryId: string,
    value: Record<string, unknown>,
    expectedRevision: number,
  ): Promise<ConfirmedMemoryRecord> {
    if (Object.keys(value).length === 0) throw new DomainError("INVALID_CONTENT", "记忆内容不能为空");
    return this.dependencies.store.reviseMemory(
      userId,
      memoryId,
      value,
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
      this.dependencies.ids,
    );
  }

  deactivateMemory(userId: string, memoryId: string, expectedRevision: number): Promise<ConfirmedMemoryRecord> {
    return this.dependencies.store.deactivateMemory(
      userId,
      memoryId,
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
  }

  deleteMemory(userId: string, memoryId: string, expectedRevision: number): Promise<void> {
    return this.dependencies.store.deleteMemory(
      userId,
      memoryId,
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
  }

  listDirections(userId: string, state: "active" | "all" = "active"): Promise<DirectionRecord[]> {
    return this.dependencies.store.listDirections(userId, state);
  }

  updateDirection(
    userId: string,
    directionId: string,
    patch: { name?: string; description?: string; state?: DirectionRecord["state"] },
    expectedRevision: number,
  ): Promise<DirectionRecord> {
    const normalized = {
      ...patch,
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.description === undefined ? {} : { description: patch.description.trim() }),
    };
    if (normalized.name === "") throw new DomainError("EMPTY_TITLE", "方向名称不能为空");
    if (Object.keys(normalized).length === 0) throw new DomainError("INVALID_CONTENT", "至少修改一个方向字段");
    return this.dependencies.store.updateDirection(
      userId,
      directionId,
      normalized,
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
      this.dependencies.ids,
    );
  }

  async createCommitment(userId: string, reviewId: string, input: { title: string; reason?: string }): Promise<CommitmentRecord> {
    const title = input.title.trim();
    if (!title) throw new DomainError("EMPTY_TITLE", "下周重点不能为空");
    const periodEnd = await this.dependencies.store.getCommitmentReviewPeriodEnd(userId, reviewId);
    if (!periodEnd) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
    const target = await this.dependencies.periods.ensureWeekContaining(userId, periodEnd);
    return this.dependencies.store.createCommitment(
      userId,
      reviewId,
      title,
      input.reason?.trim() ?? "用户添加",
      target.id,
      this.dependencies.clock.now().toISOString(),
      this.dependencies.ids,
    );
  }

  async confirmCommitment(userId: string, commitmentId: string, expectedRevision: number): Promise<CommitmentRecord> {
    const periodEnd = await this.dependencies.store.getCommitmentSourcePeriodEnd(userId, commitmentId);
    if (!periodEnd) throw new DomainError("RESOURCE_NOT_FOUND", "下周重点不存在");
    const target = await this.dependencies.periods.ensureWeekContaining(userId, periodEnd);
    return this.dependencies.store.updateCommitment(
      userId,
      commitmentId,
      { status: "confirmed", targetPeriodId: target.id },
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
  }

  updateCommitment(
    userId: string,
    commitmentId: string,
    patch: { title?: string; reason?: string },
    expectedRevision: number,
  ): Promise<CommitmentRecord> {
    const title = patch.title?.trim();
    if (patch.title !== undefined && !title) throw new DomainError("EMPTY_TITLE", "下周重点不能为空");
    return this.dependencies.store.updateCommitment(
      userId,
      commitmentId,
      { ...(title === undefined ? {} : { title }), ...(patch.reason === undefined ? {} : { reason: patch.reason.trim() }) },
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
  }

  setCommitmentStatus(
    userId: string,
    commitmentId: string,
    status: "paused" | "dropped",
    expectedRevision: number,
  ): Promise<CommitmentRecord> {
    return this.dependencies.store.updateCommitment(
      userId,
      commitmentId,
      { status },
      expectedRevision,
      this.dependencies.clock.now().toISOString(),
    );
  }
}

export function planReviewConfirmation(view: WeeklyReviewView, now: string, ids: IdGenerator): ReviewConfirmationPlan {
  if (!view.review) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
  if (view.claims.some((claim) => claim.status === "pending")) {
    throw new DomainError("INVALID_RELATION", "请先处理全部 Agent 判断");
  }
  const memories: ConfirmedMemoryRecord[] = [];
  const directions: DirectionRecord[] = [];
  const contributionEdges: ContributionEdgeRecord[] = [];
  const confirmedCandidateIds: string[] = [];
  const rejectedCandidateIds: string[] = [];
  for (const claim of view.claims) {
    const accepted = claim.status === "accepted" || claim.status === "edited";
    const candidate = claim.memoryCandidate;
    if (!accepted) {
      if (candidate?.status === "pending") rejectedCandidateIds.push(candidate.id);
      continue;
    }
    let direction: DirectionRecord | null = null;
    if (claim.proposedDirection) {
      direction = {
        id: ids.next(),
        userId: view.run.userId,
        name: claim.proposedDirection.name,
        description: claim.userRevision ?? claim.statement,
        state: "active",
        createdFromReviewId: view.review.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      directions.push(direction);
      for (const evidence of claim.evidence.filter((entry) => entry.entityType !== "memory" && entry.excludedAt === null)) {
        contributionEdges.push({
          id: ids.next(),
          userId: view.run.userId,
          sourceType: evidence.entityType,
          sourceId: evidence.entityId,
          directionId: direction.id,
          relation: claim.proposedDirection.relation,
          confidence: claim.confidence,
          source: "user_confirmed",
          validFrom: now,
          validTo: null,
          supersedesId: null,
          createdAt: now,
        });
      }
    }
    if (candidate?.status === "pending") {
      confirmedCandidateIds.push(candidate.id);
      memories.push(memoryFromCandidate(candidate, view.review.id, view.run.userId, now, ids));
    } else if (direction) {
      memories.push({
        id: ids.next(),
        userId: view.run.userId,
        memoryType: "direction",
        value: { name: direction.name, description: direction.description, directionId: direction.id },
        sourceCandidateId: null,
        sourceReviewId: view.review.id,
        effectiveFrom: now,
        effectiveTo: null,
        status: "active",
        revision: 1,
        supersedesId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return { memories, directions, contributionEdges, confirmedCandidateIds, rejectedCandidateIds };
}

function memoryFromCandidate(
  candidate: MemoryCandidateRecord,
  reviewId: string,
  userId: string,
  now: string,
  ids: IdGenerator,
): ConfirmedMemoryRecord {
  return {
    id: ids.next(),
    userId,
    memoryType: candidate.memoryType,
    value: candidate.proposedValue,
    sourceCandidateId: candidate.id,
    sourceReviewId: reviewId,
    effectiveFrom: now,
    effectiveTo: null,
    status: "active",
    revision: 1,
    supersedesId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function reviewStatusAfterDecision(claims: ReviewClaimRecord[]): "pending" | "partially_confirmed" {
  return claims.every((claim) => claim.status === "pending") ? "pending" : "partially_confirmed";
}

export function isDirectionTransitionAllowed(
  from: DirectionRecord["state"],
  to: DirectionRecord["state"],
): boolean {
  if (from === to) return true;
  if (from === "candidate") return to === "active" || to === "ended";
  if (from === "active") return to === "paused" || to === "ended" || to === "replaced";
  if (from === "paused") return to === "active" || to === "ended" || to === "replaced";
  return false;
}
