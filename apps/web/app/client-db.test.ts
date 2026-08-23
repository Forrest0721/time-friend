import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { ClientPersistence } from "./client-db";

const stores: ClientPersistence[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.destroy()));
});

describe("client persistence", () => {
  it("persists editor drafts with their base revision", async () => {
    const store = createStore();
    await store.saveDraft({
      key: "item:1",
      baseRevision: 3,
      document: { type: "doc", schemaVersion: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "未保存" }] }] },
      updatedAt: "2026-08-23T00:00:00.000Z",
    });

    await expect(store.getDraft("item:1")).resolves.toMatchObject({ baseRevision: 3 });
    await store.deleteDraft("item:1");
    await expect(store.getDraft("item:1")).resolves.toBeNull();
  });

  it("orders create retries and retains a safe failure reason", async () => {
    const store = createStore();
    await store.enqueueCreate(entry("second", "2026-08-23T00:00:02.000Z"));
    await store.enqueueCreate(entry("first", "2026-08-23T00:00:01.000Z"));
    await store.markCreateFailed("first", "network unavailable", "2026-08-23T00:00:03.000Z");

    const queued = await store.listCreates("user-a");
    expect(queued.map((item) => item.id)).toEqual(["first", "second"]);
    expect(queued[0]).toMatchObject({ state: "failed", attempts: 1, lastError: "network unavailable" });
    await store.markCreatePending("first", "2026-08-23T00:00:04.000Z");
    await store.removeCreate("second");
    await expect(store.listCreates("user-a")).resolves.toEqual([expect.objectContaining({ id: "first", state: "pending" })]);
  });

  it("never exposes one account's durable outbox to another account", async () => {
    const store = createStore();
    await store.enqueueCreate(entry("first", "2026-08-23T00:00:01.000Z", "user-a"));
    await store.enqueueCreate(entry("second", "2026-08-23T00:00:02.000Z", "user-b"));

    await expect(store.listCreates("user-a")).resolves.toEqual([expect.objectContaining({ id: "first" })]);
    await expect(store.listCreates("user-b")).resolves.toEqual([expect.objectContaining({ id: "second" })]);
  });
});

function createStore(): ClientPersistence {
  const store = new ClientPersistence(`time-friend-test-${crypto.randomUUID()}`);
  stores.push(store);
  return store;
}

function entry(id: string, createdAt: string, userId = "user-a") {
  return {
    id,
    userId,
    idempotencyKey: `key-${id}-12345678`,
    body: { id: crypto.randomUUID(), listId: crypto.randomUUID(), kind: "task" as const, title: id },
    state: "pending" as const,
    attempts: 0,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
  };
}
