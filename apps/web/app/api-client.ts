export const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const hasConfiguredApi = apiBaseUrl.length > 0;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!hasConfiguredApi) throw new ApiError("尚未配置服务端地址", 503, "API_NOT_CONFIGURED");
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { title?: string; code?: string } | null;
    throw new ApiError(problem?.title ?? `请求失败（${response.status}）`, response.status, problem?.code ?? "REQUEST_FAILED");
  }
  if (response.status === 204) return null as T;
  return await response.json() as T;
}

export function apiMutation<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method,
    headers: { "idempotency-key": crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function agentRunEventsUrl(runId: string): string {
  return `${apiBaseUrl}/api/v1/agent-runs/${encodeURIComponent(runId)}/events`;
}
