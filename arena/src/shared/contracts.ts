/** Browser/server wire contract. Credentials belong only to ServerEnv. */
export type Piece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type Cell = Piece | 0;
export type Board = Cell[][];
export interface Move {
  rotation: number;
  x: number;
  y: number;
}
export interface Metrics {
  linesCleared: number;
  holes: number;
  maxHeight: number;
  aggregateHeight: number;
  bumpiness: number;
}
export type Forecast =
  | { piece: Piece; available: false }
  | { piece: Piece; available: true; move: Move; metrics: Metrics };
export interface Plan {
  move: Move;
  current: Metrics;
  forecast: Forecast | null;
  score: number;
  rank: number;
}
export interface MoveInput {
  board: Board;
  piece: Piece;
  next: Piece[];
  assist?: boolean;
}
export interface SelectionGuard {
  enabled: boolean;
  corrected: boolean;
  reason: string | null;
  originalRank: number;
  appliedRank: number;
  originalMetrics: Metrics;
  appliedMetrics: Metrics;
}
export type ApiStyle = "decisions" | "chat" | "responses";
export interface PublicConfig {
  baseUrl: string;
  model: string;
  style: ApiStyle;
  inputVersion: string;
  configuredModelId: string | null;
  configured: boolean;
  candidateLimit: number;
}
export interface ModelIdentity {
  displayName?: string;
  configuredModelId: string | null;
  reportedModelIds: string[];
  source: "api_response" | "operator_configuration" | "unreported";
}
export interface PerformanceEvent {
  event: string;
  requestId?: string;
  timestamp?: string;
  offsetMs?: number;
  phase?: string;
  durationMs?: number;
  [key: string]: unknown;
}
export interface DecisionRequest {
  state: string;
  question: string;
  options: string[];
}
export interface DecisionResponse {
  model_id: string | null;
  prediction: string;
  prediction_index?: number;
  confidence?: number;
  probabilities: Record<string, number>;
}
export interface Round {
  phase: string;
  request: DecisionRequest;
  response: DecisionResponse;
  timing: {
    durationMs: number;
    headersMs: number;
    decodeMs: number;
    httpStatus: number;
  };
}
export interface Candidate extends Move {
  probability: number;
}
export interface Trace {
  requestId?: string;
  events: PerformanceEvent[];
  inputVersion?: string;
  endpoint?: string;
  protocol?: ApiStyle;
  latencyMs: number;
  prepareMs?: number;
  legalMoveCount?: number;
  consideredMoveCount?: number;
  request?: unknown;
  messages?: unknown;
  response?: string;
  modelIdentity?: ModelIdentity;
  selectedMetrics?: Metrics;
  forecast?: Forecast | null;
  plan?: { rank: number; score: number };
  modelDecision?: Move;
  selectionGuard?: SelectionGuard;
}
export interface MoveResponse extends Move {
  model: string;
  confidence?: number;
  candidates?: Candidate[];
  forced?: boolean;
  trace: Trace;
}
export interface ApiFailure {
  error: string;
  errorCode?: string | number;
  upstreamStatus?: number;
  tokenUsage?: unknown;
  trace?: Partial<Trace>;
}
export interface HealthResponse {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
}
export interface PerformanceEntry {
  id: string;
  sessionId: string;
  turn: number;
  piece: Piece;
  startedAt: string;
  status: string;
  mode: string;
  [key: string]: unknown;
}
