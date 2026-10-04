// The loom, after the journal page of yellow and magenta columns: outlined bars, filled solid, with a window
// that steps from bar to bar. In the window, a small box with a tick, a long line, another box. Here the
// window rolls along the bars as a wave. Tool calls quicken it; each running subagent adds a wave; your
// message re-inks it.
import { GROUND, blankCells, hex, mix } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB } from "./core";

const INKS: { edge: RGB; fill: RGB; tick: RGB; line: RGB }[] = [
  { edge: hex("#e83fc4"), fill: hex("#e4b400"), tick: hex("#ff7a1f"), line: hex("#2a8fb8") },   // the journal page
  { edge: hex("#2ee0c8"), fill: hex("#5b3fb0"), tick: hex("#ffd23f"), line: hex("#ff5fa8") },
  { edge: hex("#ff6b4a"), fill: hex("#1f6f5a"), tick: hex("#e9e5da"), line: hex("#ffb03a") },
];

export const loom: Piece = {
  name: "loom",
  blurb: "outlined bars with a window of boxes rolling along them",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const BAR = 4;                                   // an edge and three cells of fill
    const bars = Math.max(1, Math.floor((cols - 1) / BAR));
    const left = (cols - (bars * BAR + 1)) >> 1;
    const top = 1, bottom = rows - 2;               // the frame's top and bottom edges
    let phase = (seed % 100) / 10, speed = 1, waves = 1, ink = seed % INKS.length;

    return {
      tick(dt) {
        phase += dt * 0.6 * speed;
        speed += (1 - speed) * Math.min(1, dt * 1.5);
      },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const { edge, fill, tick, line } = INKS[ink]!;
        const ground = opts.tint ? GROUND : null;
        const fillBg = mix(GROUND, fill, 0.85);
        const put = (x: number, y: number, ch: string, fg: RGB, bg: RGB | null) => {
          if (x >= 0 && y >= 0 && x < cols && y < rows) cells[y * cols + x] = { ch, fg, bg, halo: [fg[0] * 0.3, fg[1] * 0.3, fg[2] * 0.3] };
        };
        const inner = bottom - top - 1;
        const win = Math.max(8, Math.round(inner * 0.42));      // the window's height
        for (let b = 0; b < bars; b++) {
          const x0 = left + b * BAR;
          // The window's top steps from bar to bar along a wave (several, while subagents run).
          let s = 0;
          for (let k = 0; k < waves; k++) s += Math.sin(phase * (1 + k * 0.37) - b * (0.32 + k * 0.11) + k * 1.7) / waves;
          const wy = top + 1 + Math.round(((s + 1) / 2) * (inner - win));
          const box = Math.max(2, Math.round(win * 0.22));
          // Rows that cross the bar with a rule: the window's ends, and each box's inner edge.
          const rules = new Set([wy, wy + box, wy + win - 1 - box, wy + win - 1]);
          for (let y = top; y <= bottom; y++) {
            const inWin = y >= wy && y <= wy + win - 1;
            const ruled = y === top || y === bottom || rules.has(y);
            // The left edge of the bar, with joins where rules meet it.
            const edgeCh = y === top ? (b === 0 ? "┌" : "┬") : y === bottom ? (b === 0 ? "└" : "┴") : ruled ? (b === 0 ? "├" : "┼") : "│";
            put(x0, y, edgeCh, edge, ground);
            for (let c = 1; c < BAR; c++) {
              const x = x0 + c;
              if (ruled) { put(x, y, "─", edge, ground); continue; }
              if (!inWin) { put(x, y, " ", fill, fillBg); continue; }
              const mid = c === 2;
              if (y < wy + box || y > wy + win - 1 - box) put(x, y, mid ? "╎" : " ", tick, ground);   // a box with its tick
              else put(x, y, mid ? "│" : " ", line, ground);                                         // the long line
            }
          }
        }
        // The frame's right edge.
        const xr = left + bars * BAR;
        for (let y = top; y <= bottom; y++) put(xr, y, y === top ? "┐" : y === bottom ? "┘" : "│", edge, ground);
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") speed = Math.max(speed, 5);
        else if (p.kind === "agents") waves = 1 + Math.min(4, p.running);
        else ink = (ink + 1) % INKS.length;
      },
      label: () => "loom",
    };
  },
};
