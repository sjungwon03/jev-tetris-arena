/** Optional LLM adapter. Native JEV /decisions is implemented in decisions.ts. */
import { matrix, placementMetrics } from "../../domain/tetris";
import type { Move, MoveInput, PublicConfig } from "../../shared/contracts";
import { TETRIS_COACHING } from "./planner";
import { reportedModel, upstreamError } from "../http";
export function parseChatDecision(text: string, moves: Move[]): Move {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const value = JSON.parse(clean) as { rotation?: unknown; x?: unknown } | null;
  const move = moves.find(
    (m) => m.rotation === value?.rotation && m.x === value?.x,
  );
  if (!move) throw Error("illegal_move");
  return move;
}
export function chatMessages(input: MoveInput, moves: Move[]) {
  return [
    {
      role: "system",
      content:
        TETRIS_COACHING +
        " You are JEV, a Tetris decision-making agent. Play a 40-line sprint. Choose exactly one legal move supplied by the environment. Minimize holes, keep the stack low and flat, and clear lines. The board has 20 rows (top to bottom) and 10 columns (left to right); 0 is empty. x is the left edge of the piece matrix, rotation is clockwise quarter turns. Return ONLY a JSON object with integer fields rotation and x. Each legal move includes exact after-placement and line-clear metrics: linesCleared (maximize), holes, maxHeight, aggregateHeight and bumpiness (minimize). Use these metrics rather than recalculating the resulting board. Never invent a move. No markdown, explanation or reasoning.",
    },
    {
      role: "user",
      content: JSON.stringify({
        ...input,
        assist: undefined,
        pieceRotations: [0, 1, 2, 3].map((r) => matrix(input.piece, r)),
        legalMoves: moves.map((move) => ({
          ...move,
          after: placementMetrics(input.board, input.piece, move),
        })),
      }),
    },
  ];
}
interface LlmBody extends Record<string, unknown> {
  choices?: { message?: { content?: string } }[];
  output_text?: string;
  output?: { content?: { type?: string; text?: string }[] }[];
}
export async function invokeOpenAI(
  config: PublicConfig,
  input: MoveInput,
  moves: Move[],
  headers: Record<string, string>,
  fetcher: typeof fetch,
) {
  const messages = chatMessages(input, moves),
    responses = config.style === "responses";
  const payload = responses
    ? {
        model: config.model,
        instructions: messages[0].content,
        input: messages[1].content,
        max_output_tokens: 1024,
      }
    : { model: config.model, messages, max_completion_tokens: 1024 };
  const result = await fetcher(
    config.baseUrl + (responses ? "/responses" : "/chat/completions"),
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!result.ok) throw await upstreamError(result);
  const body = (await result.json()) as LlmBody;
  const text = responses
    ? body.output_text ||
      body.output
        ?.flatMap((o) => o.content || [])
        .filter((o) => o.type === "output_text")
        .map((o) => o.text)
        .join("")
    : body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw Error("invalid_model_output");
  return {
    text,
    decision: parseChatDecision(text, moves),
    modelId: reportedModel(body),
    httpStatus: result.status,
    messages,
  };
}
