// The Pen on Dots pages in the terminal: mandala (page 13), eclipse (99), venn (97) and columns (79).
// Each page draws on a grid of dots, two columns to a dot so circles stay round; a stroke cell
// takes its box-drawing glyph from the neighbours on the same stroke, and the column between two
// dots carries a horizontal stroke on across.
import { GROUND, PAPER_DOT, WHITE, blankCells, hex, mix, pick, rng, scale } from "./core";
import type { Cell, Piece, PieceInstance, PieceOptions, Pulse, RGB, Rng } from "./core";

const M: Record<string, RGB> = {
  pink: hex("#f0479a"), orange: hex("#ff7a1f"), coral: hex("#f25c3d"), red: hex("#dd3328"),
  teal: hex("#138f98"), mint: hex("#2fb98a"), lime: hex("#62c534"), yellow: hex("#e4ae00"),
  blue: hex("#2f6be0"), navy: hex("#2037a0"), purple: hex("#7440c4"), magenta: hex("#bb2dbd"),
  black: hex("#2a2926"), gray: hex("#86837c"), sky: hex("#3aa7e6"), forest: hex("#1f7a45"),
  amber: hex("#e89a1c"), blush: hex("#f39cc6"),
};
const PALETTES: Record<string, string[]> = {
  rainbow: ["pink", "orange", "teal", "lime", "blue", "purple", "magenta", "coral", "mint", "black"],
  coast: ["teal", "mint", "pink", "orange", "coral", "gray", "teal"],
  tricolor: ["red", "navy", "magenta", "purple", "red", "navy"],
  dusk: ["purple", "magenta", "orange", "black", "lime", "pink"],
};

// On black, dark inks turn to white gel and every colour lifts so it glows (as in Pen on Dots' dark theme).
const toneCache = new Map<RGB, RGB>();
function tone(rgb: RGB): RGB {
  let v = toneCache.get(rgb);
  if (!v) {
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    if (lum < 60) v = [233, 229, 218];
    else {
      const k = Math.min(1.6, 235 / Math.max(...rgb));
      v = rgb.map((c) => Math.min(255, c * k * 0.82 + 40)) as RGB;
    }
    toneCache.set(rgb, v);
  }
  return v;
}

// ── Ink on a grid of dots, and how it becomes cells ─────────────────────────
// `ch: null` is a stroke whose glyph comes from its neighbours in `group`; anything else is drawn as given.
interface Ink { x: number; y: number; ch: string | null; col: RGB; group: number; region: number; key: number; time?: number }

// Stroke glyph by which orthogonal neighbours share the stroke. L=1 R=2 U=4 D=8.
const BOX = ["•", "╴", "╶", "─", "╵", "┘", "└", "┴", "╷", "┐", "┌", "┬", "│", "┤", "├", "┼"];
const PLUS = (mask: number) => (mask === 15 ? "+" : mask === 0 ? "·" : BOX[mask]!);
const GLYPH: Record<string, string> = { "/": "╱", "\\": "╲" };

class Sheet {
  group: Int32Array; ch: (string | null)[]; col: (RGB | null)[]; age: Float32Array;
  constructor(readonly w: number, readonly h: number) {
    this.group = new Int32Array(w * h).fill(-1);
    this.ch = new Array(w * h).fill(null);
    this.col = new Array(w * h).fill(null);
    this.age = new Float32Array(w * h).fill(99);
  }
  put(x: number, y: number, ch: string | null, col: RGB, group: number, age = 99) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.group[i] = group; this.ch[i] = ch; this.col[i] = col; this.age[i] = age;
  }
  private stroke(x: number, y: number, g: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    return this.group[i] === g && this.ch[i] === null;
  }
  cells(cols: number, rows: number, opts: PieceOptions, fade = 1): Cell[] {
    const cells = blankCells(cols * rows, opts);
    const ox = (cols - this.w * 2) >> 1;
    const paper = opts.tint ? GROUND : null;
    for (let y = 0; y < this.h && y < rows; y++) for (let x = 0; x < this.w; x++) {
      const col = ox + x * 2;
      if (col < 0 || col + 1 >= cols) continue;
      const i = y * this.w + x, g = this.group[i]!;
      if (g === -1) { cells[y * cols + col] = { ch: "·", fg: PAPER_DOT, bg: paper }; continue; }
      const base = tone(this.col[i]!);
      const wet = Math.exp(-this.age[i]! * 6) * 0.6;
      const fg = mix(mix(GROUND, base, fade), WHITE, wet * fade);
      const quiet = this.ch[i] === "·";                    // a field of plain dots keeps the paper behind it
      const bg = opts.tint && !quiet ? mix(GROUND, base, (0.1 + wet * 0.3) * fade) : paper;
      const halo = scale(base, (0.35 + wet) * fade);
      let ch = this.ch[i];
      let east = false;
      if (ch === null) {
        const m = (this.stroke(x - 1, y, g) ? 1 : 0) | (this.stroke(x + 1, y, g) ? 2 : 0) |
                  (this.stroke(x, y - 1, g) ? 4 : 0) | (this.stroke(x, y + 1, g) ? 8 : 0);
        ch = BOX[m]!;
        east = (m & 2) !== 0;
      } else ch = GLYPH[ch] ?? ch;
      cells[y * cols + col] = { ch, fg, bg, halo };
      if (east) cells[y * cols + col + 1] = { ch: "─", fg, bg, halo };
    }
    return cells;
  }
}

// ── Pages drawn once, then inked in stroke by stroke ────────────────────────
interface Built { inks: Ink[]; duration: number; label: string }

function finalize(inks: Ink[], duration: number): Ink[] {
  // Regions in sequence, strokes within a region by key. Mirrored cells share a key, so a symmetric
  // page is inked by four pens at once.
  inks.sort((a, b) => a.region - b.region || a.key - b.key);
  let rank = -1, last = "";
  for (const c of inks) {
    const k = c.region + ":" + c.key;
    if (k !== last) { rank++; last = k; }
    c.time = rank;
  }
  const dt = duration / Math.max(1, rank + 1);
  for (const c of inks) {
    c.time = c.time! * dt;
    const j = 1 + ((((c.key * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 0.12;   // marker ink is never even
    c.col = c.col.map((v) => Math.max(0, Math.min(255, v * j))) as RGB;
  }
  return inks;
}

function buildMandala(cols: number, rows: number, r: Rng, seed: number): Built {
  const paletteName = pick(r, [["rainbow", 3], ["coast", 2], ["tricolor", 1.5], ["dusk", 1.5]]);
  const pal = PALETTES[paletteName]!.map((n) => M[n]!);
  const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
  const R = Math.max(6, Math.min(cx, cy) - 1);
  const METRICS: Record<string, (nx: number, ny: number) => number> = {
    square: (nx, ny) => Math.max(nx, ny),
    diamond: (nx, ny) => (nx + ny) * 0.72,
    octagon: (nx, ny) => Math.max(Math.max(nx, ny), (nx + ny) * 0.74),
    star: (nx, ny) => Math.min(Math.max(nx, ny) * 1.12, (nx + ny) * 0.6),
    round: (nx, ny) => Math.hypot(nx, ny),
  };
  type Band = { metric: string; thr: number; sectors: number; center?: boolean; frame?: boolean; wide?: boolean };
  const bands: Band[] = [];
  let thr = 0.1 + r() * 0.06;
  bands.push({ metric: pick(r, [["diamond", 3], ["square", 1], ["star", 1]]), thr, sectors: 1, center: true });
  while (thr < 0.93) {
    // Now and then a wide band, roomy enough to hold a row of charms.
    const wide = r() < 0.28;
    thr += wide ? 0.3 + r() * 0.08 : 0.08 + r() * 0.13;
    bands.push({ metric: pick(r, Object.keys(METRICS).map((n) => [n, n === "round" ? 0.5 : 1] as [string, number])), thr: Math.min(thr, 1), sectors: wide ? 1 : pick(r, [[1, 2], [2, 3], [3, 1]]), wide });
  }
  bands.push({ metric: "square", thr: Infinity, sectors: 2, frame: true });

  const STYLES: [string, number][] = [["edge", 3], ["h", 1.2], ["v", 1.2], ["diag", 2], ["rings", 3.5], ["tiles", 0.8], ["dots", 0.5], ["blank", 0.15]];
  const regions = bands.flatMap((b, bi) => Array.from({ length: b.sectors }, (_, s) => ({
    band: bi, sector: s,
    style: b.center ? "center" : b.wide ? "charms" : b.frame ? pick(r, [["edge", 3], ["diag", 1], ["rings", 1], ["charms", 1]]) : pick(r, STYLES),
    col: pal[Math.floor(r() * pal.length)]!, col2: pal[Math.floor(r() * pal.length)]!,
    rainbow: paletteName === "rainbow" && r() < 0.5,
    outline: !b.center && !b.frame && r() < 0.5,
    dir: r() < 0.5 ? 1 : -1, phase: Math.floor(r() * 2), gap: r() < 0.8 ? 2 : 3,
    charm: pick(r, [["bracket", 3], ["fork", 2], ["letters", 1.5]]),
  })));
  const regionIndex = (bi: number, s: number) => regions.findIndex((g) => g.band === bi && g.sector === s);

  const regionAt = new Int16Array(cols * rows), metricAt = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const nx = Math.abs(x - cx) / R, ny = Math.abs(y - cy) / R;
    let bi = 0;
    while (bi < bands.length - 1 && METRICS[bands[bi]!.metric]!(nx, ny) >= bands[bi]!.thr) bi++;
    const b = bands[bi]!, ang = Math.atan2(ny, nx);
    let s = 0;
    if (b.sectors === 2) s = ang < Math.PI / 4 ? 0 : 1;
    if (b.sectors === 3) s = ang < Math.PI * 0.19 ? 0 : ang < Math.PI * 0.31 ? 1 : 2;
    regionAt[y * cols + x] = regionIndex(bi, s);
    metricAt[y * cols + x] = METRICS[b.metric]!(nx, ny);
  }
  const reg = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : regionAt[y * cols + x]!);

  const inks: Ink[] = [];
  const centerR = Math.max(2, Math.min(6, Math.round(bands[0]!.thr * R)));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const ri = reg(x, y), g = regions[ri]!;
    const dx = x - cx, dy = y - cy, fx = Math.abs(dx), fy = Math.abs(dy);
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let border = false, outward = false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const n = reg(x + ox, y + oy);
      if (n !== -1 && n !== ri) { border = true; if (n > ri) outward = true; }
    }
    const put = (ch: string | null, col: RGB, key: number, group = ri) => inks.push({ x, y, ch, col, region: ri, key, group });
    const ang = Math.round(Math.atan2(fy, fx) * 1000);
    if (border) { if (g.outline && outward) put(null, g.col, ang, ri + 10000); continue; }
    const lineCol = (i: number) => (g.rainbow ? pal[((i % pal.length) + pal.length) % pal.length]! : g.col);
    switch (g.style) {
      case "center": {
        const d = fx + fy;
        if (d === centerR) put(dx * dy < 0 ? "\\" : dx * dy > 0 ? "/" : "•", g.col, 0);
        else if (dx === 0 && fy < centerR - 1) put(null, g.col2, 1 + fy);
        else if (dy === 0 && fx < centerR - 1) put(null, g.col2, 1 + fx);
        break;
      }
      case "edge":
        if (Math.atan2(fy, fx) < Math.PI / 4) { if ((fx + g.phase) % g.gap === 0) put(null, lineCol(fx >> 1), fx * 4096 + fy); }
        else if ((fy + g.phase) % g.gap === 0) put(null, lineCol(fy >> 1), fy * 4096 + fx);
        break;
      case "h": if ((fy + g.phase) % g.gap === 0) put(null, lineCol(fy >> 1), fy * 4096 + fx); break;
      case "v": if ((fx + g.phase) % g.gap === 0) put(null, lineCol(fx >> 1), fx * 4096 + fy); break;
      case "diag": {
        const k = fx - g.dir * fy;
        if (((k % 3) + 3) % 3 === 0) put(g.dir * sx * sy > 0 ? "\\" : "/", lineCol(Math.floor(k / 3)), (k + 2048) * 4096 + fx);
        break;
      }
      case "rings": {
        const ring = Math.floor((metricAt[y * cols + x]! * R) / 2);
        if (Math.floor(metricAt[y * cols + x]! * R) % 2 === 0) put(null, lineCol(ring), ring * 8192 + ang, ri * 1000 + ring);
        break;
      }
      case "tiles": {
        const tx = Math.floor((fx - 1) / 4), ty = Math.floor((fy - 1) / 4), lx = (fx - 1) % 4, ly = (fy - 1) % 4;
        if (fx < 1 || fy < 1 || lx === 3 || ly === 3) break;
        const ox = cx + sx * (tx * 4 + 1), oy = cy + sy * (ty * 4 + 1);
        let whole = true;
        for (let a = -1; a <= 3 && whole; a++) for (let b = -1; b <= 3 && whole; b++) if (reg(ox + sx * a, oy + sy * b) !== ri) whole = false;
        if (!whole) break;
        if (lx === 1 && ly === 1) put(g.dir > 0 ? "•" : "+", g.col2, (tx * 97 + ty) * 64 + 9);
        else put(null, g.col, (tx * 97 + ty) * 64 + ly * 3 + lx, ri * 100000 + tx * 97 + ty);
        break;
      }
      case "dots": if (fx % 2 === 0 && fy % 2 === 0) put("•", g.col, fy * 4096 + fx); break;
      case "charms": {
        // Small motifs from the journal frames on a six-dot grid: a diamond with a plus held in corner
        // brackets, a Y fork, or a letter that mirrors into b d p q around the centre.
        const tx = Math.floor((fx - 1) / 6), ty = Math.floor((fy - 1) / 6), lx = (fx - 1) % 6, ly = (fy - 1) % 6;
        if (fx < 1 || fy < 1 || lx === 5 || ly === 5) break;
        const ox = cx + sx * (tx * 6 + 1), oy = cy + sy * (ty * 6 + 1);
        let whole = true;
        for (let a = 0; a <= 4 && whole; a++) for (let b = 0; b <= 4 && whole; b++) if (reg(ox + sx * a, oy + sy * b) !== ri) whole = false;
        if (!whole) break;
        const flip = sx * sy < 0;                       // a mirrored quarter turns its diagonals the other way
        const diag = (c: string) => (flip ? (c === "/" ? "\\" : "/") : c);
        const key = (tx * 97 + ty) * 64 + ly * 5 + lx, grp = ri * 100000 + tx * 97 + ty;
        if (g.charm === "bracket") {
          const corner = (lx <= 1 && ly <= 1 && !(lx === 1 && ly === 1)) || (lx >= 3 && ly <= 1 && !(lx === 3 && ly === 1)) ||
                         (lx <= 1 && ly >= 3 && !(lx === 1 && ly === 3)) || (lx >= 3 && ly >= 3 && !(lx === 3 && ly === 3));
          const cornerGroup = grp * 4 + (lx > 2 ? 1 : 0) + (ly > 2 ? 2 : 0);
          if (corner) put(null, g.col, key, cornerGroup);
          // The diamond's tips point outward on screen, whichever way this quarter is mirrored.
          else if (lx === 2 && (ly === 1 || ly === 3)) put((ly === 1) === (sy > 0) ? "∧" : "∨", g.col2, key);
          else if (ly === 2 && (lx === 1 || lx === 3)) put((lx === 1) === (sx > 0) ? "<" : ">", g.col2, key);
          else if (lx === 2 && ly === 2) put("+", g.col, key);
        } else if (g.charm === "fork") {
          if (ly === 0 && lx === 1) put(diag("\\"), g.col, key);
          else if (ly === 0 && lx === 3) put(diag("/"), g.col, key);
          else if (lx === 2 && ly >= 1 && ly <= 3) put(null, g.col, key, grp);
          else if (ly === 4 && (lx === 1 || lx === 3)) put("•", g.col2, key);
        } else if (lx === 2 && ly === 2) {
          // Drawn as q in the bottom-right quarter; each mirror turns it.
          put(sx > 0 ? (sy > 0 ? "q" : "d") : (sy > 0 ? "p" : "b"), g.col2, key);
        } else if ((lx === 1 || lx === 3) && (ly === 0 || ly === 4)) put("·", g.col, key);
        break;
      }
    }
  }
  for (const c of inks) c.region = regions[c.region]!.band * 4 + regions[c.region]!.sector;
  return { inks: finalize(inks, 16), duration: 16, label: `mandala / ${paletteName} / seed ${seed}` };
}

function buildColumns(cols: number, rows: number, r: Rng, seed: number): Built {
  const PAIRS = [["orange", "sky"], ["amber", "lime"], ["black", "orange"], ["magenta", "forest"], ["purple", "pink"], ["teal", "coral"]];
  const LINES = ["pink", "yellow", "blue", "sky", "orange", "lime", "purple"];
  const inks: Ink[] = [];
  const top = 1, bottom = rows - 2;
  let x = 2, block = 0, flip = r() < 0.5;
  while (x < cols - 5) {
    const w = Math.min(cols - 2 - x, 5 + Math.floor(r() * 5));
    const [boxName, hatchName] = PAIRS[Math.floor(r() * PAIRS.length)]!;
    const sizes: number[] = [];
    let s = 2, total = 0;
    while (total + s + 1 <= bottom - top + 1) { sizes.push(s); total += s + 1; s = Math.min(w, s + 1 + Math.floor(r() * 2)); }
    if (flip) sizes.reverse();
    const alignRight = r() < 0.5;
    let y = top;
    sizes.forEach((h, bi) => {
      const bw = Math.min(w, Math.max(2, Math.round(h * (0.9 + r() * 0.2))));
      const x0 = alignRight ? x + w - bw : x;
      for (let yy = y; yy < y + h; yy++) for (let xx = x0; xx < x0 + bw; xx++) {
        const edge = yy === y || yy === y + h - 1 || xx === x0 || xx === x0 + bw - 1;
        const key = bi * 10000 + (edge ? 0 : 5000) + (xx - x0) * 64 + (yy - y);
        if (edge) inks.push({ x: xx, y: yy, ch: null, col: M[boxName!]!, region: block, key, group: block * 1000 + bi });
        else if ((xx - x0) % 2 === 0 && xx > x0 && xx < x0 + bw - 1 && yy > y && yy < y + h - 1)
          inks.push({ x: xx, y: yy, ch: null, col: M[hatchName!]!, region: block, key, group: 500000 + block * 1000 + bi * 50 + (xx - x0) });
      }
      y += h + 1;
    });
    x += w + 2; block++; flip = !flip;
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n && x < cols - 2; i++) {
      const col = M[LINES[Math.floor(r() * LINES.length)]!]!;
      for (let yy = top; yy <= bottom; yy++) inks.push({ x, y: yy, ch: null, col, region: block, key: i * 4096 + yy, group: 900000 + block * 10 + i });
      x += 2;
    }
    block++; x += 1;
  }
  return { inks: finalize(inks, 14), duration: 14, label: `columns / seed ${seed}` };
}

function revealed(build: (cols: number, rows: number, r: Rng, seed: number) => Built): Piece["create"] {
  return (cols, rows, seed, opts) => {
    const r = rng(seed);
    const w = cols >> 1, h = rows;
    let page = build(w, h, r, seed), clock = 0, speed = 1, pens = 0;
    const next = () => { page = build(w, h, r, Math.floor(r() * 1e9)); clock = 0; };
    return {
      tick(dt) {
        clock += dt * speed;
        speed += (1 + pens - speed) * Math.min(1, dt * 2);
        // Hold a finished page, fade it, start the next.
        if (clock > page.duration + 12) next();
      },
      cells() {
        const sheet = new Sheet(w, h);
        const fade = Math.max(0, Math.min(1, (page.duration + 12 - clock) / 2.5));
        for (const c of page.inks) {
          if (c.time! > clock) break;
          sheet.put(c.x, c.y, c.ch, c.col, c.group, clock - c.time!);
        }
        return sheet.cells(cols, rows, opts, fade);
      },
      // A tool call hurries the pen; each running subagent is another pen's worth of speed; your message turns the page.
      react(p: Pulse) {
        if (p.kind === "tool") speed = Math.max(speed, 4 + pens);
        else if (p.kind === "agents") pens = Math.min(6, p.running);
        else next();
      },
      label: () => page.label,
    };
  };
}

// ── Pages recomputed every frame ────────────────────────────────────────────
type Spot = { x: number; y: number };
type Live = (s: Sheet, t: number, wander: Spot, variant: number, extra: Spot[]) => void;

const eclipse: Live = (s, time, p, variant, extra) => {
  const W = s.w, H = s.h, cx = W / 2, cy = H / 2, R = Math.min(W, H);
  const blobs = [
    { x: cx + Math.sin(time * 0.21) * W * 0.18, y: cy + Math.cos(time * 0.17) * H * 0.12, r: R * 0.26 },
    { x: cx + Math.cos(time * 0.13 + 1) * W * 0.28, y: cy + Math.sin(time * 0.19 + 2) * H * 0.22, r: R * 0.16 },
    { x: p.x, y: p.y, r: R * 0.13 },
    ...extra.map((e) => ({ x: e.x, y: e.y, r: R * 0.09 })),   // one more shape under the lines per running subagent
  ];
  const inks = [M.magenta!, M.teal!, M.orange!];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let f = 0;
    for (const b of blobs) { const dx = x + 0.5 - b.x, dy = y + 0.5 - b.y; f += (b.r * b.r) / (dx * dx + dy * dy + 0.01); }
    if (f > 0.78 && f < 1.0) continue;                 // the gap that draws the edge
    const inside = f >= 1.0;
    if ((y + (inside ? 1 : 0)) % 2 !== 0) continue;    // inside, the lines shift down one row
    let col = M.magenta!;
    if (variant === 1) col = inside ? M.teal! : M.pink!;
    if (variant === 2) col = inks[(y >> 1) % 3]!;
    s.put(x, y, null, col, y);
  }
};

const venn: Live = (s, time, p, variant, extra) => {
  const W = s.w, H = s.h, R = Math.min(W, H), cx = W / 2, cy = H / 2;
  const A = { x: cx - R * 0.16 + Math.sin(time * 0.23) * R * 0.05, y: cy - R * 0.14 + Math.cos(time * 0.19) * R * 0.04, r: R * 0.32 };
  const B = { x: cx + R * 0.14 + Math.cos(time * 0.17) * R * 0.05, y: cy + R * 0.16 + Math.sin(time * 0.21) * R * 0.04, r: R * 0.32 };
  // The small circle, and one more per running subagent.
  const small = [{ x: p.x, y: p.y, r: R * 0.18 }, ...extra.map((e) => ({ x: e.x, y: e.y, r: R * 0.11 }))];
  const d = (c: { x: number; y: number; r: number }, x: number, y: number) => Math.hypot(x - c.x, y - c.y) - c.r;
  const dotCol = variant === 1 ? M.coral! : M.pink!, lensCol = variant === 1 ? M.purple! : M.blush!;
  const barCol = variant === 1 ? M.teal! : M.blue!, plusCol = variant === 1 ? M.navy! : M.purple!;
  for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const da = d(A, px, py), db = d(B, px, py);
    let dc = Infinity;
    for (const c of small) dc = Math.min(dc, d(c, px, py));
    const inA = da < 0, inB = db < 0, inC = dc < 0;
    if (Math.abs(da) < 0.7 || Math.abs(db) < 0.7 || Math.abs(dc) < 0.7) continue;   // a gutter keeps edges readable
    if (inC && (inA || inB)) { if (y % 2 === 0) s.put(x, y, null, barCol, 200000 + y); continue; }
    if (inA && inB) { if (x % 2 === 0) s.put(x, y, null, lensCol, 100000 + x); continue; }
    if (inA || inB) { s.put(x, y, "·", dotCol, 1); continue; }
    if (inC) { if (x % 2 === 0 && y % 2 === 0) s.put(x, y, "•", barCol, 2); continue; }
    if (x % 3 !== 0 || y % 3 !== 0) continue;
    // Plus marks near a circle lose the arms that would cross it.
    const clear = (ox: number, oy: number) => Math.min(d(A, px + ox, py + oy), d(B, px + ox, py + oy), ...small.map((c) => d(c, px + ox, py + oy))) > 1.2;
    if (!clear(0, 0)) continue;
    const mask = (clear(-1, 0) ? 1 : 0) | (clear(1, 0) ? 2 : 0) | (clear(0, -1) ? 4 : 0) | (clear(0, 1) ? 8 : 0);
    s.put(x, y, PLUS(mask), plusCol, 3);
  }
};

function live(name: string, draw: Live): Piece["create"] {
  return (cols, rows, seed, opts) => {
    const r = rng(seed);
    const w = cols >> 1, h = rows;
    let time = r() * 100, variant = Math.floor(r() * 3), sinceVariant = 0;
    // No pointer in a terminal: the third shape wanders, and a poke sends it somewhere new.
    const wander = { x: w / 2, y: h / 2, tx: w / 2, ty: h / 2 };
    let agents = 0;
    // Each running subagent's shape drifts on its own slow orbit around the page.
    const extras = () => Array.from({ length: Math.min(agents, 6) }, (_, k) => ({
      x: w / 2 + Math.cos(time * (0.25 + k * 0.07) + k * 2.1) * w * 0.36,
      y: h / 2 + Math.sin(time * (0.31 + k * 0.05) + k * 1.3) * h * 0.36,
    }));
    return {
      tick(dt) {
        time += dt;
        sinceVariant += dt;
        if (sinceVariant > 40) { variant = (variant + 1) % 3; sinceVariant = 0; }
        wander.tx += Math.cos(time * 0.3) * dt * w * 0.08;
        wander.ty += Math.sin(time * 0.4) * dt * h * 0.08;
        wander.tx = Math.max(0, Math.min(w, wander.tx)); wander.ty = Math.max(0, Math.min(h, wander.ty));
        wander.x += (wander.tx - wander.x) * Math.min(1, dt * 2);
        wander.y += (wander.ty - wander.y) * Math.min(1, dt * 2);
      },
      cells() {
        const sheet = new Sheet(w, h);
        draw(sheet, time, wander, variant, extras());
        return sheet.cells(cols, rows, opts);
      },
      // A tool call sends the wandering shape somewhere new; your message changes the inks.
      react(p: Pulse) {
        if (p.kind === "tool") { wander.tx = r() * w; wander.ty = r() * h; }
        else if (p.kind === "agents") agents = p.running;
        else { variant = (variant + 1) % 3; sinceVariant = 0; }
      },
      label: () => name,
    };
  };
}

export const mandala: Piece = { name: "mandala", blurb: "a mirrored mandala, inked stroke by stroke", create: revealed(buildMandala) };
export const columns: Piece = { name: "columns", blurb: "graduated boxes and bundles of coloured lines", create: revealed(buildColumns) };
export const eclipsePiece: Piece = { name: "eclipse", blurb: "ruled lines that break around drifting shapes", create: live("eclipse", eclipse) };
export const vennPiece: Piece = { name: "venn", blurb: "dotted circles, hatching and a field of plus marks", create: live("venn", venn) };
