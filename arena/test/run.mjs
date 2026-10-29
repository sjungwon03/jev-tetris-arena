// Run in one process so restricted runtimes do not need Node test-worker IPC.
await import("./game.test.mjs");
await import("./controller.test.ts");
await import("./react.test.tsx");
await import("./replay.test.mjs");
