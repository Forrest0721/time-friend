import { DBSchema, IDBPDatabase, openDB } from "idb";

import type { ItemDto } from "@time-friend/contracts";

export interface EditorDraft {
  key: string;
  baseRevision: number;
  document: ItemDto["contentDoc"];
  updatedAt: string;
}

export interface CreateItemOutboxEntry {
  id: string;
  userId: string;
  idempotencyKey: string;
  body: {
    id: string;
    listId: string;
    groupId?: string | null;
    parentTaskId?: string | null;
    kind: "task" | "note";
    title: string;
    priority?: ItemDto["priority"];
    plannedOn?: string | null;
  };
  state: "pending" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TimeFriendClientSchema extends DBSchema {
  drafts: {
    key: string;
    value: EditorDraft;
  };
  outbox: {
    key: string;
    value: CreateItemOutboxEntry;
    indexes: { "by-user-created-at": [string, string] };
  };
}

export class ClientPersistence {
  private database: Promise<IDBPDatabase<TimeFriendClientSchema>> | null = null;

  constructor(private readonly databaseName = "time-friend-client-v1") {}

  async getDraft(key: string): Promise<EditorDraft | null> {
    return (await this.open()).get("drafts", key).then((draft) => draft ?? null);
  }

  async saveDraft(draft: EditorDraft): Promise<void> {
    await (await this.open()).put("drafts", structuredClone(draft));
  }

  async deleteDraft(key: string): Promise<void> {
    await (await this.open()).delete("drafts", key);
  }

  async enqueueCreate(entry: CreateItemOutboxEntry): Promise<void> {
    await (await this.open()).add("outbox", structuredClone(entry));
  }

  async listCreates(userId: string): Promise<CreateItemOutboxEntry[]> {
    return (await this.open()).getAllFromIndex(
      "outbox",
      "by-user-created-at",
      IDBKeyRange.bound([userId, ""], [userId, "\uffff"]),
    );
  }

  async markCreateFailed(id: string, message: string, updatedAt: string): Promise<void> {
    const database = await this.open();
    const entry = await database.get("outbox", id);
    if (!entry) return;
    await database.put("outbox", {
      ...entry,
      state: "failed",
      attempts: entry.attempts + 1,
      lastError: message.slice(0, 500),
      updatedAt,
    });
  }

  async markCreatePending(id: string, updatedAt: string): Promise<void> {
    const database = await this.open();
    const entry = await database.get("outbox", id);
    if (!entry) return;
    await database.put("outbox", { ...entry, state: "pending", lastError: null, updatedAt });
  }

  async removeCreate(id: string): Promise<void> {
    await (await this.open()).delete("outbox", id);
  }

  async destroy(): Promise<void> {
    const database = await this.open();
    database.close();
    this.database = null;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB deletion was blocked"));
    });
  }

  private open(): Promise<IDBPDatabase<TimeFriendClientSchema>> {
    this.database ??= openDB<TimeFriendClientSchema>(this.databaseName, 2, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          database.createObjectStore("drafts", { keyPath: "key" });
          database.createObjectStore("outbox", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          const outbox = transaction.objectStore("outbox");
          const existingIndexes: string[] = Array.from(outbox.indexNames);
          if (existingIndexes.includes("by-created-at")) {
            (outbox.deleteIndex as (name: string) => void)("by-created-at");
          }
          outbox.createIndex("by-user-created-at", ["userId", "createdAt"]);
        }
      },
    }).then(async (database) => {
      const transaction = database.transaction("outbox", "readwrite");
      let cursor = await transaction.store.openCursor();
      while (cursor) {
        if (!cursor.value.userId) await cursor.delete();
        cursor = await cursor.continue();
      }
      await transaction.done;
      return database;
    });
    return this.database;
  }
}

export const clientPersistence = new ClientPersistence();
