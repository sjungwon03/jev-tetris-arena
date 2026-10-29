import type {
  ApiFailure,
  HealthResponse,
  MoveInput,
  MoveResponse,
  PublicConfig,
} from "../shared/contracts";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: ApiFailure = { error: message },
  ) {
    super(message);
  }
}
async function read<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      "게임 API가 JSON 응답을 반환하지 않았어요.",
      response.status,
    );
  }
  if (!response.ok) {
    const error = body as ApiFailure;
    throw new ApiError(error.error || "요청 실패", response.status, error);
  }
  return body as T;
}
/** Credentials never pass through this browser client. Only the same-origin proxy is called. */
export const modelApi = {
  config: () => fetch("/api/config").then(read<PublicConfig>),
  health: () => fetch("/api/health").then(read<HealthResponse>),
  move: (
    input: MoveInput,
    context: { requestId: string; sessionId: string; turn: number },
    signal: AbortSignal,
  ) =>
    fetch("/api/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-JEV-Request-ID": context.requestId,
        "X-JEV-Session-ID": context.sessionId,
        "X-JEV-Turn": String(context.turn),
      },
      body: JSON.stringify(input),
      signal,
    }).then(read<MoveResponse>),
};
export type ModelApi = typeof modelApi;
