// A field of plus marks over drifting colour regions, after the journal page where yellow, blue, purple and red
// pluses meet. A plus takes the colour of the region it sits in; one on a border loses the arms that reach into
// the next region, so the borders draw themselves in half-pluses.
import { GROUND, PAPER_DOT, blankCells, hex, mix, rng } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB, Rng } from "./core";

const SETS: RGB[][] = [
  ["#f2c200", "#2f7fe0", "#8a4fd6", "#e0342b"].map(hex),     // the journal page: yellow ground, blue, purple, red
  ["#2ee0c8", "#ff5fa8", "#ffd23f", "#5b8cff"].map(hex),
  ["#e9e5da", "#ff6b4a", "#a57bff", "#9bf05a"].map(hex),
];

interface Region { x: number; y: number; r: number; ax: number; ay: number; sx: number; sy: number; ph: number; col: number }

export const plusfield: Piece = {
  name: "plusfield",
  blurb: "plus marks over drifting colour regions; borders drawn in half-pluses",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const r: Rng = rng(seed);
    const w = cols >> 1, h = rows;                  // two columns to a dot, so regions stay round
    const R = Math.min(w, h);
    let set = Math.floor(r() * SETS.length), time = r() * 100, swell = 0;
    const region = (col: number): Region => ({
      x: w * (0.2 + r() * 0.6), y: h * (0.2 + r() * 0.6), r: R * (0.18 + r() * 0.16),
      ax: w * (0.1 + r() * 0.25), ay: h * (0.1 + r() * 0.25), sx: 0.05 + r() * 0.08, sy: 0.05 + r() * 0.08, ph: r() * 6.28, col,
    });
    const base = [region(1), region(2), region(3)];
    let extra: Region[] = [];

    // The region that owns a point: the one it sits deepest inside, else the ground (colour 0).
    const owner = (px: number, py: number, rs: Region[]) => {
      let best = 0, depth = 0;
      for (const g of rs) {
        const d = g.r * (1 + swell * 0.25) - Math.hypot(px - g.x, py - g.y);
        if (d > depth) { depth = d; best = g.col; }
      }
      return best;
    };

    return {
      tick(dt) {
        time += dt;
        swell *= Math.exp(-dt * 1.5);
        for (const g of [...base, ...extra]) {
          g.x = w / 2 + Math.sin(time * g.sx + g.ph) * g.ax;
          g.y = h / 2 + Math.cos(time * g.sy + g.ph * 1.3) * g.ay;
        }
      },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const pal = SETS[set]!;
        const rs = [...base, ...extra];
        const ox = (cols - w * 2) >> 1;
        const paper = opts.tint ? GROUND : null;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const col = ox + x * 2;
          if (col < 0 || col >= cols) continue;
          if (x % 2 !== 1 || y % 2 !== 1) { cells[y * cols + col] = { ch: "·", fg: PAPER_DOT, bg: paper }; continue; }
          const own = owner(x, y, rs);
          // Each arm keeps only if its tip is in the same region as the plus.
          const arm = (dx: number, dy: number) => owner(x + dx, y + dy, rs) === own;
          const m = (arm(-0.7, 0) ? 1 : 0) | (arm(0.7, 0) ? 2 : 0) | (arm(0, -0.7) ? 4 : 0) | (arm(0, 0.7) ? 8 : 0);
          const ink = pal[own % pal.length]!;
          const ch = m === 15 ? "+" : m === 0 ? "·" : ["·", "╴", "╶", "─", "╵", "┘", "└", "┴", "╷", "┐", "┌", "┬", "│", "┤", "├", "┼"][m]!;
          cells[y * cols + col] = { ch, fg: ink, bg: opts.tint ? mix(GROUND, ink, 0.1) : null, halo: [ink[0] * 0.4, ink[1] * 0.4, ink[2] * 0.4] };
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") swell = Math.min(1.5, swell + 0.5);
        else if (p.kind === "agents") {
          // Each running subagent is a region of its own colour.
          while (extra.length < Math.min(6, p.running)) extra.push(region(1 + ((extra.length + 3) % 3)));
          extra = extra.slice(0, Math.min(6, p.running));
        } else set = (set + 1) % SETS.length;
      },
      label: () => "plusfield",
    };
  },
};
