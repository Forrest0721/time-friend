import { and, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import {
  hashCanonical,
  PERIOD_FACTS_SCHEMA_VERSION,
  TRAJECTORY_PROMPT_VERSION,
  TRAJECTORY_WORKFLOW_NAME,
  TRAJECTORY_WORKFLOW_VERSION,
  WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION,
  type AgentRunRecord,
  type CommitmentRecord,
  type ConfirmedMemoryRecord,
  type ClaimDecision,
  type ConfirmedMemoryView,
  type EvidenceRefRecord,
  type DirectionRecord,
  type EvidenceSearchResult,
  type EvidenceValidationResult,
  type GeneratedReview,
  type GeneratedReviewResult,
  type MaterializedReview,
  type MemoryCandidateRecord,
  type PeriodComparison,
  type PeriodRecord,
  type PeriodSnapshot,
  type ReviewClaimRecord,
  type ReviewVersionRecord,
  type TrajectoryAgentTools,
  type TrajectoryFeedbackStore,
  type TrajectoryReviewStore,
  type WeeklyReviewView,
  DomainError,
  isDirectionTransitionAllowed,
  planReviewConfirmation,
  reviewStatusAfterDecision,
} from "@time-friend/domain";
import type { IdGenerator } from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import {
  agentRuns,
  confirmedMemoryEvidenceDependencies,
  confirmedMemories,
  contributionEdges,
  directions,
  evidenceRefs,
  items,
  lists,
  memoryCandidates,
  nextPeriodCommitments,
  periods,
  periodSnapshots,
  reviewClaims,
  reviewVersions,
  snapshotEvidence,
  users,
} from "../schema/index.js";
import { PostgresTransactionContext, type TimeFriendTransaction } from "../transaction-context.js";

export interface TrajectoryReviewJobScheduler {
  schedule(transaction: TimeFriendTransaction, runId: string): Promise<void>;
}

const noOpScheduler: TrajectoryReviewJobScheduler = { schedule: async () => undefined };

export class PostgresTrajectoryReviewStore implements TrajectoryReviewStore, TrajectoryFeedbackStore {
  constructor(
    private readonly database: TimeFriendDatabase,
    private readonly transactions = new PostgresTransactionContext(),
    private readonly scheduler: TrajectoryReviewJobScheduler = noOpScheduler,
  ) {}

  requestRun(input: AgentRunRecord): Promise<AgentRunRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const existingRows = await transaction
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.userId, input.userId),
            eq(agentRuns.workflowVersion, input.workflowVersion),
            eq(agentRuns.inputHash, input.inputHash),
            eq(agentRuns.provider, input.provider),
            eq(agentRuns.model, input.model),
            eq(agentRuns.modelConfigHash, input.modelConfigHash),
          ),
        )
        .orderBy(desc(agentRuns.createdAt));
      const reusable = existingRows.find(
        (row) =>
          row.status === "succeeded" ||
          (["queued", "running", "validating"].includes(row.status) && row.forceLowData === input.forceLowData) ||
          (row.status === "waiting_for_data" && !input.forceLowData),
      );
      if (reusable) return toAgentRun(reusable);
      const retryable = existingRows.find((row) => row.status === "failed" && row.forceLowData === input.forceLowData);
      if (retryable && input.status === "queued") {
        const [updated] = await transaction
          .update(agentRuns)
          .set({ status: "queued", errorCode: null, errorDetailRedacted: null, finishedAt: null, updatedAt: new Date(input.updatedAt) })
          .where(and(eq(agentRuns.id, retryable.id), eq(agentRuns.status, "failed")))
          .returning();
        if (updated) {
          await this.scheduler.schedule(transaction, updated.id);
          return toAgentRun(updated);
        }
      }
      const [inserted] = await transaction
        .insert(agentRuns)
        .values(agentRunToRow(input))
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        if (inserted.status === "queued") await this.scheduler.schedule(transaction, inserted.id);
        return toAgentRun(inserted);
      }
      const [concurrent] = await transaction
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.userId, input.userId),
            eq(agentRuns.periodSnapshotId, input.periodSnapshotId),
            inArray(agentRuns.status, ["queued", "running", "validating", "succeeded"]),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      if (!concurrent) throw new Error("agent run upsert did not return a row");
      return toAgentRun(concurrent);
    });
  }

  async getRun(userId: string, runId: string): Promise<AgentRunRecord | null> {
    const [row] = await this.database
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.userId, userId), eq(agentRuns.id, runId)))
      .limit(1);
    return row ? toAgentRun(row) : null;
  }

  claimRun(runId: string, now: string): Promise<AgentRunRecord | null> {
    return this.transactions.run(this.database, async (transaction) => {
      const [row] = await transaction.select().from(agentRuns).where(eq(agentRuns.id, runId)).for("update").limit(1);
      if (!row || row.status === "succeeded" || row.status === "waiting_for_data") return null;
      const [preference] = await transaction
        .select({ agentEnabled: users.agentEnabled })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      if (!preference?.agentEnabled) {
        await transaction
          .update(agentRuns)
          .set({
            status: "failed",
            errorCode: "AGENT_DISABLED",
            errorDetailRedacted: null,
            finishedAt: new Date(now),
            updatedAt: new Date(now),
          })
          .where(eq(agentRuns.id, row.id));
        return null;
      }
      if (row.status === "validating") return toAgentRun(row);
      if (row.status === "running" && row.startedAt && row.startedAt.getTime() > Date.parse(now) - 10 * 60_000) return null;
      if (!(["queued", "failed", "running"] as const).includes(row.status as "queued" | "failed" | "running")) return null;
      const [updated] = await transaction
        .update(agentRuns)
        .set({
          status: "running",
          attempts: row.attempts + 1,
          startedAt: new Date(now),
          finishedAt: null,
          errorCode: null,
          errorDetailRedacted: null,
          updatedAt: new Date(now),
        })
        .where(eq(agentRuns.id, row.id))
        .returning();
      return updated ? toAgentRun(updated) : null;
    });
  }

  async getRunContext(runId: string): Promise<{ run: AgentRunRecord; period: PeriodRecord; snapshot: PeriodSnapshot } | null> {
    const [runRow] = await this.database.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
    if (!runRow) return null;
    const [snapshotRow] = await this.database
      .select()
      .from(periodSnapshots)
      .where(and(eq(periodSnapshots.id, runRow.periodSnapshotId), eq(periodSnapshots.userId, runRow.userId)))
      .limit(1);
    if (!snapshotRow) return null;
    const [periodRow] = await this.database
      .select()
      .from(periods)
      .where(and(eq(periods.id, snapshotRow.periodId), eq(periods.userId, runRow.userId)))
      .limit(1);
    if (!periodRow) return null;
    return { run: toAgentRun(runRow), snapshot: toSnapshot(snapshotRow), period: toPeriod(periodRow) };
  }

  createAgentTools(userId: string, period: PeriodRecord, snapshot: PeriodSnapshot): TrajectoryAgentTools {
    return {
      getPeriodSnapshot: async () => ({ period, snapshot }),
      searchEvidence: (input) => this.searchEvidence(userId, snapshot.id, input),
      getConfirmedMemories: () => this.getConfirmedMemories(userId, snapshot.sourceWatermark),
      comparePeriods: () => this.comparePeriods(userId, period, snapshot),
      proposeContributionEdges: async (input) => ({
        candidateId: `candidate_${hashCanonical({ snapshotId: snapshot.id, ...input }).slice(0, 32)}`,
        ...input,
      }),
      validateReviewEvidence: (review) => this.validateReviewEvidence(userId, snapshot.id, snapshot.sourceWatermark, review),
    };
  }

  saveAgentOutput(runId: string, result: GeneratedReviewResult, now: string): Promise<AgentRunRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const [updated] = await transaction
        .update(agentRuns)
        .set({
          status: "validating",
          rawOutputJson: result.review,
          sdkTraceId: result.sdkTraceId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: result.durationMs,
          toolCallsJson: result.toolCalls ?? [],
          estimatedCostMicrousd: result.estimatedCostMicrousd ?? null,
          updatedAt: new Date(now),
        })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
        .returning();
      if (!updated) throw new Error("AGENT_RUN_STATE_CONFLICT");
      return toAgentRun(updated);
    });
  }

  persistValidatedReview(runId: string, materialized: MaterializedReview, now: string): Promise<WeeklyReviewView> {
    return this.transactions.run(this.database, async (transaction) => {
      const [runRow] = await transaction.select().from(agentRuns).where(eq(agentRuns.id, runId)).for("update").limit(1);
      if (!runRow) throw new Error("RUN_CONTEXT_NOT_FOUND");
      if (runRow.status === "succeeded") {
        const existing = await loadViewByRun(transaction, runRow.userId, runId);
        if (!existing) throw new Error("REVIEW_NOT_FOUND_AFTER_SUCCESS");
        return existing;
      }
      if (runRow.status !== "validating") throw new Error("AGENT_RUN_STATE_CONFLICT");
      const [periodRow] = await transaction.select().from(periods).where(eq(periods.id, materialized.review.periodId)).for("update").limit(1);
      if (!periodRow || periodRow.userId !== runRow.userId) throw new Error("RUN_CONTEXT_NOT_FOUND");
      const existingReviews = await transaction
        .select({ version: reviewVersions.version })
        .from(reviewVersions)
        .where(eq(reviewVersions.periodId, periodRow.id))
        .orderBy(desc(reviewVersions.version));
      const version = (existingReviews[0]?.version ?? 0) + 1;
      await transaction
        .update(reviewVersions)
        .set({ status: "superseded" })
        .where(and(eq(reviewVersions.periodId, periodRow.id), ne(reviewVersions.status, "superseded")));
      const review = { ...materialized.review, version };
      await transaction.insert(reviewVersions).values(reviewToRow(review));
      if (materialized.claims.length > 0) await transaction.insert(reviewClaims).values(materialized.claims.map(claimToRow));
      if (materialized.evidence.length > 0) await transaction.insert(evidenceRefs).values(materialized.evidence.map(evidenceToRow));
      if (materialized.memoryCandidates.length > 0) {
        await transaction.insert(memoryCandidates).values(materialized.memoryCandidates.map(memoryCandidateToRow));
      }
      if (materialized.commitments.length > 0) {
        await transaction.insert(nextPeriodCommitments).values(materialized.commitments.map(commitmentToRow));
      }
      await transaction
        .update(agentRuns)
        .set({ status: "succeeded", finishedAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(agentRuns.id, runId));
      const view = await loadViewByRun(transaction, runRow.userId, runId);
      if (!view) throw new Error("REVIEW_PERSISTENCE_FAILED");
      return view;
    });
  }

  async failRun(runId: string, errorCode: string, errorDetailRedacted: string, now: string): Promise<void> {
    await this.database
      .update(agentRuns)
      .set({ status: "failed", errorCode, errorDetailRedacted, finishedAt: new Date(now), updatedAt: new Date(now) })
      .where(and(eq(agentRuns.id, runId), ne(agentRuns.status, "succeeded")));
  }

  async getReviewForPeriod(userId: string, periodId: string): Promise<WeeklyReviewView | null> {
    const [row] = await this.database
      .select({ runId: reviewVersions.agentRunId })
      .from(reviewVersions)
      .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.periodId, periodId), ne(reviewVersions.status, "superseded")))
      .orderBy(desc(reviewVersions.version))
      .limit(1);
    return row ? loadViewByRun(this.database, userId, row.runId) : null;
  }

  async listReviews(userId: string, limit: number, beforeCreatedAt?: string): Promise<WeeklyReviewView[]> {
    const condition = beforeCreatedAt
      ? and(eq(reviewVersions.userId, userId), ne(reviewVersions.status, "superseded"), lt(reviewVersions.createdAt, new Date(beforeCreatedAt)))
      : and(eq(reviewVersions.userId, userId), ne(reviewVersions.status, "superseded"));
    const rows = await this.database
      .select({ runId: reviewVersions.agentRunId })
      .from(reviewVersions)
      .where(condition)
      .orderBy(desc(reviewVersions.createdAt))
      .limit(limit);
    const views: WeeklyReviewView[] = [];
    for (const row of rows) {
      const view = await loadViewByRun(this.database, userId, row.runId);
      if (view) views.push(view);
    }
    return views;
  }

  decideClaim(userId: string, claimId: string, decision: ClaimDecision, now: string, ids: IdGenerator): Promise<WeeklyReviewView> {
    return this.transactions.run(this.database, async (transaction) => {
      const [claim] = await transaction
        .select()
        .from(reviewClaims)
        .where(and(eq(reviewClaims.userId, userId), eq(reviewClaims.id, claimId)))
        .for("update")
        .limit(1);
      if (!claim) throw new DomainError("RESOURCE_NOT_FOUND", "Agent 判断不存在");
      const [review] = await transaction
        .select()
        .from(reviewVersions)
        .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.id, claim.reviewVersionId)))
        .for("update")
        .limit(1);
      if (!review) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
      if (review.status === "confirmed" || review.status === "superseded") {
        throw new DomainError("INVALID_RELATION", "已确认或已被替代的复盘不能再修改");
      }
      await transaction
        .update(reviewClaims)
        .set({
          status: decision.action === "accept" ? "accepted" : decision.action === "edit" ? "edited" : "rejected",
          userRevision: decision.action === "edit" ? decision.userRevision : null,
          correctionKind: decision.correctionKind ?? null,
        })
        .where(eq(reviewClaims.id, claim.id));
      const [candidate] = await transaction
        .select()
        .from(memoryCandidates)
        .where(and(eq(memoryCandidates.userId, userId), eq(memoryCandidates.reviewClaimId, claim.id)))
        .limit(1);
      if (candidate) {
        const remember = decision.action !== "reject" && decision.remember;
        await transaction
          .update(memoryCandidates)
          .set({
            status: remember ? "pending" : "rejected",
            ...(remember && decision.memoryType ? { memoryType: decision.memoryType } : {}),
            ...(remember && decision.memoryValue ? { proposedValueJson: decision.memoryValue } : {}),
          })
          .where(eq(memoryCandidates.id, candidate.id));
      } else if (decision.action !== "reject" && decision.remember) {
        await transaction.insert(memoryCandidates).values({
          id: ids.next(),
          userId,
          reviewClaimId: claim.id,
          memoryType: decision.memoryType ?? "preference",
          proposedValueJson: decision.memoryValue ?? {
            correction: decision.correctionKind ?? "accepted",
            statement: claim.statement,
            rationale: claim.rationale,
          },
          status: "pending",
          createdAt: new Date(now),
        });
      }
      const updatedClaims = await transaction
        .select()
        .from(reviewClaims)
        .where(and(eq(reviewClaims.userId, userId), eq(reviewClaims.reviewVersionId, review.id)));
      await transaction
        .update(reviewVersions)
        .set({ status: reviewStatusAfterDecision(updatedClaims.map(toClaim)) })
        .where(eq(reviewVersions.id, review.id));
      const view = await loadViewByRun(transaction, userId, review.agentRunId);
      if (!view) throw new Error("REVIEW_PERSISTENCE_FAILED");
      return view;
    });
  }

  excludeEvidence(
    userId: string,
    evidenceId: string,
    reason: string,
    remember: boolean,
    now: string,
    ids: IdGenerator,
  ): Promise<WeeklyReviewView> {
    return this.transactions.run(this.database, async (transaction) => {
      const [evidence] = await transaction
        .select()
        .from(evidenceRefs)
        .where(and(eq(evidenceRefs.userId, userId), eq(evidenceRefs.id, evidenceId)))
        .for("update")
        .limit(1);
      if (!evidence) throw new DomainError("RESOURCE_NOT_FOUND", "证据关联不存在");
      const [claim] = await transaction
        .select()
        .from(reviewClaims)
        .where(and(eq(reviewClaims.userId, userId), eq(reviewClaims.id, evidence.claimId)))
        .limit(1);
      if (!claim) throw new DomainError("RESOURCE_NOT_FOUND", "Agent 判断不存在");
      const [review] = await transaction
        .select()
        .from(reviewVersions)
        .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.id, claim.reviewVersionId)))
        .limit(1);
      if (!review) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
      if (review.status === "confirmed" || review.status === "superseded") {
        throw new DomainError("INVALID_RELATION", "已确认或已被替代的复盘不能再修改证据关联");
      }
      if (evidence.excludedAt === null) {
        await transaction
          .update(evidenceRefs)
          .set({ excludedAt: new Date(now), exclusionReason: reason })
          .where(eq(evidenceRefs.id, evidence.id));
        if (remember) {
          await transaction.insert(confirmedMemories).values(
            memoryToRow({
              id: ids.next(),
              userId,
              memoryType: "exclusion",
              value: {
                entityType: evidence.entityType,
                entityId: evidence.entityId,
                reason,
                scope: "contribution_mapping",
              },
              sourceCandidateId: null,
              sourceReviewId: review.id,
              effectiveFrom: now,
              effectiveTo: null,
              status: "active",
              revision: 1,
              supersedesId: null,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
      }
      const view = await loadViewByRun(transaction, userId, review.agentRunId);
      if (!view) throw new Error("REVIEW_PERSISTENCE_FAILED");
      return view;
    });
  }

  confirmReview(userId: string, reviewId: string, now: string, ids: IdGenerator): Promise<WeeklyReviewView> {
    return this.transactions.run(this.database, async (transaction) => {
      const [review] = await transaction
        .select()
        .from(reviewVersions)
        .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.id, reviewId)))
        .for("update")
        .limit(1);
      if (!review) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
      const existing = await loadViewByRun(transaction, userId, review.agentRunId);
      if (!existing) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
      if (review.status === "confirmed") return existing;
      if (review.status === "superseded") throw new DomainError("INVALID_RELATION", "已被替代的复盘不能确认");
      const plan = planReviewConfirmation(existing, now, ids);
      if (plan.directions.length > 0) {
        await transaction.insert(directions).values(
          plan.directions.map((entry) => ({
            id: entry.id,
            userId: entry.userId,
            name: entry.name,
            description: entry.description,
            state: entry.state,
            createdFromReviewId: entry.createdFromReviewId,
            revision: entry.revision,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt),
          })),
        );
      }
      if (plan.memories.length > 0) {
        await transaction.insert(confirmedMemories).values(plan.memories.map(memoryToRow));
      }
      if (plan.memoryDependencies.length > 0) {
        await transaction.insert(confirmedMemoryEvidenceDependencies).values(plan.memoryDependencies.map((dependency) => ({
          id: ids.next(),
          userId,
          memoryId: dependency.memoryId,
          entityType: dependency.entityType,
          entityId: dependency.entityId,
          createdAt: new Date(now),
        })));
      }
      if (plan.contributionEdges.length > 0) {
        await transaction.insert(contributionEdges).values(
          plan.contributionEdges.map((entry) => ({
            ...entry,
            validFrom: new Date(entry.validFrom),
            validTo: dateOrNull(entry.validTo),
            createdAt: new Date(entry.createdAt),
          })),
        );
      }
      if (plan.confirmedCandidateIds.length > 0) {
        await transaction
          .update(memoryCandidates)
          .set({ status: "confirmed" })
          .where(and(eq(memoryCandidates.userId, userId), inArray(memoryCandidates.id, plan.confirmedCandidateIds)));
      }
      if (plan.rejectedCandidateIds.length > 0) {
        await transaction
          .update(memoryCandidates)
          .set({ status: "rejected" })
          .where(and(eq(memoryCandidates.userId, userId), inArray(memoryCandidates.id, plan.rejectedCandidateIds)));
      }
      await transaction
        .update(reviewVersions)
        .set({ status: "confirmed", confirmedAt: new Date(now) })
        .where(eq(reviewVersions.id, review.id));
      const confirmed = await loadViewByRun(transaction, userId, review.agentRunId);
      if (!confirmed) throw new Error("REVIEW_PERSISTENCE_FAILED");
      return confirmed;
    });
  }

  async listMemories(userId: string, status: "active" | "all"): Promise<ConfirmedMemoryRecord[]> {
    const rows = await this.database
      .select()
      .from(confirmedMemories)
      .where(status === "active" ? and(eq(confirmedMemories.userId, userId), eq(confirmedMemories.status, "active")) : eq(confirmedMemories.userId, userId))
      .orderBy(desc(confirmedMemories.effectiveFrom), desc(confirmedMemories.revision), desc(confirmedMemories.createdAt));
    return rows.map(toMemory);
  }

  async listDirections(userId: string, state: "active" | "all"): Promise<DirectionRecord[]> {
    const rows = await this.database
      .select()
      .from(directions)
      .where(state === "active" ? and(eq(directions.userId, userId), eq(directions.state, "active")) : eq(directions.userId, userId))
      .orderBy(desc(directions.updatedAt), desc(directions.createdAt));
    return rows.map(toDirection);
  }

  updateDirection(
    userId: string,
    directionId: string,
    patch: { name?: string; description?: string; state?: DirectionRecord["state"] },
    expectedRevision: number,
    now: string,
    ids: IdGenerator,
  ): Promise<DirectionRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(directions)
        .where(and(eq(directions.userId, userId), eq(directions.id, directionId)))
        .for("update")
        .limit(1);
      if (!current) throw new DomainError("RESOURCE_NOT_FOUND", "方向不存在");
      if (current.revision !== expectedRevision) {
        throw new DomainError("REVISION_CONFLICT", "方向已被其他操作更新", { revision: current.revision });
      }
      if (patch.state && !isDirectionTransitionAllowed(current.state, patch.state)) {
        throw new DomainError("INVALID_RELATION", "方向状态转换不合法");
      }
      if ((current.state === "ended" || current.state === "replaced") && Object.keys(patch).length > 0) {
        throw new DomainError("INVALID_RELATION", "已结束或已替代的方向不能修改");
      }
      const [updated] = await transaction
        .update(directions)
        .set({ ...patch, revision: current.revision + 1, updatedAt: new Date(now) })
        .where(eq(directions.id, current.id))
        .returning();
      const direction = toDirection(updated!);
      const [priorMemory] = await transaction
        .select()
        .from(confirmedMemories)
        .where(
          and(
            eq(confirmedMemories.userId, userId),
            eq(confirmedMemories.memoryType, "direction_state"),
            eq(confirmedMemories.status, "active"),
            sql`${confirmedMemories.valueJson} ->> 'directionId' = ${direction.id}`,
          ),
        )
        .orderBy(desc(confirmedMemories.revision))
        .for("update")
        .limit(1);
      if (priorMemory) {
        await transaction
          .update(confirmedMemories)
          .set({ status: "superseded", effectiveTo: new Date(now), updatedAt: new Date(now) })
          .where(eq(confirmedMemories.id, priorMemory.id));
      }
      await transaction.insert(confirmedMemories).values(
        memoryToRow({
          id: ids.next(),
          userId,
          memoryType: "direction_state",
          value: {
            directionId: direction.id,
            name: direction.name,
            description: direction.description,
            state: direction.state,
          },
          sourceCandidateId: null,
          sourceReviewId: direction.createdFromReviewId,
          effectiveFrom: now,
          effectiveTo: null,
          status: "active",
          revision: (priorMemory?.revision ?? 0) + 1,
          supersedesId: priorMemory?.id ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      return direction;
    });
  }

  reviseMemory(
    userId: string,
    memoryId: string,
    value: Record<string, unknown>,
    expectedRevision: number,
    now: string,
    ids: IdGenerator,
  ): Promise<ConfirmedMemoryRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const current = await lockActiveMemory(transaction, userId, memoryId, expectedRevision);
      await transaction
        .update(confirmedMemories)
        .set({ status: "superseded", effectiveTo: new Date(now), updatedAt: new Date(now) })
        .where(eq(confirmedMemories.id, current.id));
      const replacement: ConfirmedMemoryRecord = {
        ...toMemory(current),
        id: ids.next(),
        value,
        effectiveFrom: now,
        effectiveTo: null,
        status: "active",
        revision: current.revision + 1,
        supersedesId: current.id,
        reviewRequiredAt: null,
        reviewRequiredReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const [inserted] = await transaction.insert(confirmedMemories).values(memoryToRow(replacement)).returning();
      const dependencies = await transaction
        .select()
        .from(confirmedMemoryEvidenceDependencies)
        .where(and(
          eq(confirmedMemoryEvidenceDependencies.userId, userId),
          eq(confirmedMemoryEvidenceDependencies.memoryId, current.id),
        ));
      if (dependencies.length > 0) {
        await transaction.insert(confirmedMemoryEvidenceDependencies).values(dependencies.map((dependency) => ({
          id: ids.next(),
          userId,
          memoryId: inserted!.id,
          entityType: dependency.entityType,
          entityId: dependency.entityId,
          invalidatedAt: null,
          createdAt: new Date(now),
        })));
      }
      return toMemory(inserted!);
    });
  }

  deactivateMemory(
    userId: string,
    memoryId: string,
    expectedRevision: number,
    now: string,
  ): Promise<ConfirmedMemoryRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const current = await lockActiveMemory(transaction, userId, memoryId, expectedRevision);
      const [updated] = await transaction
        .update(confirmedMemories)
        .set({ status: "superseded", effectiveTo: new Date(now), updatedAt: new Date(now) })
        .where(eq(confirmedMemories.id, current.id))
        .returning();
      return toMemory(updated!);
    });
  }

  async deleteMemory(userId: string, memoryId: string, expectedRevision: number, now: string): Promise<void> {
    await this.transactions.run(this.database, async (transaction) => {
      const current = await lockActiveMemory(transaction, userId, memoryId, expectedRevision);
      await transaction
        .update(confirmedMemories)
        .set({ status: "deleted", effectiveTo: new Date(now), updatedAt: new Date(now) })
        .where(eq(confirmedMemories.id, current.id));
    });
  }

  createCommitment(
    userId: string,
    reviewId: string,
    title: string,
    reason: string,
    targetPeriodId: string,
    now: string,
    ids: IdGenerator,
  ): Promise<CommitmentRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const [review] = await transaction
        .select()
        .from(reviewVersions)
        .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.id, reviewId), ne(reviewVersions.status, "superseded")))
        .for("update")
        .limit(1);
      if (!review) throw new DomainError("RESOURCE_NOT_FOUND", "轨迹复盘不存在");
      const [targetPeriod] = await transaction
        .select({ id: periods.id })
        .from(periods)
        .where(and(eq(periods.userId, userId), eq(periods.id, targetPeriodId)))
        .for("update")
        .limit(1);
      if (!targetPeriod) throw new DomainError("RESOURCE_NOT_FOUND", "目标周期不存在");
      const active = await transaction
        .select({ id: nextPeriodCommitments.id })
        .from(nextPeriodCommitments)
        .where(and(
          eq(nextPeriodCommitments.userId, userId),
          eq(nextPeriodCommitments.targetPeriodId, targetPeriodId),
          inArray(nextPeriodCommitments.status, ["proposed", "confirmed", "paused"]),
        ))
        .limit(3);
      if (active.length >= 3) throw new DomainError("INVALID_RELATION", "每周最多保留 3 个重点");
      const positions = await transaction
        .select({ position: nextPeriodCommitments.position })
        .from(nextPeriodCommitments)
        .where(and(eq(nextPeriodCommitments.userId, userId), eq(nextPeriodCommitments.sourceReviewId, reviewId)))
        .orderBy(desc(nextPeriodCommitments.position))
        .limit(1);
      const record: CommitmentRecord = {
        id: ids.next(),
        userId,
        sourceReviewId: reviewId,
        targetPeriodId,
        title,
        reason,
        evidenceIds: [],
        status: "confirmed",
        position: (positions[0]?.position ?? -1) + 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      const [inserted] = await transaction.insert(nextPeriodCommitments).values(commitmentToRow(record)).returning();
      return toCommitment(inserted!);
    });
  }

  updateCommitment(
    userId: string,
    commitmentId: string,
    patch: { title?: string; reason?: string; status?: CommitmentRecord["status"]; targetPeriodId?: string | null },
    expectedRevision: number,
    now: string,
  ): Promise<CommitmentRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(nextPeriodCommitments)
        .where(and(eq(nextPeriodCommitments.userId, userId), eq(nextPeriodCommitments.id, commitmentId)))
        .for("update")
        .limit(1);
      if (!current) throw new DomainError("RESOURCE_NOT_FOUND", "下周重点不存在");
      if (current.revision !== expectedRevision) {
        throw new DomainError("REVISION_CONFLICT", "下周重点已被其他操作更新", { revision: current.revision });
      }
      if ((current.status === "dropped" || current.status === "completed") && Object.keys(patch).length > 0) {
        throw new DomainError("INVALID_RELATION", "已结束的下周重点不能修改");
      }
      if (patch.status && !isCommitmentTransitionAllowed(current.status, patch.status)) {
        throw new DomainError("INVALID_RELATION", "下周重点状态转换不合法");
      }
      if (patch.status === "confirmed") {
        const targetPeriodId = patch.targetPeriodId ?? current.targetPeriodId;
        if (!targetPeriodId) throw new DomainError("INVALID_RELATION", "确认重点前需要确定目标周期");
        const [targetPeriod] = await transaction
          .select({ id: periods.id })
          .from(periods)
          .where(and(eq(periods.userId, userId), eq(periods.id, targetPeriodId)))
          .for("update")
          .limit(1);
        if (!targetPeriod) throw new DomainError("RESOURCE_NOT_FOUND", "目标周期不存在");
        const active = await transaction
          .select({ id: nextPeriodCommitments.id })
          .from(nextPeriodCommitments)
          .where(and(
            eq(nextPeriodCommitments.userId, userId),
            eq(nextPeriodCommitments.targetPeriodId, targetPeriodId),
            inArray(nextPeriodCommitments.status, ["confirmed", "paused"]),
            ne(nextPeriodCommitments.id, current.id),
          ))
          .limit(3);
        if (active.length >= 3) throw new DomainError("INVALID_RELATION", "每周最多确认 3 个重点");
      }
      const [updated] = await transaction
        .update(nextPeriodCommitments)
        .set({ ...patch, revision: current.revision + 1, updatedAt: new Date(now) })
        .where(eq(nextPeriodCommitments.id, current.id))
        .returning();
      return toCommitment(updated!);
    });
  }

  async getCommitmentReviewPeriodEnd(userId: string, reviewId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ endsAt: periods.endsAt })
      .from(reviewVersions)
      .innerJoin(periods, and(eq(periods.userId, reviewVersions.userId), eq(periods.id, reviewVersions.periodId)))
      .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.id, reviewId)))
      .limit(1);
    return row?.endsAt.toISOString() ?? null;
  }

  async listCommitmentsForPeriod(userId: string, periodId: string): Promise<CommitmentRecord[]> {
    const rows = await this.database
      .select()
      .from(nextPeriodCommitments)
      .where(and(
        eq(nextPeriodCommitments.userId, userId),
        eq(nextPeriodCommitments.targetPeriodId, periodId),
        inArray(nextPeriodCommitments.status, ["confirmed", "paused"]),
      ))
      .orderBy(nextPeriodCommitments.position, nextPeriodCommitments.createdAt);
    return rows.map(toCommitment);
  }

  async getCommitmentSourcePeriodEnd(userId: string, commitmentId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ endsAt: periods.endsAt })
      .from(nextPeriodCommitments)
      .innerJoin(reviewVersions, and(eq(reviewVersions.userId, nextPeriodCommitments.userId), eq(reviewVersions.id, nextPeriodCommitments.sourceReviewId)))
      .innerJoin(periods, and(eq(periods.userId, reviewVersions.userId), eq(periods.id, reviewVersions.periodId)))
      .where(and(eq(nextPeriodCommitments.userId, userId), eq(nextPeriodCommitments.id, commitmentId)))
      .limit(1);
    return row?.endsAt.toISOString() ?? null;
  }

  private async searchEvidence(
    userId: string,
    snapshotId: string,
    input: { query: string; scope: Array<"task" | "focus_session" | "progress_entry" | "task_event" | "memory">; limit: number },
  ): Promise<EvidenceSearchResult[]> {
    const scope = input.scope.filter((entry) => entry !== "memory");
    if (scope.length === 0) return [];
    const query = input.query.trim();
    const searchDocument = sql`to_tsvector('simple', ${snapshotEvidence.title} || ' ' || coalesce(${snapshotEvidence.excerpt}, ''))`;
    const webQuery = sql`websearch_to_tsquery('simple', ${query})`;
    const similarity = sql<number>`similarity(${snapshotEvidence.title} || ' ' || coalesce(${snapshotEvidence.excerpt}, ''), ${query})`;
    const rows = await this.database
      .select()
      .from(snapshotEvidence)
      .where(
        and(
          eq(snapshotEvidence.userId, userId),
          eq(snapshotEvidence.snapshotId, snapshotId),
          inArray(snapshotEvidence.entityType, scope),
          or(sql`${searchDocument} @@ ${webQuery}`, sql`${similarity} > 0.08`),
        ),
      )
      .orderBy(desc(sql`ts_rank(${searchDocument}, ${webQuery}) + ${similarity}`), desc(snapshotEvidence.occurredAt))
      .limit(Math.min(input.limit, 30));
    return rows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      excerpt: row.excerpt,
      occurredAt: row.occurredAt.toISOString(),
      taskId: row.taskId,
      listId: row.listId,
    }));
  }

  private async getConfirmedMemories(userId: string, effectiveAt: string): Promise<ConfirmedMemoryView[]> {
    const rows = await this.database
      .select()
      .from(confirmedMemories)
      .where(
        and(
          eq(confirmedMemories.userId, userId),
          eq(confirmedMemories.status, "active"),
          lte(confirmedMemories.effectiveFrom, new Date(effectiveAt)),
          or(isNull(confirmedMemories.effectiveTo), gt(confirmedMemories.effectiveTo, new Date(effectiveAt))),
        ),
      )
      .orderBy(desc(confirmedMemories.updatedAt))
      .limit(100);
    return rows.map((row) => ({
      id: row.id,
      memoryType: row.memoryType,
      value: row.valueJson,
      effectiveFrom: row.effectiveFrom.toISOString(),
      revision: row.revision,
    }));
  }

  private async comparePeriods(userId: string, period: PeriodRecord, snapshot: PeriodSnapshot): Promise<PeriodComparison> {
    const [previousPeriod] = await this.database
      .select()
      .from(periods)
      .where(and(eq(periods.userId, userId), eq(periods.timezone, period.timezone), eq(periods.endsAt, new Date(period.startsAt))))
      .limit(1);
    if (!previousPeriod) return emptyComparison(snapshot.id);
    const [previousSnapshot] = await this.database
      .select()
      .from(periodSnapshots)
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.periodId, previousPeriod.id), ne(periodSnapshots.status, "superseded")))
      .orderBy(desc(periodSnapshots.version))
      .limit(1);
    if (!previousSnapshot) return emptyComparison(snapshot.id);
    const previous = toSnapshot(previousSnapshot);
    return {
      currentSnapshotId: snapshot.id,
      previousSnapshotId: previous.id,
      focusSecondsDelta: snapshot.metrics.focus.totalSeconds - previous.metrics.focus.totalSeconds,
      sessionCountDelta: snapshot.metrics.focus.sessionCount - previous.metrics.focus.sessionCount,
      progressCountDelta: totalProgress(snapshot) - totalProgress(previous),
    };
  }

  private async validateReviewEvidence(
    userId: string,
    snapshotId: string,
    effectiveAt: string,
    review: GeneratedReview,
  ): Promise<EvidenceValidationResult> {
    const unique = new Map(review.claims.flatMap((claim) => claim.evidence).map((entry) => [`${entry.entityType}:${entry.entityId}`, entry]));
    const valid: EvidenceValidationResult["valid"] = [];
    const invalid: EvidenceValidationResult["invalid"] = [];
    for (const reference of unique.values()) {
      if (reference.entityType === "memory") {
        const [memory] = await this.database
          .select({ id: confirmedMemories.id })
          .from(confirmedMemories)
          .where(
            and(
              eq(confirmedMemories.userId, userId),
              eq(confirmedMemories.id, reference.entityId),
              eq(confirmedMemories.status, "active"),
              lte(confirmedMemories.effectiveFrom, new Date(effectiveAt)),
            ),
          )
          .limit(1);
        if (memory) valid.push(reference);
        else invalid.push({ ...reference, reason: "not_found" });
        continue;
      }
      const [frozen] = await this.database
        .select({ id: snapshotEvidence.id })
        .from(snapshotEvidence)
        .where(
          and(
            eq(snapshotEvidence.userId, userId),
            eq(snapshotEvidence.snapshotId, snapshotId),
            eq(snapshotEvidence.entityType, reference.entityType),
            eq(snapshotEvidence.entityId, reference.entityId),
          ),
        )
        .limit(1);
      if (frozen) {
        valid.push(reference);
        continue;
      }
      const reason = await this.classifyInvalidEvidence(userId, snapshotId, reference.entityType, reference.entityId);
      invalid.push({ ...reference, reason });
    }
    return { valid, invalid };
  }

  private async classifyInvalidEvidence(
    userId: string,
    snapshotId: string,
    entityType: "task" | "focus_session" | "progress_entry" | "task_event",
    entityId: string,
  ): Promise<"not_found" | "out_of_scope" | "excluded"> {
    const [otherEvidence] = await this.database
      .select({ userId: snapshotEvidence.userId, snapshotId: snapshotEvidence.snapshotId, listId: snapshotEvidence.listId })
      .from(snapshotEvidence)
      .where(and(eq(snapshotEvidence.entityType, entityType), eq(snapshotEvidence.entityId, entityId)))
      .limit(1);
    if (otherEvidence) {
      if (otherEvidence.userId !== userId || otherEvidence.snapshotId !== snapshotId) return "out_of_scope";
      if (otherEvidence.listId) {
        const [list] = await this.database
          .select({ learningPolicy: lists.learningPolicy })
          .from(lists)
          .where(and(eq(lists.userId, userId), eq(lists.id, otherEvidence.listId)))
          .limit(1);
        if (list?.learningPolicy === "exclude") return "excluded";
      }
    }
    if (entityType === "task") {
      const [excludedTask] = await this.database
        .select({ id: items.id })
        .from(items)
        .innerJoin(lists, and(eq(lists.userId, items.userId), eq(lists.id, items.listId)))
        .where(and(eq(items.id, entityId), eq(items.userId, userId), eq(lists.learningPolicy, "exclude")))
        .limit(1);
      if (excludedTask) return "excluded";
    }
    return "not_found";
  }
}

type AgentRunRow = typeof agentRuns.$inferSelect;
type PeriodRow = typeof periods.$inferSelect;
type SnapshotRow = typeof periodSnapshots.$inferSelect;
type ReviewRow = typeof reviewVersions.$inferSelect;
type ClaimRow = typeof reviewClaims.$inferSelect;
type EvidenceRow = typeof evidenceRefs.$inferSelect;
type CandidateRow = typeof memoryCandidates.$inferSelect;
type CommitmentRow = typeof nextPeriodCommitments.$inferSelect;
type MemoryRow = typeof confirmedMemories.$inferSelect;

function agentRunToRow(run: AgentRunRecord): typeof agentRuns.$inferInsert {
  return {
    id: run.id,
    userId: run.userId,
    periodSnapshotId: run.periodSnapshotId,
    workflowName: run.workflowName,
    workflowVersion: run.workflowVersion,
    provider: run.provider,
    model: run.model,
    modelConfigJson: run.modelConfig,
    modelConfigHash: run.modelConfigHash,
    promptVersion: run.promptVersion,
    outputSchemaVersion: run.outputSchemaVersion,
    inputHash: run.inputHash,
    forceLowData: run.forceLowData,
    status: run.status,
    rawOutputJson: run.rawOutput,
    sdkTraceId: run.sdkTraceId,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    durationMs: run.durationMs,
    toolCallsJson: run.toolCalls ?? [],
    estimatedCostMicrousd: run.estimatedCostMicrousd ?? null,
    attempts: run.attempts,
    errorCode: run.errorCode,
    errorDetailRedacted: run.errorDetailRedacted,
    startedAt: dateOrNull(run.startedAt),
    finishedAt: dateOrNull(run.finishedAt),
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt),
  };
}

function toAgentRun(row: AgentRunRow): AgentRunRecord {
  if (
    row.workflowName !== TRAJECTORY_WORKFLOW_NAME ||
    row.workflowVersion !== TRAJECTORY_WORKFLOW_VERSION ||
    row.promptVersion !== TRAJECTORY_PROMPT_VERSION ||
    row.outputSchemaVersion !== WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION ||
    (row.provider !== "openai" && row.provider !== "deepseek")
  ) {
    throw new Error("unsupported trajectory workflow version");
  }
  return {
    id: row.id,
    userId: row.userId,
    periodSnapshotId: row.periodSnapshotId,
    workflowName: TRAJECTORY_WORKFLOW_NAME,
    workflowVersion: TRAJECTORY_WORKFLOW_VERSION,
    provider: row.provider,
    model: row.model,
    modelConfig: row.modelConfigJson,
    modelConfigHash: row.modelConfigHash,
    promptVersion: TRAJECTORY_PROMPT_VERSION,
    outputSchemaVersion: WEEKLY_REVIEW_OUTPUT_SCHEMA_VERSION,
    inputHash: row.inputHash,
    forceLowData: row.forceLowData,
    status: row.status,
    rawOutput: row.rawOutputJson,
    sdkTraceId: row.sdkTraceId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    toolCalls: row.toolCallsJson,
    estimatedCostMicrousd: row.estimatedCostMicrousd,
    attempts: row.attempts,
    errorCode: row.errorCode,
    errorDetailRedacted: row.errorDetailRedacted,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPeriod(row: PeriodRow): PeriodRecord {
  if (row.kind !== "week") throw new Error("unsupported period kind");
  return { ...row, kind: "week", startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), createdAt: row.createdAt.toISOString() };
}

function toSnapshot(row: SnapshotRow): PeriodSnapshot {
  if (row.schemaVersion !== PERIOD_FACTS_SCHEMA_VERSION) throw new Error("unsupported period facts schema");
  return {
    id: row.id,
    userId: row.userId,
    periodId: row.periodId,
    version: row.version,
    status: row.status,
    sourceWatermark: row.sourceWatermark.toISOString(),
    inputHash: row.inputHash,
    schemaVersion: PERIOD_FACTS_SCHEMA_VERSION,
    metrics: row.metricsJson,
    entityIndex: row.entityIndexJson,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadViewByRun(
  database: TimeFriendDatabase | TimeFriendTransaction,
  userId: string,
  runId: string,
): Promise<WeeklyReviewView | null> {
  const [runRow] = await database.select().from(agentRuns).where(and(eq(agentRuns.userId, userId), eq(agentRuns.id, runId))).limit(1);
  if (!runRow) return null;
  const [reviewRow] = await database
    .select()
    .from(reviewVersions)
    .where(and(eq(reviewVersions.userId, userId), eq(reviewVersions.agentRunId, runId)))
    .limit(1);
  if (!reviewRow) return { run: toAgentRun(runRow), review: null, claims: [], commitments: [] };
  const claimRows = await database
    .select()
    .from(reviewClaims)
    .where(and(eq(reviewClaims.userId, userId), eq(reviewClaims.reviewVersionId, reviewRow.id)))
    .orderBy(reviewClaims.position);
  const claimIds = claimRows.map((row) => row.id);
  const evidenceRows = claimIds.length
    ? await database.select().from(evidenceRefs).where(and(eq(evidenceRefs.userId, userId), inArray(evidenceRefs.claimId, claimIds)))
    : [];
  const documentEvidenceIds = evidenceRows.filter((entry) => entry.entityType !== "memory").map((entry) => entry.entityId);
  const evidenceDocuments = documentEvidenceIds.length
    ? await database
        .select()
        .from(snapshotEvidence)
        .where(and(
          eq(snapshotEvidence.userId, userId),
          eq(snapshotEvidence.snapshotId, reviewRow.snapshotId),
          inArray(snapshotEvidence.entityId, documentEvidenceIds),
        ))
    : [];
  const documentByEntity = new Map(evidenceDocuments.map((entry) => [`${entry.entityType}:${entry.entityId}`, entry]));
  const candidateRows = claimIds.length
    ? await database.select().from(memoryCandidates).where(and(eq(memoryCandidates.userId, userId), inArray(memoryCandidates.reviewClaimId, claimIds)))
    : [];
  const commitmentRows = await database
    .select()
    .from(nextPeriodCommitments)
    .where(and(eq(nextPeriodCommitments.userId, userId), eq(nextPeriodCommitments.sourceReviewId, reviewRow.id)))
    .orderBy(nextPeriodCommitments.position);
  return {
    run: toAgentRun(runRow),
    review: toReview(reviewRow),
    claims: claimRows.map((row) => ({
      ...toClaim(row),
      evidence: evidenceRows
        .filter((entry) => entry.claimId === row.id)
        .map((entry) => toEvidence(entry, documentByEntity.get(`${entry.entityType}:${entry.entityId}`))),
      memoryCandidate: candidateRows.find((entry) => entry.reviewClaimId === row.id) ? toCandidate(candidateRows.find((entry) => entry.reviewClaimId === row.id)!) : null,
    })),
    commitments: commitmentRows.map(toCommitment),
  };
}

function reviewToRow(review: ReviewVersionRecord): typeof reviewVersions.$inferInsert {
  return { ...review, limitationsJson: review.limitations, createdAt: new Date(review.createdAt), confirmedAt: dateOrNull(review.confirmedAt) };
}
function claimToRow(claim: ReviewClaimRecord): typeof reviewClaims.$inferInsert {
  return { ...claim, proposedDirectionJson: claim.proposedDirection };
}
function evidenceToRow(evidence: EvidenceRefRecord): typeof evidenceRefs.$inferInsert {
  return {
    ...evidence,
    excludedAt: dateOrNull(evidence.excludedAt),
  };
}
function memoryCandidateToRow(candidate: MemoryCandidateRecord): typeof memoryCandidates.$inferInsert {
  return { ...candidate, proposedValueJson: candidate.proposedValue };
}
function commitmentToRow(commitment: CommitmentRecord): typeof nextPeriodCommitments.$inferInsert {
  return {
    ...commitment,
    evidenceIdsJson: commitment.evidenceIds,
    createdAt: new Date(commitment.createdAt),
    updatedAt: new Date(commitment.updatedAt),
  };
}

function toReview(row: ReviewRow): ReviewVersionRecord {
  return { ...row, limitations: row.limitationsJson, createdAt: row.createdAt.toISOString(), confirmedAt: isoOrNull(row.confirmedAt) };
}
function toClaim(row: ClaimRow): ReviewClaimRecord {
  return {
    id: row.id,
    userId: row.userId,
    reviewVersionId: row.reviewVersionId,
    claimType: row.claimType,
    statement: row.statement,
    rationale: row.rationale,
    confidence: row.confidence,
    status: row.status,
    userRevision: row.userRevision,
    correctionKind: row.correctionKind as ReviewClaimRecord["correctionKind"],
    position: row.position,
    proposedDirection: row.proposedDirectionJson as ReviewClaimRecord["proposedDirection"],
  };
}
function toEvidence(row: EvidenceRow, document?: typeof snapshotEvidence.$inferSelect): EvidenceRefRecord {
  return {
    id: row.id,
    userId: row.userId,
    claimId: row.claimId,
    entityType: row.entityType,
    entityId: row.entityId,
    role: row.role,
    excerpt: row.excerpt,
    excludedAt: isoOrNull(row.excludedAt),
    exclusionReason: row.exclusionReason,
    detail: document ? {
      title: document.title,
      occurredAt: document.occurredAt.toISOString(),
      taskId: document.taskId,
      listId: document.listId,
      metrics: document.metricsJson,
    } : null,
  };
}
function toCandidate(row: CandidateRow): MemoryCandidateRecord {
  return { id: row.id, userId: row.userId, reviewClaimId: row.reviewClaimId, memoryType: row.memoryType as MemoryCandidateRecord["memoryType"], proposedValue: row.proposedValueJson, status: row.status };
}
function toCommitment(row: CommitmentRow): CommitmentRecord {
  return { ...row, evidenceIds: row.evidenceIdsJson, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function toDirection(row: typeof directions.$inferSelect): DirectionRecord {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function memoryToRow(memory: ConfirmedMemoryRecord): typeof confirmedMemories.$inferInsert {
  return {
    id: memory.id,
    userId: memory.userId,
    memoryType: memory.memoryType,
    valueJson: memory.value,
    sourceCandidateId: memory.sourceCandidateId,
    sourceReviewId: memory.sourceReviewId,
    effectiveFrom: new Date(memory.effectiveFrom),
    effectiveTo: dateOrNull(memory.effectiveTo),
    status: memory.status,
    revision: memory.revision,
    supersedesId: memory.supersedesId,
    reviewRequiredAt: memory.reviewRequiredAt ? new Date(memory.reviewRequiredAt) : null,
    reviewRequiredReason: memory.reviewRequiredReason ?? null,
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.updatedAt),
  };
}

function toMemory(row: MemoryRow): ConfirmedMemoryRecord {
  return {
    id: row.id,
    userId: row.userId,
    memoryType: row.memoryType,
    value: row.valueJson,
    sourceCandidateId: row.sourceCandidateId,
    sourceReviewId: row.sourceReviewId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: isoOrNull(row.effectiveTo),
    status: row.status,
    revision: row.revision,
    supersedesId: row.supersedesId,
    reviewRequiredAt: isoOrNull(row.reviewRequiredAt),
    reviewRequiredReason: row.reviewRequiredReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function lockActiveMemory(
  transaction: TimeFriendTransaction,
  userId: string,
  memoryId: string,
  expectedRevision: number,
): Promise<MemoryRow> {
  const [current] = await transaction
    .select()
    .from(confirmedMemories)
    .where(and(eq(confirmedMemories.userId, userId), eq(confirmedMemories.id, memoryId)))
    .for("update")
    .limit(1);
  if (!current) throw new DomainError("RESOURCE_NOT_FOUND", "长期记忆不存在");
  if (current.revision !== expectedRevision) {
    throw new DomainError("REVISION_CONFLICT", "长期记忆已被其他操作更新", { revision: current.revision });
  }
  if (current.status !== "active") throw new DomainError("INVALID_RELATION", "只有有效记忆可以修改");
  return current;
}

function isCommitmentTransitionAllowed(from: CommitmentRecord["status"], to: CommitmentRecord["status"]): boolean {
  if (from === to) return true;
  if (from === "proposed") return to === "confirmed" || to === "paused" || to === "dropped";
  if (from === "confirmed") return to === "paused" || to === "dropped" || to === "completed";
  if (from === "paused") return to === "confirmed" || to === "dropped";
  return false;
}

function emptyComparison(snapshotId: string): PeriodComparison {
  return { currentSnapshotId: snapshotId, previousSnapshotId: null, focusSecondsDelta: null, sessionCountDelta: null, progressCountDelta: null };
}
function totalProgress(snapshot: PeriodSnapshot): number {
  return Object.values(snapshot.metrics.progress).reduce((sum, count) => sum + count, 0);
}
function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
