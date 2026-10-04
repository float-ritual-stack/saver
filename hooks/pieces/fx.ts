// Effects over any piece's cells, after tachyonfx and terminaltexteffects: Amiga-style colour cycling, shimmer,
// a sweeping beam, hue drift and glitches while a piece plays; a decrypt as it arrives; and a palette burst
// that dissolves it away as it leaves. Effects never change what a piece draws, only how its cells look.
import { rng } from "./core";
import type { Cell, Piece, PieceInstance, PieceOptions, Pulse, RGB } from "./core";

// ── Colour helpers ──────────────────────────────────────────────────────────
const clamp = (v: number) => Math.max(0, Math.min(255, v));
const lerp = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const fract = (x: number) => x - Math.floor(x);
function hueRotate(c: RGB, turns: number): RGB {
  // Rotation about the grey axis: cheap, and keeps brightness.
  const a = turns * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a), k = 1 / 3, s = Math.sqrt(k);
  const m = (i: number, j: number) => (i === j ? cos + (1 - cos) * k : (1 - cos) * k + (((j - i + 3) % 3 === 1) ? -s * sin : s * sin));
  return [clamp(c[0] * m(0, 0) + c[1] * m(0, 1) + c[2] * m(0, 2)), clamp(c[0] * m(1, 0) + c[1] * m(1, 1) + c[2] * m(1, 2)), clamp(c[0] * m(2, 0) + c[1] * m(2, 1) + c[2] * m(2, 2))];
}
function hash(a: number, b: number, c: number) {
  let t = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Colour-cycling ramps: each loops back on itself, so a shift never shows a seam.
const RAMPS: Record<string, RGB[]> = {
  copper: ["#200a40", "#7a1fa0", "#ff3fb4", "#ffb03a", "#fff2c0", "#ffb03a", "#ff3fb4", "#7a1fa0"].map(hex),
  ocean: ["#06203a", "#1460a0", "#2ee0c8", "#e9fff8", "#2ee0c8", "#1460a0"].map(hex),
  rainbow: ["#ff3b4a", "#ff8a3d", "#ffd23f", "#9bf05a", "#2ee0c8", "#5b8cff", "#a57bff", "#f05bf0"].map(hex),
  ember: ["#2a0806", "#a01c10", "#ff5a1f", "#ffd23f", "#ff5a1f", "#a01c10"].map(hex),
  ice: ["#1a1f3a", "#5b8cff", "#c8e6ff", "#ffffff", "#c8e6ff", "#5b8cff"].map(hex),
};
const RAMP_NAMES = Object.keys(RAMPS);
const ramp = (r: RGB[], u: number): RGB => {
  const x = fract(u) * r.length, i = Math.floor(x);
  return lerp(r[i]!, r[(i + 1) % r.length]!, x - i);
};

/** An ink cell: something the piece drew, as opposed to paper and its dots. */
const inked = (c: Cell) => c.ch !== " " && c.ch !== "·";
// Noise for decrypts and glitches: only glyphs every surface draws, the --pixels mode included.
const NOISE = [..."#%@*+=-:;oxO<>"].concat(["╱", "╲", "╳", "∧", "∨", "┼", "╎"]);

// ── Ambient effects ─────────────────────────────────────────────────────────
type Ctx = { cols: number; rows: number; t: number; seed: number };
type Ambient = (c: Cell, x: number, y: number, ctx: Ctx, k: number) => Cell;

const AMBIENT: Record<string, (r: () => number) => Ambient> = {
  // Amiga colour cycling: a ramp flows across the drawing along a diagonal, a ring or a sweep of angle.
  cycle(r) {
    const name = RAMP_NAMES[Math.floor(r() * RAMP_NAMES.length)]!, shape = Math.floor(r() * 3), speed = 0.15 + r() * 0.35, scale = 0.02 + r() * 0.04;
    return (c, x, y, { cols, rows, t }, k) => {
      if (!inked(c)) return c;
      const dx = x / 2 - cols / 4, dy = y - rows / 2;
      const key = shape === 0 ? (x / 2 + y) * scale : shape === 1 ? Math.hypot(dx, dy) * scale * 1.5 : Math.atan2(dy, dx) / (Math.PI * 2);
      const col = ramp(RAMPS[name]!, key - t * speed);
      return { ...c, fg: lerp(c.fg, col, k * 0.75), halo: c.halo ? lerp(c.halo, col, k * 0.5) : c.halo };
    };
  },
  // Shimmer: a few strokes catch the light at a time, flash white and fade.
  shimmer(r) {
    const rate = 0.004 + r() * 0.01;
    return (c, x, y, { t, seed }, k) => {
      if (!inked(c)) return c;
      const slot = Math.floor(t * 6), phase = fract(t * 6);
      if (hash(x, y, slot + seed) > rate * (1 + k * 6)) return c;
      const glint = (1 - phase) * Math.min(1, k + 0.4);
      return { ...c, fg: lerp(c.fg, [255, 255, 255], glint), halo: lerp(c.halo ?? c.fg, [255, 255, 255], glint * 0.6) };
    };
  },
  // A beam of light sweeping across, lifting whatever it passes.
  beam(r) {
    const speed = 6 + r() * 10, width = 2 + r() * 4, dir = r() < 0.5 ? 1 : -1;
    return (c, x, y, { cols, rows, t }, k) => {
      const span = cols / 2 + rows + width * 4;
      const pos = fract((t * speed) / span) * span - width * 2;
      const at = dir > 0 ? x / 2 + y : cols / 2 - x / 2 + y;
      const lift = Math.max(0, 1 - Math.abs(at - pos) / width) * k;
      if (lift <= 0) return c;
      return inked(c) ? { ...c, fg: lerp(c.fg, [255, 255, 255], lift * 0.7), halo: lerp(c.halo ?? c.fg, [255, 255, 255], lift * 0.4) }
                      : { ...c, fg: lerp(c.fg, [120, 130, 160], lift * 0.8) };
    };
  },
  // The whole palette drifting slowly around the colour wheel.
  drift(r) {
    const speed = (0.01 + r() * 0.03) * (r() < 0.5 ? 1 : -1);
    return (c, _x, _y, { t }, k) => (inked(c) ? { ...c, fg: hueRotate(c.fg, t * speed * k), halo: c.halo ? hueRotate(c.halo, t * speed * k) : c.halo } : c);
  },
  // Now and then a row tears: glyphs swap for noise for a moment.
  glitch(r) {
    const rate = 0.02 + r() * 0.04;
    return (c, x, y, { t, seed }, k) => {
      const slot = Math.floor(t * 10);
      if (hash(0, y, slot + seed) > rate * k || !inked(c)) return c;
      return hash(x, y, slot) < 0.5 ? { ...c, ch: NOISE[Math.floor(hash(y, x, slot + 7) * NOISE.length)]!, fg: hueRotate(c.fg, 0.5) } : c;
    };
  },
};
export const EFFECTS = Object.keys(AMBIENT);

/** Colours rounded to steps of 8, so an effect's tiny shifts never count as a change. */
const q = (c: RGB): RGB => [(c[0] >> 3) << 3, (c[1] >> 3) << 3, (c[2] >> 3) << 3];
const quantize = (c: Cell): Cell => ({ ...c, fg: q(c.fg), bg: c.bg ? q(c.bg) : c.bg, halo: c.halo ? q(c.halo) : c.halo });

// ── Arrivals and departures ─────────────────────────────────────────────────
/** Decrypt: each cell shows noise in a cold green until its moment, then settles into what the piece drew. */
function decrypt(c: Cell, x: number, y: number, p: number, seed: number, t: number): Cell {
  if (!inked(c)) return c;
  const settle = hash(x, y, seed) * 0.8;
  if (p >= settle + 0.2) return c;
  if (p < settle * 0.5) return { ...c, ch: " ", halo: undefined };
  const ch = NOISE[Math.floor(hash(x, y, Math.floor(t * 20)) * NOISE.length)]!;
  return { ...c, ch, fg: lerp([60, 255, 140], c.fg, Math.max(0, (p - settle) / 0.2)), halo: [20, 90, 50] };
}
/** Leaving: the palette spins faster and brighter, then cells blink out one by one. */
function depart(c: Cell, x: number, y: number, p: number, seed: number, t: number, r: RGB[]): Cell {
  if (!inked(c)) return p > 0.85 ? { ...c, fg: lerp(c.fg, [0, 0, 0], (p - 0.85) / 0.15) } : c;
  const spin = ramp(r, (x / 2 + y) * 0.05 - t * (0.6 + p * 3));
  const lit = { ...c, fg: lerp(c.fg, spin, Math.min(1, p * 2)), halo: lerp(c.halo ?? c.fg, spin, Math.min(1, p * 2)) };
  const gone = 0.45 + hash(x, y, seed) * 0.5;
  if (p < gone) return lit;
  if (p < gone + 0.05) return { ...lit, ch: "•", fg: [255, 255, 255] };
  return { ...c, ch: " ", halo: undefined };
}

// ── The wrapper ─────────────────────────────────────────────────────────────
export type FxMode = "auto" | "off" | (string & {});

export interface FxControl {
  /** Play this piece's departure, then call `done`. */
  leave?(seconds: number, done: () => void): void;
}

/** A piece with effects on top. `mode` picks them: auto (a seeded mix), off, or one effect by name. */
export function withFx(piece: Piece, mode: () => FxMode = () => "auto"): Piece {
  return {
    name: piece.name,
    blurb: piece.blurb,
    create(cols: number, rows: number, seed: number, opts: PieceOptions): PieceInstance & FxControl {
      const inner = piece.create(cols, rows, seed, opts);
      const r = rng(seed ^ 0x5eed);
      // Every piece gets its own mix: colour cycling half the time, plus one or two others, at its own strength.
      const pick: string[] = [];
      if (r() < 0.55) pick.push("cycle");
      for (const name of ["shimmer", "beam", "drift", "glitch"]) if (r() < (name === "glitch" ? 0.15 : 0.4)) pick.push(name);
      if (!pick.length) pick.push("shimmer");
      const made: Record<string, Ambient> = {};
      for (const name of EFFECTS) made[name] = AMBIENT[name]!(r);
      const strength: Record<string, number> = {};
      for (const name of EFFECTS) strength[name] = 0.35 + r() * 0.45;
      const leaveRamp = RAMPS[RAMP_NAMES[Math.floor(r() * RAMP_NAMES.length)]!]!;

      let t = 0, arrive = 0, leaving: { at: number; len: number; done: () => void } | null = null;
      // Bursts from the session: a tool call shimmers, a message spins the palette.
      let shimmerBurst = 0, cycleBurst = 0;

      return {
        tick(dt) {
          t += dt; arrive += dt;
          shimmerBurst *= Math.exp(-dt * 2); cycleBurst *= Math.exp(-dt * 0.8);
          inner.tick(dt);
          if (leaving && t - leaving.at >= leaving.len) { const d = leaving.done; leaving = null; d(); }
        },
        cells() {
          const cells = inner.cells();
          const m = mode();
          const active = m === "off" ? [] : m === "auto" ? pick : EFFECTS.includes(m) ? [m] : pick;
          // The piece's own fade (a page ending) brings a palette spin with it.
          const ending = inner.ending?.() ?? 0;
          // Colour effects step like Amiga colour cycling (12 steps a second) rather than slide, so a cell only
          // changes when its colour does: the terminal is sent a fraction of the cells.
          const ctx: Ctx = { cols, rows, t: Math.floor(t * 12) / 12, seed };
          const arriving = arrive < 1.6 && m !== "off" ? arrive / 1.6 : 1;
          const p = leaving ? Math.min(1, (t - leaving.at) / leaving.len) : 0;
          const extra: [string, number][] = [];
          if (shimmerBurst > 0.02 && !active.includes("shimmer")) extra.push(["shimmer", shimmerBurst]);
          if ((cycleBurst > 0.02 || ending > 0) && !active.includes("cycle")) extra.push(["cycle", Math.max(cycleBurst, ending)]);
          if (!active.length && !extra.length && arriving >= 1 && !leaving) return cells;
          const out = new Array<Cell>(cells.length);
          for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            let c = cells[i]!;
            for (const name of active) {
              const k = strength[name]! + (name === "shimmer" ? shimmerBurst : name === "cycle" ? Math.max(cycleBurst, ending) : 0);
              c = made[name]!(c, x, y, ctx, Math.min(1, k));
            }
            for (const [name, k] of extra) c = made[name]!(c, x, y, ctx, Math.min(1, k));
            if (arriving < 1) c = decrypt(c, x, y, arriving, seed, t);
            if (leaving) c = depart(c, x, y, p, seed, t, leaveRamp);
            out[i] = c === cells[i] ? c : quantize(c);
          }
          return out;
        },
        react(pulse: Pulse) {
          if (pulse.kind === "tool") shimmerBurst = Math.min(1, shimmerBurst + 0.5);
          if (pulse.kind === "message") cycleBurst = 1;
          inner.react?.(pulse);
        },
        ending: () => inner.ending?.() ?? 0,
        label: () => inner.label(),
        leave(seconds, done) { leaving = { at: t, len: seconds, done }; },
      };
    },
  };
}
