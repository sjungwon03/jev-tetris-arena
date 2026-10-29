import test from "node:test";
import assert from "node:assert/strict";
import { BattleController } from "../src/client/game/BattleController";
import { ApiError, type ModelApi } from "../src/client/api";
import { placements } from "../src/domain/tetris";
import type {
  MoveInput,
  MoveResponse,
  PublicConfig,
} from "../src/shared/contracts";
const config: PublicConfig = {
  baseUrl: "https://jev.example/v1",
  model: "JEV",
  style: "decisions",
  inputVersion: "test",
  configuredModelId: null,
  configured: true,
  candidateLimit: 4,
};
function setup(move?: ModelApi["move"]) {
  const store = new Map<string, string>();
  const api: ModelApi = {
    config: async () => config,
    health: async () => ({ ok: true }),
    move:
      move ||
      (async (input) => ({
        ...placements(input.board, input.piece)[0],
        model: "JEV",
        trace: {
          events: [],
          latencyMs: 42,
          response: "native response",
          request: [
            { state: "board", question: "choose", options: ["a", "b"] },
          ],
        },
      })),
  };
  const controller = new BattleController(api, {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  });
  return { controller, store };
}
test("controller preserves shared sequence, hold, pause and restart", () => {
  const { controller: c } = setup();
  assert.equal(c.getSnapshot().status, "ready");
  c.start();
  assert.equal(c.getSnapshot().human.type, c.getSnapshot().ai.type);
  c.act("KeyC");
  assert.ok(c.getSnapshot().human.held);
  c.pause();
  const x = c.getSnapshot().human.x;
  c.act("ArrowLeft");
  assert.equal(c.getSnapshot().human.x, x);
  c.start();
  assert.equal(c.getSnapshot().human.lines, 0);
  c.dispose();
});
test("model exchange and telemetry survive a restart and reload", async () => {
  const { controller: c, store } = setup();
  await c.loadConfig();
  c.start();
  await c.plan();
  const state = c.getSnapshot();
  assert.equal(state.exchange?.response?.trace.response, "native response");
  assert.equal(state.history.length, 1);
  assert.equal(state.logs.length, 1);
  assert.ok(state.target);
  c.start();
  assert.equal(c.getSnapshot().history.length, 0);
  assert.equal(c.getSnapshot().logs.length, 1);
  const restored = new BattleController(undefined, {
    getItem: (key) => store.get(key) || null,
    setItem() {},
  });
  assert.equal(restored.getSnapshot().logs.length, 1);
  c.dispose();
  restored.dispose();
});
test("abandoned battle result cannot change the next battle", async () => {
  let resolve!: (response: MoveResponse) => void;
  let input!: MoveInput;
  const { controller: c } = setup(async (i) => {
    input = i;
    return new Promise<MoveResponse>((r) => {
      resolve = r;
    });
  });
  await c.loadConfig();
  c.start();
  const pending = c.plan();
  c.start();
  resolve({
    ...placements(input.board, input.piece)[0],
    model: "old",
    trace: { events: [], latencyMs: 1 },
  });
  await pending;
  assert.equal(c.getSnapshot().exchange, null);
  assert.equal(c.getSnapshot().target, null);
  assert.equal(c.getSnapshot().logs[0].status, "discarded");
  c.dispose();
});
test("upstream failure is visible, correlated and pauses play", async () => {
  const { controller: c } = setup(async () => {
    throw new ApiError("JEV 요청 오류", 502, {
      error: "JEV 요청 오류",
      upstreamStatus: 400,
      trace: { requestId: "repro" },
    });
  });
  await c.loadConfig();
  c.start();
  await c.plan();
  assert.equal(c.getSnapshot().status, "paused");
  assert.match(c.getSnapshot().error!, /HTTP 400/);
  assert.match(c.getSnapshot().error!, /repro/);
  assert.equal(c.getSnapshot().logs[0].status, "error");
  c.dispose();
});
test("assist and original versus corrected decisions remain in the client log", async () => {
  const { controller: c } = setup(async (input) => {
    assert.equal(input.assist, true);
    const move = placements(input.board, input.piece)[0];
    return {
      ...move,
      model: "JEV",
      trace: {
        events: [],
        latencyMs: 1,
        modelDecision: { rotation: 3, x: 8, y: 10 },
        selectionGuard: {
          enabled: true,
          corrected: true,
          reason: "lower_ranked_plan",
          originalRank: 4,
          appliedRank: 1,
          originalMetrics: {
            linesCleared: 0,
            holes: 2,
            maxHeight: 4,
            aggregateHeight: 8,
            bumpiness: 3,
          },
          appliedMetrics: {
            linesCleared: 0,
            holes: 0,
            maxHeight: 2,
            aggregateHeight: 4,
            bumpiness: 3,
          },
        },
      },
    };
  });
  await c.loadConfig();
  c.start();
  await c.plan();
  assert.equal(
    (c.getSnapshot().logs[0].selectionGuard as { corrected: boolean })
      .corrected,
    true,
  );
  c.dispose();
});
