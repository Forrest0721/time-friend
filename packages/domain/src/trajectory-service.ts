import { DomainError } from "./errors.js";
import type { Clock, IdGenerator } from "./primitives.js";
import {
  computePeriodFacts,
  PERIOD_FACTS_SCHEMA_VERSION,
  type PeriodFacts,
  type PeriodFactsInput,
  type WeeklyPeriod,
  weekPeriodContaining,
} from "./trajectory.js";
import type { EvidenceEntityType } from "./trajectory-review.js";

export type PeriodSnapshotStatus = "current" | "stale" | "superseded";

export interface PeriodRecord extends WeeklyPeriod {
  id: string;
  userId: string;
  createdAt: string;
}

export interface SnapshotEntityIndex {
  taskIds: string[];
  focusSessionIds: string[];
  progressEntryIds: string[];
  taskEventIds: string[];
}

export interface SnapshotEvidenceDocument {
  entityType: Exclude<EvidenceEntityType, "memory">;
  entityId: string;
  title: string;
  excerpt: string | null;
  occurredAt: string;
  taskId: string | null;
  listId: string | null;
}

export type LoadedPeriodFactsInput = Omit<PeriodFactsInput, "period" | "sourceWatermark"> & {
  evidenceDocuments: SnapshotEvidenceDocument[];
};

export interface PeriodSnapshot {
  id: string;
  userId: string;
  periodId: string;
  version: number;
  status: PeriodSnapshotStatus;
  sourceWatermark: string;
  inputHash: string;
  schemaVersion: typeof PERIOD_FACTS_SCHEMA_VERSION;
  metrics: PeriodFacts;
  entityIndex: SnapshotEntityIndex;
  createdAt: string;
}

export interface TrajectoryWeek {
  period: PeriodRecord;
  snapshots: PeriodSnapshot[];
}

export interface TrajectoryStoreTransaction {
  getUserTrajectorySettings(userId: string): Promise<{ timezone: string; agentEnabled: boolean } | null>;
  findPeriodByIdentity(userId: string, period: WeeklyPeriod): Promise<PeriodRecord | null>;
  findPeriod(userId: string, periodId: string, lock?: boolean): Promise<PeriodRecord | null>;
  insertPeriod(period: PeriodRecord): Promise<PeriodRecord>;
  listPeriods(userId: string, limit: number, beforeStartsAt?: string): Promise<PeriodRecord[]>;
  loadPeriodFactsInput(userId: string, period: PeriodRecord, sourceWatermark: string): Promise<LoadedPeriodFactsInput>;
  findSnapshotByHash(userId: string, periodId: string, inputHash: string): Promise<PeriodSnapshot | null>;
  listSnapshots(userId: string, periodId: string): Promise<PeriodSnapshot[]>;
  supersedeCurrentSnapshots(userId: string, periodId: string): Promise<void>;
  activateSnapshot(userId: string, snapshotId: string): Promise<void>;
  insertSnapshot(snapshot: PeriodSnapshot, evidenceDocuments: readonly SnapshotEvidenceDocument[]): Promise<void>;
  markSnapshotsStale(userId: string, occurredAt: string): Promise<number>;
  markSnapshotsStaleForLocalDate(userId: string, localDate: string): Promise<number>;
  markSnapshotsContainingEntity(
    userId: string,
    entityType: Exclude<EvidenceEntityType, "memory">,
    entityId: string,
  ): Promise<number>;
  markAllSnapshotsStale(userId: string): Promise<number>;
}

export interface TrajectoryStore {
  transaction<T>(work: (transaction: TrajectoryStoreTransaction) => Promise<T>): Promise<T>;
}

export class TrajectoryService {
  constructor(
    private readonly dependencies: {
      store: TrajectoryStore;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async ensureCurrentWeek(userId: string): Promise<PeriodRecord> {
    return this.ensureWeekContaining(userId, this.dependencies.clock.now());
  }

  async ensureWeekContaining(userId: string, instant: Date | string): Promise<PeriodRecord> {
    return this.dependencies.store.transaction(async (transaction) => {
      const settings = await requireResource(transaction.getUserTrajectorySettings(userId), "用户不存在");
      const definition = weekPeriodContaining(instant, settings.timezone);
      const existing = await transaction.findPeriodByIdentity(userId, definition);
      if (existing) return existing;
      const record: PeriodRecord = {
        id: this.dependencies.ids.next(),
        userId,
        ...definition,
        createdAt: this.dependencies.clock.now().toISOString(),
      };
      return transaction.insertPeriod(record);
    });
  }

  async listWeeks(userId: string, input: { limit?: number; beforeStartsAt?: string } = {}): Promise<TrajectoryWeek[]> {
    await this.ensureCurrentWeek(userId);
    return this.dependencies.store.transaction(async (transaction) => {
      const periods = await transaction.listPeriods(userId, Math.min(Math.max(input.limit ?? 20, 1), 50), input.beforeStartsAt);
      const result: TrajectoryWeek[] = [];
      for (const period of periods) {
        result.push({ period, snapshots: await transaction.listSnapshots(userId, period.id) });
      }
      return result;
    });
  }

  async getWeek(userId: string, periodId: string): Promise<TrajectoryWeek> {
    return this.dependencies.store.transaction(async (transaction) => {
      const period = await requireResource(transaction.findPeriod(userId, periodId), "周期不存在");
      return { period, snapshots: await transaction.listSnapshots(userId, period.id) };
    });
  }

  async generateSnapshot(userId: string, periodId: string): Promise<PeriodSnapshot> {
    return this.dependencies.store.transaction(async (transaction) => {
      const period = await requireResource(transaction.findPeriod(userId, periodId, true), "周期不存在");
      const now = this.dependencies.clock.now();
      const sourceWatermark = new Date(Math.min(now.getTime(), Date.parse(period.endsAt))).toISOString();
      if (Date.parse(sourceWatermark) < Date.parse(period.startsAt)) {
        throw new DomainError("INVALID_PERIOD", "尚未进入该周期，不能生成事实快照");
      }
      const raw = await transaction.loadPeriodFactsInput(userId, period, sourceWatermark);
      const { evidenceDocuments, ...factsInput } = raw;
      const result = computePeriodFacts({ period, sourceWatermark, ...factsInput });
      const existing = await transaction.findSnapshotByHash(userId, period.id, result.inputHash);
      if (existing) {
        if (existing.status !== "current") {
          await transaction.supersedeCurrentSnapshots(userId, period.id);
          await transaction.activateSnapshot(userId, existing.id);
          return { ...existing, status: "current" };
        }
        return existing;
      }
      const snapshots = await transaction.listSnapshots(userId, period.id);
      const createdAt = now.toISOString();
      const snapshot: PeriodSnapshot = {
        id: this.dependencies.ids.next(),
        userId,
        periodId: period.id,
        version: Math.max(0, ...snapshots.map((entry) => entry.version)) + 1,
        status: "current",
        sourceWatermark,
        inputHash: result.inputHash,
        schemaVersion: result.facts.schemaVersion,
        metrics: result.facts,
        entityIndex: {
          taskIds: raw.tasks.map((entry) => entry.id).sort(),
          focusSessionIds: raw.focusSessions.map((entry) => entry.id).sort(),
          progressEntryIds: raw.progressEntries.map((entry) => entry.id).sort(),
          taskEventIds: raw.taskEvents.map((entry) => entry.id).sort(),
        },
        createdAt,
      };
      await transaction.supersedeCurrentSnapshots(userId, period.id);
      await transaction.insertSnapshot(snapshot, evidenceDocuments);
      return snapshot;
    });
  }

  markSnapshotsStale(userId: string, occurredAt: string): Promise<number> {
    return this.dependencies.store.transaction((transaction) => transaction.markSnapshotsStale(userId, occurredAt));
  }

  markSnapshotsStaleForLocalDate(userId: string, localDate: string): Promise<number> {
    return this.dependencies.store.transaction((transaction) => transaction.markSnapshotsStaleForLocalDate(userId, localDate));
  }

  markSnapshotsContainingEntity(
    userId: string,
    entityType: Exclude<EvidenceEntityType, "memory">,
    entityId: string,
  ): Promise<number> {
    return this.dependencies.store.transaction((transaction) =>
      transaction.markSnapshotsContainingEntity(userId, entityType, entityId),
    );
  }

  markAllSnapshotsStale(userId: string): Promise<number> {
    return this.dependencies.store.transaction((transaction) => transaction.markAllSnapshotsStale(userId));
  }
}

async function requireResource<T>(promise: Promise<T | null>, message: string): Promise<T> {
  const resource = await promise;
  if (!resource) throw new DomainError("RESOURCE_NOT_FOUND", message);
  return resource;
}
