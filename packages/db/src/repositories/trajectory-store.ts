import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";

import type {
  PeriodRecord,
  PeriodSnapshot,
  SnapshotEvidenceDocument,
  TrajectoryStore,
  TrajectoryStoreTransaction,
  WeeklyPeriod,
} from "@time-friend/domain";
import { PERIOD_FACTS_SCHEMA_VERSION } from "@time-friend/domain";

import type { TimeFriendDatabase } from "../client.js";
import {
  focusSegments,
  focusSessions,
  items,
  lists,
  periods,
  periodSnapshots,
  progressEntries,
  snapshotEvidence,
  taskEvents,
  users,
} from "../schema/index.js";
import type { TimeFriendTransaction } from "../transaction-context.js";

export class PostgresTrajectoryStore implements TrajectoryStore {
  constructor(private readonly database: TimeFriendDatabase) {}

  async transaction<T>(work: (transaction: TrajectoryStoreTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.database.transaction(
          (transaction) => work(new PostgresTrajectoryStoreTransaction(transaction)),
          { isolationLevel: "repeatable read", accessMode: "read write" },
        );
      } catch (error) {
        if (attempt >= 2 || !isRetryableTransactionError(error)) throw error;
      }
    }
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code
    ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "40001" || code === "40P01";
}

export class PostgresTrajectoryStoreTransaction implements TrajectoryStoreTransaction {
  constructor(private readonly database: TimeFriendTransaction) {}

  async getUserTrajectorySettings(userId: string) {
    const [row] = await this.database
      .select({ timezone: users.timezone, agentEnabled: users.agentEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async findPeriodByIdentity(userId: string, period: WeeklyPeriod): Promise<PeriodRecord | null> {
    const [row] = await this.database
      .select()
      .from(periods)
      .where(
        and(
          eq(periods.userId, userId),
          eq(periods.kind, period.kind),
          eq(periods.startsAt, new Date(period.startsAt)),
          eq(periods.timezone, period.timezone),
        ),
      )
      .limit(1);
    return row ? toPeriod(row) : null;
  }

  async findPeriod(userId: string, periodId: string, lock = false): Promise<PeriodRecord | null> {
    let query = this.database
      .select()
      .from(periods)
      .where(and(eq(periods.userId, userId), eq(periods.id, periodId)))
      .$dynamic();
    if (lock) query = query.for("update");
    const [row] = await query.limit(1);
    return row ? toPeriod(row) : null;
  }

  async insertPeriod(period: PeriodRecord): Promise<PeriodRecord> {
    const inserted = await this.database
      .insert(periods)
      .values({
        id: period.id,
        userId: period.userId,
        kind: period.kind,
        timezone: period.timezone,
        localStartDate: period.localStartDate,
        localEndDate: period.localEndDate,
        startsAt: new Date(period.startsAt),
        endsAt: new Date(period.endsAt),
        createdAt: new Date(period.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return toPeriod(inserted[0]);
    const existing = await this.findPeriodByIdentity(period.userId, period);
    if (!existing) throw new Error("period upsert did not return a row");
    return existing;
  }

  async listPeriods(userId: string, limit: number, beforeStartsAt?: string): Promise<PeriodRecord[]> {
    const predicate = beforeStartsAt
      ? and(eq(periods.userId, userId), lt(periods.startsAt, new Date(beforeStartsAt)))
      : eq(periods.userId, userId);
    const rows = await this.database.select().from(periods).where(predicate).orderBy(desc(periods.startsAt)).limit(limit);
    return rows.map(toPeriod);
  }

  async loadPeriodFactsInput(userId: string, period: PeriodRecord, sourceWatermark: string) {
    const includedLists = await this.database
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(and(eq(lists.userId, userId), eq(lists.learningPolicy, "include")))
      .orderBy(lists.id);
    const listIds = includedLists.map((entry) => entry.id);
    const taskRows =
      listIds.length === 0
        ? []
        : await this.database
            .select({
              id: items.id,
              listId: items.listId,
              title: items.title,
              contentText: items.contentText,
              status: items.status,
              plannedOn: items.plannedOn,
              completedAt: items.completedAt,
              abandonedAt: items.abandonedAt,
              createdAt: items.createdAt,
            })
            .from(items)
            .where(and(eq(items.userId, userId), inArray(items.listId, listIds), eq(items.kind, "task"), isNull(items.deletedAt)))
            .orderBy(items.id);
    const taskInputs = taskRows.map((row) => ({
      ...row,
      status: row.status!,
      completedAt: isoOrNull(row.completedAt),
      abandonedAt: isoOrNull(row.abandonedAt),
    }));
    const taskIds = taskInputs.map((entry) => entry.id);

    const overlapSegments = await this.database
      .select({ sessionId: focusSegments.sessionId })
      .from(focusSegments)
      .where(
        and(
          eq(focusSegments.userId, userId),
          lt(focusSegments.startedAt, new Date(sourceWatermark)),
          or(isNull(focusSegments.endedAt), gt(focusSegments.endedAt, new Date(period.startsAt))),
        ),
      );
    const candidateSessionIds = [...new Set(overlapSegments.map((entry) => entry.sessionId))];
    const sessionRows =
      candidateSessionIds.length === 0
        ? []
        : await this.database
            .select({
              id: focusSessions.id,
              taskId: focusSessions.taskId,
              mode: focusSessions.mode,
              state: focusSessions.state,
              effectiveSeconds: focusSessions.effectiveSeconds,
              startedAt: focusSessions.startedAt,
            })
            .from(focusSessions)
            .where(
              and(
                eq(focusSessions.userId, userId),
                inArray(focusSessions.id, candidateSessionIds),
                isNull(focusSessions.deletedAt),
                taskIds.length === 0
                  ? isNull(focusSessions.taskId)
                  : or(isNull(focusSessions.taskId), inArray(focusSessions.taskId, taskIds)),
              ),
            )
            .orderBy(focusSessions.id);
    const sessionIds = sessionRows.map((entry) => entry.id);
    const segmentRows =
      sessionIds.length === 0
        ? []
        : await this.database
            .select({
              id: focusSegments.id,
              sessionId: focusSegments.sessionId,
              startedAt: focusSegments.startedAt,
              endedAt: focusSegments.endedAt,
            })
            .from(focusSegments)
            .where(and(eq(focusSegments.userId, userId), inArray(focusSegments.sessionId, sessionIds)))
            .orderBy(focusSegments.id);

    const progressRows = await this.database
      .select({
        id: progressEntries.id,
        taskId: progressEntries.taskId,
        focusSessionId: progressEntries.focusSessionId,
        outcome: progressEntries.outcome,
        note: progressEntries.note,
        nextStep: progressEntries.nextStep,
        occurredAt: progressEntries.occurredAt,
      })
      .from(progressEntries)
      .where(
        and(
          eq(progressEntries.userId, userId),
          isNull(progressEntries.deletedAt),
          gte(progressEntries.occurredAt, new Date(period.startsAt)),
          lt(progressEntries.occurredAt, new Date(sourceWatermark)),
          taskIds.length === 0 ? isNull(progressEntries.taskId) : or(isNull(progressEntries.taskId), inArray(progressEntries.taskId, taskIds)),
        ),
      )
      .orderBy(progressEntries.id);

    const taskEventRows =
      taskIds.length === 0
        ? []
        : await this.database
            .select({
              id: taskEvents.id,
              taskId: taskEvents.taskId,
              eventType: taskEvents.eventType,
              occurredAt: taskEvents.occurredAt,
              payload: taskEvents.payload,
            })
            .from(taskEvents)
            .where(
              and(
                eq(taskEvents.userId, userId),
                inArray(taskEvents.taskId, taskIds),
                gte(taskEvents.occurredAt, new Date(period.startsAt)),
                lt(taskEvents.occurredAt, new Date(sourceWatermark)),
              ),
            )
            .orderBy(taskEvents.id);

    const relevantTaskIds = new Set<string>();
    for (const task of taskInputs) {
      const completedInPeriod = task.completedAt !== null && task.completedAt >= period.startsAt && task.completedAt < period.endsAt;
      const abandonedInPeriod = task.abandonedAt !== null && task.abandonedAt >= period.startsAt && task.abandonedAt < period.endsAt;
      const plannedInPeriod = task.plannedOn !== null && task.plannedOn >= period.localStartDate && task.plannedOn <= period.localEndDate;
      if (completedInPeriod || abandonedInPeriod || plannedInPeriod) relevantTaskIds.add(task.id);
    }
    for (const row of sessionRows) if (row.taskId) relevantTaskIds.add(row.taskId);
    for (const row of progressRows) if (row.taskId) relevantTaskIds.add(row.taskId);
    for (const row of taskEventRows) relevantTaskIds.add(row.taskId);
    const relevantTasks = taskInputs.filter((entry) => relevantTaskIds.has(entry.id));
    const taskById = new Map(taskInputs.map((entry) => [entry.id, entry]));
    const evidenceDocuments: SnapshotEvidenceDocument[] = [
      ...relevantTasks.map((task) => ({
        entityType: "task" as const,
        entityId: task.id,
        title: task.title,
        excerpt: truncate(task.contentText),
        occurredAt: task.createdAt.toISOString(),
        taskId: task.id,
        listId: task.listId,
      })),
      ...sessionRows.map((session) => ({
        entityType: "focus_session" as const,
        entityId: session.id,
        title: session.mode === "pomodoro" ? "番茄专注" : "正计时专注",
        excerpt: null,
        occurredAt: session.startedAt.toISOString(),
        taskId: session.taskId,
        listId: session.taskId ? taskById.get(session.taskId)?.listId ?? null : null,
      })),
      ...progressRows.map((progress) => ({
        entityType: "progress_entry" as const,
        entityId: progress.id,
        title: progressTitle(progress.outcome),
        excerpt: truncate([progress.note, progress.nextStep].filter(Boolean).join("\n")),
        occurredAt: progress.occurredAt.toISOString(),
        taskId: progress.taskId,
        listId: progress.taskId ? taskById.get(progress.taskId)?.listId ?? null : null,
      })),
      ...taskEventRows.map((event) => ({
        entityType: "task_event" as const,
        entityId: event.id,
        title: event.eventType,
        excerpt: null,
        occurredAt: event.occurredAt.toISOString(),
        taskId: event.taskId,
        listId: taskById.get(event.taskId)?.listId ?? null,
      })),
    ];

    return {
      lists: includedLists,
      tasks: relevantTasks.map((task) => ({
        id: task.id,
        listId: task.listId,
        title: task.title,
        contentText: task.contentText,
        status: task.status,
        plannedOn: task.plannedOn,
        completedAt: task.completedAt,
        abandonedAt: task.abandonedAt,
      })),
      focusSessions: sessionRows.map((session) => ({
        id: session.id,
        taskId: session.taskId,
        mode: session.mode,
        state: session.state,
        effectiveSeconds: session.effectiveSeconds,
      })),
      focusSegments: segmentRows.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), endedAt: isoOrNull(row.endedAt) })),
      progressEntries: progressRows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      taskEvents: taskEventRows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      evidenceDocuments,
    };
  }

  async findSnapshotByHash(userId: string, periodId: string, inputHash: string): Promise<PeriodSnapshot | null> {
    const [row] = await this.database
      .select()
      .from(periodSnapshots)
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.periodId, periodId), eq(periodSnapshots.inputHash, inputHash)))
      .limit(1);
    return row ? toSnapshot(row) : null;
  }

  async listSnapshots(userId: string, periodId: string): Promise<PeriodSnapshot[]> {
    const rows = await this.database
      .select()
      .from(periodSnapshots)
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.periodId, periodId)))
      .orderBy(desc(periodSnapshots.version));
    return rows.map(toSnapshot);
  }

  async supersedeCurrentSnapshots(userId: string, periodId: string): Promise<void> {
    await this.database
      .update(periodSnapshots)
      .set({ status: "superseded" })
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.periodId, periodId), eq(periodSnapshots.status, "current")));
  }

  async activateSnapshot(userId: string, snapshotId: string): Promise<void> {
    await this.database
      .update(periodSnapshots)
      .set({ status: "current" })
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.id, snapshotId)));
  }

  async insertSnapshot(snapshot: PeriodSnapshot, evidenceDocuments: readonly SnapshotEvidenceDocument[]): Promise<void> {
    await this.database.insert(periodSnapshots).values({
      id: snapshot.id,
      userId: snapshot.userId,
      periodId: snapshot.periodId,
      version: snapshot.version,
      status: snapshot.status,
      sourceWatermark: new Date(snapshot.sourceWatermark),
      inputHash: snapshot.inputHash,
      schemaVersion: snapshot.schemaVersion,
      metricsJson: snapshot.metrics,
      entityIndexJson: snapshot.entityIndex,
      createdAt: new Date(snapshot.createdAt),
    });
    if (evidenceDocuments.length > 0) {
      await this.database.insert(snapshotEvidence).values(
        evidenceDocuments.map((document) => ({
          id: crypto.randomUUID(),
          userId: snapshot.userId,
          snapshotId: snapshot.id,
          entityType: document.entityType,
          entityId: document.entityId,
          title: document.title,
          excerpt: document.excerpt,
          occurredAt: new Date(document.occurredAt),
          taskId: document.taskId,
          listId: document.listId,
          createdAt: new Date(snapshot.createdAt),
        })),
      );
    }
  }

  async markSnapshotsStale(userId: string, occurredAt: string): Promise<number> {
    const matchingPeriods = await this.database
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.userId, userId), lte(periods.startsAt, new Date(occurredAt)), gt(periods.endsAt, new Date(occurredAt))));
    if (matchingPeriods.length === 0) return 0;
    const changed = await this.database
      .update(periodSnapshots)
      .set({ status: "stale" })
      .where(
        and(
          eq(periodSnapshots.userId, userId),
          inArray(
            periodSnapshots.periodId,
            matchingPeriods.map((entry) => entry.id),
          ),
          eq(periodSnapshots.status, "current"),
        ),
      )
      .returning({ id: periodSnapshots.id });
    return changed.length;
  }

  async markSnapshotsStaleForLocalDate(userId: string, localDate: string): Promise<number> {
    const matchingPeriods = await this.database
      .select({ id: periods.id })
      .from(periods)
      .where(
        and(
          eq(periods.userId, userId),
          lte(periods.localStartDate, localDate),
          gte(periods.localEndDate, localDate),
        ),
      );
    return this.markPeriodSnapshotsStale(userId, matchingPeriods.map((entry) => entry.id));
  }

  async markSnapshotsContainingEntity(
    userId: string,
    entityType: "task" | "focus_session" | "progress_entry" | "task_event",
    entityId: string,
  ): Promise<number> {
    const matchingSnapshots = await this.database
      .select({ id: snapshotEvidence.snapshotId })
      .from(snapshotEvidence)
      .where(
        and(
          eq(snapshotEvidence.userId, userId),
          eq(snapshotEvidence.entityType, entityType),
          eq(snapshotEvidence.entityId, entityId),
        ),
      );
    if (matchingSnapshots.length === 0) return 0;
    const changed = await this.database
      .update(periodSnapshots)
      .set({ status: "stale" })
      .where(
        and(
          eq(periodSnapshots.userId, userId),
          inArray(periodSnapshots.id, matchingSnapshots.map((entry) => entry.id)),
          eq(periodSnapshots.status, "current"),
        ),
      )
      .returning({ id: periodSnapshots.id });
    return changed.length;
  }

  async markAllSnapshotsStale(userId: string): Promise<number> {
    const changed = await this.database
      .update(periodSnapshots)
      .set({ status: "stale" })
      .where(and(eq(periodSnapshots.userId, userId), eq(periodSnapshots.status, "current")))
      .returning({ id: periodSnapshots.id });
    return changed.length;
  }

  private async markPeriodSnapshotsStale(userId: string, periodIds: string[]): Promise<number> {
    if (periodIds.length === 0) return 0;
    const changed = await this.database
      .update(periodSnapshots)
      .set({ status: "stale" })
      .where(
        and(
          eq(periodSnapshots.userId, userId),
          inArray(periodSnapshots.periodId, periodIds),
          eq(periodSnapshots.status, "current"),
        ),
      )
      .returning({ id: periodSnapshots.id });
    return changed.length;
  }
}

type PeriodRow = typeof periods.$inferSelect;
type SnapshotRow = typeof periodSnapshots.$inferSelect;

function toPeriod(row: PeriodRow): PeriodRecord {
  return {
    ...row,
    kind: "week",
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toSnapshot(row: SnapshotRow): PeriodSnapshot {
  if (row.schemaVersion !== PERIOD_FACTS_SCHEMA_VERSION) throw new Error(`unsupported period facts schema: ${row.schemaVersion}`);
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

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function truncate(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 300) : null;
}

function progressTitle(outcome: "completed" | "progressed" | "blocked" | "maintenance" | "note"): string {
  return { completed: "已完成", progressed: "有推进", blocked: "受阻", maintenance: "维持事务", note: "进展备注" }[outcome];
}
