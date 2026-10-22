// A pond in the rain. Drops land across the whole surface and push out rings that pass through each other,
// each a damped wave trailing its leading crest, and the sum shows as tone, tinted by height from the deep
// colour to the crest's. A tool call is a drop; each running subagent makes the rain heavier; your message
// changes the light and lands one big drop in the middle.
import { GROUND, blankCells, hex, mix, rng } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB, Rng } from "./core";

const WATERS: RGB[][] = [
  ["#0d2a4a", "#1f7fc2", "#5fe0e8", "#f2fbff"].map(hex),   // lido
  ["#22103a", "#7a3fd0", "#ff6fb8", "#ffe6f2"].map(hex),   // dusk
  ["#0b2a22", "#1f9a6e", "#a6f07a", "#f6ffd8"].map(hex),   // lily pad
  ["#2a0e08", "#c2401f", "#ffa13d", "#fff0c8"].map(hex),   // lantern
];
const RAMP = " .,:;-=+*oxO#%@";

interface Drop { x: number; y: number; at: number; amp: number }

export const ripple: Piece = {
  name: "ripple",
  blurb: "rain on a pond: rings that spread and pass through each other",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    const r: Rng = rng(seed);
    const W = cols / 2, H = rows;                   // two columns to a unit, so rings stay round
    const S = Math.min(W, H);
    const speed = Math.max(1.5, Math.min(6, S * 0.12)), wave = Math.max(1.6, Math.min(5, S / 7)), life = 6;
    const k = (Math.PI * 2) / wave, trail = wave * 1.6;
    // Drops a second, by the long side and by area, so a thin strip rains along its length as a big pane does.
    const base = Math.max(0.6, Math.max(W, H) / 25, (W * H) / 3000);
    let water = Math.floor(r() * WATERS.length), time = 0, rain = 1, next = 0, n = Math.floor(r() * 100);
    let drops: Drop[] = [];
    // Golden-ratio steps along the long side spread the drops evenly however wide the pane is.
    const land = (amp: number, x?: number, y?: number) => {
      n++;
      const g = (n * 0.618034) % 1;
      drops.push({ x: x ?? (W >= H ? g * W : r() * W), y: y ?? (W >= H ? r() * H : g * H), at: time, amp });
    };
    for (let i = 0; i < Math.ceil(base * life); i++) { land(0.8 + r() * 0.4); drops[drops.length - 1]!.at -= r() * life; }
    const height = new Float32Array(cols * rows);

    return {
      tick(dt) {
        time += dt;
        next -= dt * base * rain;
        while (next <= 0) { land(0.8 + r() * 0.5); next += 0.4 + r() * 1.2; }
        drops = drops.filter((d) => time - d.at < life * d.amp);
      },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const pal = WATERS[water]!;
        height.fill(0);
        for (const d of drops) {
          const age = time - d.at, R = age * speed;
          const left = 1 - age / (life * d.amp);
          if (left <= 0) continue;
          const fade = Math.min(1.3, d.amp) * left * Math.sqrt(left);
          // Only the band from the leading crest back through its trail is worth visiting.
          const inner = Math.max(0, R - trail * 3), outer = R + wave * 0.25;
          const y0 = Math.max(0, Math.floor(d.y - outer)), y1 = Math.min(rows - 1, Math.ceil(d.y + outer));
          for (let row = y0; row <= y1; row++) {
            const dy = row + 0.5 - d.y;
            const span = outer * outer - dy * dy;
            if (span <= 0) continue;
            const reach = Math.sqrt(span) * 2;
            const c0 = Math.max(0, Math.floor(d.x * 2 - reach)), c1 = Math.min(cols - 1, Math.ceil(d.x * 2 + reach));
            for (let col = c0; col <= c1; col++) {
              const dx = (col + 0.5) / 2 - d.x;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < inner || dist > outer) continue;
              const behind = R - dist;
              height[row * cols + col]! += fade * Math.cos(k * behind) * Math.exp(-Math.max(0, behind) / trail);
            }
          }
        }
        for (let i = 0; i < cols * rows; i++) {
          const h = height[i]!;
          // Crests in full tone; troughs only faintly, so calm water stays dark.
          const v = Math.min(1, h > 0 ? h * 1.2 : -h * 0.2);
          const g = Math.floor(v * (RAMP.length - 1));
          if (g === 0) continue;
          const t = (h + 1) / 2;
          const u = Math.max(0, Math.min(1, t)) * (pal.length - 1), j = Math.min(pal.length - 2, Math.floor(u));
          const fg = mix(pal[j]!, pal[j + 1]!, u - j);
          cells[i] = { ch: RAMP[g]!, fg, bg: opts.tint ? mix(GROUND, fg, 0.06 + v * 0.1) : null, halo: [fg[0] * v * 0.45, fg[1] * v * 0.45, fg[2] * v * 0.45] };
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") land(1.2);
        else if (p.kind === "agents") rain = 1 + Math.min(4, p.running) * 0.8;
        else { water = (water + 1) % WATERS.length; land(2, W / 2, H / 2); }
      },
      label: () => "ripple",
    };
  },
};
