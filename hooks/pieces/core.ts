// Shared by the Claude Code mod (hooks/register.tsx) and the terminal saver (tty/saver.ts).
// Plain TypeScript only: no Node, no DOM, so it runs in Bun and in the mod's own environment alike.

export type RGB = [number, number, number];

/** One terminal cell. `bg: null` is the terminal's own background; `halo` is glow colour × strength, for graphics. */
export interface Cell { ch: string; fg: RGB; bg: RGB | null; halo?: RGB }

export interface PieceOptions {
  /** Paint the glow as tinted cell backgrounds (text terminals, the mod's Raster); false leaves it to `halo`. */
  tint: boolean;
  /** 0–1: how much work a frame may do (Gargantua's ray steps). */
  quality?: number;
}

export interface PieceInstance {
  tick(dt: number): void;
  /** `cols * rows` cells, row-major. */
  cells(): Cell[];
  /** Something happened in the session: a tool call, the running subagents changed, or a message arrived mid-turn. */
  react?(pulse: Pulse): void;
  /** 0 while the piece plays; rising to 1 as it fades out on its own (a page ending). */
  ending?(): number;
  label(): string;
}

export type Pulse = { kind: "tool" } | { kind: "message" } | { kind: "agents"; running: number };

export interface Piece {
  name: string;
  /** One line for a picker. */
  blurb: string;
  create(cols: number, rows: number, seed: number, opts: PieceOptions): PieceInstance;
}

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const GROUND = hex("#0c0d11");
export const PAPER_DOT = hex("#2b2d36");
export const WHITE: RGB = [255, 255, 255];

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(r: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1]![0];
}

export function blankCells(n: number, opts: PieceOptions): Cell[] {
  const blank: Cell = { ch: " ", fg: PAPER_DOT, bg: opts.tint ? GROUND : null };
  return new Array(n).fill(blank);
}

// ── The mod's Raster wants base64 of little-endian u32 triplets [codePoint, fg, bg] ──
const DEFAULT_COLOR = 0x01000000;
// The Raster paints 1024 colour pairs at once; rounding each channel to a step of 8 keeps gradients inside that.
const q8 = (v: number) => Math.max(0, Math.min(255, Math.round(v / 8) * 8)) | 0;
const packColor = (c: RGB | null) => (c ? (q8(c[0]) << 16) | (q8(c[1]) << 8) | q8(c[2]) : DEFAULT_COLOR);

export function encodeRaster(cells: Cell[]): string {
  const words = new Uint32Array(cells.length * 3);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const cp = c.ch.codePointAt(0) ?? 32;
    words[i * 3] = cp > 0xffff || cp < 32 ? 32 : cp;     // width-1 BMP only, or the Raster refuses the tree
    words[i * 3 + 1] = packColor(c.fg);
    words[i * 3 + 2] = packColor(c.bg);
  }
  return toBase64(new Uint8Array(words.buffer));
}

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? A[n & 63]! : "=");
  }
  return out;
}
