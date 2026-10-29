import test from "node:test";
import assert from "node:assert/strict";
import { extractRequests, replay } from "../scripts/replay.mjs";
const request = {
  state: '{"board":[0]}',
  question: "choose",
  options: ["left", "right"],
};
test("extracts native requests from browser exports and server samples without changing strings", () => {
  const browser = extractRequests({
    entries: [
      {
        id: "r1",
        turn: 7,
        request: [{ phase: "예선 1", ...request }],
        events: [{ event: "jev.call.started", request }],
      },
    ],
  });
  assert.equal(browser.length, 1);
  assert.deepEqual(browser[0].request, request);
  assert.equal(browser[0].sourceTurn, 7);
  assert.equal(browser[0].sourceModelIdentity.source, "unreported");
  const server = extractRequests({
    entries: [
      { event: "turn.started" },
      { event: "jev.call.started", requestId: "r1", request },
    ],
  });
  assert.equal(server.length, 1);
});
test("replay sends identical payload and records reported identity without treating a label as verified", async () => {
  const entries = extractRequests({ entries: [{ request }] });
  const result = await replay(entries, {
    endpoint: "https://compare.example/v1/decisions",
    key: "test-secret",
    modelLabel: "4B-experiment",
    fetcher: async (_, options) => {
      assert.deepEqual(JSON.parse(options.body), request);
      return Response.json({
        prediction: "right",
        prediction_index: 1,
        confidence: 0.8,
        model_id: "actual-model-v2",
      });
    },
  });
  const r = result.results[0];
  assert.equal(r.valid, true);
  assert.equal(r.modelIdentity.source, "api_response");
  assert.deepEqual(r.modelIdentity.reportedModelIds, ["actual-model-v2"]);
  assert.ok(r.requestHash);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});
test("missing ID remains unknown and invalid selections or upstream bodies are not accepted", async () => {
  const entries = extractRequests({ entries: [{ request }] });
  const a = await replay(entries, {
    endpoint: "https://compare.example/v1/decisions",
    modelLabel: "Kev-4B",
    fetcher: async () => Response.json({ prediction: "other" }),
  });
  assert.equal(a.results[0].valid, false);
  assert.equal(a.results[0].modelIdentity.source, "unreported");
  const b = await replay(entries, {
    endpoint: "https://compare.example/v1/decisions",
    fetcher: async () => new Response("sensitive error", { status: 500 }),
  });
  assert.ok(!JSON.stringify(b).includes("sensitive error"));
});
test("baseline choice is retained for exact-request comparisons", async () => {
  const entries = extractRequests({
    entries: [
      { event: "jev.call.started", requestId: "r", phase: "final", request },
      {
        event: "jev.call.completed",
        requestId: "r",
        phase: "final",
        response: { prediction: "left", confidence: 0.6 },
      },
    ],
  });
  assert.equal(entries[0].baselineSelection.prediction, "left");
  const result = await replay(entries, {
    endpoint: "https://compare.example/v1/decisions",
    fetcher: async () =>
      Response.json({ prediction: "right", prediction_index: 1 }),
  });
  assert.equal(result.results[0].selectionChanged, true);
});
