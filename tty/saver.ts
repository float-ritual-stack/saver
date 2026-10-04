#!/usr/bin/env bun
// Echo Lattice as a terminal screen saver.
//
// The drawing is real terminal text: Unicode box-drawing strokes in your terminal's own font, two columns to a
// lattice dot so the grid reads square. Where the terminal speaks the Kitty graphics protocol (kitty, Ghostty,
// Herdr with kitty_graphics on), a small glow image is placed *under* the text and stretched by the terminal,
// so the gel-pen bloom costs a few kilobytes a frame. Elsewhere the glow falls back to tinted cell backgrounds.
//
//   bun saver.ts                 any key exits
//   bun saver.ts --play          space: new piece seed  p: a tool call  a/A: one more/fewer subagent  m: a message  q: quit
//   bun saver.ts --piece NAME    cycle (default: each piece in turn), lattice, mandala, eclipse, venn, columns, gargantua
//   bun saver.ts --text          never use graphics
//   bun saver.ts --snapshot DIR --at 20   render one frame to DIR (no terminal needed), for checking by eye
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GROUND, PIECES } from "../hooks/pieces";
import type { Cell, PieceInstance, RGB } from "../hooks/pieces";

// ── Options ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const PLAY = flag("--play");
const FORCE_TEXT = flag("--text");
const FORCE_KITTY = flag("--kitty");
const SNAPSHOT = value("--snapshot");
const SNAP_AT = Number(value("--at") ?? 20);
const SEED = value("--seed") ? Number(value("--seed")) : undefined;
const PIECE = value("--piece") ?? "cycle";
if (!PIECES[PIECE]) { console.error(`unknown piece "${PIECE}"; pieces: ${Object.keys(PIECES).join(", ")}`); process.exit(1); }
const make = (cols: number, rows: number, seed: number, tint: boolean): PieceInstance =>
  PIECES[PIECE]!.create(cols, rows, seed, { tint, quality: 1 });

// ── The glow raster, built from each cell's halo ────────────────────────────
const GLOW_X = 2, GLOW_Y = 4;   // glow pixels per cell; the terminal stretches them smoothly
function glowImage(cells: Cell[], cols: number, rows: number) {
  const gw = cols * GLOW_X, gh = rows * GLOW_Y;
  const acc = new Float32Array(gw * gh * 3);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const h = cells[row * cols + col]!.halo;
    if (!h) continue;
    for (let py = 0; py < GLOW_Y; py++) for (let px = 0; px < GLOW_X; px++) {
      const o = ((row * GLOW_Y + py) * gw + col * GLOW_X + px) * 3;
      acc[o] += h[0]; acc[o + 1] += h[1]; acc[o + 2] += h[2];
    }
  }
  // Two box-blur passes soften the strokes into a bloom; the ground fills the rest of the screen.
  blur(acc, gw, gh, 3); blur(acc, gw, gh, 3);
  const data = new Uint8Array(gw * gh * 4);
  for (let p = 0, q = 0; p < gw * gh; p++, q += 3) {
    const ny = Math.floor(p / gw) / gh - 0.5, nx = (p % gw) / gw - 0.5;
    const vignette = 1 - (nx * nx + ny * ny) * 0.5;
    data[p * 4] = Math.min(255, (GROUND[0] + acc[q]! * 0.5) * vignette);
    data[p * 4 + 1] = Math.min(255, (GROUND[1] + acc[q + 1]! * 0.5) * vignette);
    data[p * 4 + 2] = Math.min(255, (GROUND[2] + acc[q + 2]! * 0.5) * vignette);
    data[p * 4 + 3] = 255;
  }
  return { width: gw, height: gh, data };
}

function blur(a: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + c]!;
    for (let x = 0; x < w; x++) {
      tmp[(y * w + x) * 3 + c] = s / n;
      s += a[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c]! - a[(y * w + Math.max(0, x - r)) * 3 + c]!;
    }
  }
  for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c]!;
    for (let y = 0; y < h; y++) {
      a[(y * w + x) * 3 + c] = s / n;
      s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c]! - tmp[(Math.max(0, y - r) * w + x) * 3 + c]!;
    }
  }
}

// ── Kitty graphics ──────────────────────────────────────────────────────────
const APC = (body: string, payload = "") => `\x1b_G${body}${payload ? ";" + payload : ""}\x1b\\`;

/** Same decision as the ep0ch door (packages/door/src/kitty.ts): env first, Herdr's config, else ask. */
function kittyHint(env = process.env): boolean | null {
  if (env.TMUX) return false;   // tmux needs passthrough and placeholder placement; stay in text
  if (env.HERDR_ENV === "1") {
    try {
      const home = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
      const cfg = Bun.TOML.parse(readFileSync(env.HERDR_CONFIG_PATH || join(home, "herdr", "config.toml"), "utf8")) as {
        terminal?: { kitty_graphics?: unknown }; experimental?: { kitty_graphics?: unknown };
      };
      return (cfg.terminal?.kitty_graphics ?? cfg.experimental?.kitty_graphics) === true;
    } catch { return false; }
  }
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || env.TERM_PROGRAM === "ghostty" || env.TERM === "xterm-ghostty") return true;
  return null;
}
const KITTY_QUERY = APC("i=31,s=1,v=1,a=q,t=d,f=24", "AAAA") + "\x1b[c";

/** Uploads each glow frame under a fresh id, places it under the text, then frees the previous one. */
class GlowLayer {
  private shown: number | null = null;
  private nextId = 7_000 + Math.floor(Math.random() * 1_000_000);
  bytes = 0;
  frame(img: { width: number; height: number; data: Uint8Array }, cols: number, rows: number): string {
    const id = this.nextId++;
    const b64 = deflateSync(img.data, { level: 3 }).toString("base64");
    let out = "";
    for (let at = 0; at < b64.length; at += 4096) {
      const more = at + 4096 < b64.length ? 1 : 0;
      const head = at === 0 ? `a=t,f=32,o=z,t=d,i=${id},s=${img.width},v=${img.height},q=2,m=${more}` : `m=${more}`;
      out += APC(head, b64.slice(at, at + 4096));
    }
    out += `\x1b7\x1b[1;1H` + APC(`a=p,i=${id},p=1,c=${cols},r=${rows},C=1,z=-1,q=2`) + "\x1b8";
    if (this.shown !== null) out += APC(`a=d,d=I,i=${this.shown},q=2`);
    this.shown = id;
    this.bytes += out.length;
    return out;
  }
  dispose(): string {
    const out = this.shown !== null ? APC(`a=d,d=I,i=${this.shown},q=2`) : "";
    this.shown = null;
    return out;
  }
}

// ── Text output, writing only the cells that changed ────────────────────────
const sgr = (c: RGB, bg = false) => `\x1b[${bg ? 48 : 38};2;${c[0] | 0};${c[1] | 0};${c[2] | 0}m`;
const same = (a: RGB | null, b: RGB | null) => a === b || (!!a && !!b && (a[0] | 0) === (b[0] | 0) && (a[1] | 0) === (b[1] | 0) && (a[2] | 0) === (b[2] | 0));

class Screen {
  prev: Cell[] = [];
  paint(cells: Cell[], cols: number, rows: number): string {
    let out = "", cx = -1, cy = -1;
    let fg: RGB | null = null, bg: RGB | null | undefined = undefined;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const i = row * cols + col, c = cells[i]!, p = this.prev[i];
      if (p && p.ch === c.ch && same(p.fg, c.fg) && same(p.bg, c.bg)) continue;
      if (cy !== row || cx !== col) out += `\x1b[${row + 1};${col + 1}H`;
      if (!same(fg, c.fg)) { out += sgr(c.fg); fg = c.fg; }
      if (bg === undefined || !same(bg, c.bg)) { out += c.bg ? sgr(c.bg, true) : "\x1b[49m"; bg = c.bg; }
      out += c.ch;
      cx = col + 1; cy = row;
    }
    this.prev = cells;
    return out;
  }
}

// ── Snapshot: one frame to disk, without a terminal ─────────────────────────
function png(img: { width: number; height: number; data: Uint8Array }): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(raw, y * (img.width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

if (SNAPSHOT) {
  const cols = Number(value("--cols") ?? 180), rows = Number(value("--rows") ?? 50);
  // Two instances from one seed, ticked alike: one for graphics mode, one for text, so both files show one moment.
  const withGlow = make(cols, rows, SEED ?? 4242, false), textMode = make(cols, rows, SEED ?? 4242, true);
  for (let t = 0; t < SNAP_AT; t += 1 / 30) { withGlow.tick(1 / 30); textMode.tick(1 / 30); }
  const cells = withGlow.cells(), glow = glowImage(cells, cols, rows);
  const textOnly = textMode.cells();
  mkdirSync(SNAPSHOT, { recursive: true });
  writeFileSync(join(SNAPSHOT, "glow.png"), png(glow));
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const html = (cs: Cell[], withGlow: boolean) => {
    let s = "";
    for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) { const k = cs[r * cols + c]!; s += `<span style="color:${css(k.fg)}${k.bg ? `;background:${css(k.bg)}` : ""}">${esc(k.ch)}</span>`; } s += "\n"; }
    return `<pre style="margin:0;font:14px/17px Menlo,monospace;${withGlow ? "background:url(glow.png) 0 0/100% 100%;" : `background:${css(GROUND)};`}display:inline-block">${s}</pre>`;
  };
  writeFileSync(join(SNAPSHOT, "kitty.html"), `<meta charset="utf-8"><body style="margin:0;background:#000">${html(cells, true)}`);
  writeFileSync(join(SNAPSHOT, "text.html"), `<meta charset="utf-8"><body style="margin:0;background:#000">${html(textOnly, false)}`);
  console.log(`${withGlow.label()} -> ${SNAPSHOT}`);
  process.exit(0);
}

// ── The saver ───────────────────────────────────────────────────────────────
const out = process.stdout;
const stdin = process.stdin;
if (!out.isTTY || !stdin.isTTY) { console.error("saver.ts draws to a terminal; run it in one (or use --snapshot DIR)."); process.exit(1); }

// Some ptys report no size; draw at 80x24 rather than nothing.
const size = () => [out.columns || 80, out.rows || 24] as const;
let [cols, rows] = size();
let kitty = false;
const screen = new Screen();
const glowLayer = new GlowLayer();
const fresh = () => make(cols, rows, Math.floor(Math.random() * 1e9), !kitty);
let piece = make(cols, rows, SEED ?? Math.floor(Math.random() * 1e9), true);
let running = true;
let agents = 0;
let pending = "";

const write = (s: string) => { if (s) out.write(s); };
function restore() {
  if (!running) return;
  running = false;
  write(glowLayer.dispose() + "\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l");
  try { stdin.setRawMode(false); } catch {}
  stdin.pause();
}
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { restore(); process.exit(0); });

stdin.setRawMode(true);
stdin.resume();
write("\x1b[?1049h\x1b[?25l\x1b[0m\x1b[2J");

// The terminal's replies to our queries arrive on stdin like keystrokes: take them out before deciding on a key.
const REPLY = /\x1b_G[^\x1b]*\x1b\\|\x1b\[\?[\d;]*c|\x1b\[[\d;]*t/g;
let probing: ((reply: string) => void) | null = null;
stdin.on("data", (buf: Buffer) => {
  pending += buf.toString("latin1");
  if (probing) { probing(pending); return; }
  const keys = pending.replace(REPLY, "");
  pending = "";
  if (!keys) return;
  if (!PLAY) { restore(); process.exit(0); }
  for (const k of keys) {
    if (k === "q" || k === "\x03") { restore(); process.exit(0); }
    if (k === " ") piece = fresh();
    if (k === "p") piece.react?.({ kind: "tool" });
    if (k === "m") piece.react?.({ kind: "message" });
    if (k === "a" || k === "A") { agents = Math.max(0, Math.min(6, agents + (k === "a" ? 1 : -1))); piece.react?.({ kind: "agents", running: agents }); }
  }
});

out.on("resize", () => {
  [cols, rows] = size();
  screen.prev = [];
  write("\x1b[0m\x1b[2J");
  piece = fresh();
});

async function detectKitty(): Promise<boolean> {
  if (FORCE_TEXT) return false;
  if (FORCE_KITTY) return true;
  const hint = kittyHint();
  if (hint !== null) return hint;
  return new Promise((resolve) => {
    const done = (v: boolean) => { clearTimeout(timer); probing = null; pending = ""; resolve(v); };
    const timer = setTimeout(() => done(false), 400);
    probing = (s) => {
      if (/\x1b_Gi=31;OK\x1b\\/.test(s)) done(true);
      else if (/\x1b\[\?[\d;]*c/.test(s)) done(false);   // DA1 came back first: no graphics
    };
    write(KITTY_QUERY);
  });
}

kitty = await detectKitty();
piece = make(cols, rows, SEED ?? Math.floor(Math.random() * 1e9), !kitty);
let lastHalo = -1;
let last = performance.now();
let glowClock = 0;
const FRAME_MS = 1000 / 30;
const loop = () => {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  piece.tick(dt);
  const cells = piece.cells();
  let frame = "\x1b[?2026h";                         // synchronized update, where supported
  // The glow changes slowly: fifteen uploads a second at most, and none while it holds still.
  glowClock += dt;
  if (kitty && glowClock >= 1 / 15) {
    glowClock = 0;
    let sum = 0;
    for (const c of cells) if (c.halo) sum += c.halo[0] * 3 + c.halo[1] * 5 + c.halo[2] * 7;
    const halo = Math.round(sum);
    if (halo !== lastHalo) { lastHalo = halo; frame += glowLayer.frame(glowImage(cells, cols, rows), cols, rows); }
  }
  frame += screen.paint(cells, cols, rows) + "\x1b[?2026l";
  write(frame);
  setTimeout(loop, Math.max(0, FRAME_MS - (performance.now() - now)));
};
loop();
