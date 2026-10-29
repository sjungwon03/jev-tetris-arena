import { useEffect, useRef } from "react";
import { COLORS, matrix, type Game } from "../../domain/tetris";
import type { Move, Piece } from "../../shared/contracts";
function block(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  ghost = false,
) {
  ctx.fillStyle = ghost ? color + "15" : color;
  ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
  ctx.strokeStyle = ghost ? color + "65" : "#ffffff24";
  ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
}
export function GameBoard({
  game,
  revision,
  target,
  label,
}: {
  game: Game;
  revision: number;
  target?: Move | null;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0e120c";
    ctx.fillRect(0, 0, 300, 600);
    ctx.strokeStyle = "#252d1c66";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= 10; x++) {
      ctx.beginPath();
      ctx.moveTo(x * 30, 0);
      ctx.lineTo(x * 30, 600);
      ctx.stroke();
    }
    for (let y = 0; y <= 20; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * 30);
      ctx.lineTo(300, y * 30);
      ctx.stroke();
    }
    game.board.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v) block(ctx, x * 30, y * 30, 30, COLORS[v]);
      }),
    );
    if (!game.dead)
      for (const ghost of [true, false]) {
        const posY = ghost ? game.ghost() : game.y;
        game.m.forEach((row, y) =>
          row.forEach((v, x) => {
            if (v && posY + y >= 0)
              block(
                ctx,
                (game.x + x) * 30,
                (posY + y) * 30,
                30,
                COLORS[game.type],
                ghost,
              );
          }),
        );
      }
    if (target) {
      ctx.lineWidth = 2;
      matrix(game.type, target.rotation).forEach((row, y) =>
        row.forEach((v, x) => {
          if (v) {
            block(
              ctx,
              (target.x + x) * 30,
              (target.y + y) * 30,
              30,
              "#e3d0ff",
              true,
            );
          }
        }),
      );
    }
  }, [game, revision, target]);
  return <canvas ref={ref} width={300} height={600} aria-label={label} />;
}
export function PiecePreview({
  pieces,
  rotation = 0,
  height = 70,
}: {
  pieces: (Piece | null)[];
  rotation?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 90, height);
    pieces.forEach((type, i) => {
      if (!type) return;
      const m = matrix(type, rotation);
      m.forEach((row, y) =>
        row.forEach((v, x) => {
          if (v)
            block(
              ctx,
              (90 - m[0].length * 17) / 2 + x * 17,
              10 + i * 65 + y * 17,
              17,
              COLORS[type],
            );
        }),
      );
    });
  }, [pieces, rotation, height]);
  return (
    <canvas ref={ref} width={90} height={height} aria-label="블록 미리보기" />
  );
}
