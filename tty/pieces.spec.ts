// Every piece, through every kind of pulse, only ever draws cells the mod's Raster accepts, and fills every pane shape.
import { expect, test } from "bun:test";
import { PIECES, encodeRaster } from "../hooks/pieces";
import { hasShape } from "./glyphs";

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

for (const name of Object.keys(PIECES)) {
  test(`${name}: printable width-1 BMP glyphs, the right count, through every pulse`, () => {
    const cols = 61, rows = 23;
    const p = PIECES[name]!.create(cols, rows, 7, { tint: true, quality: 0.3 });
    for (let f = 0; f < 120; f++) {
      p.tick(0.1);
      if (f === 10) p.react?.({ kind: "tool" });
      if (f === 20) p.react?.({ kind: "agents", running: 3 });
      if (f === 40) p.react?.({ kind: "message" });
      if (f === 60) p.react?.({ kind: "agents", running: 0 });
      if (f % 20 !== 0) continue;
      const cells = p.cells();
      expect(cells.length).toBe(cols * rows);
      for (const c of cells) {
        const cp = c.ch.codePointAt(0)!;
        expect([...c.ch].length).toBe(1);
        expect(cp >= 32 && cp <= 0xffff && !WIDE.test(c.ch)).toBe(true);
        if (!hasShape(c.ch)) throw new Error(`${name} drew "${c.ch}", which --pixels has no shape for`);
      }
      expect(encodeRaster(cells).length).toBe(Math.ceil((cols * rows * 12) / 3) * 4);
    }
  });
}

// The panel above the prompt, a wide pane, a docked column, a tiny tile, and a very wide strip.
const SHAPES: [number, number][] = [[120, 13], [211, 55], [36, 30], [23, 11], [371, 46]];
const ink = (ch: string) => ch !== " " && ch !== "·";

for (const name of Object.keys(PIECES)) {
  for (const [cols, rows] of SHAPES) {
    test(`${name} at ${cols}x${rows}: draws out to both ends of the long axis`, () => {
      const p = PIECES[name]!.create(cols, rows, 7, { tint: false, quality: 0.1 });
      for (let f = 0; f < 200; f++) p.tick(0.1);
      const cells = p.cells();
      expect(cells.length).toBe(cols * rows);
      const wide = cols / 2 >= rows;
      let a = 0, b = 0;   // ink in the first and last thirds
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!ink(cells[y * cols + x]!.ch)) continue;
        const u = wide ? x / cols : y / rows;
        if (u < 1 / 3) a++; else if (u >= 2 / 3) b++;
      }
      const third = (cols * rows) / 3;
      expect(Math.min(a, b) / third).toBeGreaterThan(0.02);
    });
  }
}
