import { describe, expect, it, vi } from "vitest";

import { AccountPrivacyService, type AccountDeletionRecord, type AccountPrivacyStore } from "./account-privacy.js";

const now = "2026-08-22T08:00:00.000Z";

describe("AccountPrivacyService", () => {
  it("creates a content-free deletion receipt and delegates erasure", async () => {
    const store = privacyStore();
    const service = new AccountPrivacyService({ store, clock: { now: () => new Date(now) }, ids: { next: () => "request-a" } });

    const requested = await service.requestDeletion("user-a");
    expect(requested).toMatchObject({ id: "request-a", userId: "user-a", status: "queued" });
    expect(requested.subjectHash).not.toContain("user-a");
    await expect(service.executeDeletion(requested.id)).resolves.toMatchObject({ status: "completed", userId: null });
  });

  it("records a redacted failure code when erasure fails", async () => {
    const store = privacyStore();
    vi.mocked(store.eraseAccount).mockRejectedValue(new Error("database detail must not be stored"));
    const service = new AccountPrivacyService({ store, clock: { now: () => new Date(now) }, ids: { next: () => "request-a" } });

    await expect(service.executeDeletion("request-a")).rejects.toThrow("database detail");
    expect(store.failDeletion).toHaveBeenCalledWith("request-a", "ACCOUNT_ERASURE_FAILED", now);
  });
});

function privacyStore(): AccountPrivacyStore {
  const queued: AccountDeletionRecord = {
    id: "request-a",
    userId: "user-a",
    subjectHash: "hash",
    status: "queued",
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    errorCode: null,
  };
  return {
    exportData: vi.fn(async () => null),
    requestDeletion: vi.fn(async (record) => record),
    claimDeletion: vi.fn(async (): Promise<AccountDeletionRecord> => ({ ...queued, status: "processing", startedAt: now })),
    eraseAccount: vi.fn(async (): Promise<AccountDeletionRecord> => ({ ...queued, userId: null, status: "completed", startedAt: now, completedAt: now })),
    failDeletion: vi.fn(async () => undefined),
  };
}
