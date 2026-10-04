// Every glyph the pieces draw, as shapes rather than a font: strokes, dots and rings in a unit cell, rasterized
// with anti-aliasing at whatever pixel size a cell gets. Used by the saver's --pixels mode, where the terminal's
// own font no longer decides how small the art can be.

type Shape =
  | { k: "seg"; a: [number, number]; b: [number, number] }
  | { k: "dot"; c: [number, number]; r: number }
  | { k: "ring"; c: [number, number]; r: number };

const seg = (ax: number, ay: number, bx: number, by: number): Shape => ({ k: "seg", a: [ax, ay], b: [bx, by] });
const dot = (x: number, y: number, r: number): Shape => ({ k: "dot", c: [x, y], r });
const ring = (x: number, y: number, r: number): Shape => ({ k: "ring", c: [x, y], r });
const M = 0.5;   // the cell's centre, where strokes meet

// Box-drawing arms from the centre: L R U D.
const arms = (l: boolean, r: boolean, u: boolean, d: boolean): Shape[] => [
  ...(l ? [seg(0, M, M, M)] : []), ...(r ? [seg(M, M, 1, M)] : []),
  ...(u ? [seg(M, 0, M, M)] : []), ...(d ? [seg(M, M, M, 1)] : []),
];
const END = 0.06;   // a pen lift leaves a small pool of ink

const SHAPES: Record<string, Shape[]> = {
  "─": arms(true, true, false, false), "│": arms(false, false, true, true),
  "┌": arms(false, true, false, true), "┐": arms(true, false, false, true),
  "└": arms(false, true, true, false), "┘": arms(true, false, true, false),
  "├": arms(false, true, true, true), "┤": arms(true, false, true, true),
  "┬": arms(true, true, false, true), "┴": arms(true, true, true, false),
  "┼": arms(true, true, true, true),
  "╴": [...arms(true, false, false, false), dot(M, M, END)], "╶": [...arms(false, true, false, false), dot(M, M, END)],
  "╵": [...arms(false, false, true, false), dot(M, M, END)], "╷": [...arms(false, false, false, true), dot(M, M, END)],
  "╎": [seg(M, 0.1, M, 0.4), seg(M, 0.6, M, 0.9)],
  "╱": [seg(-0.02, 1.02, 1.02, -0.02)], "╲": [seg(-0.02, -0.02, 1.02, 1.02)],
  "╳": [seg(-0.02, 1.02, 1.02, -0.02), seg(-0.02, -0.02, 1.02, 1.02)],
  "∧": [seg(0.15, 0.85, M, 0.2), seg(M, 0.2, 0.85, 0.85)], "∨": [seg(0.15, 0.15, M, 0.8), seg(M, 0.8, 0.85, 0.15)],
  "<": [seg(0.85, 0.15, 0.2, M), seg(0.2, M, 0.85, 0.85)], ">": [seg(0.15, 0.15, 0.8, M), seg(0.8, M, 0.15, 0.85)],
  "·": [dot(M, M, 0.07)], "•": [dot(M, M, 0.16)], "+": [seg(0.2, M, 0.8, M), seg(M, 0.3, M, 0.7)],
  // The brightness ramp, light to heavy, so a ray-traced piece reads as tone.
  ".": [dot(M, 0.72, 0.07)], ",": [dot(M, 0.68, 0.08), seg(M, 0.72, 0.42, 0.88)],
  ":": [dot(M, 0.32, 0.07), dot(M, 0.68, 0.07)], ";": [dot(M, 0.32, 0.07), dot(M, 0.66, 0.08), seg(M, 0.7, 0.42, 0.86)],
  "-": [seg(0.25, M, 0.75, M)], "=": [seg(0.22, 0.38, 0.78, 0.38), seg(0.22, 0.62, 0.78, 0.62)],
  "*": [seg(0.2, M, 0.8, M), seg(M, 0.25, M, 0.75), seg(0.28, 0.33, 0.72, 0.67), seg(0.72, 0.33, 0.28, 0.67)],
  "o": [ring(M, 0.56, 0.2)], "x": [seg(0.25, 0.32, 0.75, 0.78), seg(0.75, 0.32, 0.25, 0.78)],
  "O": [ring(M, M, 0.3)], "#": [seg(0.35, 0.15, 0.35, 0.85), seg(0.65, 0.15, 0.65, 0.85), seg(0.15, 0.38, 0.85, 0.38), seg(0.15, 0.62, 0.85, 0.62)],
  "%": [ring(M, M, 0.28), seg(0.2, 0.85, 0.8, 0.15)], "@": [dot(M, M, 0.3), ring(M, M, 0.42)],
  // Letters the mandala's charms mirror: a stem and a bowl.
  b: [seg(0.32, 0.12, 0.32, 0.88), ring(0.52, 0.66, 0.2)], d: [seg(0.68, 0.12, 0.68, 0.88), ring(0.48, 0.66, 0.2)],
  p: [seg(0.32, 0.12, 0.32, 0.88), ring(0.52, 0.34, 0.2)], q: [seg(0.68, 0.12, 0.68, 0.88), ring(0.48, 0.34, 0.2)],
  " ": [],
};

/** Whether `ch` has a drawn shape (anything else falls back to a small square). */
export const hasShape = (ch: string) => ch in SHAPES;

const cache = new Map<string, Uint8Array>();

/** Coverage (0–255) of `ch` drawn in a `w`×`h` pixel cell, row-major. Unknown glyphs draw as a small square. */
export function glyphMask(ch: string, w: number, h: number): Uint8Array {
  const key = `${ch}|${w}|${h}`;
  let m = cache.get(key);
  if (m) return m;
  m = new Uint8Array(w * h);
  const shapes = SHAPES[ch] ?? [seg(0.3, 0.3, 0.7, 0.3), seg(0.7, 0.3, 0.7, 0.7), seg(0.7, 0.7, 0.3, 0.7), seg(0.3, 0.7, 0.3, 0.3)];
  const half = Math.max(0.55, Math.min(w, h) * 0.09);           // stroke half-width, in pixels
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5, py = y + 0.5;
    let cover = 0;
    for (const s of shapes) {
      let d: number;
      if (s.k === "seg") {
        const ax = s.a[0] * w, ay = s.a[1] * h, bx = s.b[0] * w, by = s.b[1] * h;
        const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
        d = Math.hypot(px - ax - vx * t, py - ay - vy * t) - half;
      } else {
        // Dots and rings are round on screen, so their radius is measured in the cell's shorter side.
        const r = s.r * Math.min(w, h * 0.6) * 1.6;
        const dd = Math.hypot(px - s.c[0] * w, py - s.c[1] * h);
        d = s.k === "dot" ? dd - Math.max(0.6, r) : Math.abs(dd - r) - half;
      }
      cover = Math.max(cover, Math.max(0, Math.min(1, 0.5 - d)));
    }
    m[y * w + x] = Math.round(cover * 255);
  }
  cache.set(key, m);
  return m;
}
