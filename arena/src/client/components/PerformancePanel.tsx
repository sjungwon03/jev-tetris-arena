import { memo } from "react";
import type {
  BattleController,
  BattleSnapshot,
} from "../game/BattleController";
export const PerformancePanel = memo(function PerformancePanel({
  logs,
  storageWarning,
  controller,
}: {
  logs: BattleSnapshot["logs"];
  storageWarning: boolean;
  controller: BattleController;
}) {
  const times = logs
    .map((e) => e.clientDurationMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  function download() {
    const blob = new Blob([JSON.stringify(controller.exportLogs(), null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      "jev-performance-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="performance-panel">
      <div className="performance-heading">
        <div>
          <div className="eyebrow">PERFORMANCE LOG</div>
          <h2>성능 진단 기록</h2>
          <p>
            {logs.length}턴 기록
            {times.length > 0 &&
              ` · 평균 ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms · P95 ${times[Math.ceil(times.length * 0.95) - 1]} ms`}
            {storageWarning
              ? " · 저장 실패 (내보내기 가능)"
              : " · 이 브라우저에 저장"}
          </p>
        </div>
        <button className="primary" onClick={download}>
          JSON 로그 다운로드 ↓
        </button>
      </div>
      <p className="perf-help">
        요청 ID로 서버 로그와 대조할 수 있어요. 최근 최대 120턴을 저장합니다.
        시간 단위는 ms입니다.
      </p>
      <div className="performance-table">
        <table>
          <thead>
            <tr>
              {[
                "턴",
                "블록",
                "상태",
                "브라우저 왕복",
                "서버 처리",
                "요청 ID",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs
              .slice(-8)
              .reverse()
              .map((log) => (
                <tr key={log.id}>
                  {[
                    log.turn,
                    log.piece,
                    log.status,
                    log.clientDurationMs ?? "—",
                    log.serverDurationMs ?? "—",
                    log.requestId || log.id,
                  ].map((v, i) => (
                    <td key={i}>{String(v)}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>최근 턴 상세 로그</summary>
        <pre>
          {logs.length
            ? JSON.stringify(logs.at(-1), null, 2)
            : "배틀을 시작하면 로그가 쌓입니다."}
        </pre>
      </details>
    </section>
  );
});
