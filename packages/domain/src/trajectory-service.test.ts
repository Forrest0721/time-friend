import { describe, expect, it } from "vitest";

import { TrajectoryService, type PeriodRecord, type PeriodSnapshot, type TrajectoryStoreTransaction } from "./trajectory-service.js";

describe("TrajectoryService", () => {
  it("creates a user-local period and reuses an identical immutable snapshot", async () => {
    const store = new MemoryStore();
    const service = createService(store);
    const period = await service.ensureCurrentWeek("user-a");
    const first = await service.generateSnapshot("user-a", period.id);
    const second = await service.generateSnapshot("user-a", period.id);

    expect(period).toMatchObject({ localStartDate: "2026-08-17", timezone: "Asia/Shanghai" });
    expect(second.id).toBe(first.id);
    expect(store.snapshots).toHaveLength(1);
  });

  it("creates a new version and supersedes the prior current snapshot when source input changes", async () => {
    const store = new MemoryStore();
    const service = createService(store);
    const period = await service.ensureCurrentWeek("user-a");
    const first = await service.generateSnapshot("user-a", period.id);
    store.progress.push({
      id: "progress-1",
      taskId: null,
      focusSessionId: null,
      outcome: "progressed",
      note: null,
      nextStep: null,
      occurredAt: "2026-08-20T08:00:00.000Z",
    });
    const second = await service.generateSnapshot("user-a", period.id);

    expect(second).toMatchObject({ version: 2, status: "current" });
    expect(store.snapshots.find((entry) => entry.id === first.id)?.status).toBe("superseded");
  });

  it("keeps tenant-scoped periods private", async () => {
    const service = createService(new MemoryStore());
    const period = await service.ensureCurrentWeek("user-a");
    await expect(service.getWeek("user-b", period.id)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

function createService(store: MemoryStore): TrajectoryService {
  let sequence = 0;
  return new TrajectoryService({
    store: { transaction: async (work) => work(store) },
    clock: { now: () => new Date("2026-08-22T08:00:00.000Z") },
    ids: { next: () => `00000000-0000-7000-8000-${String(++sequence).padStart(12, "0")}` },
  });
}

class MemoryStore implements TrajectoryStoreTransaction {
  periods: PeriodRecord[] = [];
  snapshots: PeriodSnapshot[] = [];
  progress: Array<{
    id: string;
    taskId: string | null;
    focusSessionId: string | null;
    outcome: "progressed";
    note: string | null;
    nextStep: string | null;
    occurredAt: string;
  }> = [];

  async getUserTrajectorySettings(userId: string) {
    return userId === "user-a" || userId === "user-b" ? { timezone: "Asia/Shanghai", agentEnabled: true } : null;
  }

  async findPeriodByIdentity(userId: string, period: { startsAt: string; timezone: string }) {
    return this.periods.find((entry) => entry.userId === userId && entry.startsAt === period.startsAt && entry.timezone === period.timezone) ?? null;
  }

  async findPeriod(userId: string, periodId: string) {
    return this.periods.find((entry) => entry.userId === userId && entry.id === periodId) ?? null;
  }

  async insertPeriod(period: PeriodRecord) {
    this.periods.push(period);
    return period;
  }

  async listPeriods(userId: string, limit: number, beforeStartsAt?: string) {
    return this.periods
      .filter((entry) => entry.userId === userId && (beforeStartsAt === undefined || entry.startsAt < beforeStartsAt))
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
      .slice(0, limit);
  }

  async loadPeriodFactsInput() {
    return { lists: [], tasks: [], focusSessions: [], focusSegments: [], progressEntries: this.progress, taskEvents: [], evidenceDocuments: [] };
  }

  async findSnapshotByHash(userId: string, periodId: string, inputHash: string) {
    return this.snapshots.find((entry) => entry.userId === userId && entry.periodId === periodId && entry.inputHash === inputHash) ?? null;
  }

  async listSnapshots(userId: string, periodId: string) {
    return this.snapshots.filter((entry) => entry.userId === userId && entry.periodId === periodId).sort((left, right) => right.version - left.version);
  }

  async supersedeCurrentSnapshots(userId: string, periodId: string) {
    for (const snapshot of this.snapshots) {
      if (snapshot.userId === userId && snapshot.periodId === periodId && snapshot.status === "current") snapshot.status = "superseded";
    }
  }

  async activateSnapshot(userId: string, snapshotId: string) {
    const snapshot = this.snapshots.find((entry) => entry.userId === userId && entry.id === snapshotId);
    if (snapshot) snapshot.status = "current";
  }

  async insertSnapshot(snapshot: PeriodSnapshot) {
    this.snapshots.push(snapshot);
  }

  async markSnapshotsStale(userId: string, occurredAt: string) {
    let count = 0;
    for (const period of this.periods.filter((entry) => entry.userId === userId && entry.startsAt <= occurredAt && entry.endsAt > occurredAt)) {
      for (const snapshot of this.snapshots.filter((entry) => entry.periodId === period.id && entry.status === "current")) {
        snapshot.status = "stale";
        count += 1;
      }
    }
    return count;
  }

  async markSnapshotsStaleForLocalDate(userId: string, localDate: string) {
    let count = 0;
    for (const period of this.periods.filter(
      (entry) => entry.userId === userId && entry.localStartDate <= localDate && entry.localEndDate >= localDate,
    )) {
      for (const snapshot of this.snapshots.filter((entry) => entry.periodId === period.id && entry.status === "current")) {
        snapshot.status = "stale";
        count += 1;
      }
    }
    return count;
  }

  async markSnapshotsContainingEntity() {
    return 0;
  }

  async markAllSnapshotsStale(userId: string) {
    let count = 0;
    for (const snapshot of this.snapshots.filter((entry) => entry.userId === userId && entry.status === "current")) {
      snapshot.status = "stale";
      count += 1;
    }
    return count;
  }
}
