export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface CommandContext {
  userId: string;
  clock: Clock;
  ids: IdGenerator;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function toIso(date: Date): string {
  return date.toISOString();
}

export function normalizeRequiredText(value: string, field: "name" | "title"): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainError(
      field === "name" ? "EMPTY_NAME" : "EMPTY_TITLE",
      field === "name" ? "名称不能为空" : "标题不能为空",
    );
  }
  return normalized;
}
import { DomainError } from "./errors.js";
