import { Game, makeSequence, bestMove, placements } from "../../domain/tetris";
import type {
  Move,
  MoveInput,
  MoveResponse,
  PerformanceEntry,
  Piece,
  PublicConfig,
} from "../../shared/contracts";
import { ApiError, modelApi, type ModelApi } from "../api";
export type BattleStatus = "ready" | "playing" | "paused" | "finished";
export interface Exchange {
  turn: number;
  piece: Piece;
  input: MoveInput;
  state: "pending" | "selected" | "applied" | "error";
  response?: MoveResponse;
  error?: string;
}
export interface BattleSnapshot {
  revision: number;
  status: BattleStatus;
  human: Game;
  ai: Game;
  elapsed: number;
  target: Move | null;
  config: PublicConfig | null;
  difficulty: "easy" | "normal" | "hard";
  assist: boolean;
  sound: boolean;
  exchange: Exchange | null;
  history: Exchange[];
  logs: PerformanceEntry[];
  error: string | null;
  winner: "human" | "ai" | null;
  storageWarning: boolean;
}
const STORAGE_KEY = "jev-performance-v1";
const id = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
function boardMetrics(board: MoveInput["board"]) {
  let holes = 0,
    maxHeight = 0;
  for (let x = 0; x < 10; x++) {
    let covered = false;
    for (let y = 0; y < 20; y++) {
      if (board[y][x]) {
        covered = true;
        maxHeight = Math.max(maxHeight, 20 - y);
      } else if (covered) holes++;
    }
  }
  return { holes, maxHeight };
}
/** Owns gameplay and asynchronous decisions. React subscribes to immutable snapshot envelopes. */
export class BattleController {
  private sequence = makeSequence();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private request: AbortController | null = null;
  private lastTime = 0;
  private gravity = 0;
  private aiTime = 0;
  private selectedAt = 0;
  private turn = 0;
  private session = id();
  private pending = false;
  private activeLog: string | null = null;
  private audio: AudioContext | null = null;
  private state: BattleSnapshot = {
    revision: 0,
    status: "ready",
    human: new Game(this.sequence),
    ai: new Game(this.sequence),
    elapsed: 0,
    target: null,
    config: null,
    difficulty: "normal",
    assist: true,
    sound: false,
    exchange: null,
    history: [],
    logs: [],
    error: null,
    winner: null,
    storageWarning: false,
  };
  constructor(
    private api: ModelApi = modelApi,
    private storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved))
        this.state.logs = saved
          .filter(
            (entry): entry is PerformanceEntry =>
              entry && typeof entry.id === "string",
          )
          .slice(-120);
    } catch {
      this.state.storageWarning = true;
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit() {
    this.state = { ...this.state, revision: this.state.revision + 1 };
    this.listeners.forEach((listener) => listener());
  }
  async loadConfig() {
    try {
      this.state.config = await this.api.config();
      this.emit();
    } catch {
      this.state.error =
        "모델 설정을 읽지 못했어요. 새로고침 후 다시 확인해 주세요.";
      this.emit();
    }
  }
  setDifficulty(value: BattleSnapshot["difficulty"]) {
    if (this.state.status !== "playing" && this.state.status !== "paused") {
      this.state.difficulty = value;
      this.emit();
    }
  }
  setAssist(value: boolean) {
    if (this.state.status !== "playing" && this.state.status !== "paused") {
      this.state.assist = value;
      this.emit();
    }
  }
  toggleSound() {
    this.state.sound = !this.state.sound;
    this.beep();
    this.emit();
  }
  private beep() {
    if (!this.state.sound || typeof AudioContext === "undefined") return;
    this.audio ??= new AudioContext();
    void this.audio.resume();
    const oscillator = this.audio.createOscillator(),
      gain = this.audio.createGain();
    gain.gain.setValueAtTime(0.04, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.1);
    oscillator.connect(gain);
    gain.connect(this.audio.destination);
    oscillator.start();
    oscillator.stop(this.audio.currentTime + 0.1);
  }
  start() {
    this.request?.abort();
    this.epoch++;
    this.sequence = makeSequence();
    this.session = id();
    this.turn = 0;
    this.pending = false;
    this.gravity = 0;
    this.aiTime = 0;
    this.lastTime = 0;
    this.activeLog = null;
    this.state = {
      ...this.state,
      status: "playing",
      human: new Game(this.sequence),
      ai: new Game(this.sequence),
      elapsed: 0,
      target: null,
      exchange: null,
      history: [],
      error: null,
      winner: null,
    };
    this.emit();
  }
  pause() {
    if (this.state.status === "playing") this.state.status = "paused";
    else if (this.state.status === "paused") {
      this.state.status = "playing";
      this.state.error = null;
      this.lastTime = 0;
    }
    this.emit();
  }
  act(key: string) {
    if (key === "Escape" || key === "KeyP") {
      this.pause();
      return;
    }
    if (key === "Enter" && this.state.status !== "playing") {
      if (this.state.status === "paused") this.pause();
      else this.start();
      return;
    }
    if (this.state.status !== "playing") return;
    const g = this.state.human;
    switch (key) {
      case "ArrowLeft":
        g.move(-1, 0);
        break;
      case "ArrowRight":
        g.move(1, 0);
        break;
      case "ArrowUp":
      case "KeyX":
        g.turn();
        break;
      case "KeyZ":
        g.turn(-1);
        break;
      case "ArrowDown":
        if (g.move(0, 1)) g.score++;
        else g.lock();
        break;
      case "Space":
        g.drop();
        this.gravity = 0;
        this.beep();
        break;
      case "KeyC":
        g.hold();
        break;
    }
    this.finish();
    this.emit();
  }
  nextPieces(game: Game) {
    return [0, 1, 2].map((offset) => this.sequence(game.index + offset));
  }
  private finish() {
    const { human, ai } = this.state;
    if (
      this.state.status === "playing" &&
      (human.dead || ai.dead || human.lines >= 40 || ai.lines >= 40)
    ) {
      this.state.status = "finished";
      this.state.winner = human.lines >= 40 || ai.dead ? "human" : "ai";
      this.epoch++;
      this.request?.abort();
      this.pending = false;
    }
  }
  private persist() {
    let logs = this.state.logs.slice(-120);
    let serialized = JSON.stringify(logs);
    while (serialized.length > 1500000 && logs.length > 1) {
      logs.shift();
      serialized = JSON.stringify(logs);
    }
    this.state.logs = logs;
    try {
      this.storage?.setItem(STORAGE_KEY, serialized);
    } catch {
      this.state.storageWarning = true;
    }
  }
  private updateLog(logId: string, patch: Record<string, unknown>) {
    this.state.logs = this.state.logs.map((log) =>
      log.id === logId ? { ...log, ...patch } : log,
    );
    this.persist();
  }
  exportLogs() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      entries: this.state.logs,
    };
  }
  async plan() {
    if (this.pending || this.state.status !== "playing") return;
    const run = this.epoch,
      g = this.state.ai,
      legal = placements(g.board, g.type);
    if (!legal.length) {
      g.dead = true;
      this.finish();
      this.emit();
      return;
    }
    this.pending = true;
    const turn = ++this.turn,
      piece = g.type,
      started = performance.now(),
      requestId = id(),
      sessionId = this.session;
    this.activeLog = requestId;
    const input: MoveInput = {
      board: g.board.map((row) => row.slice()),
      piece,
      next: this.nextPieces(g).slice(0, 2),
      assist: this.state.assist,
    };
    const exchange: Exchange = { turn, piece, input, state: "pending" };
    this.state.exchange = exchange;
    this.state.logs = [
      ...this.state.logs,
      {
        id: requestId,
        sessionId,
        turn,
        piece,
        startedAt: new Date().toISOString(),
        status: "pending",
        mode: this.state.config?.configured ? "model" : "local",
        boardBefore: input.board,
        beforeMetrics: boardMetrics(input.board),
        next: input.next,
      },
    ];
    this.persist();
    this.emit();
    try {
      let response: MoveResponse;
      if (this.state.config?.configured) {
        const controller = new AbortController();
        this.request = controller;
        const timeout = setTimeout(
          () =>
            controller.abort(
              new DOMException("모델 응답 시간 초과", "TimeoutError"),
            ),
          22000,
        );
        try {
          response = await this.api.move(
            input,
            { requestId, sessionId, turn },
            controller.signal,
          );
        } finally {
          clearTimeout(timeout);
        }
      } else {
        const move = bestMove(g.board, g.type);
        if (!move) throw Error("가능한 배치가 없어요.");
        response = {
          ...move,
          model: "로컬 AI",
          trace: {
            events: [],
            latencyMs: Math.round(performance.now() - started),
            response: JSON.stringify(move),
          },
        };
      }
      this.updateLog(requestId, {
        status: run === this.epoch ? "selected" : "discarded",
        clientDurationMs: Math.round(performance.now() - started),
        serverDurationMs: response.trace.latencyMs,
        requestId: response.trace.requestId,
        endpoint: response.trace.endpoint,
        protocol: response.trace.protocol,
        inputVersion: response.trace.inputVersion,
        modelIdentity: response.trace.modelIdentity,
        modelDecision: response.trace.modelDecision,
        selectionGuard: response.trace.selectionGuard,
        selectedMetrics: response.trace.selectedMetrics,
        forecast: response.trace.forecast,
        plan: response.trace.plan,
        events: response.trace.events,
        calls: response.trace.events.filter(
          (event) =>
            event.event.endsWith(".completed") ||
            event.event.endsWith(".failed"),
        ),
        request: response.trace.request || response.trace.messages,
        response: response.trace.response,
        selected: { rotation: response.rotation, x: response.x, y: response.y },
        confidence: response.confidence,
      });
      if (run !== this.epoch) return;
      const move = legal.find(
        (m) => m.rotation === response.rotation && m.x === response.x,
      );
      if (!move) throw Error("모델이 유효하지 않은 배치를 선택했어요.");
      this.state.target = move;
      this.selectedAt = performance.now();
      exchange.state = "selected";
      exchange.response = response;
      this.state.exchange = { ...exchange };
      this.state.history = [exchange, ...this.state.history].slice(0, 12);
    } catch (error) {
      const detail =
        error instanceof ApiError
          ? `${error.message} · 게임 HTTP ${error.status}${error.details.upstreamStatus ? " · JEV HTTP " + error.details.upstreamStatus : ""} · 요청 ${error.details.trace?.requestId || requestId}`
          : error instanceof Error
            ? error.message
            : "모델 요청 실패";
      this.updateLog(requestId, {
        status: run === this.epoch ? "error" : "discarded",
        clientDurationMs: Math.round(performance.now() - started),
        error: detail,
        ...(error instanceof ApiError
          ? {
              httpStatus: error.status,
              events: error.details.trace?.events,
              serverDurationMs: error.details.trace?.latencyMs,
            }
          : {}),
      });
      if (run === this.epoch) {
        this.state.status = "paused";
        this.state.error = detail;
        exchange.state = "error";
        exchange.error = detail;
        this.state.exchange = { ...exchange };
      }
    } finally {
      if (run === this.epoch) {
        this.pending = false;
        this.emit();
      }
    }
  }
  /** Advances animation only; request cancellation and stale-result checks live in plan(). */
  tick(now: number) {
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min(now - this.lastTime, 80);
    this.lastTime = now;
    if (this.state.status !== "playing") return;
    this.state.elapsed += dt;
    this.gravity += dt;
    this.aiTime += dt;
    if (
      this.gravity >= Math.max(130, 900 - (this.state.human.level - 1) * 65)
    ) {
      if (!this.state.human.move(0, 1)) this.state.human.lock();
      this.gravity = 0;
      this.finish();
    }
    const interval = { easy: 360, normal: 220, hard: 90 }[
      this.state.difficulty
    ];
    if (this.aiTime >= interval) {
      this.aiTime = 0;
      this.stepAi(now);
    }
    this.emit();
  }
  private stepAi(now: number) {
    if (this.state.status !== "playing") return;
    const move = this.state.target,
      g = this.state.ai;
    if (!move) {
      void this.plan();
      return;
    }
    if (now - this.selectedAt < 750) return;
    if (g.rotation !== move.rotation) {
      if (!g.turn()) this.executionFailed("rotation_blocked");
      return;
    }
    if (g.x !== move.x) {
      if (!g.move(Math.sign(move.x - g.x), 0))
        this.executionFailed("movement_blocked");
      return;
    }
    const before = g.lines,
      placedPiece = g.type;
    g.drop();
    if (this.activeLog)
      this.updateLog(this.activeLog, {
        status: "applied",
        appliedAt: new Date().toISOString(),
        selectionToApplyMs: Math.round(now - this.selectedAt),
        linesCleared: g.lines - before,
        linesTotal: g.lines,
        boardAfter: g.board.map((row) => row.slice()),
        afterMetrics: boardMetrics(g.board),
        placedPiece,
      });
    if (this.state.exchange)
      this.state.exchange = { ...this.state.exchange, state: "applied" };
    this.state.target = null;
    this.finish();
  }
  private executionFailed(reason: string) {
    if (this.activeLog)
      this.updateLog(this.activeLog, {
        status: "execution_failed",
        error: reason,
      });
    this.state.target = null;
  }
  dispose() {
    this.epoch++;
    this.request?.abort();
    this.pending = false;
    this.listeners.clear();
    void this.audio?.close();
  }
}
