import { memo } from "react";
import type { BattleSnapshot } from "../game/BattleController";
import { PiecePreview } from "./GameBoard";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
export const JevMonitor = memo(function JevMonitor({
  exchange,
  history,
}: {
  exchange: BattleSnapshot["exchange"];
  history: BattleSnapshot["history"];
}) {
  const e = exchange,
    r = e?.response,
    t = r?.trace,
    guard = t?.selectionGuard,
    forecast = t?.forecast,
    metrics = t?.selectedMetrics;
  const state =
    e?.state === "pending"
      ? "JEV 응답 대기 중…"
      : e?.state === "error"
        ? "요청 처리 오류"
        : e?.state === "applied"
          ? "배치 실행 완료"
          : r
            ? "선택 검증 완료 · 이동 중"
            : "배틀 시작을 기다리는 중";
  return (
    <section className="jev-monitor" aria-labelledby="monitor-title">
      <div className="monitor-heading">
        <div>
          <div className="eyebrow">LIVE MODEL EXCHANGE</div>
          <h2 id="monitor-title">JEV의 다음 한 수</h2>
          <p>게임이 보낸 정보, 모델의 응답, 실제 선택을 확인하세요.</p>
        </div>
        <span className="monitor-status">{state}</span>
      </div>
      <div className="monitor-grid">
        <div className="exchange-column">
          <div className="monitor-label">
            01 / GAME → JEV <span>TURN {e?.turn ?? "—"}</span>
          </div>
          <p>
            {e
              ? `${e.piece} 블록 · 다음 ${e.input.next.join(" → ")}`
              : "보드와 가능한 배치를 JEV에 전달합니다."}
          </p>
          <details>
            <summary>전달한 메시지 전체 보기</summary>
            <pre>
              {pretty(t?.request || t?.messages || e?.input) ||
                "아직 요청이 없습니다."}
            </pre>
          </details>
        </div>
        <div className="exchange-column">
          <div className="monitor-label">
            02 / JEV → GAME <span>{t?.latencyMs ?? "—"} ms</span>
          </div>
          <p>
            {guard?.corrected
              ? `JEV 선택: 회전 ${(t?.modelDecision?.rotation ?? 0) * 90}° / x ${t?.modelDecision?.x} → 적용: 회전 ${(r?.rotation ?? 0) * 90}° / x ${r?.x} (실력 보정 켜짐)`
              : r
                ? `전체 ${t?.legalMoveCount ?? "—"}개 중 하네스가 추린 ${t?.consideredMoveCount ?? t?.legalMoveCount ?? "—"}개에서 선택했습니다.`
                : "모델의 응답을 기다리고 있습니다."}
          </p>
          <pre className="response-payload">
            {e?.error || t?.response || "응답 대기 중…"}
          </pre>
        </div>
        <div className="decision-column">
          <div className="monitor-label">03 / SELECTED MOVE</div>
          <div className="decision-body">
            <PiecePreview
              pieces={[r ? e!.piece : null]}
              rotation={r?.rotation}
            />
            <div>
              <strong>
                {r ? `${e?.piece} → ${r.x}열 / ${r.y}행` : "선택 대기"}
              </strong>
              <p>
                {r
                  ? `시계 방향 ${r.rotation * 90}° · x ${r.x} / y ${r.y}`
                  : "회전 — · 좌표 —"}
              </p>
              <span>
                {guard?.corrected
                  ? `하네스 보정 · 평가 ${guard.originalRank}위 → ${guard.appliedRank}위`
                  : r?.forced
                    ? "유일한 배치 · 모델 호출 없음"
                    : r
                      ? "✓ 선택 검증 완료" +
                        (r.confidence !== undefined
                          ? ` · 신뢰도 ${(r.confidence * 100).toFixed(1)}%`
                          : "")
                      : "응답을 받으면 배치를 검증합니다."}
              </span>
            </div>
          </div>
          <p className="perf-help">
            {metrics
              ? `배치 후 · 제거 ${metrics.linesCleared}줄 / 구멍 ${metrics.holes} / 높이 ${metrics.maxHeight}`
              : "배치 후 지표를 기다리는 중"}
            {t?.plan && ` · 2수 평가 ${t.plan.rank}위`}
            {forecast &&
              (forecast.available
                ? ` · 다음 ${forecast.piece} 예상: 구멍 ${forecast.metrics.holes} / 높이 ${forecast.metrics.maxHeight}`
                : ` · 다음 ${forecast.piece} 배치 불가 예상`)}
          </p>
          <p className="perf-help">
            {t?.modelIdentity?.reportedModelIds.length
              ? "API 보고 모델: " + t.modelIdentity.reportedModelIds.join(", ")
              : t?.modelIdentity?.configuredModelId
                ? "운영자 설정 모델: " + t.modelIdentity.configuredModelId
                : "실제 모델 ID 미확인"}
          </p>
          <ol className="decision-candidates">
            {r?.candidates?.slice(0, 4).map((c) => (
              <li key={`${c.rotation}/${c.x}`}>
                {c.rotation === r.rotation && c.x === r.x ? "✓ " : ""}회전{" "}
                {c.rotation * 90}° · x {c.x} ·{" "}
                {(c.probability * 100).toFixed(1)}%
              </li>
            ))}
          </ol>
        </div>
      </div>
      <details className="turn-history">
        <summary>
          최근 턴 기록 <span>{history.length}</span>
        </summary>
        <ol>
          {history.map((item) => (
            <li key={item.turn}>
              #{item.turn} · {item.piece} · {item.response?.trace.latencyMs} ms
              {item.response?.trace.selectionGuard?.corrected
                ? " · 하네스 보정"
                : ""}
              <details>
                <summary>요청 / 응답</summary>
                <pre>
                  {pretty({
                    request:
                      item.response?.trace.request ||
                      item.response?.trace.messages,
                    response: item.response?.trace.response,
                    modelDecision: item.response?.trace.modelDecision,
                    appliedDecision: item.response && {
                      rotation: item.response.rotation,
                      x: item.response.x,
                      y: item.response.y,
                    },
                    selectionGuard: item.response?.trace.selectionGuard,
                  })}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
});
