import { AsyncLocalStorage } from "node:async_hooks";

import { TimeFriendDatabase } from "./client.js";

export type TimeFriendTransaction = Parameters<Parameters<TimeFriendDatabase["transaction"]>[0]>[0];

export class PostgresTransactionContext {
  private readonly storage = new AsyncLocalStorage<TimeFriendTransaction>();

  current(): TimeFriendTransaction | undefined {
    return this.storage.getStore();
  }

  async run<T>(database: TimeFriendDatabase, work: (transaction: TimeFriendTransaction) => Promise<T>): Promise<T> {
    const current = this.current();
    if (current) return work(current);
    return database.transaction((transaction) => this.storage.run(transaction, () => work(transaction)));
  }
}
