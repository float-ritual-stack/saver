// The canopy: black and white op-art stripes in square rings, flowing toward a vanishing point that drifts,
// each light stripe woven with a zigzag like the chenille throws, and the whole lit the way the room is lit,
// magenta to blue to red. Tool calls quicken the flow; each running subagent adds a second vanishing point
// whose rings interfere with the first; your message turns the lights.
import { GROUND, blankCells, hex, mix } from "./core";
import type { Cell, Piece, PieceOptions, Pulse, RGB } from "./core";

const LIGHTS: RGB[][] = [
  ["#ff3fb4", "#7a5bff", "#ff3b4a"].map(hex),     // the room: magenta, blue, red
  ["#2ee0c8", "#5b8cff", "#a57bff"].map(hex),
  ["#ffb03a", "#ff3fb4", "#e9e5da"].map(hex),
];
const CLOTH = hex("#efe8dc"), INK = hex("#0b0b0f");

export const canopy: Piece = {
  name: "canopy",
  blurb: "op-art stripes flowing into a drifting vanishing point, lit like the room",
  create(cols: number, rows: number, seed: number, opts: PieceOptions) {
    let time = (seed % 1000) / 10, flow = 0, speed = 1, lights = seed % LIGHTS.length, points = 1, shift = 0;
    return {
      tick(dt) {
        time += dt;
        speed += (1 - speed) * Math.min(1, dt * 1.2);
        flow += dt * 0.9 * speed;
        shift += dt * 0.05;
      },
      cells(): Cell[] {
        const cells = blankCells(cols * rows, opts);
        const pal = LIGHTS[lights]!;
        const W = cols / 2, H = rows;                       // two columns to a unit, so rings stay square
        const vps = Array.from({ length: points }, (_, k) => ({
          x: W * (0.5 + 0.28 * Math.sin(time * (0.07 + k * 0.03) + k * 2.4)),
          y: H * (0.5 + 0.28 * Math.cos(time * (0.05 + k * 0.04) + k * 1.1)),
        }));
        const stripe = Math.max(2, Math.round(Math.min(W, H) / 9));
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const x = col / 2, y = row;
          let light = 0;
          let weave = "";
          for (const vp of vps) {
            const dx = x - vp.x, dy = y - vp.y;
            const along = Math.abs(dx) > Math.abs(dy) ? dy : dx;   // position along the ring's side
            // Square rings, flowing inward; a small triangle wave on each ring gives the zigzag edge.
            const zig = Math.abs(((along * 1.2) % 2 + 2) % 2 - 1) * 0.6;
            const m = Math.max(Math.abs(dx), Math.abs(dy)) + zig;
            const band = Math.floor(m / stripe + flow);
            light ^= band & 1;
            if (vps.length === 1) weave = Math.abs(dx) > Math.abs(dy) ? (col % 2 ? "╱" : "╲") : (row % 2 ? "╱" : "╲");
          }
          // Light falls across the room: magenta at one side, blue across the middle, red at the other.
          const u = ((col / cols + row / rows * 0.6 + shift) % 1 + 1) % 1;
          const lamp = u < 0.5 ? mix(pal[0]!, pal[1]!, u * 2) : mix(pal[1]!, pal[2]!, (u - 0.5) * 2);
          if (light) {
            const cloth = mix(CLOTH, lamp, 0.55);
            cells[row * cols + col] = { ch: weave || " ", fg: mix(cloth, INK, 0.35), bg: cloth, halo: [lamp[0] * 0.4, lamp[1] * 0.4, lamp[2] * 0.4] };
          } else {
            const dark = mix(INK, lamp, 0.12);
            cells[row * cols + col] = { ch: " ", fg: dark, bg: opts.tint ? dark : mix(GROUND, lamp, 0.08) };
          }
        }
        return cells;
      },
      react(p: Pulse) {
        if (p.kind === "tool") speed = Math.max(speed, 4);
        else if (p.kind === "agents") points = 1 + Math.min(2, p.running);
        else lights = (lights + 1) % LIGHTS.length;
      },
      label: () => "canopy",
    };
  },
};
