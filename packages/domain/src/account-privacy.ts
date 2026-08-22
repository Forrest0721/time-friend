import { DomainError } from "./errors.js";
import { hashCanonical } from "./trajectory.js";
import type { IdGenerator } from "./primitives.js";

export interface AccountDataExport {
  schemaVersion: "1";
  generatedAt: string;
  profile: {
    id: string;
    email: string;
    name: string;
    timezone: string;
    weekStartsOn: number;
    agentEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
  data: Record<string, unknown[]>;
}

export type AccountDeletionStatus = "queued" | "processing" | "completed" | "failed";

export interface AccountDeletionRecord {
  id: string;
  userId: string | null;
  subjectHash: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
}

export interface AccountPrivacyStore {
  exportData(userId: string, generatedAt: string): Promise<AccountDataExport | null>;
  requestDeletion(record: AccountDeletionRecord): Promise<AccountDeletionRecord | null>;
  claimDeletion(requestId: string, now: string): Promise<AccountDeletionRecord | null>;
  eraseAccount(requestId: string, now: string): Promise<AccountDeletionRecord>;
  failDeletion(requestId: string, errorCode: string, now: string): Promise<void>;
}

export class AccountPrivacyService {
  constructor(
    private readonly dependencies: {
      store: AccountPrivacyStore;
      clock: { now(): Date };
      ids: IdGenerator;
    },
  ) {}

  async exportData(userId: string): Promise<AccountDataExport> {
    const exported = await this.dependencies.store.exportData(userId, this.dependencies.clock.now().toISOString());
    if (!exported) throw new DomainError("RESOURCE_NOT_FOUND", "用户不存在");
    return exported;
  }

  async requestDeletion(userId: string): Promise<AccountDeletionRecord> {
    const requestedAt = this.dependencies.clock.now().toISOString();
    const record = await this.dependencies.store.requestDeletion({
      id: this.dependencies.ids.next(),
      userId,
      subjectHash: hashCanonical({ userId }),
      status: "queued",
      requestedAt,
      startedAt: null,
      completedAt: null,
      errorCode: null,
    });
    if (!record) throw new DomainError("RESOURCE_NOT_FOUND", "用户不存在");
    return record;
  }

  async executeDeletion(requestId: string): Promise<AccountDeletionRecord | null> {
    const now = this.dependencies.clock.now().toISOString();
    const claimed = await this.dependencies.store.claimDeletion(requestId, now);
    if (!claimed) return null;
    try {
      return await this.dependencies.store.eraseAccount(requestId, now);
    } catch (error) {
      await this.dependencies.store.failDeletion(requestId, "ACCOUNT_ERASURE_FAILED", now);
      throw error;
    }
  }
}
