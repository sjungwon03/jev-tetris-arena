import {
  matrix,
  placements,
  placementMetrics,
  placementOutcome,
  collides,
} from "../../domain/tetris";
import type {
  Move,
  MoveInput,
  Plan,
  Metrics,
  Forecast,
  DecisionRequest,
} from "../../shared/contracts";
export const INPUT_VERSION = "candidate-features-v7-guarded";
export const TETRIS_COACHING =
  "Play a 40-line sprint. Take safe singles/doubles; never stack up waiting for four lines. Keep the surface low and flat. Never roof over empty cells or build deep pits/center towers. Keep room for the next piece; leave an I well only if safe.";
export function uniquePlacements(type: MoveInput["piece"], moves: Move[]) {
  const seen = new Set();
  return moves.filter((move) => {
    const cells: number[] = [];
    matrix(type, move.rotation).forEach((row, y) =>
      row.forEach((v, x) => {
        if (v) cells.push((y + move.y) * 10 + x + move.x);
      }),
    );
    const key = cells.sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const moveKey = (m: Move) => `${m.rotation}/${m.x}/${m.y}`;
export function forecastNext(input: MoveInput, move: Move): Forecast | null {
  const next = input.next[0];
  if (!next) return null;
  const after = placementOutcome(input.board, input.piece, move).board,
    shape = matrix(next),
    x = Math.floor((10 - shape.length) / 2),
    y = next === "I" ? -1 : 0;
  if (collides(after, shape, x, y)) return { piece: next, available: false };
  let best: Forecast | null = null,
    bestValue = -Infinity;
  for (const candidate of uniquePlacements(next, placements(after, next))) {
    const f = placementMetrics(after, next, candidate);
    const value =
      f.linesCleared * 8 -
      f.aggregateHeight * 0.51 -
      f.holes * 3.5 -
      f.bumpiness * 0.22 -
      f.maxHeight * 0.3;
    if (value > bestValue) {
      bestValue = value;
      best = { piece: next, available: true, move: candidate, metrics: f };
    }
  }
  return best || { piece: next, available: false };
}
export function rankPlans(input: MoveInput, moves: Move[]): Map<string, Plan> {
  const quality = (f: Metrics) =>
    f.linesCleared * 8 -
    f.aggregateHeight * 0.51 -
    f.holes * 3.5 -
    f.bumpiness * 0.22 -
    f.maxHeight * 0.3;
  const plans = moves
    .map((move) => {
      const current = placementMetrics(input.board, input.piece, move),
        forecast = forecastNext(input, move);
      const score =
        forecast && !forecast.available
          ? -1000000
          : forecast
            ? current.linesCleared * 5 +
              quality(current) * 0.35 +
              quality(forecast.metrics) * 0.65
            : quality(current);
      return { move, current, forecast, score };
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.forecast && !a.forecast.available)) -
          Number(Boolean(b.forecast && !b.forecast.available)) ||
        a.current.holes - b.current.holes ||
        b.score - a.score,
    );
  return new Map(
    plans.map((plan, i) => [moveKey(plan.move), { ...plan, rank: i + 1 }]),
  );
}
export function decisionRequest(
  input: MoveInput,
  moves: Move[],
  forecasts?: Map<string, Plan>,
): DecisionRequest {
  forecasts ??= rankPlans(input, moves);
  let currentHoles = 0;
  for (let x = 0; x < 10; x++) {
    let covered = false;
    for (let y = 0; y < 20; y++) {
      if (input.board[y][x]) covered = true;
      else if (covered) currentHoles++;
    }
  }
  return {
    state: JSON.stringify({
      board: input.board.map((row) => row.map((v) => (v ? 1 : 0)).join("")),
      piece: input.piece,
      next: input.next,
    }),
    question:
      TETRIS_COACHING +
      " Prefer BEST-PLAN; otherwise LOWEST p rank. Reject BLOCKED-NEXT. SAFE=no new holes. clear=lines; holes=total(change); high=max height; stack=sum heights; rough=unevenness. NEXT=forecast, not guarantee. r/x/y are IDs.",
    options: moves.map((m) => {
      const f = placementMetrics(input.board, input.piece, m);
      const delta = f.holes - currentHoles;
      const plan = forecasts.get(moveKey(m))!,
        next = plan.forecast;
      const future = !next
        ? ""
        : !next.available
          ? " BLOCKED-NEXT"
          : ` NEXT holes${next.metrics.holes} high${next.metrics.maxHeight} clear${next.metrics.linesCleared}`;
      return `${plan.rank === 1 ? "BEST-PLAN " : ""}p${plan.rank} ${delta <= 0 ? "SAFE" : "ADDS-HOLES"} r${m.rotation} x${m.x} y${m.y}; clear${f.linesCleared} holes${f.holes}(${delta >= 0 ? "+" : ""}${delta}) high${f.maxHeight} stack${f.aggregateHeight} rough${f.bumpiness}${future}`;
    }),
  };
}
