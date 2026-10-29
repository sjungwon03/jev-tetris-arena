import type { PublicConfig, PerformanceEvent } from "../shared/contracts";
export class UpstreamError extends Error {
  upstreamStatus: number;
  code?: string;
  tokenUsage?: { branch: number; state: number; limit: number };
  constructor(status: number) {
    super("upstream_" + status);
    this.upstreamStatus = status;
  }
}
export const modelId = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : null;
export const reportedModel = (body: Record<string, unknown>) =>
  modelId(body?.model_id) || modelId(body?.model);
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function errorCode(error: unknown) {
  const e = error as {
    code?: string | number;
    name?: string;
    message?: string;
  };
  return (
    e?.code ||
    (e?.name === "TimeoutError"
      ? "timeout"
      : e?.name === "AbortError"
        ? "aborted"
        : /^upstream_\d+$/.test(e?.message || "")
          ? e.message
          : e?.message === "illegal_move"
            ? "illegal_move"
            : "invalid_response_or_network")
  );
}
export async function upstreamError(response: Response) {
  const error = new UpstreamError(response.status);
  error.upstreamStatus = response.status;
  if (response.status === 400) {
    try {
      const raw = await response.text(),
        body = raw.length <= 8000 ? JSON.parse(raw) : null;
      const match =
        typeof body?.error === "string" &&
        body.error.match(
          /^branch too long: (\d+) tokens with a (\d+)-token state \(row limit (\d+)\)$/,
        );
      if (match) {
        error.code = "input_token_limit";
        error.tokenUsage = {
          branch: Number(match[1]),
          state: Number(match[2]),
          limit: Number(match[3]),
        };
      }
    } catch {}
  }
  return error;
}
export function telemetry(request: Request, c: PublicConfig) {
  const safe = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
      ? value
      : undefined;
  const requestId =
    safe(request.headers.get("X-JEV-Request-ID")) || crypto.randomUUID();
  const sessionId = safe(request.headers.get("X-JEV-Session-ID"));
  const rawTurn = request.headers.get("X-JEV-Turn"),
    turn = rawTurn && /^\d{1,6}$/.test(rawTurn) ? Number(rawTurn) : undefined;
  const started = performance.now(),
    events: PerformanceEvent[] = [];
  const emit = (event: string, fields: Record<string, unknown> = {}) => {
    const data = {
      event,
      requestId,
      sessionId,
      turn,
      protocol: c.style,
      inputVersion: c.inputVersion,
      configuredModelId: c.configuredModelId,
      timestamp: new Date().toISOString(),
      offsetMs: Math.round(performance.now() - started),
      ...fields,
    };
    events.push(data);
    console.log(JSON.stringify({ source: "jev-performance", ...data }));
  };
  return {
    requestId,
    events,
    emit,
    elapsed: () => Math.round(performance.now() - started),
  };
}
