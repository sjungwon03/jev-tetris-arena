import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BattleController } from "./game/BattleController";
import { PlayerPanel } from "./components/PlayerPanel";
import { JevMonitor } from "./components/JevMonitor";
import { PerformancePanel } from "./components/PerformancePanel";
import { modelApi } from "./api";
const controls = [
  ["ArrowLeft", "←"],
  ["ArrowUp", "↻"],
  ["ArrowRight", "→"],
  ["KeyC", "홀드"],
  ["Space", "드롭 ↓"],
];
export function App({
  controller: provided,
}: {
  controller?: BattleController;
}) {
  const ref = useRef<BattleController | null>(null);
  if (!ref.current) {
    let storage: Storage | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {}
    ref.current = provided || new BattleController(modelApi, storage);
  }
  const controller = ref.current;
  const battle = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [dialog, setDialog] = useState<"guide" | "settings" | null>(null),
    [health, setHealth] = useState("");
  useEffect(() => {
    void controller.loadConfig();
    let frame = 0;
    const tick = (now: number) => {
      controller.tick(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (dialog) {
        if (e.code === "Escape") setDialog(null);
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Space",
          "Escape",
          "Enter",
          "KeyC",
          "KeyZ",
          "KeyX",
          "KeyP",
        ].includes(e.code)
      ) {
        e.preventDefault();
        if (
          e.repeat &&
          ["Space", "KeyC", "Enter", "Escape", "KeyP"].includes(e.code)
        )
          return;
        controller.act(e.code);
      }
    }
    function hidden() {
      if (document.hidden && controller.getSnapshot().status === "playing")
        controller.pause();
    }
    document.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [controller, dialog]);
  const active = battle.status === "playing" || battle.status === "paused",
    time = Math.floor(battle.elapsed / 1000);
  function open(which: "guide" | "settings") {
    if (battle.status === "playing") controller.pause();
    setDialog(which);
  }
  const overlay =
    battle.status === "playing" ? undefined : (
      <div className="board-overlay">
        <span className="outline-symbol">↳</span>
        <h3>
          {battle.status === "ready"
            ? "준비되셨나요?"
            : battle.status === "finished"
              ? battle.winner === "human"
                ? "YOU WIN!"
                : "JEV WINS"
              : battle.error
                ? "요청 처리 오류"
                : "잠깐, 숨 고르기."}
        </h3>
        <p>
          {battle.error ||
            (battle.status === "ready"
              ? "당신의 플레이를 보여주세요."
              : battle.status === "finished"
                ? "다시 대결해 볼까요?"
                : "준비되면 다시 이어가세요.")}
        </p>
        <button
          className="primary"
          onClick={() =>
            battle.status === "paused" ? controller.pause() : controller.start()
          }
        >
          {battle.status === "paused"
            ? "계속 플레이"
            : battle.status === "ready"
              ? "배틀 시작"
              : "다시 대결"}{" "}
          <span>↗</span>
        </button>
        <small>ENTER 키로도 시작할 수 있어요</small>
      </div>
    );
  return (
    <>
      <header>
        <a className="brand" href="./">
          <span className="brand-mark">▦</span> JEV<span>ARENA</span>
        </a>
        <nav>
          <span className="selected">플레이</span>
          <button onClick={() => open("guide")}>플레이 가이드 ↗</button>
        </nav>
        <button className="connection" onClick={() => open("settings")}>
          <i />
          <span>
            {battle.config?.configured
              ? "JEV · " + battle.config.model
              : "로컬 AI · 데모 모드"}
          </span>
          <span>⚙</span>
        </button>
      </header>
      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> HUMAN × MACHINE
            </div>
            <h1>당신의 다음 수는?</h1>
            <p>쌓고, 지우고, 앞서가세요. 당신과 JEV의 테트리스 배틀.</p>
          </div>
          <div className="room">
            <span>01 / BATTLE ROOM</span>
            <b>
              한 판으로 증명하세요. <span>↙</span>
            </b>
          </div>
        </section>
        <section className="toolbar">
          <div className="mode">
            <span className="mode-icon">⚔</span>
            <div>
              <b>스프린트 배틀</b>
              <small>먼저 40줄을 지우면 승리</small>
            </div>
            <span className="tag">1 vs 1</span>
          </div>
          <div className="tools">
            <label
              className="assist-toggle"
              title="하네스 평가가 낮은 선택을 보정합니다. 끄면 원래 모델 선택을 적용합니다."
            >
              <input
                type="checkbox"
                checked={battle.assist}
                disabled={active}
                onChange={(e) => controller.setAssist(e.target.checked)}
              />{" "}
              실력 보정
            </label>
            <label>
              AI 난이도{" "}
              <select
                value={battle.difficulty}
                disabled={active}
                onChange={(e) =>
                  controller.setDifficulty(
                    e.target.value as typeof battle.difficulty,
                  )
                }
              >
                <option value="easy">연습</option>
                <option value="normal">보통</option>
                <option value="hard">도전</option>
              </select>
            </label>
            <button
              className="icon-btn"
              aria-label={battle.sound ? "사운드 끄기" : "사운드 켜기"}
              onClick={() => controller.toggleSound()}
              style={{ color: battle.sound ? "var(--lime)" : undefined }}
            >
              ♪
            </button>
            <button
              className="icon-btn"
              aria-label="일시정지"
              onClick={() => controller.pause()}
            >
              {battle.status === "paused" ? "▶" : "Ⅱ"}
            </button>
          </div>
        </section>
        <section className="arena">
          <PlayerPanel
            game={battle.human}
            revision={battle.revision}
            next={controller.nextPieces(battle.human)}
            overlay={overlay}
            state={battle.status === "playing" ? "플레이 중" : "준비 완료"}
          />
          <div className="versus">
            <span className="versus-line" />
            <b>VS</b>
            <span className="versus-line" />
            <div className="timer">
              <span>TIME</span>
              <strong>
                {String(Math.floor(time / 60)).padStart(2, "0")}:
                {String(time % 60).padStart(2, "0")}
              </strong>
            </div>
            <span className="center-text">
              MAKE
              <br />
              YOUR
              <br />
              MOVE.
            </span>
          </div>
          <PlayerPanel
            ai
            game={battle.ai}
            revision={battle.revision}
            next={controller.nextPieces(battle.ai)}
            target={battle.target}
            state={
              battle.exchange?.state === "pending"
                ? "JEV 생각 중…"
                : battle.config?.configured
                  ? "JEV 준비 완료"
                  : "로컬 AI"
            }
            overlay={
              battle.status === "ready" ? (
                <div className="board-overlay ai-overlay">
                  <span className="ai-orb">✳</span>
                  <h3>CHALLENGE ACCEPTED.</h3>
                  <p>당신의 첫 수를 기다리고 있어요.</p>
                  <span className="waiting">
                    <i /> 대결 준비 완료
                  </span>
                </div>
              ) : undefined
            }
          />
        </section>
        <JevMonitor exchange={battle.exchange} history={battle.history} />
        <PerformancePanel
          logs={battle.logs}
          storageWarning={battle.storageWarning}
          controller={controller}
        />
        <section className="bottom-bar">
          <div className="key-guide">
            {[
              ["← →", "이동"],
              ["↑", "회전"],
              ["↓", "소프트 드롭"],
              ["SPACE", "하드 드롭"],
              ["C", "홀드"],
              ["ESC", "일시정지"],
            ].map(([key, label]) => (
              <span key={key}>
                <kbd>{key}</kbd> {label}
              </span>
            ))}
          </div>
          <button
            onClick={() => {
              if (!active || confirm("현재 대결을 끝내고 새로 시작할까요?"))
                controller.start();
            }}
          >
            ↻ 다시 시작
          </button>
        </section>
        <div className="mobile-controls">
          {controls.map(([key, label]) => (
            <button key={key} onClick={() => controller.act(key)}>
              {label}
            </button>
          ))}
        </div>
        <footer>
          <span>LESS NOISE. MORE BLOCKS.</span>
          <span>
            <i /> 브라우저에서 바로 플레이 · 40 LINES SPRINT
          </span>
          <span>JEV ARENA © 2026</span>
        </footer>
      </main>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <dialog open onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              aria-label="닫기"
              onClick={() => setDialog(null)}
            >
              ×
            </button>
            <div className="eyebrow">
              {dialog === "guide" ? "HOW TO PLAY" : "MODEL CONNECTION"}
            </div>
            {dialog === "guide" ? (
              <>
                <h2>한 줄씩, 승리에 가까이.</h2>
                <p>
                  가로 한 줄을 빈틈없이 채우면 줄이 사라집니다. 먼저 40줄을
                  지우면 승리! 블록이 천장에 닿으면 패배합니다.
                </p>
                <p>
                  ← → 이동 · ↑ 회전 · Z 반시계 회전
                  <br />↓ 소프트 드롭 · SPACE 하드 드롭 · C 홀드
                  <br />
                  ESC / P 일시정지 · ENTER 시작
                </p>
                <p>
                  양쪽에 같은 순서의 블록이 주어집니다. 실력 보정을 켜면 모델
                  원래 선택과 보정 결과를 통신 패널에서 비교할 수 있어요.
                </p>
              </>
            ) : (
              <>
                <h2>JEV 연결 설정</h2>
                <p>
                  보드 → 후보 평가·프롬프트 → 서버 프록시 → 모델 선택 검증 →
                  보정 → 실행 순서로 진행합니다. 인증키는 서버에만 보관합니다.
                </p>
                <div className="config-info">
                  <p>
                    PROVIDER{" "}
                    <strong>{battle.config?.baseUrl || "확인 중"}</strong>
                  </p>
                  <p>
                    MODEL <strong>{battle.config?.model || "미설정"}</strong>
                  </p>
                  <p>
                    PROTOCOL <strong>{battle.config?.style || "—"}</strong>
                  </p>
                </div>
                <p className="contract">
                  서버 설정: JEV_BASE_URL · JEV_MODEL · JEV_API_KEY
                  <br />
                  방식: decisions / chat / responses
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    setHealth("연결 확인 중…");
                    try {
                      const r = await modelApi.health();
                      setHealth(
                        r.ok
                          ? "모델 연결 확인 완료 · " + r.model
                          : r.error || "연결 확인 실패",
                      );
                    } catch (e) {
                      setHealth(
                        e instanceof Error ? e.message : "연결 확인 실패",
                      );
                    }
                  }}
                >
                  연결 상태 확인 ↗
                </button>
                <p role="status">{health}</p>
              </>
            )}
          </dialog>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {battle.error ||
          (battle.status === "finished"
            ? battle.winner === "human"
              ? "플레이어 승리"
              : "JEV 승리"
            : battle.status === "playing"
              ? "배틀 진행 중"
              : "")}
      </div>
    </>
  );
}
