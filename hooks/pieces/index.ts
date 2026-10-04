// Every piece, by name. The saver's --piece and the mod's /saver choose from this.
import { rng } from "./core";
import type { Piece, PieceInstance, Pulse } from "./core";
import { canopy } from "./canopy";
import { gargantua } from "./gargantua";
import { lattice } from "./lattice";
import { loom } from "./loom";
import { columns, eclipsePiece, mandala, vennPiece } from "./pen";
import { plusfield } from "./plusfield";
import { seedPiece } from "./seed";

import { withFx } from "./fx";
import type { FxControl, FxMode } from "./fx";

// The effects every piece plays with: auto (each piece its own seeded mix), off, or one effect by name.
let fxMode: FxMode = "auto";
export const setFx = (m: FxMode) => { fxMode = m; };
export const getFx = () => fxMode;
const fx = (p: Piece) => withFx(p, () => fxMode);

const ROTATION: Piece[] = [lattice, mandala, plusfield, canopy, seedPiece, eclipsePiece, gargantua, loom, vennPiece, columns].map(fx);

// Each of the others in turn, a minute and a half apiece: the outgoing piece's palette spins and dissolves,
// and the next one decrypts in.
const cycle: Piece = {
  name: "cycle",
  blurb: "each of the others in turn, a minute and a half apiece",
  create(cols, rows, seed, opts) {
    const r = rng(seed);
    let at = Math.floor(r() * ROTATION.length), clock = 0, leaving = false;
    const start = () => ROTATION[at]!.create(cols, rows, Math.floor(r() * 1e9), opts) as PieceInstance & FxControl;
    let current = start();
    let agents = 0;   // a piece that rotates in learns how many subagents are already running
    const next = () => {
      at = (at + 1) % ROTATION.length; clock = 0; leaving = false;
      current = start(); current.react?.({ kind: "agents", running: agents });
    };
    return {
      tick(dt) {
        clock += dt;
        if (clock > 90 && !leaving) { leaving = true; if (current.leave) current.leave(3, next); else next(); }
        current.tick(dt);
      },
      cells: () => current.cells(),
      react: (p: Pulse) => { if (p.kind === "agents") agents = p.running; current.react?.(p); },
      label: () => current.label(),
    };
  },
};

export const PIECES: Record<string, Piece> = {
  ...Object.fromEntries(ROTATION.map((p) => [p.name, p])),
  cycle,
};
export { EFFECTS } from "./fx";
export * from "./core";
