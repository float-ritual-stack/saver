// Every piece, by name. The saver's --piece and the mod's /saver choose from this.
import { rng } from "./core";
import type { Piece, PieceInstance, Pulse } from "./core";
import { gargantua } from "./gargantua";
import { lattice } from "./lattice";
import { loom } from "./loom";
import { columns, eclipsePiece, mandala, vennPiece } from "./pen";
import { plusfield } from "./plusfield";

const ROTATION: Piece[] = [lattice, mandala, plusfield, eclipsePiece, gargantua, loom, vennPiece, columns];

// Each of the others in turn, a minute and a half apiece.
const cycle: Piece = {
  name: "cycle",
  blurb: "each of the others in turn, a minute and a half apiece",
  create(cols, rows, seed, opts) {
    const r = rng(seed);
    let at = Math.floor(r() * ROTATION.length), clock = 0;
    let current: PieceInstance = ROTATION[at]!.create(cols, rows, Math.floor(r() * 1e9), opts);
    let agents = 0;   // a piece that rotates in learns how many subagents are already running
    return {
      tick(dt) {
        clock += dt;
        if (clock > 90) { clock = 0; at = (at + 1) % ROTATION.length; current = ROTATION[at]!.create(cols, rows, Math.floor(r() * 1e9), opts); current.react?.({ kind: "agents", running: agents }); }
        current.tick(dt);
      },
      cells: () => current.cells(),
      react: (p: Pulse) => { if (p.kind === "agents") agents = p.running; current.react?.(p); },
      label: () => current.label(),
    };
  },
};

export const PIECES: Record<string, Piece> = {
  lattice, mandala, eclipse: eclipsePiece, venn: vennPiece, columns, plusfield, loom, gargantua, cycle,
};
export * from "./core";
