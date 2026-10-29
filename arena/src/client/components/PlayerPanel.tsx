import type { Game } from "../../domain/tetris";
import type { Move, Piece } from "../../shared/contracts";
import { GameBoard, PiecePreview } from "./GameBoard";
export function PlayerPanel({
  game,
  ai,
  revision,
  next,
  target,
  overlay,
  state,
}: {
  game: Game;
  ai?: boolean;
  revision: number;
  next: Piece[];
  target?: Move | null;
  overlay?: React.ReactNode;
  state: string;
}) {
  return (
    <article className={"player " + (ai ? "side-ai" : "side-human")}>
      <div className="player-top">
        <div className="identity">
          <span className={"avatar " + (ai ? "ai-avatar" : "")}>
            {ai ? "✳" : "⌁"}
          </span>
          <div>
            <h2>
              {ai ? "JEV" : "PLAYER"} <span>{ai ? "AI" : "YOU"}</span>
            </h2>
            <p>
              {ai
                ? "모든 블록에는 최적의 자리가 있다."
                : "가능성은, 당신의 손끝에."}
            </p>
          </div>
        </div>
        <span className={"state " + (ai ? "ai-state" : "")}>{state}</span>
      </div>
      <div className="play-area">
        <aside>
          <div className="mini-label">HOLD {!ai && <kbd>C</kbd>}</div>
          <PiecePreview pieces={[game.held]} />
          <div className="side-note">
            {ai ? (
              <>
                THINK.
                <br />
                STACK.
                <br />
                REPEAT.
              </>
            ) : (
              <>
                KEEP IT
                <br />
                GOING
              </>
            )}
            <span>{ai ? "✳" : "↘"}</span>
          </div>
        </aside>
        <div className="board-wrap">
          <GameBoard
            game={game}
            revision={revision}
            target={target}
            label={ai ? "AI 테트리스 보드" : "플레이어 테트리스 보드"}
          />
          {overlay}
        </div>
        <aside>
          <div className="mini-label">NEXT</div>
          <PiecePreview pieces={next} height={250} />
        </aside>
      </div>
      <div className="stats">
        <div>
          <span>SCORE</span>
          <b>{String(game.score).padStart(6, "0")}</b>
        </div>
        <div>
          <span>LINES</span>
          <b>
            <em>{String(game.lines).padStart(2, "0")}</em>
            <small> / 40</small>
          </b>
        </div>
        <div>
          <span>LEVEL</span>
          <b>{String(game.level).padStart(2, "0")}</b>
        </div>
      </div>
    </article>
  );
}
