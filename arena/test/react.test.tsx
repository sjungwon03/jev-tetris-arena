import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/client/App";
import { BattleController } from "../src/client/game/BattleController";
import { JevMonitor } from "../src/client/components/JevMonitor";
import { placements } from "../src/domain/tetris";
test("React renders both boards, controls, model monitor and log export", () => {
  const controller = new BattleController();
  const html = renderToStaticMarkup(<App controller={controller} />);
  for (const text of [
    "플레이어 테트리스 보드",
    "AI 테트리스 보드",
    "실력 보정",
    "JSON 로그 다운로드",
    "MODEL EXCHANGE",
    "배틀 시작",
  ])
    assert.ok(html.includes(text));
  controller.dispose();
});
test("React monitor shows original model choice and correction without changing raw response", () => {
  const c = new BattleController(),
    state = c.getSnapshot(),
    move = placements(state.ai.board, state.ai.type)[0],
    metrics = {
      linesCleared: 0,
      holes: 0,
      maxHeight: 2,
      aggregateHeight: 4,
      bumpiness: 3,
    };
  state.exchange = {
    turn: 1,
    piece: state.ai.type,
    input: { board: state.ai.board, piece: state.ai.type, next: [] },
    state: "selected",
    response: {
      ...move,
      model: "JEV",
      trace: {
        events: [],
        latencyMs: 10,
        response: "raw-native-response",
        modelDecision: { rotation: 3, x: 8, y: 10 },
        selectionGuard: {
          enabled: true,
          corrected: true,
          reason: "lower_ranked_plan",
          originalRank: 4,
          appliedRank: 1,
          originalMetrics: metrics,
          appliedMetrics: metrics,
        },
      },
    },
  };
  const html = renderToStaticMarkup(
    <JevMonitor exchange={state.exchange} history={state.history} />,
  );
  assert.match(html, /하네스 보정/);
  assert.match(html, /JEV 선택/);
  assert.match(html, /적용/);
  assert.match(html, /raw-native-response/);
  c.dispose();
});
