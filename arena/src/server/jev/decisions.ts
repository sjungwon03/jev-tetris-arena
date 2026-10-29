import {
  uniquePlacements,
  rankPlans,
  decisionRequest,
  moveKey,
} from "./planner";
import { guardSelection } from "./selectionGuard";
import { errorCode, upstreamError, reportedModel } from "../http";
import { placementMetrics } from "../../domain/tetris";
import type {
  Move,
  MoveInput,
  Round,
  DecisionResponse,
  Candidate,
} from "../../shared/contracts";
type Emit = (event: string, fields?: Record<string, unknown>) => void;
export interface JevResult {
  decision: Move;
  modelDecision?: Move;
  selectionGuard?: import("../../shared/contracts").SelectionGuard;
  forced?: boolean;
  forecast: import("../../shared/contracts").Forecast | null;
  plan: { rank: number; score: number };
  confidence?: number;
  candidates: Candidate[];
  rounds: Round[];
  upstreamCallCount: number;
  consideredMoveCount?: number;
  legalMoveCount: number;
}
export async function runJev(
  input: MoveInput,
  moves: Move[],
  endpoint: string,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  emit: Emit = () => {},
  { candidateLimit = 4, guardEnabled = false } = {},
): Promise<JevResult> {
  const legal = uniquePlacements(input.piece, moves),
    rounds: Round[] = [],
    signal = AbortSignal.timeout(20000);
  let callCount = 0;
  const forecastStarted = performance.now(),
    forecasts = rankPlans(input, legal);
  emit("jev.lookahead.prepared", {
    candidateCount: legal.length,
    durationMs: Math.round(performance.now() - forecastStarted),
    nextPiece: input.next[0],
  });
  const considered =
    candidateLimit > 0
      ? [...legal]
          .sort(
            (a, b) =>
              forecasts.get(moveKey(a))!.rank - forecasts.get(moveKey(b))!.rank,
          )
          .slice(0, candidateLimit)
      : legal;
  emit("jev.candidates.shortlisted", {
    legalMoveCount: legal.length,
    consideredMoveCount: considered.length,
    method: "two-piece-heuristic",
    candidates: considered.map((move) => ({
      move,
      rank: forecasts.get(moveKey(move))!.rank,
      score: forecasts.get(moveKey(move))!.score,
    })),
  });
  const probability = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
  async function round(candidates: Move[], phase: string) {
    const request = decisionRequest(input, candidates, forecasts),
      started = performance.now();
    let httpStatus, headersMs, decodeMs;
    callCount++;
    emit("jev.call.started", {
      phase,
      endpoint,
      optionCount: candidates.length,
      requestBytes: new TextEncoder().encode(JSON.stringify(request)).length,
      request,
    });
    try {
      const upstream = await fetcher(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal,
      });
      httpStatus = upstream.status;
      headersMs = Math.round(performance.now() - started);
      if (!upstream.ok) throw await upstreamError(upstream);
      const decodeStarted = performance.now(),
        body = await upstream.json();
      decodeMs = Math.round(performance.now() - decodeStarted);
      const decision = parseJevDecision(body, request.options, candidates);
      const confidence = probability(body.confidence)
        ? body.confidence
        : undefined;
      const response = {
        model_id: reportedModel(body),
        prediction: body.prediction,
        prediction_index: body.prediction_index,
        confidence,
        probabilities: Object.fromEntries(
          request.options
            .filter((option) => probability(body.probabilities?.[option]))
            .map((option) => [option, body.probabilities[option]]),
        ),
      };
      const timing = {
        durationMs: Math.round(performance.now() - started),
        headersMs,
        decodeMs,
        httpStatus,
      };
      rounds.push({ phase, request, response, timing });
      emit("jev.call.completed", {
        phase,
        optionCount: candidates.length,
        ...timing,
        selected: decision,
        selectedMetrics: placementMetrics(input.board, input.piece, decision),
        reportedModelId: reportedModel(body),
        confidence,
        response,
      });
      return {
        decision,
        confidence,
        candidates: candidates
          .map((m, i) => ({
            ...m,
            probability: response.probabilities[request.options[i]],
          }))
          .filter((m) => probability(m.probability))
          .sort((a, b) => b.probability - a.probability),
      };
    } catch (caught) {
      const error = caught as Error & { code?: string; tokenUsage?: unknown };
      emit("jev.call.failed", {
        phase,
        optionCount: candidates.length,
        httpStatus,
        headersMs,
        decodeMs,
        durationMs: Math.round(performance.now() - started),
        error: errorCode(error),
        tokenUsage: error.tokenUsage,
      });
      if (error.code === "input_token_limit" && candidates.length > 2) {
        emit("jev.call.repartitioned", {
          phase,
          optionCount: candidates.length,
          reason: "input_token_limit",
          tokenUsage: error.tokenUsage,
        });
        const groups = [
          candidates.filter((_, i) => i % 2 === 0),
          candidates.filter((_, i) => i % 2 === 1),
        ];
        const results = await Promise.allSettled(
          groups.map((group, i) =>
            group.length === 1
              ? Promise.resolve({ decision: group[0] })
              : round(group, phase + "/분할" + (i + 1)),
          ),
        );
        const failed = results.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
        return round(
          results.map((r) => {
            if (r.status === "rejected") throw r.reason;
            return r.value.decision;
          }),
          phase + "/재선택",
        );
      }
      throw error;
    }
  }
  if (considered.length === 1)
    return {
      decision: considered[0],
      forced: true,
      forecast: forecasts.get(moveKey(legal[0]))!.forecast,
      plan: { rank: 1, score: forecasts.get(moveKey(legal[0]))!.score },
      rounds: [],
      upstreamCallCount: 0,
      candidates: [],
      legalMoveCount: 1,
    };
  let finalists = considered;
  if (considered.length > 20) {
    const groupCount = Math.ceil(considered.length / 20),
      groups: Move[][] = Array.from({ length: groupCount }, () => []);
    considered.forEach((m, i) => groups[i % groupCount].push(m));
    const results = await Promise.allSettled(
      groups.map((group, i) => round(group, "예선 " + (i + 1))),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    const winners = results.map((r) => {
      if (r.status === "rejected") throw r.reason;
      return r.value;
    });
    finalists = winners.map((w) => w.decision);
  }
  const result = await round(
    finalists,
    considered.length > 20 ? "최종 선택" : "선택",
  );
  const guarded = guardSelection(result.decision, forecasts, guardEnabled);
  if (guarded.selectionGuard.corrected)
    emit("jev.selection.corrected", {
      modelDecision: guarded.modelDecision,
      appliedDecision: guarded.decision,
      selectionGuard: guarded.selectionGuard,
    });
  return {
    ...result,
    ...guarded,
    forecast: forecasts.get(moveKey(guarded.decision))!.forecast,
    plan: {
      rank: forecasts.get(moveKey(guarded.decision))!.rank,
      score: forecasts.get(moveKey(guarded.decision))!.score,
    },
    rounds,
    upstreamCallCount: callCount,
    consideredMoveCount: considered.length,
    legalMoveCount: legal.length,
  };
}
export function parseJevDecision(
  body: { prediction?: unknown; prediction_index?: unknown } | null,
  options: string[],
  moves: Move[],
) {
  const index = options.indexOf(
    typeof body?.prediction === "string" ? body.prediction : "",
  );
  if (
    index < 0 ||
    (body?.prediction_index !== undefined && body?.prediction_index !== index)
  )
    throw Error("illegal_move");
  return moves[index];
}
