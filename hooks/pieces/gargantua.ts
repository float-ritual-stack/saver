// Gargantua on the CPU: a Schwarzschild black hole, one light ray per terminal cell, integrated backwards
// along its bent path. The ray's brightness picks the glyph, its colour tints it. Terminal cells are about
// twice as tall as wide, so the camera squeezes x by half to keep the shadow round.
// Tool calls feed the hole (the disk flares, then settles); running subagents spin the disk faster and
// hotter; your message mid-turn swings the camera to a new angle.
import { GROUND, blankCells, mix } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB } from "./core";

const RAMP = " .,:;-=+*oxO#%@";
const R_IN = 3, R_OUT = 14;
const CELL_ASPECT = 0.5;

const fract = (x: number) => x - Math.floor(x);
function hash13(x: number, y: number, z: number) {
  let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d; py += d; pz += d;
  return fract((px + py) * pz);
}
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash13(ix + a, iy + b, iz + c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
           l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
function fbm(x: number, y: number, z: number) {
  let a = 0.5, s = 0;
  for (let i = 0; i < 3; i++) { s += a * noise3(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s;
}
// Interstellar amber: ember, orange, straw, white.
function heat(t: number): RGB {
  t = Math.max(0, Math.min(1.4, t));
  const t5 = t ** 5;
  return [1.0 * t + 0.25 * t * t + 0.6 * t5, 0.32 * t + 0.45 * t * t + 0.7 * t5, 0.06 * t + 0.2 * t * t + 0.9 * t5];
}

function trace(px: number, py: number, cam: { yaw: number; pitch: number; dist: number }, time: number, steps: number, feed: number) {
  const { yaw, pitch, dist } = cam;
  const ro = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
  const fl = Math.hypot(ro[0]!, ro[1]!, ro[2]!);
  const fw = [-ro[0]! / fl, -ro[1]! / fl, -ro[2]! / fl];
  let rt = [fw[1]! * 0 - fw[2]! * 1, fw[2]! * 0 - fw[0]! * 0, fw[0]! * 1 - fw[1]! * 0];   // cross(fw, up)
  const rl = Math.hypot(rt[0]!, rt[1]!, rt[2]!); rt = [rt[0]! / rl, rt[1]! / rl, rt[2]! / rl];
  const up = [rt[1]! * fw[2]! - rt[2]! * fw[1]!, rt[2]! * fw[0]! - rt[0]! * fw[2]!, rt[0]! * fw[1]! - rt[1]! * fw[0]!];
  let dx = fw[0]! * 2.1 + rt[0]! * px + up[0]! * py, dy = fw[1]! * 2.1 + rt[1]! * px + up[1]! * py, dz = fw[2]! * 2.1 + rt[2]! * px + up[2]! * py;
  const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;

  let x = ro[0]!, y = ro[1]!, z = ro[2]!, vx = dx, vy = dy, vz = dz;
  const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  let cr = 0, cg = 0, cb = 0, trans = 1, minR = 1e9, captured = false;

  for (let i = 0; i < steps; i++) {
    const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
    if (r < minR) minR = r;
    if (r < 1) { captured = true; break; }
    if (r > dist * 1.6 + 20 && x * vx + y * vy + z * vz > 0) break;
    const dt = Math.max(0.03, Math.min(1.5, (0.09 * r * r) / (r + 4)));
    const k = (-1.5 * h2) / (r2 * r2 * r);
    vx += k * x * dt; vy += k * y * dt; vz += k * z * dt;
    const nx = x + vx * dt, ny = y + vy * dt, nz = z + vz * dt;
    if (y * ny < 0) {
      // Crossing the disk's plane.
      const f = y / (y - ny);
      const hxp = x + (nx - x) * f, hzp = z + (nz - z) * f;
      const rr = Math.hypot(hxp, hzp);
      if (rr > R_IN * 0.9 && rr < R_OUT) {
        const ang = Math.atan2(hzp, hxp);
        const a = ang + (time * 2.2) / rr ** 1.5;
        const density = Math.max(0, Math.min(1, (fbm(rr * 2.6, Math.cos(a) * 2.2, Math.sin(a) * 2.2 + time * 0.05) * 0.8 + 0.1 - 0.25) / 0.6));
        const edge = Math.max(0, Math.min(1, (rr - R_IN * 0.9) / (R_IN * 0.3))) * (1 - Math.max(0, Math.min(1, (rr - (R_OUT - 5)) / 5)));
        const temp = (R_IN / rr) ** 1.1;
        // Doppler beaming and gravitational redshift.
        const v = Math.min(0.7, Math.sqrt(0.5 / Math.max(rr - 1, 0.1)));
        const vl = Math.hypot(vx, vy, vz);
        const cosT = (Math.sin(ang) * vx - Math.cos(ang) * vz) / vl;
        const gamma = 1 / Math.sqrt(1 - v * v);
        const g = Math.sqrt(Math.max(1 - 1 / rr, 0)) / (gamma * (1 - v * cosT));
        const boost = Math.max(0.05, Math.min(6, g ** 3));
        const emit = edge * (0.35 + density) * boost * (1 + feed);
        const c = heat(temp * Math.max(0.4, Math.min(1.6, g)) * 1.05);
        const alpha = Math.max(0, Math.min(0.95, edge * (0.55 + 0.45 * density)));
        cr += trans * c[0] * emit * 1.6 * alpha; cg += trans * c[1] * emit * 1.6 * alpha; cb += trans * c[2] * emit * 1.6 * alpha;
        trans *= 1 - alpha * 0.9;
        if (trans < 0.03) break;
      }
    }
    x = nx; y = ny; z = nz;
  }
  let star = 0;
  if (!captured) {
    const vl = Math.hypot(vx, vy, vz);
    const hs = hash13(Math.floor((vx / vl) * 160), Math.floor((vy / vl) * 160), Math.floor((vz / vl) * 160));
    if (hs > 0.9975) star = (hs - 0.9975) / 0.0025;
    // The photon sphere at r = 1.5: rays that grazed it glow.
    const ring = trans * 1.4 * Math.exp(-(minR - 1.5) * 7);
    const c = heat(1);
    cr += c[0] * ring; cg += c[1] * ring; cb += c[2] * ring;
  }
  return { r: cr, g: cg, b: cb, star, trans };
}

export const gargantua: Piece = {
  name: "gargantua",
  blurb: "a black hole, ray-traced one cell at a time",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const steps = Math.round(90 + 260 * (opts.quality ?? 1));
    const cam = { yaw: (seed % 628) / 100, pitch: 0.1, dist: 22 };
    let time = 0, wall = 0, feed = 0, agents = 0, swing = 0, swingTo = 0;
    return {
      tick(dt) {
        wall += dt;
        time += dt * (1 + agents * 0.6);
        cam.yaw += dt * 0.07;
        swing += (swingTo - swing) * Math.min(1, dt * 1.5);
        cam.pitch = 0.1 + Math.sin(wall * 0.11) * 0.12 + swing;
        feed *= Math.exp(-dt * 1.2);
      },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const half = rows / 2;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const px = ((col + 0.5 - cols / 2) * CELL_ASPECT) / half;
          const py = -(row + 0.5 - half) / half;
          const t = trace(px, py, cam, time, steps, feed + agents * 0.35);
          const tr = 1 - Math.exp(-t.r * 2.6), tg = 1 - Math.exp(-t.g * 2.6), tb = 1 - Math.exp(-t.b * 2.6);
          const L = 0.299 * tr + 0.587 * tg + 0.114 * tb;
          const dither = (fract(Math.sin(col * 12.9898 + row * 78.233 + time * 7) * 43758.5453) - 0.5) / RAMP.length;
          let ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor((L * 1.15 + dither) * RAMP.length)))]!;
          const peak = Math.max(tr, tg, tb, 0.18), lift = Math.min(1, L * 1.6 + 0.25);
          let fg: RGB = [(tr / peak) * lift * 255, (tg / peak) * lift * 255, (tb / peak) * lift * 255];
          if (t.star > 0 && L < 0.4 && t.trans > 0.5) { ch = ".,+*"[Math.min(3, Math.floor(t.star * 4))]!; fg = [190, 210, 255]; }
          if (ch === " ") continue;
          const glow: RGB = [tr * 255, tg * 255, tb * 255];
          cells[row * cols + col] = { ch, fg, bg: opts.tint ? mix(GROUND, glow, 0.22) : null, halo: [glow[0] * 0.5, glow[1] * 0.5, glow[2] * 0.5] };
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") feed = Math.min(2.5, feed + 0.6);
        else if (p.kind === "agents") agents = Math.min(6, p.running);
        else { swingTo = swingTo > 0.3 ? -0.15 : 0.55; cam.yaw += 0.8; }
      },
      label: () => "gargantua",
    };
  },
};
