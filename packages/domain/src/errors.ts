export type DomainErrorCode =
  | "EMPTY_NAME"
  | "EMPTY_TITLE"
  | "INVALID_CONTENT"
  | "CONTENT_TOO_LARGE"
  | "INVALID_DATE"
  | "INVALID_TIMEZONE"
  | "INVALID_PERIOD"
  | "INVALID_RELATION"
  | "INVALID_ITEM_KIND"
  | "INVALID_TASK_TRANSITION"
  | "INVALID_FOCUS_TRANSITION"
  | "ACTIVE_FOCUS_EXISTS"
  | "AGENT_DISABLED"
  | "INBOX_IMMUTABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT"
  | "RESOURCE_NOT_FOUND"
  | "CROSS_USER_ACCESS";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertRevision(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual) {
    throw new DomainError("REVISION_CONFLICT", "资源已在其他位置更新", {
      expected,
      actual,
    });
  }
}

export function assertOwnedBy(userId: string, resourceUserId: string): void {
  if (userId !== resourceUserId) {
    throw new DomainError("CROSS_USER_ACCESS", "资源不属于当前用户");
  }
}
