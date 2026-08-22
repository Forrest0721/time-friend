import { DomainError } from "@time-friend/domain";

interface ItemCursor {
  positionKey: string;
  id: string;
}

interface EventCursor {
  occurredAt: string;
  recordedAt: string;
  id: string;
}

interface TimeCursor {
  timestamp: string;
  id: string;
}

export function paginateByPosition<T extends ItemCursor>(items: readonly T[], cursor: string | undefined, limit: number) {
  const after = cursor ? decodeCursor<ItemCursor>(cursor) : null;
  const eligible = after
    ? items.filter((item) => item.positionKey > after.positionKey || (item.positionKey === after.positionKey && item.id > after.id))
    : [...items];
  const page = eligible.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: eligible.length > page.length && last ? encodeCursor({ positionKey: last.positionKey, id: last.id }) : null,
  };
}

export function paginateEvents<T extends EventCursor>(events: readonly T[], cursor: string | undefined, limit: number) {
  const after = cursor ? decodeCursor<EventCursor>(cursor) : null;
  const eligible = after ? events.filter((event) => compareEventCursor(event, after) > 0) : [...events];
  const page = eligible.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      eligible.length > page.length && last
        ? encodeCursor({ occurredAt: last.occurredAt, recordedAt: last.recordedAt, id: last.id })
        : null,
  };
}

export function paginateByTimeDescending<T>(
  items: readonly T[],
  timestampOf: (item: T) => string,
  idOf: (item: T) => string,
  cursor: string | undefined,
  limit: number,
) {
  const before = cursor ? decodeCursor<TimeCursor>(cursor) : null;
  const eligible = before
    ? items.filter((item) => {
        const timestamp = timestampOf(item);
        return timestamp < before.timestamp || (timestamp === before.timestamp && idOf(item) < before.id);
      })
    : [...items];
  const page = eligible.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      eligible.length > page.length && last ? encodeCursor({ timestamp: timestampOf(last), id: idOf(last) }) : null,
  };
}

function compareEventCursor(left: EventCursor, right: EventCursor): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id);
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor<T>(cursor: string): T {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor payload");
    return parsed as T;
  } catch {
    throw new DomainError("INVALID_RELATION", "分页游标不合法");
  }
}
