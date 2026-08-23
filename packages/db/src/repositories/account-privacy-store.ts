import { and, eq, inArray } from "drizzle-orm";

import type {
  AccountDataExport,
  AccountDeletionRecord,
  AccountPrivacyStore,
} from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import {
  accountDeletionRequests,
  agentRuns,
  confirmedMemories,
  confirmedMemoryEvidenceDependencies,
  contributionEdges,
  directions,
  evidenceRefs,
  focusAdjustments,
  focusSegments,
  focusSessions,
  folders,
  groups,
  items,
  lists,
  memoryCandidates,
  nextPeriodCommitments,
  periods,
  periodSnapshots,
  progressEntries,
  reviewClaims,
  reviewVersions,
  sessions,
  snapshotEvidence,
  taskEvents,
  users,
  verifications,
} from "../schema/index.js";
import { PostgresTransactionContext, type TimeFriendTransaction } from "../transaction-context.js";

export interface AccountDeletionJobScheduler {
  schedule(transaction: TimeFriendTransaction, requestId: string): Promise<void>;
}

const noOpScheduler: AccountDeletionJobScheduler = { schedule: async () => undefined };

export class PostgresAccountPrivacyStore implements AccountPrivacyStore {
  constructor(
    private readonly database: TimeFriendDatabase,
    private readonly transactions = new PostgresTransactionContext(),
    private readonly scheduler: AccountDeletionJobScheduler = noOpScheduler,
  ) {}

  async exportData(userId: string, generatedAt: string): Promise<AccountDataExport | null> {
    const [profile] = await this.database.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!profile || profile.frozenAt) return null;
    const [
      folderRows,
      listRows,
      groupRows,
      itemRows,
      taskEventRows,
      focusSessionRows,
      focusSegmentRows,
      focusAdjustmentRows,
      progressRows,
      periodRows,
      snapshotRows,
      snapshotEvidenceRows,
      runRows,
      reviewRows,
      claimRows,
      evidenceRows,
      candidateRows,
      commitmentRows,
      directionRows,
      memoryRows,
      memoryDependencyRows,
      edgeRows,
    ] = await Promise.all([
      this.database.select().from(folders).where(eq(folders.userId, userId)),
      this.database.select().from(lists).where(eq(lists.userId, userId)),
      this.database.select().from(groups).where(eq(groups.userId, userId)),
      this.database.select().from(items).where(eq(items.userId, userId)),
      this.database.select().from(taskEvents).where(eq(taskEvents.userId, userId)),
      this.database.select().from(focusSessions).where(eq(focusSessions.userId, userId)),
      this.database.select().from(focusSegments).where(eq(focusSegments.userId, userId)),
      this.database.select().from(focusAdjustments).where(eq(focusAdjustments.userId, userId)),
      this.database.select().from(progressEntries).where(eq(progressEntries.userId, userId)),
      this.database.select().from(periods).where(eq(periods.userId, userId)),
      this.database.select().from(periodSnapshots).where(eq(periodSnapshots.userId, userId)),
      this.database.select().from(snapshotEvidence).where(eq(snapshotEvidence.userId, userId)),
      this.database.select().from(agentRuns).where(eq(agentRuns.userId, userId)),
      this.database.select().from(reviewVersions).where(eq(reviewVersions.userId, userId)),
      this.database.select().from(reviewClaims).where(eq(reviewClaims.userId, userId)),
      this.database.select().from(evidenceRefs).where(eq(evidenceRefs.userId, userId)),
      this.database.select().from(memoryCandidates).where(eq(memoryCandidates.userId, userId)),
      this.database.select().from(nextPeriodCommitments).where(eq(nextPeriodCommitments.userId, userId)),
      this.database.select().from(directions).where(eq(directions.userId, userId)),
      this.database.select().from(confirmedMemories).where(eq(confirmedMemories.userId, userId)),
      this.database.select().from(confirmedMemoryEvidenceDependencies).where(eq(confirmedMemoryEvidenceDependencies.userId, userId)),
      this.database.select().from(contributionEdges).where(eq(contributionEdges.userId, userId)),
    ]);
    return {
      schemaVersion: "1",
      generatedAt,
      profile: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        timezone: profile.timezone,
        weekStartsOn: profile.weekStartsOn,
        agentEnabled: profile.agentEnabled,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      data: {
        folders: folderRows,
        lists: listRows,
        groups: groupRows,
        items: itemRows,
        taskEvents: taskEventRows,
        focusSessions: focusSessionRows,
        focusSegments: focusSegmentRows,
        focusAdjustments: focusAdjustmentRows,
        progressEntries: progressRows,
        periods: periodRows,
        periodSnapshots: snapshotRows,
        snapshotEvidence: snapshotEvidenceRows,
        agentRuns: runRows,
        reviewVersions: reviewRows,
        reviewClaims: claimRows,
        evidenceRefs: evidenceRows,
        memoryCandidates: candidateRows,
        nextPeriodCommitments: commitmentRows,
        directions: directionRows,
        confirmedMemories: memoryRows,
        confirmedMemoryEvidenceDependencies: memoryDependencyRows,
        contributionEdges: edgeRows,
      },
    };
  }

  requestDeletion(record: AccountDeletionRecord): Promise<AccountDeletionRecord | null> {
    return this.transactions.run(this.database, async (transaction) => {
      const [user] = await transaction.select({ id: users.id }).from(users).where(eq(users.id, record.userId!)).for("update").limit(1);
      if (!user) return null;
      const [existing] = await transaction
        .select()
        .from(accountDeletionRequests)
        .where(and(eq(accountDeletionRequests.userId, user.id), inArray(accountDeletionRequests.status, ["queued", "processing"])))
        .limit(1);
      if (existing) return toDeletionRecord(existing);
      const [inserted] = await transaction.insert(accountDeletionRequests).values(deletionToRow(record)).returning();
      if (!inserted) throw new Error("ACCOUNT_DELETION_REQUEST_NOT_CREATED");
      await transaction.update(users).set({ frozenAt: new Date(record.requestedAt), agentEnabled: false, updatedAt: new Date(record.requestedAt) }).where(eq(users.id, user.id));
      await transaction.delete(sessions).where(eq(sessions.userId, user.id));
      await this.scheduler.schedule(transaction, inserted.id);
      return toDeletionRecord(inserted);
    });
  }

  claimDeletion(requestId: string, now: string): Promise<AccountDeletionRecord | null> {
    return this.transactions.run(this.database, async (transaction) => {
      const [request] = await transaction.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, requestId)).for("update").limit(1);
      if (!request || request.status === "completed" || request.status === "processing") return null;
      if (request.status !== "queued" && request.status !== "failed") return null;
      const [updated] = await transaction
        .update(accountDeletionRequests)
        .set({ status: "processing", startedAt: new Date(now), errorCode: null, updatedAt: new Date(now) })
        .where(eq(accountDeletionRequests.id, requestId))
        .returning();
      return updated ? toDeletionRecord(updated) : null;
    });
  }

  eraseAccount(requestId: string, now: string): Promise<AccountDeletionRecord> {
    return this.transactions.run(this.database, async (transaction) => {
      const [request] = await transaction.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.id, requestId)).for("update").limit(1);
      if (!request) throw new Error("ACCOUNT_DELETION_REQUEST_NOT_FOUND");
      if (request.status === "completed") return toDeletionRecord(request);
      if (request.status !== "processing") throw new Error("ACCOUNT_DELETION_STATE_CONFLICT");
      if (request.userId) {
        const [profile] = await transaction.select({ email: users.email }).from(users).where(eq(users.id, request.userId)).limit(1);
        if (profile) await transaction.delete(verifications).where(eq(verifications.identifier, profile.email));
        await transaction.delete(users).where(eq(users.id, request.userId));
      }
      const [completed] = await transaction
        .update(accountDeletionRequests)
        .set({ userId: null, status: "completed", completedAt: new Date(now), errorCode: null, updatedAt: new Date(now) })
        .where(eq(accountDeletionRequests.id, requestId))
        .returning();
      if (!completed) throw new Error("ACCOUNT_DELETION_RECEIPT_NOT_UPDATED");
      return toDeletionRecord(completed);
    });
  }

  async failDeletion(requestId: string, errorCode: string, now: string): Promise<void> {
    await this.database
      .update(accountDeletionRequests)
      .set({ status: "failed", errorCode, updatedAt: new Date(now) })
      .where(and(eq(accountDeletionRequests.id, requestId), eq(accountDeletionRequests.status, "processing")));
  }
}

function deletionToRow(record: AccountDeletionRecord) {
  return {
    id: record.id,
    userId: record.userId,
    subjectHash: record.subjectHash,
    status: record.status,
    requestedAt: new Date(record.requestedAt),
    startedAt: record.startedAt ? new Date(record.startedAt) : null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    errorCode: record.errorCode,
  };
}

function toDeletionRecord(row: typeof accountDeletionRequests.$inferSelect): AccountDeletionRecord {
  return {
    id: row.id,
    userId: row.userId,
    subjectHash: row.subjectHash,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
  };
}
