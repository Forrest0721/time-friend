import { describe, expect, it, vi } from "vitest";

import { TaskService, TaskStoreTransaction } from "./task-service.js";

describe("TaskService", () => {
  it("serializes bootstrap reads within a single database transaction", async () => {
    let running = 0;
    let maximumConcurrency = 0;
    const read = async <T>(value: T): Promise<T> => {
      running += 1;
      maximumConcurrency = Math.max(maximumConcurrency, running);
      await Promise.resolve();
      running -= 1;
      return value;
    };
    const transaction = {
      listFolders: vi.fn(() => read([])),
      findFolder: vi.fn(),
      saveFolder: vi.fn(),
      listTaskLists: vi.fn(() => read([])),
      findTaskList: vi.fn(),
      saveTaskList: vi.fn(),
      listTaskGroups: vi.fn(() => read([])),
      findTaskGroup: vi.fn(),
      saveTaskGroup: vi.fn(),
      listItems: vi.fn(() => read([])),
      findItem: vi.fn(),
      saveItem: vi.fn(),
      saveMovedTaskTree: vi.fn(),
      appendTaskEvents: vi.fn(),
      listTaskEvents: vi.fn(),
    } satisfies TaskStoreTransaction;
    const service = new TaskService({
      store: { transaction: (work) => work(transaction) },
      clock: { now: () => new Date("2026-08-22T00:00:00.000Z") },
      ids: { next: () => "00000000-0000-7000-8000-000000000001" },
    });

    await expect(service.getTaskData("user-1")).resolves.toEqual({ folders: [], lists: [], groups: [], items: [] });
    expect(maximumConcurrency).toBe(1);
  });
});
