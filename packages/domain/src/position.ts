import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import { DomainError } from "./errors.js";

export function positionAfter(existing: readonly string[]): string {
  const last = [...existing].sort().at(-1) ?? null;
  return generateKeyBetween(last, null);
}

export function positionBetween(previous: string | null, next: string | null): string {
  if (previous !== null && next !== null && previous >= next) {
    throw new DomainError("INVALID_RELATION", "排序边界不合法", { previous, next });
  }
  return generateKeyBetween(previous, next);
}

export function rebalancePositions(ids: readonly string[]): ReadonlyMap<string, string> {
  if (new Set(ids).size !== ids.length) {
    throw new DomainError("INVALID_RELATION", "排序列表包含重复 ID");
  }
  const keys = generateNKeysBetween(null, null, ids.length);
  return new Map(ids.map((id, index) => [id, keys[index]!]));
}
