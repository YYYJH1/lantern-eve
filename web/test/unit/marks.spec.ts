import { expect, test } from "@playwright/test";
import { CIRCLES, GLYPHS, type Mark, pick, RULES, SEALS, STRIKE_LINES, STRIKES, TALLY, tallies, tally, TICKS, UNDERLINES, VERTICAL_RULES } from "../../src/page/ui/marks.ts";

/** Every number of a path, in pairs. A path is only moves, lines, quadratic curves and closes, with absolute coordinates. */
function points(d: string): Array<[number, number]> {
  expect(d, "path data").toMatch(/^[MLQZ0-9.,\s-]+$/);
  expect(d.startsWith("M")).toBe(true);
  expect(d.endsWith("Z")).toBe(true);
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  expect(numbers.length % 2).toBe(0);
  expect(numbers.every(Number.isFinite)).toBe(true);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < numbers.length; i += 2) out.push([numbers[i] as number, numbers[i + 1] as number]);
  return out;
}

function extent(mark: Mark): { x0: number; y0: number; x1: number; y1: number } {
  const all = mark.paths.flatMap(points);
  return {
    x0: Math.min(...all.map((p) => p[0])),
    y0: Math.min(...all.map((p) => p[1])),
    x1: Math.max(...all.map((p) => p[0])),
    y1: Math.max(...all.map((p) => p[1])),
  };
}

const EVERY: Array<[string, Mark]> = [
  ...TICKS.map((m, i): [string, Mark] => [`tick ${i}`, m]),
  ...Object.entries(CIRCLES).map(([k, m]): [string, Mark] => [`circle ${k}`, m]),
  ...STRIKES.map((m, i): [string, Mark] => [`strike ${i}`, m]),
  ...STRIKE_LINES.map((m, i): [string, Mark] => [`strike line ${i}`, m]),
  ...TALLY.map((m, i): [string, Mark] => [`tally ${i + 1}`, m]),
  ...UNDERLINES.map((m, i): [string, Mark] => [`underline ${i}`, m]),
  ...RULES.map((m, i): [string, Mark] => [`rule ${i}`, m]),
  ...VERTICAL_RULES.map((m, i): [string, Mark] => [`vertical rule ${i}`, m]),
  ...Object.entries(GLYPHS).map(([k, m]): [string, Mark] => [`glyph ${k}`, m]),
  ...Object.entries(SEALS).flatMap(([word, shapes]) => Object.entries(shapes).map(([shape, m]): [string, Mark] => [`seal ${word} ${shape}`, m])),
];

test.describe("the brush marks", () => {
  test("are filled outlines inside their own boxes, written as plain path data", () => {
    expect(EVERY.length).toBeGreaterThanOrEqual(30);
    for (const [name, mark] of EVERY) {
      expect(mark.w, name).toBeGreaterThan(0);
      expect(mark.h, name).toBeGreaterThan(0);
      expect(mark.paths.length, name).toBeGreaterThan(0);
      const box = extent(mark);
      // A stroke may run a little past its box (the flick of a tick, the overshoot of a circle), and never far.
      expect(box.x0, name).toBeGreaterThan(-3);
      expect(box.y0, name).toBeGreaterThan(-3);
      expect(box.x1, name).toBeLessThan(mark.w + 3);
      expect(box.y1, name).toBeLessThan(mark.h + 3);
      // The marks fill their boxes: a mark that is a speck of its box would be drawn too small.
      expect(box.x1 - box.x0, name).toBeGreaterThan(mark.w * 0.5);
    }
  });

  test("have variants that differ, so a list of ticks or underlines is not a stamp repeated", () => {
    for (const variants of [TICKS, STRIKES, STRIKE_LINES, UNDERLINES, RULES, VERTICAL_RULES]) {
      expect(new Set(variants.map((m) => m.paths.join("|"))).size).toBe(variants.length);
    }
    expect(Object.keys(CIRCLES).sort()).toEqual(["long", "round", "wide"]);
    // A circle is drawn for the shape it goes round: long is wider than wide, wide than round.
    expect(CIRCLES.round.w / CIRCLES.round.h).toBeCloseTo(1, 1);
    expect(CIRCLES.wide.w / CIRCLES.wide.h).toBeGreaterThan(1.8);
    expect(CIRCLES.long.w / CIRCLES.long.h).toBeGreaterThan(3.5);
  });

  test("count in the strokes of 正, written in order, and the first n strokes are the same strokes whatever n is", () => {
    expect(TALLY.map((m) => m.paths.length)).toEqual([1, 2, 3, 4, 5]);
    for (let n = 1; n < 5; n++) {
      const shorter = TALLY[n - 1] as Mark;
      const longer = TALLY[n] as Mark;
      expect(longer.paths.slice(0, n), `the first ${n} strokes`).toEqual(shorter.paths);
      expect([longer.w, longer.h]).toEqual([shorter.w, shorter.h]);
    }
    // Each stroke reaches where its place in the character is: the top bar is level and wide, the stem is tall, the bottom bar is the widest and lowest.
    const strokes = (TALLY[4] as Mark).paths.map((d) => {
      const all = points(d);
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    });
    const [top, stem, middle, foot, bottom] = strokes as [(typeof strokes)[0], (typeof strokes)[0], (typeof strokes)[0], (typeof strokes)[0], (typeof strokes)[0]];
    expect(top.w).toBeGreaterThan(top.h * 4);
    expect(stem.h).toBeGreaterThan(stem.w * 4);
    expect(middle.w).toBeLessThan(top.w);
    expect(foot.h).toBeLessThan(stem.h);
    expect(bottom.w).toBeGreaterThanOrEqual(top.w);
    expect(top.y).toBeLessThan(middle.y);
    expect(middle.y).toBeLessThan(bottom.y);
    expect(foot.y).toBeGreaterThan(middle.y);
  });

  test("give the tally of a number: nothing for none, a whole 正 for five, and a 正 for every five", () => {
    expect(tally(0)).toBeNull();
    expect(tally(-3)).toBeNull();
    expect(tally(1)).toBe(TALLY[0]);
    expect(tally(3)).toBe(TALLY[2]);
    expect(tally(5)).toBe(TALLY[4]);
    expect(tally(9)).toBe(TALLY[4]);
    expect(tallies(0)).toEqual([]);
    expect(tallies(5)).toEqual([TALLY[4]]);
    expect(tallies(12)).toEqual([TALLY[4], TALLY[4], TALLY[1]]);
  });

  test("have seals with the characters and the frame cut out of the ink, one path to fill with the even-odd rule", () => {
    expect(Object.keys(SEALS).sort()).toEqual(["delivered", "done"]);
    for (const [word, shapes] of Object.entries(SEALS)) {
      for (const [shape, seal] of Object.entries(shapes)) {
        const name = `${word} ${shape}`;
        expect(seal.evenodd, name).toBe(true);
        expect(seal.paths, name).toHaveLength(1);
        // The outline, two for the frame, the strokes of two characters and some specks: a lot of closed shapes.
        expect(((seal.paths[0] as string).match(/Z/g) ?? []).length, name).toBeGreaterThan(20);
      }
      expect(shapes.wide.w, word).toBeGreaterThan(shapes.wide.h);
      expect(shapes.square.w, word).toBe(shapes.square.h);
    }
    // The strokes and the rules are not cut and need no rule.
    for (const [name, mark] of EVERY) if (!name.startsWith("seal")) expect(mark.evenodd, name).toBeUndefined();
  });

  test("are picked by a key, the same variant every time", () => {
    const first = pick(TICKS, "t_bamboo_first");
    for (let i = 0; i < 5; i++) expect(pick(TICKS, "t_bamboo_first")).toBe(first);
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => pick(TICKS, k))).size).toBeGreaterThan(1);
    expect(pick(TICKS, 7)).toBe(pick(TICKS, "7"));
    expect(TICKS).toContain(pick(TICKS, 12345));
  });
});
