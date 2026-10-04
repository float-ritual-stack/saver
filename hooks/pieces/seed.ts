// Seed, after the bear tattoo's crown: a flower of life drawn circle by circle, dotwork shading where circles
// overlap, a triskele turning at the centre, and a nested triangle frame beneath. Tool calls scatter fresh
// stipple; each running subagent opens another ring of circles; your message turns the triskele around.
import { GROUND, PAPER_DOT, blankCells, hex, mix } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB } from "./core";

const INK = hex("#e9e5da");
const ACCENTS: RGB[] = ["#ff5fa8", "#7a8bff", "#ff5a4a", "#2ee0c8"].map(hex);

// A stroke glyph for a curve passing through, by the direction of its tangent.
const TANGENT = ["─", "╲", "│", "╱"];

export const seedPiece: Piece = {
  name: "seed",
  blurb: "a flower of life drawn circle by circle, dotwork shading and a turning triskele",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const w = cols >> 1, h = rows;                       // two columns to a unit, so circles stay round
    const cx = w / 2, cy = h * 0.42;
    const rho = Math.max(3, Math.min(w, h) * 0.13);       // one circle's radius
    let time = 0, rings = 1, spin = 1, grain = seed >>> 0, accent = seed % ACCENTS.length;

    // Circle centres on a hexagonal lattice, ring by ring outward from the centre.
    const centres = (n: number) => {
      const out: { x: number; y: number; ring: number }[] = [{ x: cx, y: cy, ring: 0 }];
      for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) {
        const s = -q - r, ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if (ring === 0 || ring > n) continue;
        out.push({ x: cx + rho * (q + r / 2), y: cy + rho * r * Math.sqrt(3) / 2, ring });
      }
      return out;
    };
    const hash = (a: number, b: number) => {
      let t = (a * 374761393 + b * 668265263 + grain) | 0;
      t = Math.imul(t ^ (t >>> 13), 1274126177);
      return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
    };

    return {
      tick(dt) { time += dt; },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const ox = (cols - w * 2) >> 1;
        const paper = opts.tint ? GROUND : null;
        const cs = centres(rings);
        // Each circle is drawn in as a sweeping arc, ring by ring.
        const drawn = (i: number) => Math.max(0, Math.min(1, (time - i * 0.9) / 1.6));
        const glow = ACCENTS[accent]!;
        const frameTop = cy + rho * (rings + 1.2), apex = h - 1, half = (apex - frameTop) * 0.9;
        // Traced per column (half a unit across), so the curves are twice as fine as the dot grid.
        const triY = frameTop + (apex - frameTop) * 0.34, triR = Math.max(4, half * 0.62);
        // The triskele inside the frame: three spirals a third of a turn apart, each traced as a path.
        const triskele = new Set<number>();
        for (let arm = 0; arm < 3; arm++) {
          const base = arm * (Math.PI * 2) / 3 + spin * time * 0.3;
          const hubX = cx + Math.cos(base) * triR * 0.5, hubY = triY + Math.sin(base) * triR * 0.5;
          for (let t = 0; t < Math.PI * 2.6; t += 0.03) {
            const r = (t / (Math.PI * 2.6)) * triR * 0.55, a2 = base + Math.PI + spin * t;
            const col = Math.round(ox + (hubX + Math.cos(a2) * r) * 2), row = Math.round(hubY + Math.sin(a2) * r - 0.5);
            if (col >= 0 && col < cols && row >= 0 && row < rows) triskele.add(row * cols + col);
          }
        }
        for (let y = 0; y < h; y++) for (let col = 0; col < cols; col++) {
          const px = (col - ox) / 2 + 0.25, py = y + 0.5;
          let stroke = -1, inside = 0;
          const tangentAt = (dx: number, dy: number) => Math.round(((Math.atan2(dy, dx) + Math.PI * 1.5) % Math.PI) / (Math.PI / 4)) % 4;
          for (let i = 0; i < cs.length; i++) {
            const c = cs[i]!, dx = px - c.x, dy = py - c.y, d = Math.hypot(dx, dy);
            if (d < rho) inside++;
            const ang = ((Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2)) / (Math.PI * 2);
            if (Math.abs(d - rho) < 0.42 && ang <= drawn(i)) stroke = tangentAt(dx, dy);
          }
          // The enclosing circle around the whole flower.
          const odx = px - cx, ody = py - cy;
          if (Math.abs(Math.hypot(odx, ody) - rho * (rings + 1)) < 0.42 && time > cs.length * 0.9) stroke = tangentAt(odx, ody);
          let ch = "", fg = INK;
          if (stroke >= 0) ch = TANGENT[stroke]!;
          else if (inside >= 2 && time > 2) {
            // Dotwork: denser where more circles overlap, re-scattered now and then.
            if (hash(col, y) < Math.min(0.6, (inside - 1) * 0.18)) { ch = inside > 2 ? ":" : "·"; fg = mix(INK, glow, 0.35); }
          }
          // The nested triangle frame below, apex down.
          if (!ch && py > frameTop && py < apex) {
            const k = (py - frameTop) / (apex - frameTop), edge = half * (1 - k), ax = Math.abs(px - cx);
            if (Math.abs(ax - edge) < 0.3 || Math.abs(ax - edge * 0.62) < 0.3) { ch = px > cx ? "╱" : "╲"; fg = mix(INK, glow, 0.25); }
          }
          if (!ch && Math.abs(py - frameTop) < 0.5 && Math.abs(px - cx) < half) { ch = "─"; fg = mix(INK, glow, 0.25); }
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
