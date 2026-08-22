import { and, desc, eq, gte, inArray, isNull, lt, SQL } from "drizzle-orm";

import {
  DomainError,
  ExecutionStore,
  ExecutionStoreTransaction,
  FocusAdjustment,
  FocusDeadlineJob,
  FocusSegment,
  FocusSession,
  ProgressEntry,
  TaskEvent,
} from "@time-friend/domain";

import { TimeFriendDatabase } from "../client.js";
import { focusAdjustments, focusSegments, focusSessions, progressEntries } from "../schema/index.js";
import { PostgresTransactionContext, TimeFriendTransaction } from "../transaction-context.js";
import { PostgresTaskStoreTransaction } from "./task-store.js";

export interface ExecutionJobScheduler {
  schedule(transaction: TimeFriendTransaction, job: FocusDeadlineJob): Promise<void>;
}

const noOpScheduler: ExecutionJobScheduler = { schedule: async () => undefined };

export class PostgresExecutionStore implements ExecutionStore {
  constructor(
    private readonly database: TimeFriendDatabase,
    private readonly transactions = new PostgresTransactionContext(),
    private readonly scheduler: ExecutionJobScheduler = noOpScheduler,
  ) {}

  transaction<T>(work: (transaction: ExecutionStoreTransaction) => Promise<T>): Promise<T> {
    return this.transactions.run(this.database, (transaction) => work(new PostgresExecutionStoreTransaction(transaction, this.scheduler)));
  }
}

export class PostgresExecutionStoreTransaction implements ExecutionStoreTransaction {
  private readonly tasks: PostgresTaskStoreTransaction;

  constructor(
    private readonly database: TimeFriendTransaction,
    private readonly scheduler: ExecutionJobScheduler = noOpScheduler,
  ) {
    this.tasks = new PostgresTaskStoreTransaction(database);
  }

  async findActiveFocusSession(userId: string): Promise<FocusSession | null> {
    const [row] = await this.database
      .select()
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          inArray(focusSessions.state, ["running", "paused", "needs_attention"]),
          isNull(focusSessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? toFocusSession(row) : null;
  }

  async lockFocusSession(userId: string, id: string): Promise<FocusSession | null> {
    const [row] = await this.database
      .select()
      .from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.id, id), isNull(focusSessions.deletedAt)))
      .for("update")
      .limit(1);
    return row ? toFocusSession(row) : null;
  }

  async listFocusSessions(input: { userId: string; taskId?: string; from?: string; to?: string }): Promise<FocusSession[]> {
    const predicates: SQL[] = [eq(focusSessions.userId, input.userId), isNull(focusSessions.deletedAt)];
    if (input.taskId !== undefined) predicates.push(eq(focusSessions.taskId, input.taskId));
    if (input.from !== undefined) predicates.push(gte(focusSessions.startedAt, new Date(input.from)));
    if (input.to !== undefined) predicates.push(lt(focusSessions.startedAt, new Date(input.to)));
    const rows = await this.database
      .select()
      .from(focusSessions)
      .where(and(...predicates))
      .orderBy(desc(focusSessions.startedAt), desc(focusSessions.id));
    return rows.map(toFocusSession);
  }

  async saveFocusSession(session: FocusSession, previousRevision: number | null): Promise<void> {
    try {
      if (previousRevision === null) {
        await this.database.insert(focusSessions).values(focusSessionToRow(session));
        return;
      }
      const updated = await this.database
        .update(focusSessions)
        .set(focusSessionToRow(session))
        .where(and(eq(focusSessions.userId, session.userId), eq(focusSessions.id, session.id), eq(focusSessions.revision, previousRevision)))
        .returning({ id: focusSessions.id });
      assertUpdated(updated, session);
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new DomainError("ACTIVE_FOCUS_EXISTS", "已有进行中的专注");
      }
      throw error;
    }
  }

  async findOpenFocusSegment(userId: string, sessionId: string): Promise<FocusSegment | null> {
    const [row] = await this.database
      .select()
      .from(focusSegments)
      .where(and(eq(focusSegments.userId, userId), eq(focusSegments.sessionId, sessionId), isNull(focusSegments.endedAt)))
      .limit(1);
    return row ? toFocusSegment(row) : null;
  }

  async insertFocusSegment(segment: FocusSegment): Promise<void> {
    await this.database.insert(focusSegments).values(focusSegmentToRow(segment));
  }

  async closeFocusSegment(segment: FocusSegment): Promise<void> {
    const updated = await this.database
      .update(focusSegments)
      .set({ endedAt: dateOrNull(segment.endedAt), closeReason: segment.closeReason })
      .where(
        and(
          eq(focusSegments.userId, segment.userId),
          eq(focusSegments.sessionId, segment.sessionId),
          eq(focusSegments.id, segment.id),
          isNull(focusSegments.endedAt),
        ),
      )
      .returning({ id: focusSegments.id });
    if (updated.length !== 1) throw new DomainError("REVISION_CONFLICT", "专注时间段已被关闭", { id: segment.id });
  }

  async insertFocusAdjustment(adjustment: FocusAdjustment): Promise<void> {
    await this.database.insert(focusAdjustments).values({
      ...adjustment,
      createdAt: new Date(adjustment.createdAt),
    });
  }

  async findProgressEntry(userId: string, id: string, lock = false): Promise<ProgressEntry | null> {
    let query = this.database
      .select()
      .from(progressEntries)
      .where(and(eq(progressEntries.userId, userId), eq(progressEntries.id, id), isNull(progressEntries.deletedAt)))
      .$dynamic();
    if (lock) query = query.for("update");
    const [row] = await query.limit(1);
    return row ? toProgressEntry(row) : null;
  }

  async listProgressEntries(input: {
    userId: string;
    taskId?: string;
    focusSessionId?: string;
    from?: string;
    to?: string;
  }): Promise<ProgressEntry[]> {
    const predicates: SQL[] = [eq(progressEntries.userId, input.userId), isNull(progressEntries.deletedAt)];
    if (input.taskId !== undefined) predicates.push(eq(progressEntries.taskId, input.taskId));
    if (input.focusSessionId !== undefined) predicates.push(eq(progressEntries.focusSessionId, input.focusSessionId));
    if (input.from !== undefined) predicates.push(gte(progressEntries.occurredAt, new Date(input.from)));
    if (input.to !== undefined) predicates.push(lt(progressEntries.occurredAt, new Date(input.to)));
    const rows = await this.database
      .select()
      .from(progressEntries)
      .where(and(...predicates))
      .orderBy(desc(progressEntries.occurredAt), desc(progressEntries.id));
    return rows.map(toProgressEntry);
  }

  async saveProgressEntry(entry: ProgressEntry, previousRevision: number | null): Promise<void> {
    if (previousRevision === null) {
      await this.database.insert(progressEntries).values(progressEntryToRow(entry));
      return;
    }
    const updated = await this.database
      .update(progressEntries)
      .set(progressEntryToRow(entry))
      .where(and(eq(progressEntries.userId, entry.userId), eq(progressEntries.id, entry.id), eq(progressEntries.revision, previousRevision)))
      .returning({ id: progressEntries.id });
    assertUpdated(updated, entry);
  }

  findItem(userId: string, id: string) {
    return this.tasks.findItem(userId, id);
  }

  saveItem(item: Parameters<PostgresTaskStoreTransaction["saveItem"]>[0], previousRevision: number | null) {
    return this.tasks.saveItem(item, previousRevision);
  }

  appendTaskEvents(events: readonly TaskEvent[]) {
    return this.tasks.appendTaskEvents(events);
  }

  scheduleFocusDeadline(job: FocusDeadlineJob): Promise<void> {
    return this.scheduler.schedule(this.database, job);
  }
}

type FocusSessionRow = typeof focusSessions.$inferSelect;
type FocusSegmentRow = typeof focusSegments.$inferSelect;
type ProgressEntryRow = typeof progressEntries.$inferSelect;

function toFocusSession(row: FocusSessionRow): FocusSession {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    endedAt: isoOrNull(row.endedAt),
    expectedEndAt: isoOrNull(row.expectedEndAt),
    deletedAt: isoOrNull(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function focusSessionToRow(session: FocusSession): typeof focusSessions.$inferInsert {
  return {
    ...session,
    startedAt: new Date(session.startedAt),
    endedAt: dateOrNull(session.endedAt),
    expectedEndAt: dateOrNull(session.expectedEndAt),
    deletedAt: dateOrNull(session.deletedAt),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  };
}

function toFocusSegment(row: FocusSegmentRow): FocusSegment {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    endedAt: isoOrNull(row.endedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function focusSegmentToRow(segment: FocusSegment): typeof focusSegments.$inferInsert {
  return {
    ...segment,
    startedAt: new Date(segment.startedAt),
    endedAt: dateOrNull(segment.endedAt),
    createdAt: new Date(segment.createdAt),
  };
}

function toProgressEntry(row: ProgressEntryRow): ProgressEntry {
  return {
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function progressEntryToRow(entry: ProgressEntry): typeof progressEntries.$inferInsert {
  return {
    ...entry,
    occurredAt: new Date(entry.occurredAt),
    recordedAt: new Date(entry.recordedAt),
    updatedAt: new Date(entry.updatedAt),
    deletedAt: dateOrNull(entry.deletedAt),
  };
}

function assertUpdated(updated: readonly { id: string }[], entity: { id: string; revision: number }): void {
  if (updated.length !== 1) {
    throw new DomainError("REVISION_CONFLICT", "资源已在其他位置更新", { id: entity.id, attemptedRevision: entity.revision });
  }
}

function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
