import { placements, SHAPES, matrix, placementMetrics } from "../domain/tetris";
import { INPUT_VERSION, TETRIS_COACHING } from "./jev/planner";
import { chatMessages, invokeOpenAI } from "./jev/openai";
import { runJev } from "./jev/decisions";
import {
  json,
  modelId,
  reportedModel,
  errorCode,
  upstreamError,
  telemetry,
} from "./http";
import type {
  Move,
  MoveInput,
  PublicConfig,
  ApiStyle,
  ModelIdentity,
} from "../shared/contracts";
export interface ServerEnv {
  JEV_API_STYLE?: string;
  JEV_BASE_URL?: string;
  JEV_MODEL?: string;
  JEV_CANDIDATE_LIMIT?: string;
  JEV_UPSTREAM_MODEL_ID?: string;
  JEV_API_KEY?: string;
}
export function config(env: ServerEnv): PublicConfig {
  const style: ApiStyle =
    env.JEV_API_STYLE === "decisions"
      ? "decisions"
      : env.JEV_API_STYLE === "responses"
        ? "responses"
        : "chat";
  const decisions = style === "decisions";
  const baseUrl = (
    env.JEV_BASE_URL ||
    (decisions ? "https://jev.sanhouse.kr/v1" : "https://llm.sanhouse.kr/v1")
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    model: env.JEV_MODEL || (decisions ? "JEV" : ""),
    candidateLimit: decisions
      ? env.JEV_CANDIDATE_LIMIT === "0"
        ? 0
        : Math.max(2, Math.min(20, Number(env.JEV_CANDIDATE_LIMIT) || 4))
      : 0,
    style,
    inputVersion: decisions ? INPUT_VERSION : "llm-harness-v2-coaching",
    configuredModelId: modelId(env.JEV_UPSTREAM_MODEL_ID),
    configured: decisions || Boolean(env.JEV_MODEL),
  };
}
function validInput(input: unknown): input is MoveInput {
  if (!input || typeof input !== "object") return false;
  const value = input as MoveInput;
  return (
    value &&
    Object.hasOwn(SHAPES, value.piece) &&
    Array.isArray(value.board) &&
    value.board.length === 20 &&
    value.board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 10 &&
        row.every(
          (v) => v === 0 || (typeof v === "string" && Object.hasOwn(SHAPES, v)),
        ),
    ) &&
    Array.isArray(value.next) &&
    value.next.length <= 5 &&
    value.next.every(
      (v) => typeof v === "string" && Object.hasOwn(SHAPES, v),
    ) &&
    (value.assist === undefined || typeof value.assist === "boolean")
  );
}
export async function api(
  request: Request,
  env: ServerEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const path = new URL(request.url).pathname,
    c = config(env);
  if (path === "/api/config" && request.method === "GET") return json(c);
  if (path === "/api/health" && request.method === "GET") {
    if (!c.configured)
      return json(
        { ok: false, error: "JEV_MODEL 환경변수를 설정해 주세요." },
        503,
      );
    if (c.style === "decisions") {
      const probe = new Request(new URL("/api/move", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board: Array.from({ length: 20 }, () => Array(10).fill(0)),
          piece: "T",
          next: ["I", "O"],
        }),
      });
      const result = await api(probe, env, fetcher),
        body = await result.json();
      return json(
        {
          ok: result.ok,
          model: c.model,
          latencyMs: body.trace?.latencyMs,
          error: body.error,
        },
        result.status,
      );
    }
    try {
      const r = await fetcher(c.baseUrl + "/models", {
        headers: env.JEV_API_KEY
          ? { Authorization: "Bearer " + env.JEV_API_KEY }
          : {},
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok)
        return json(
          { ok: false, error: "공급자 인증 또는 연결 오류 (" + r.status + ")" },
          502,
        );
      const body = await r.json(),
        found =
          Array.isArray(body.data) &&
          body.data.some((m: { id: string }) => m.id === c.model);
      return json(
        {
          ok: found,
          model: c.model,
          error: found
            ? undefined
            : "공급자의 모델 목록에서 설정한 모델 ID를 찾지 못했어요.",
        },
        found ? 200 : 502,
      );
    } catch {
      return json({ ok: false, error: "모델 공급자에 연결할 수 없어요." }, 502);
    }
  }
  if (path !== "/api/move") return json({ error: "Not found" }, 404);
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Origin not allowed" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return json({ error: "JSON required" }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > 16000)
    return json({ error: "Request too large" }, 413);
  if (!c.configured)
    return json({ error: "JEV_MODEL이 설정되지 않았어요." }, 503);
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 16000) return json({ error: "Request too large" }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!validInput(input)) return json({ error: "Invalid board" }, 400);
  const log = telemetry(request, c),
    prepareStarted = performance.now();
  const moves = placements(input.board, input.piece);
  const prepareMs = Math.round(performance.now() - prepareStarted);
  log.emit("turn.started", {
    piece: input.piece,
    next: input.next,
    board: input.board,
    legalMoveCount: moves.length,
    prepareMs,
  });
  if (!moves.length) {
    log.emit("turn.failed", {
      error: "no_legal_moves",
      durationMs: log.elapsed(),
    });
    return json(
      {
        error: "No legal moves",
        trace: { requestId: log.requestId, events: log.events },
      },
      422,
    );
  }
  const messages = chatMessages(input, moves);
  const headers = {
    "Content-Type": "application/json",
    ...(env.JEV_API_KEY ? { Authorization: "Bearer " + env.JEV_API_KEY } : {}),
  };
  const jev = c.style === "decisions";
  const endpoint =
    c.baseUrl +
    (jev
      ? "/decisions"
      : c.style === "responses"
        ? "/responses"
        : "/chat/completions");
  const started = Date.now();
  try {
    let decision: Move,
      text: string,
      confidence: number | undefined,
      candidates: import("../shared/contracts").Candidate[] | undefined,
      jevResult: Awaited<ReturnType<typeof runJev>> | undefined,
      chatReportedModel: string | null = null;
    if (jev) {
      jevResult = await runJev(
        input,
        moves,
        endpoint,
        headers,
        fetcher,
        log.emit,
        {
          candidateLimit: c.candidateLimit,
          guardEnabled: input.assist === true,
        },
      );
      ({ decision, confidence, candidates } = jevResult);
      text = JSON.stringify(
        jevResult.forced
          ? { forced: true, note: "유일한 배치 · 모델 호출 없음" }
          : jevResult.rounds.map((r) => ({ phase: r.phase, ...r.response })),
        null,
        2,
      );
    } else {
      log.emit("model.call.started", {
        endpoint,
        optionCount: moves.length,
        messages,
      });
      const callStarted = performance.now();
      const result = await invokeOpenAI(c, input, moves, headers, fetcher);
      text = result.text;
      decision = result.decision;
      chatReportedModel = result.modelId;
      log.emit("model.call.completed", {
        durationMs: Math.round(performance.now() - callStarted),
        httpStatus: result.httpStatus,
        selected: decision,
        reportedModelId: chatReportedModel,
      });
    }
    const modelIdentity: ModelIdentity = {
      source: "unreported",
      displayName: c.model,
      configuredModelId: c.configuredModelId,
      reportedModelIds: [
        ...new Set(
          (
            jevResult?.rounds.map((r) => r.response.model_id) || [
              chatReportedModel,
            ]
          ).filter((id): id is string => typeof id === "string"),
        ),
      ],
    };
    modelIdentity.source = modelIdentity.reportedModelIds.length
      ? "api_response"
      : c.configuredModelId
        ? "operator_configuration"
        : "unreported";
    const selectedMetrics = placementMetrics(
      input.board,
      input.piece,
      decision,
    );
    log.emit("turn.completed", {
      endpoint,
      durationMs: log.elapsed(),
      upstreamCallCount: jevResult?.upstreamCallCount ?? 1,
      uniqueMoveCount: jevResult?.legalMoveCount ?? moves.length,
      modelDecision: jevResult?.modelDecision,
      selectionGuard: jevResult?.selectionGuard,
      selected: decision,
      selectedMetrics,
      modelIdentity,
      confidence,
      forced: jevResult?.forced || false,
    });
    return json({
      ...decision,
      model: c.model,
      confidence,
      candidates,
      forced: jevResult?.forced,
      trace: {
        modelDecision: jevResult?.modelDecision,
        selectionGuard: jevResult?.selectionGuard,
        consideredMoveCount: jevResult?.consideredMoveCount,
        plan: jevResult?.plan,
        forecast: jevResult?.forecast,
        modelIdentity,
        inputVersion: c.inputVersion,
        selectedMetrics,
        requestId: log.requestId,
        events: log.events,
        prepareMs,
        protocol: c.style,
        endpoint,
        request: jev
          ? jevResult?.rounds.map((r) => ({ phase: r.phase, ...r.request }))
          : undefined,
        messages: jev ? undefined : messages,
        response: text,
        latencyMs: Date.now() - started,
        legalMoveCount: jevResult?.legalMoveCount ?? moves.length,
      },
    });
  } catch (caught) {
    const e = caught as Error & {
      code?: string;
      upstreamStatus?: number;
      tokenUsage?: unknown;
    };
    log.emit("turn.failed", {
      endpoint,
      error: errorCode(e),
      upstreamStatus: e.upstreamStatus,
      tokenUsage: e.tokenUsage,
      durationMs: log.elapsed(),
    });
    return json(
      {
        errorCode: errorCode(e),
        upstreamStatus: e.upstreamStatus,
        tokenUsage: e.tokenUsage,
        trace: {
          requestId: log.requestId,
          events: log.events,
          endpoint,
          inputVersion: c.inputVersion,
          latencyMs: log.elapsed(),
        },
        error:
          e.code === "input_token_limit"
            ? "JEV 입력 토큰 한도를 초과했어요."
            : e.name === "TimeoutError"
              ? "모델 응답 시간이 초과됐어요."
              : e.message === "illegal_move"
                ? "모델이 불가능한 배치를 선택했어요."
                : /^upstream_\d+$/.test(e.message)
                  ? "모델 공급자 응답 오류 (" + e.message.slice(9) + ")"
                  : "모델 연결 또는 응답 형식을 확인해 주세요.",
      },
      502,
    );
  }
}
