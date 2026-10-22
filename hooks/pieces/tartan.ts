// A woven plaid. A seeded sett of coloured stripes runs both ways, as warp and weft, and each cell shows whichever
// thread is on top by a 2/2 twill, so the colours cross in diagonal steps: the cloth in the cell's background,
// the thread itself as a fine line. The cloth slides slowly. A tool call throws a bright shuttle across;
// each running subagent weaves another stripe into the sett; your message threads a new sett and palette.
import { WHITE, hex, mix, rng, scale } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB, Rng } from "./core";

const WOOLS: RGB[][] = [
  ["#141a33", "#2f6bd8", "#d92b4b", "#f2d24b", "#e8e4d8"].map(hex),   // dress
  ["#10201a", "#2e8b57", "#8bd96b", "#d9a441", "#6a55c8"].map(hex),   // moss
  ["#150d26", "#ff4f8b", "#40d4ff", "#8a5cff", "#ffe08a"].map(hex),   // night bus
  ["#1c100b", "#c2461f", "#f08c3a", "#3f8f9f", "#efe1c6"].map(hex),   // rust
];

interface Stripe { c: number; w: number }
interface Shuttle { row: number; x: number; v: number }

export const tartan: Piece = {
  name: "tartan",
  blurb: "a woven plaid sliding slowly, crossed by bright shuttles",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const r: Rng = rng(seed);
    const W = cols / 2, H = rows;                   // two columns to a thread, so the checks stay square
    let wool = Math.floor(r() * WOOLS.length), sx = r() * 50, sy = r() * 50, extra = 0;
    let half: Stripe[] = [], threads: RGB[] = [], shuttles: Shuttle[] = [];

    // Half a sett, mirrored about its last stripe like most tartans, scaled so a few repeats fill the long side.
    const newSett = () => {
      const n = 5 + Math.floor(r() * 4);
      const brights = [1, 2, 3, 4].sort(() => r() - 0.5);
      half = [];
      // Broad bands of ground and one bright, split by narrow stripes of the others.
      for (let k = 0; k < n; k++) {
        const broad = k % 2 === 0;
        const c = broad ? (r() < 0.6 ? 0 : brights[0]!) : brights[1 + ((k >> 1) % 3)]!;
        half.push({ c, w: broad ? 3 + Math.floor(r() * 5) : 1 + Math.floor(r() * 2) });
      }
    };
    const thread = () => {
      const pal = WOOLS[wool]!;
      // Each running subagent is a thin stripe of the palette's next colour, set into the sett in turn.
      const stripes = half.slice();
      for (let k = 0; k < extra; k++) stripes.splice(1 + ((k * 3) % stripes.length), 0, { c: 1 + ((k + 2) % 4), w: 1 });
      const target = Math.max(8, Math.min(24, Math.min(W, H) * 0.5));
      const total = stripes.reduce((s, t) => s + t.w, 0);
      const widths = stripes.map((t) => Math.max(1, Math.round((t.w * target) / total)));
      const run: RGB[] = [];
      stripes.forEach((t, k) => { for (let i = 0; i < widths[k]!; i++) run.push(pal[t.c]!); });
      threads = [...run, ...run.slice(1, -1).reverse()];
    };
    newSett();
    thread();

    return {
      tick(dt) {
        sx += dt * 0.25;
        sy += dt * 0.11;
        for (const s of shuttles) s.x += s.v * dt;
        shuttles = shuttles.filter((s) => s.x < cols * 2.5);
      },
      cells(): Cell[] {
        const cells: Cell[] = new Array(cols * rows);
        const L = threads.length;
        const lit = new Float32Array(cols * rows);
        for (const s of shuttles) for (let col = 0; col < cols && col <= s.x; col++) {
          // Bright at the shuttle, fading behind it.
          const k = Math.exp(-(s.x - col) / (cols * 0.3));
          const i = s.row * cols + col;
          lit[i] = Math.max(lit[i]!, k);
        }
        for (let row = 0; row < rows; row++) {
          const v = Math.floor(row + sy);
          const weft = threads[((v % L) + L) % L]!;
          for (let col = 0; col < cols; col++) {
            const u = Math.floor(col / 2 + sx);
            const warp = threads[((u % L) + L) % L]!;
            const i = row * cols + col;
            const glow = lit[i]!;
            // 2/2 twill: over two, under two, stepping one thread each row.
            const up = glow === 0 && ((u + v) & 3) < 2;
            const body = up ? warp : glow ? mix(weft, WHITE, glow * 0.7) : weft;
            const lum = body[0] * 0.3 + body[1] * 0.55 + body[2] * 0.15;
            const fg = lum > 140 ? mix(body, WHITE, 0.35) : mix(body, WHITE, 0.25 + glow * 0.5);
            const bg = scale(body, up ? 0.5 : 0.42 + glow * 0.4);
            cells[i] = { ch: up ? "│" : "─", fg, bg, halo: scale(fg, 0.3 + glow * 0.3) };
          }
        }
        for (const s of shuttles) {
          const x = Math.floor(s.x);
          if (x < cols) cells[s.row * cols + x] = { ch: "•", fg: WHITE, bg: cells[s.row * cols + x]!.bg, halo: [150, 150, 150] };
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") shuttles.push({ row: Math.floor(r() * rows), x: 0, v: cols / 1.4 });
        else if (p.kind === "agents") { extra = Math.min(6, p.running); thread(); }
        else { wool = (wool + 1) % WOOLS.length; newSett(); thread(); }
      },
      label: () => "tartan",
    };
  },
};
