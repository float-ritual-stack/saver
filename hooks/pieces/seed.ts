// Seed, after the bear tattoo's crown: a flower of life drawn circle by circle, dotwork shading where circles
// overlap, a triskele turning at the centre, and a nested triangle frame beneath. Tool calls scatter fresh
// stipple; each running subagent opens another ring of circles; your message turns the triskele around.
import { GROUND, PAPER_DOT, blankCells, hex, mix } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB } from "./core";

const INK = hex("#e9e5da");
const ACCENTS: RGB[] = ["#ff5fa8", "#7a8bff", "#ff5a4a", "#2ee0c8", "#9bd16a", "#ffb03a"].map(hex);

// A stroke glyph for a curve passing through, by the direction of its tangent.
const TANGENT = ["─", "╲", "│", "╱"];

// Where the flowers go. The outer circle's radius is fitted to the pane, so more rings only make the circles
// finer and nothing overflows. With room below, each flower stands on its triangle frame and holds its triskele
// there; without it, triskeles turn between the flowers. Wide panes take a row of flowers, tall ones a column.
interface Layout {
  Ro: number;
  flowers: { x: number; y: number }[];
  frames: { x: number; top: number; apex: number; half: number }[];
  triskeles: { x: number; y: number; r: number }[];
  /** The frames' shared top line, one span per row of flowers. */
  lines: { y: number; x0: number; x1: number }[];
}
const FRAME = 1.15, GAP = 0.1;   // a frame's height, and the gap above it, in outer radii

function layout(w: number, h: number): Layout {
  const out: Layout = { Ro: 0, flowers: [], frames: [], triskeles: [], lines: [] };
  const framed = Math.min((h - 1.5) / (2 + FRAME + GAP), (w - 1) / 2.2);
  if (framed >= 5) {
    let Ro = framed;
    const nx = Math.max(1, Math.round(w / (2.2 * Ro + 1)));
    Ro = Math.min(Ro, (w / nx - 1) / 2.2);
    const P = w / nx, unit = (2 + FRAME) * Ro + 1;
    const ny = Math.max(1, Math.floor((h - 0.5) / unit));
    const y0 = (h - ny * unit) / 2;
    for (let iy = 0; iy < ny; iy++) {
      const cy = y0 + iy * unit + Ro + 0.25, top = cy + Ro + 0.5, apex = top + FRAME * Ro;
      const half = Math.min(0.9 * FRAME * Ro, P / 2 - 0.5);
      for (let ix = 0; ix < nx; ix++) {
        const x = P * (ix + 0.5);
        out.flowers.push({ x, y: cy });
        out.frames.push({ x, top, apex, half });
        out.triskeles.push({ x, y: top + (apex - top) * 0.34, r: half * 0.62 });
      }
      out.lines.push({ y: top, x0: P / 2 - half, x1: w - P / 2 + half });
    }
    out.Ro = Ro;
    return out;
  }
  const G = 1.3;                                       // the gap a triskele turns in, in outer radii
  let Ro = Math.max(2, Math.min((h - 1) / 2, (w - 1) / 2));
  const n = Math.max(1, Math.round((w + G * Ro) / ((2 + G) * Ro)));
  Ro = Math.min(Ro, (w - 1) / (2 * n + G * (n - 1)));
  const span = (2 * n + G * (n - 1)) * Ro, cy = h / 2;
  for (let i = 0; i < n; i++) {
    const x = (w - span) / 2 + Ro + i * (2 + G) * Ro;
    out.flowers.push({ x, y: cy });
    if (i > 0) out.triskeles.push({ x: x - (1 + G / 2) * Ro, y: cy, r: Math.min(Ro * 0.55, (h / 2 - 0.5) / 1.05) });
  }
  if (n === 1) out.triskeles.push({ x: out.flowers[0]!.x, y: cy, r: Ro * 0.4 });   // alone, it turns at the heart
  out.Ro = Ro;
  return out;
}

export const seedPiece: Piece = {
  name: "seed",
  blurb: "a flower of life drawn circle by circle, dotwork shading and a turning triskele",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const w = cols >> 1, h = rows;                       // two columns to a unit, so circles stay round
    const L = layout(w, h), Ro = L.Ro;
    let time = 0, rings = 1, spin = 1, grain = seed >>> 0, accent = seed % ACCENTS.length;

    // Circle centres on a hexagonal lattice, ring by ring outward from the centre, relative to it.
    const centres = (n: number, rho: number) => {
      const out: { x: number; y: number; ring: number }[] = [{ x: 0, y: 0, ring: 0 }];
      for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
        const s = -q - r, ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if (ring === 0 || ring > n) continue;
        out.push({ x: rho * (q + r / 2), y: rho * r * Math.sqrt(3) / 2, ring });
      }
      return out;
    };
    const hash = (a: number, b: number) => {
      let t = (a * 374761393 + b * 668265263 + grain) | 0;
      t = Math.imul(t ^ (t >>> 13), 1274126177);
      return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
    };
    const nearest = <T extends { x: number }>(items: T[], px: number, py: number, y: (t: T) => number) => {
      let best = items[0]!, bd = Infinity;
      for (const it of items) { const d = Math.abs(px - it.x) + Math.abs(py - y(it)) * 0.5; if (d < bd) { bd = d; best = it; } }
      return best;
    };

    return {
      tick(dt) { time += dt; },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const ox = (cols - w * 2) >> 1;
        const paper = opts.tint ? GROUND : null;
        // Small flowers keep fewer rings, so a circle never shrinks below legibility.
        const n = Math.max(1, Math.min(rings, Math.floor(Ro / 2) - 1)), rho = Ro / (n + 1);
        const cs = centres(n, rho);
        // Each circle is drawn in as a sweeping arc, ring by ring; each flower starts a beat after the last.
        const drawn = (i: number, t: number) => Math.max(0, Math.min(1, (t - i * 0.9) / 1.6));
        // The triskeles: three spirals a third of a turn apart, each traced as a path, per column (half a unit
        // across) so the curves are twice as fine as the dot grid. Neighbours turn opposite ways, mirrored.
        const triskele = new Set<number>();
        L.triskeles.forEach((tk, k) => {
          const dir = k % 2 ? -spin : spin;
          for (let arm = 0; arm < 3; arm++) {
            const base = arm * (Math.PI * 2) / 3 + dir * time * 0.3;
            const hubX = tk.x + Math.cos(base) * tk.r * 0.5, hubY = tk.y + Math.sin(base) * tk.r * 0.5;
            for (let t = 0; t < Math.PI * 2.6; t += 0.03) {
              const r = (t / (Math.PI * 2.6)) * tk.r * 0.55, a2 = base + Math.PI + dir * t;
              const col = Math.round(ox + (hubX + Math.cos(a2) * r) * 2), row = Math.round(hubY + Math.sin(a2) * r - 0.5);
              if (col >= 0 && col < cols && row >= 0 && row < rows) triskele.add(row * cols + col);
            }
          }
        });
        const tangentAt = (dx: number, dy: number) => Math.round(((Math.atan2(dy, dx) + Math.PI * 1.5) % Math.PI) / (Math.PI / 4)) % 4;
        for (let y = 0; y < h; y++) for (let col = 0; col < cols; col++) {
          const px = (col - ox) / 2 + 0.25, py = y + 0.5;
          const fl = nearest(L.flowers, px, py, (f) => f.y), fi = L.flowers.indexOf(fl), t = time - fi * 0.7;
          const glow = ACCENTS[(accent + fi) % ACCENTS.length]!;
          let stroke = -1, inside = 0;
          for (let i = 0; i < cs.length; i++) {
            const c = cs[i]!, dx = px - fl.x - c.x, dy = py - fl.y - c.y, d = Math.hypot(dx, dy);
            if (d < rho) inside++;
            if (Math.abs(d - rho) >= 0.42) continue;
            const ang = ((Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2)) / (Math.PI * 2);
            if (ang <= drawn(i, t)) stroke = tangentAt(dx, dy);
          }
          // The enclosing circle around the whole flower.
          const odx = px - fl.x, ody = py - fl.y;
          if (Math.abs(Math.hypot(odx, ody) - Ro) < 0.42 && t > cs.length * 0.9) stroke = tangentAt(odx, ody);
          let ch = "", fg = INK;
          if (stroke >= 0) ch = TANGENT[stroke]!;
          else if (inside >= 2 && t > 2) {
            // Dotwork: denser where more circles overlap, re-scattered now and then.
            if (hash(col, y) < Math.min(0.6, (inside - 1) * 0.18)) { ch = inside > 2 ? ":" : "·"; fg = mix(INK, glow, 0.35); }
          }
          // The nested triangle frame below, apex down.
          if (!ch && L.frames.length) {
            const f = nearest(L.frames, px, py, (f) => (f.top + f.apex) / 2);
            if (py > f.top && py < f.apex) {
              const k = (py - f.top) / (f.apex - f.top), edge = f.half * (1 - k), ax = Math.abs(px - f.x);
              if (Math.abs(ax - edge) < 0.3 || Math.abs(ax - edge * 0.62) < 0.3) { ch = px > f.x ? "╱" : "╲"; fg = mix(INK, glow, 0.25); }
            }
          }
          if (!ch && L.lines.some((l) => Math.abs(py - l.y) < 0.5 && px > l.x0 && px < l.x1)) { ch = "─"; fg = mix(INK, glow, 0.25); }
          if (!ch && triskele.has(y * cols + col)) { ch = "•"; fg = glow; }
          if (!ch) { cells[y * cols + col] = { ch: col % 2 === ox % 2 ? "·" : " ", fg: PAPER_DOT, bg: paper }; continue; }
          cells[y * cols + col] = { ch, fg, bg: opts.tint ? mix(GROUND, glow, stroke >= 0 ? 0.12 : 0.05) : null, halo: [glow[0] * 0.35, glow[1] * 0.35, glow[2] * 0.35] };
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") grain = (grain * 1103515245 + 12345) >>> 0;     // fresh stipple
        else if (p.kind === "agents") rings = 1 + Math.min(2, p.running);
        else { spin = -spin; accent = (accent + 1) % ACCENTS.length; }
      },
      label: () => "seed",
    };
  },
};
