import { moveKey } from "./planner";
import type { Move, Plan, SelectionGuard } from "../../shared/contracts";
export function guardSelection(
  decision: Move,
  plans: Map<string, Plan>,
  enabled: boolean,
) {
  const selected = plans.get(moveKey(decision))!,
    best = [...plans.values()].find((p) => p.rank === 1)!;
  const tied =
    selected.current.holes === best.current.holes &&
    Boolean(selected.forecast?.available) ===
      Boolean(best.forecast?.available) &&
    Math.abs(selected.score - best.score) < 1e-8;
  const corrected = Boolean(enabled && selected.rank !== 1 && !tied),
    applied = corrected ? best : selected;
  return {
    decision: applied.move,
    modelDecision: decision,
    selectionGuard: {
      enabled,
      corrected,
      reason: corrected ? "lower_ranked_plan" : null,
      originalRank: selected.rank,
      appliedRank: applied.rank,
      originalMetrics: selected.current,
      appliedMetrics: applied.current,
    },
  };
}
