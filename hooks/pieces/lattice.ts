// Echo Lattice: the rules of the dot-grid marker drawings, run as a process.
import { GROUND, PAPER_DOT, WHITE, blankCells, hex, mix, pick, rng, scale } from "./core";
import type { Cell, Piece, PieceInstance, PieceOptions, Pulse, RGB, Rng } from "./core";

const PALETTES: Record<string, RGB[]> = {
  gel: ["#ff5fa8", "#ff8a3d", "#ffd23f", "#9bf05a", "#2ee0c8", "#5b8cff", "#a57bff", "#f05bf0"].map(hex),
  ember: ["#ff6b4a", "#ffb03a", "#f2e6c9", "#ff4f7b", "#ffd23f"].map(hex),
  tide: ["#2ee0c8", "#5b8cff", "#9bf05a", "#e9e5da", "#2fb4ff"].map(hex),
  chalk: ["#e9e5da", "#a57bff", "#e9e5da", "#ff5fa8", "#8a8d99"].map(hex),
};

// ── The lattice ─────────────────────────────────────────────────────────────
// The rules of the dot-grid drawings, run as a process: the pen moves dot to dot in eight directions, every new
// line echoes all the ink already down one dot further out, breaks become channels, and it is all mirrored.
// Bits: E=1 NE=2 N=4 NW=8 W=16 SW=32 S=64 SE=128
export const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
export type Sym = "D4" | "D2" | "C4";
export const SYMMETRIES: Record<Sym, (dx: number, dy: number) => [number, number][]> = {
  D4: (dx, dy) => [[dx, dy], [-dx, dy], [dx, -dy], [-dx, -dy], [dy, dx], [-dy, dx], [dy, -dx], [-dy, -dx]],
  D2: (dx, dy) => [[dx, dy], [-dx, dy], [dx, -dy], [-dx, -dy]],
  C4: (dx, dy) => [[dx, dy], [-dy, dx], [-dx, -dy], [dy, -dx]],
};

export class Lattice {
  N = 0; C0 = 0;
  view = { w: 0, h: 0, ox: 0, oy: 0 };
  stroke = new Int32Array(0);
  born = new Float32Array(0);
  colorOf: number[] = [];
  styleOf: ("line" | "dots")[] = [];
  count = 0;
  palette: RGB[] = PALETTES.gel!;
  paletteName = "gel";
  symmetry: Sym = "D4";
  metrics: [string, number][] = [];
  sprout = 0.4;
  /** Running subagents: each is another pen, so echoes come faster and motifs sprout more. */
  pens = 0;
  gatesMax = 2;
  gen = 0;
  clock = 0;
  nextStep = 0;
  state: "growing" | "resting" | "fading" = "growing";
  doneAt = 0;
  fade = 1;
  paletteIndex = 0;

  r: Rng;
  constructor(w: number, h: number, seed: number, symmetry?: Sym) {
    this.r = rng(seed);
    this.view = { w, h, ox: 0, oy: 0 };
    this.N = Math.max(w, h) | 1;
    this.C0 = (this.N - 1) >> 1;
    this.view.ox = this.C0 - (w >> 1);
    this.view.oy = this.C0 - (h >> 1);
    this.stroke = new Int32Array(this.N * this.N).fill(-1);
    this.born = new Float32Array(this.N * this.N);
    this.paletteName = pick(this.r, [["gel", 3], ["ember", 1.5], ["tide", 1.5], ["chalk", 1]]);
    this.palette = PALETTES[this.paletteName]!;
    this.symmetry = symmetry ?? pick<Sym>(this.r, [["D4", 3], ["D2", 1.5], ["C4", 1]]);
    this.metrics = [["cheb", 1 + this.r() * 2], ["manh", 1 + this.r() * 2], ["oct", 1 + this.r() * 2]];
    this.sprout = 0.25 + this.r() * 0.35;
    this.gatesMax = Math.floor(this.r() * 4);
    this.paletteIndex = Math.floor(this.r() * 8);
    this.plant(this.C0, this.C0, pick(this.r, [["diamond", 3], ["square", 2], ["star", 2], ["plus", 1]]), 0);
    this.nextStep = 0.9;
  }

  idx = (x: number, y: number) => y * this.N + x;
  inField = (x: number, y: number) => x >= 1 && y >= 1 && x < this.N - 1 && y < this.N - 1;
  visible = (x: number, y: number) => x >= this.view.ox && y >= this.view.oy && x < this.view.ox + this.view.w && y < this.view.oy + this.view.h;

  private commit(cells: [number, number][], style: "line" | "dots", t0: number, duration: number) {
    if (!cells.length) return;
    const id = this.count++;
    this.colorOf[id] = ++this.paletteIndex % this.palette.length;
    this.styleOf[id] = style;
    const C0 = this.C0;
    const keyed = cells.map(([x, y]) => {
      const dx = x - C0, dy = y - C0, ax = Math.abs(dx), ay = Math.abs(dy);
      const k = this.symmetry === "C4" ? Math.atan2(dy, dx) : Math.atan2(Math.min(ax, ay), Math.max(ax, ay));
      return { x, y, k };
    }).sort((a, b) => a.k - b.k);
    const step = duration / keyed.length;
    keyed.forEach((c, i) => {
      for (const [sx, sy] of SYMMETRIES[this.symmetry](c.x - C0, c.y - C0)) {
        const x = C0 + sx, y = C0 + sy;
        if (!this.inField(x, y) || this.stroke[this.idx(x, y)] !== -1) continue;
        this.stroke[this.idx(x, y)] = id;
        this.born[this.idx(x, y)] = t0 + i * step;
      }
    });
  }

  private motif(cx: number, cy: number, kind: string): [number, number][] {
    const out: [number, number][] = [];
    const r = kind === "plus" ? 2 : 1 + Math.floor(this.r() * 2);
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let on = false;
      if (kind === "diamond") on = ax + ay === r + 1;
      if (kind === "square") on = Math.max(ax, ay) === r;
      if (kind === "star") on = (Math.max(ax, ay) === r && ax + ay <= r + 1) || (ax + ay === r + 1 && Math.max(ax, ay) > r);
      if (kind === "plus") on = (ax === 0 && ay <= r) || (ay === 0 && ax <= r);
      if (kind === "dot") on = ax === 0 && ay === 0;
      if (on) out.push([cx + dx, cy + dy]);
    }
    return out;
  }

  plant(x: number, y: number, kind: string, t0: number) {
    this.commit(this.motif(x, y, kind).filter(([a, b]) => this.inField(a, b) && this.stroke[this.idx(a, b)] === -1), "line", t0, 0.5);
  }

  private distance(metric: string, limit: number) {
    const N = this.N, d = new Int16Array(N * N).fill(32767);
    let frontier: number[] = [];
    for (let i = 0; i < N * N; i++) if (this.stroke[i] !== -1) { d[i] = 0; frontier.push(i); }
    for (let level = 1; level <= limit && frontier.length; level++) {
      const diag = metric === "cheb" || (metric === "oct" && level % 2 === 1);
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % N, y = (i - x) / N;
        for (const [dx, dy] of DIRS) {
          if (!diag && dx && dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (d[j]! > level) { d[j] = level; next.push(j); }
        }
      }
      frontier = next;
    }
    return d;
  }

  private grow(): boolean {
    this.gen++;
    const { N, C0 } = this;
    const metric = pick(this.r, this.metrics);
    const gap = this.r() < 0.85 ? 2 : 3;
    const d = this.distance(metric, gap);
    const wedge: [number, number][] = [];
    const sym = SYMMETRIES[this.symmetry];
    for (let y = C0; y < N - 1; y++) for (let x = C0; x < N - 1; x++) {
      if (this.symmetry === "D4" && y - C0 > x - C0) continue;
      if (this.symmetry === "C4" && x === C0 && y === C0) continue;
      if (d[this.idx(x, y)] === gap && this.inField(x, y)) wedge.push([x, y]);
    }
    const seen = (x: number, y: number) => sym(x - C0, y - C0).some(([sx, sy]) => this.visible(C0 + sx, C0 + sy));
    if (!wedge.length || !wedge.some(([x, y]) => seen(x, y))) return false;

    const cut = new Set<number>();
    const gates = Math.floor(this.r() * (this.gatesMax + 1));
    for (let g = 0; g < gates; g++) {
      const [gx, gy] = wedge[Math.floor(this.r() * wedge.length)]!;
      const w = this.r() < 0.6 ? 1 : 2;
      for (const [x, y] of wedge) if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) < w) cut.add(y * N + x);
    }
    const cells = wedge.filter(([x, y]) => !cut.has(y * N + x));
    const style = pick<"line" | "dots">(this.r, [["line", 12], ["dots", 1.2]]);
    const marks = style === "dots" ? cells.filter(([x, y]) => (x + y) % 2 === 0) : cells;
    // On a very large field (a zoomed-out terminal) each ring is drawn faster, so the page still fills.
    const big = Math.max(1, this.N / 70);
    const duration = Math.max(0.35, Math.min(2.6 / big, (marks.length * 0.016) / big));
    this.commit(marks, style, this.clock, duration);

    if (this.r() < this.sprout + this.pens * 0.15) {
      const far = this.distance("cheb", 7);
      const open: [number, number][] = [];
      for (let y = C0; y < N - 2; y++) for (let x = C0; x < N - 2; x++) if (far[this.idx(x, y)]! >= 7 && this.visible(x, y)) open.push([x, y]);
      if (open.length) {
        const [x, y] = open[Math.floor(this.r() * open.length)]!;
        this.plant(x, y, pick(this.r, [["square", 3], ["diamond", 3], ["plus", 2], ["dot", 1.5], ["star", 1]]), this.clock + duration * 0.5);
      }
    }
    this.nextStep = this.clock + (duration + 0.3) / (1 + this.pens * 0.7);
    return true;
  }

  /** Advance time; returns false when the page has faded out and a new one should begin. */
  tick(dt: number): boolean {
    this.clock += dt;
    if (this.state === "growing" && this.clock >= this.nextStep && !this.grow()) { this.state = "resting"; this.doneAt = this.clock; }
    if (this.state === "resting" && this.clock - this.doneAt > 9) this.state = "fading";
    if (this.state === "fading") { this.fade -= dt / 2.5; if (this.fade <= 0) return false; }
    return true;
  }

  /** Pen mask of a revealed cell: its revealed neighbours on the same stroke, diagonals dropped where a corner joins. */
  mask(x: number, y: number): number {
    const id = this.stroke[this.idx(x, y)]!;
    let m = 0;
    for (let b = 0; b < 8; b++) {
      const nx = x + DIRS[b]![0], ny = y + DIRS[b]![1];
      if (nx < 0 || ny < 0 || nx >= this.N || ny >= this.N) continue;
      const j = this.idx(nx, ny);
      if (this.stroke[j] === id && this.born[j]! <= this.clock) m |= 1 << b;
    }
    if (m & 1 || m & 4) m &= ~2;
    if (m & 4 || m & 16) m &= ~8;
    if (m & 16 || m & 64) m &= ~32;
    if (m & 64 || m & 1) m &= ~128;
    return m;
  }
}

// ── From pen masks to terminal glyphs ───────────────────────────────────────
// Orthogonal arms use box drawing; a lone end is a half line; diagonals use ╱ ╲ ╳.
const ORTHO = ["•", "╶", "╵", "└", "╴", "─", "┘", "┴", "╷", "┌", "│", "├", "┐", "┬", "┤", "┼"];
export function glyphFor(m: number): string {
  const e = m & 1 ? 1 : 0, n = m & 4 ? 2 : 0, w = m & 16 ? 4 : 0, s = m & 64 ? 8 : 0;
  const ortho = e | n | w | s;
  if (ortho) return ORTHO[ortho]!;
  const ne = m & 2, nw = m & 8, sw = m & 32, se = m & 128;
  const arms = (ne ? 1 : 0) + (nw ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0);
  if (arms >= 3) return "╳";
  // Two diagonals meeting make a corner that points away from them.
  if (sw && se) return "∧";
  if (nw && ne) return "∨";
  if (ne && se) return "<";
  if (nw && sw) return ">";
  if (ne || sw) return "╱";
  if (nw || se) return "╲";
  return "•";
}


// ── Cells: two columns to a lattice dot, so the grid reads square ───────────
function compose(L: Lattice, cols: number, rows: number, opts: PieceOptions): Cell[] {
  const cells = blankCells(cols * rows, opts);
  const ox = cols - L.view.w * 2 >> 1;     // centre the lattice when the column count is odd
  const fade = Math.max(0, L.fade);
  const paper = opts.tint ? GROUND : null;
  for (let vy = 0; vy < L.view.h; vy++) for (let vx = 0; vx < L.view.w; vx++) {
    const x = vx + L.view.ox, y = vy + L.view.oy;
    const col = ox + vx * 2, row = vy;
    if (col < 0 || col + 1 >= cols || row >= rows) continue;
    const i = L.idx(x, y), id = L.stroke[i]!;
    if (id === -1 || L.born[i]! > L.clock) {
      cells[row * cols + col] = { ch: "·", fg: PAPER_DOT, bg: paper };
      continue;
    }
    const age = L.clock - L.born[i]!;
    const base = L.palette[L.colorOf[id]! % L.palette.length]!;
    const ink = mix(mix(GROUND, base, fade), WHITE, Math.exp(-age * 5) * 0.55 * fade);
    const glowK = (Math.exp(-age * 0.8) * 0.9 + 0.22) * fade;
    const bg = opts.tint ? mix(GROUND, base, glowK * 0.22) : null;
    const halo = scale(base, glowK);
    if (L.styleOf[id] === "dots") { cells[row * cols + col] = { ch: "•", fg: ink, bg, halo }; continue; }
    const m = L.mask(x, y);
    cells[row * cols + col] = { ch: glyphFor(m), fg: ink, bg, halo };
    // The column between two dots carries the horizontal stroke.
    if (m & 1) cells[row * cols + col + 1] = { ch: "─", fg: ink, bg, halo };
  }
  return cells;
}

export const lattice: Piece = {
  name: "lattice",
  blurb: "echoes grow outward from seeds, dot to dot",
  create(cols: number, rows: number, seed: number, opts: PieceOptions): PieceInstance {
    let r = rng(seed);
    let L = new Lattice(cols >> 1, rows, Math.floor(r() * 1e9));
    return {
      tick(dt) { if (!L.tick(dt)) { const pens = L.pens; L = new Lattice(cols >> 1, rows, Math.floor(r() * 1e9)); L.pens = pens; } },
      cells: () => compose(L, cols, rows, opts),
      react(p: Pulse) {
        const wake = () => { if (L.state !== "growing") { L.state = "growing"; L.fade = 1; } L.nextStep = Math.min(L.nextStep, L.clock + 0.4); };
        const anywhere = () => [L.view.ox + Math.floor(r() * L.view.w), L.view.oy + Math.floor(r() * L.view.h)] as const;
        if (p.kind === "tool") {
          // A tool call plants a seed somewhere in view; its echoes join the drawing.
          const [x, y] = anywhere();
          L.plant(x, y, pick(r, [["square", 2], ["diamond", 2], ["plus", 1.5], ["dot", 1]]), L.clock);
          wake();
        } else if (p.kind === "agents") {
          // A subagent arriving plants a star; while it runs it is another pen.
          if (p.running > L.pens) { const [x, y] = anywhere(); L.plant(x, y, "star", L.clock); wake(); }
          L.pens = Math.min(6, p.running);   // a stop that never comes cannot leave it racing forever
        } else {
          // Your message recolours the whole drawing at once and starts a star at the centre.
          const names = Object.keys(PALETTES);
          L.paletteName = names[(names.indexOf(L.paletteName) + 1) % names.length]!;
          L.palette = PALETTES[L.paletteName]!;
          L.plant(L.C0, L.C0, "star", L.clock);
          wake();
        }
      },
      label: () => `echo lattice / ${L.symmetry} / ${L.paletteName} / echo ${L.gen}`,
    };
  },
};
