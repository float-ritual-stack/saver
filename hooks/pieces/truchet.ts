// Truchet tiles in Smith's rounded form: each tile holds two quarter circles on opposite corners, so
// neighbouring arcs join into winding paths and closed loops, each path in its own colour. Fronts of flips roll
// across the field and the paths re-route behind them. A tool call sends a burst of flips out from a random
// point; each running subagent keeps another front rolling; your message changes the colours.
import { GROUND, WHITE, blankCells, hex, mix, rng } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB, Rng } from "./core";

const INKS: RGB[][] = [
  ["#ff5f8f", "#3fd0ff", "#ffd23f", "#9b6bff", "#4ff0a0"].map(hex),   // neon sign
  ["#3ee8a0", "#1fb5c9", "#c6f25a", "#2f7fe0"].map(hex),               // kelp
  ["#ff7a3d", "#ff3b6b", "#ffc857", "#c2389a"].map(hex),               // ember glass
  ["#c9a7ff", "#7f8cff", "#ff9ad5", "#e6e1ff"].map(hex),               // lilac hour
];

interface Front { x: number; y: number; r: number; v: number; p: number; id: number; agent: boolean }
type Stroke = { x: number; y: number; ch: string }[];

const hash = (a: number, b: number) => {
  let t = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  t = Math.imul(t ^ (t >>> 15), 0x2c1b3c6d);
  return ((t ^ (t >>> 13)) >>> 0) / 4294967296;
};

// Which glyph joins a cell to two of its sides: up, down, left, right as bits 1, 2, 4, 8.
const JOIN: Record<number, string> = { 3: "│", 12: "─", 10: "╭", 6: "╮", 9: "╰", 5: "╯" };

// The quarter ellipse about a tile's top-left corner, from the top edge's middle cell to the left edge's, walked
// cell by cell so the path never skips a cell and every turn is a rounded corner.
function quarter(w: number, h: number): Stroke {
  const cells: [number, number][] = [];
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI / 2;
    const x = Math.min(w - 1, Math.floor((w / 2) * Math.cos(a))), y = Math.min(h - 1, Math.floor((h / 2) * Math.sin(a)));
    const last = cells[cells.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    if (last && last[0] !== x && last[1] !== y) cells.push([x, last[1]]);   // across, then down: the inside of the bend, clear of the opposite arc
    cells.push([x, y]);
  }
  const side = (a: [number, number], b: [number, number]) => (b[1] < a[1] ? 1 : b[1] > a[1] ? 2 : b[0] < a[0] ? 4 : 8);
  return cells.map((c, i) => {
    const m = (i === 0 ? 1 : side(c, cells[i - 1]!)) | (i === cells.length - 1 ? 4 : side(c, cells[i + 1]!));
    return { x: c[0], y: c[1], ch: JOIN[m]! };
  });
}
const FLIP_X: Record<string, string> = { "╭": "╮", "╮": "╭", "╰": "╯", "╯": "╰", "│": "│", "─": "─" };
const FLIP_Y: Record<string, string> = { "╭": "╰", "╰": "╭", "╮": "╯", "╯": "╮", "│": "│", "─": "─" };

export const truchet: Piece = {
  name: "truchet",
  blurb: "rounded Truchet tiles whose paths re-route as fronts of flips roll across",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const r: Rng = rng(seed);
    const W = cols / 2, H = rows;
    // Odd sizes put each port on a middle cell; twice as wide as tall, so the tile is square on screen.
    const th = Math.max(3, Math.min(9, Math.round(Math.min(W, H) / 4.5) | 1)), tw = th * 2 + 1;
    const tl = quarter(tw, th);
    const corner = (fx: boolean, fy: boolean): Stroke =>
      tl.map((c) => ({ x: fx ? tw - 1 - c.x : c.x, y: fy ? th - 1 - c.y : c.y, ch: fy ? FLIP_Y[fx ? FLIP_X[c.ch]! : c.ch]! : fx ? FLIP_X[c.ch]! : c.ch }));
    // Arc 0 always leaves through the tile's top, arc 1 through its bottom; the flip decides which sides.
    const ARCS: [Stroke, Stroke][] = [[corner(false, false), corner(true, true)], [corner(true, false), corner(false, true)]];
    const ox = -((tw - (cols % tw)) % tw >> 1), oy = -((th - (rows % th)) % th >> 1);   // centre the partial tiles
    const ni = Math.ceil((cols - ox) / tw), nj = Math.ceil((rows - oy) / th);
    const flip = new Uint8Array(ni * nj).map(() => (r() < 0.5 ? 1 : 0));
    const flash = new Float32Array(ni * nj);
    const parent = new Int32Array(ni * nj * 2);
    let fronts: Front[] = [], ink = Math.floor(r() * INKS.length), agents = 0, ids = 0, wait = 1, dirty = true;

    const launch = (p: number, agent: boolean, speed = 1) =>
      fronts.push({ x: r() * W, y: r() * H, r: 0, v: (Math.max(W, H) / 7 + 4) * speed, p, id: ids++, agent });

    const find = (a: number) => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; }
      return a;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra < rb) parent[rb] = ra; else parent[ra] = rb;   // the lower id roots, so a path keeps its colour while it lasts
    };
    const paths = () => {
      for (let k = 0; k < parent.length; k++) parent[k] = k;
      for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
        const t = j * ni + i;
        if (j > 0) union(t * 2, (t - ni) * 2 + 1);
        if (i > 0) union(t * 2 + flip[t]!, (t - 1) * 2 + 1 - flip[t - 1]!);
      }
      dirty = false;
    };

    return {
      tick(dt) {
        if ((wait -= dt) <= 0) { launch(0.35, false); wait = 5 + r() * 4; }
        let mine = 0;
        for (const f of fronts) if (f.agent) mine++;
        while (mine++ < agents) launch(0.5, true);
        const reach = Math.hypot(W, H);
        for (const f of fronts) {
          const r0 = f.r;
          f.r += f.v * dt;
          for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
            const d = Math.hypot((ox + (i + 0.5) * tw) / 2 - f.x, oy + (j + 0.5) * th - f.y);
            if (d < r0 || d >= f.r) continue;
            const t = j * ni + i;
            if (hash(t, f.id) < f.p) { flip[t]! ^= 1; flash[t] = 1; dirty = true; }
          }
        }
        fronts = fronts.filter((f) => f.r < reach);
        const fade = Math.exp(-dt * 1.2);
        for (let k = 0; k < flash.length; k++) flash[k]! *= fade;
      },
      cells(): Cell[] {
        if (dirty) paths();
        const cells = blankCells(cols * rows, opts);
        const pal = INKS[ink]!;
        for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
          const t = j * ni + i, x0 = ox + i * tw, y0 = oy + j * th;
          for (let a = 0; a < 2; a++) {
            const base = pal[Math.floor(hash(find(t * 2 + a), 7) * pal.length)]!;
            const fg = mix(base, WHITE, flash[t]! * 0.6);
            const glow = 0.35 + flash[t]! * 0.3;
            const cell: Omit<Cell, "ch"> = { fg, bg: opts.tint ? mix(GROUND, base, 0.08) : null, halo: [fg[0] * glow, fg[1] * glow, fg[2] * glow] };
            for (const s of ARCS[flip[t]!]![a]!) {
              const x = x0 + s.x, y = y0 + s.y;
              if (x >= 0 && y >= 0 && x < cols && y < rows) cells[y * cols + x] = { ...cell, ch: s.ch };
            }
          }
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") launch(0.75, false, 1.6);
        else if (p.kind === "agents") agents = Math.min(4, p.running);
        else ink = (ink + 1) % INKS.length;
      },
      label: () => "truchet",
    };
  },
};
