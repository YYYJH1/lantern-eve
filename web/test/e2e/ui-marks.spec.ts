import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The three bookmarks of the ledger, measured. A bookmark is a ribbon of cloth with a V cut into its foot, a dashed stitch that follows the outline of the cloth all the way
// round the inside of it (down the left side, across the top, down the right side and along both edges of the V), and a title slip of paper sewn on near the top with the
// name of the job on it, centred; a job that is done has its seal on the cloth under the slip. Measured at three window sizes
// (1280 by 760; 1536 by 730 at a ratio of 1.25, a laptop with its screen scaled to 125 percent; and 1920 by 1080), in Chinese
// on the light theme and in English on the dark one, closed, with one open, and with every job done.

const SIZES = [
  { width: 1280, height: 760, ratio: 1 },
  { width: 1536, height: 730, ratio: 1.25 },
  { width: 1920, height: 1080, ratio: 1 },
];

const LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

const NAMES = ["bridge", "truth", "peace"] as const;
type Name = (typeof NAMES)[number];

const tab = (page: Page, name: Name) => page.getByTestId(name === "bridge" ? "board-toggle" : `board-tab-${name}`);

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Part extends Rect {
  /** The colour of the text (the seal's rouge) and of the ground (the cloth, the paper), as the browser computed them. */
  color: string;
  background: string;
  padding: number;
}

/** The stitch: the corners of its path in the pixels of the cloth (the box of its svg is the box of the cloth), and its line as the browser computed it. */
interface Stitch extends Rect {
  corners: Array<[number, number]>;
  width: number;
  dashes: string;
  color: string;
}

interface Geometry {
  name: Name;
  cloth: Part;
  /** How deep the V in the foot of the cloth is, read from the clip path of the cloth (`calc(100% - 14px)` for its point); null where the clip path has none. */
  cut: number | null;
  stitch: Stitch | null;
  slip: Part | null;
  /** The name as it is set: the box of its text, less the space that the letter spacing leaves after the last character. */
  text: Rect | null;
  seal: Part | null;
  mark: Rect;
}

/** What each bookmark is made of, where it is, and the window it is in. */
async function measure(page: Page): Promise<{ marks: Geometry[]; width: number }> {
  return page.evaluate(() => {
    const part = (el: Element | null): Part | null => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, color: style.color, background: style.backgroundColor, padding: parseFloat(style.paddingLeft) || 0 };
    };
    const numbersOf = (text: string): number[] => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const pairs = (numbers: number[]): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i] as number, numbers[i + 1] as number]);
      return out;
    };
    const stitchOf = (el: Element | null): Stitch | null => {
      const path = el?.querySelector("path") ?? null;
      if (el === null || path === null) return null;
      const r = el.getBoundingClientRect();
      const line = getComputedStyle(path);
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, corners: pairs(numbersOf(path.getAttribute("d") ?? "")), width: parseFloat(line.strokeWidth) || 0, dashes: line.strokeDasharray, color: line.stroke };
    };
    const marks = Array.from(document.querySelectorAll('[data-testid="board-tabs"] .mark')).map((mark) => {
      const name = mark.getAttribute("data-tab") as "bridge" | "truth" | "peace";
      const label = mark.querySelector(".mark-name");
      let text: Rect | null = null;
      if (label !== null) {
        const range = document.createRange();
        range.selectNodeContents(label);
        const box = range.getBoundingClientRect();
        const spacing = parseFloat(getComputedStyle(label).letterSpacing) || 0;
        text = { left: box.left, top: box.top, right: box.right, bottom: box.bottom - spacing };
      }
      const r = mark.getBoundingClientRect();
      const cut = getComputedStyle(mark.querySelector(".mark-cloth") as Element).clipPath.match(/calc\(100% - ([\d.]+)px\)/)?.[1];
      return { name, cloth: part(mark.querySelector(".mark-cloth")) as Part, cut: cut === undefined ? null : Number(cut), stitch: stitchOf(mark.querySelector(".mark-stitch")), slip: part(mark.querySelector(".mark-label")), text, seal: part(mark.querySelector(".mark-seal")), mark: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
    return { marks, width: document.documentElement.clientWidth };
  });
}

/** The relative luminance and the contrast of two colours as the browser wrote them (rgb or color(srgb)), WCAG 2. */
function contrast(a: string, b: string): number {
  const rgb = (color: string): number[] => {
    const found = (color.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    return color.startsWith("color(") ? found.map((v, i) => (i < 3 ? v * 255 : v)) : found;
  };
  const luminance = (c: number[]): number => {
    const channel = (v: number): number => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(c[0] ?? 0) + 0.7152 * channel(c[1] ?? 0) + 0.0722 * channel(c[2] ?? 0);
  };
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const width = (r: Rect): number => r.right - r.left;
const height = (r: Rect): number => r.bottom - r.top;

type Pt = [number, number];

/** The distance of a point from a segment. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The distance of a point from the line through two points, at right angles to it. */
const toLine = (p: Pt, a: Pt, b: Pt): number => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Whether a point is inside a closed polygon. */
function inside(p: Pt, polygon: Pt[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i] as Pt, polygon[j] as Pt];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) within = !within;
  }
  return within;
}

/** How far in from the line of the stitch a box lies at its nearest, in pixels (negative where a corner is outside it): the box and the polygon are in the same pixels. */
function roomInside(box: Rect, polygon: Pt[]): number {
  const corners: Pt[] = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]];
  let room = Infinity;
  for (const p of corners) {
    const near = Math.min(...polygon.map((a, i) => toSegment(p, a, polygon[(i + 1) % polygon.length] as Pt)));
    room = Math.min(room, inside(p, polygon) ? near : -near);
  }
  return room;
}

/** All that must be true of a bookmark, with the label that says which one it is. */
function check(g: Geometry, label: string, window: number, open: boolean, done: boolean): void {
  const { cloth, stitch, slip, text, seal } = g;
  // the cloth: 46 wide, 64 when its page is open, 112 tall
  expect(width(cloth), `${label} cloth width`).toBeCloseTo(open ? 64 : 46, 0);
  expect(height(cloth), `${label} cloth height`).toBeCloseTo(112, 0);
  // nothing of the bookmark goes past the right edge of the window, or the left one
  for (const [what, r] of [["mark", g.mark], ["cloth", cloth], ["stitch", stitch], ["slip", slip], ["seal", seal]] as const) {
    if (r === null) continue;
    expect(r.right, `${label} ${what} inside the window on the right`).toBeLessThanOrEqual(window + 0.01);
    expect(r.left, `${label} ${what} inside the window on the left`).toBeGreaterThanOrEqual(0);
  }
  // the stitch is a dashed line that follows the outline of the cloth, `inset` inside it everywhere: down the left side, across the top, down the right side and
  // along both edges of the V
  expect(stitch, `${label} has a stitch`).not.toBeNull();
  if (stitch === null || slip === null || text === null) return;
  expect(stitch.dashes, `${label} stitch is dashed`).not.toBe("none");
  expect(stitch.width, `${label} stitch has a line`).toBeGreaterThan(0.9);
  const inset = 4;
  expect(Math.abs(stitch.left - cloth.left) + Math.abs(stitch.top - cloth.top) + Math.abs(stitch.right - cloth.right) + Math.abs(stitch.bottom - cloth.bottom), `${label} stitch is drawn on the box of the cloth`).toBeLessThanOrEqual(1);
  expect(stitch.corners, `${label} stitch has five corners`).toHaveLength(5);
  expect(g.cut, `${label} the cloth has a V in its foot`).not.toBeNull();
  const [footLeft, topLeft, topRight, footRight, point] = stitch.corners as [Pt, Pt, Pt, Pt, Pt];
  // the edges of the V of the cloth: from the foot on the left up to its point and down to the foot on the right
  const [footOnLeft, apex, footOnRight]: [Pt, Pt, Pt] = [[0, height(cloth)], [width(cloth) / 2, height(cloth) - (g.cut ?? 0)], [width(cloth), height(cloth)]];
  expect(topLeft[0], `${label} stitch from the left edge`).toBeCloseTo(inset, 1);
  expect(topLeft[1], `${label} stitch from the top`).toBeCloseTo(inset, 1);
  expect(topRight[1], `${label} stitch from the top, on the right`).toBeCloseTo(inset, 1);
  expect(width(cloth) - topRight[0], `${label} stitch from the right edge`).toBeCloseTo(inset, 1);
  expect(footLeft[0], `${label} the left side of the stitch is straight`).toBeCloseTo(inset, 1);
  expect(width(cloth) - footRight[0], `${label} the right side of the stitch is straight`).toBeCloseTo(inset, 1);
  // along both edges of the V it is `inset` from the edge, at right angles to it, at the foot of each side and at the point
  expect(toLine(footLeft, footOnLeft, apex), `${label} stitch from the left edge of the V`).toBeCloseTo(inset, 1);
  expect(toLine(point, footOnLeft, apex), `${label} stitch from the left edge of the V, at its point`).toBeCloseTo(inset, 1);
  expect(toLine(point, apex, footOnRight), `${label} stitch from the right edge of the V, at its point`).toBeCloseTo(inset, 1);
  expect(toLine(footRight, apex, footOnRight), `${label} stitch from the right edge of the V`).toBeCloseTo(inset, 1);
  // it is the whole outline: it comes down the sides to the V, and the point of the V is higher than its feet
  expect(point[1], `${label} the stitch has the V in it`).toBeLessThan(footLeft[1] - 3);
  expect(Math.abs(point[0] - width(cloth) / 2), `${label} the point of the V is in the middle`).toBeLessThanOrEqual(0.6);
  expect(Math.abs(footLeft[1] - footRight[1]), `${label} the two feet of the stitch are level`).toBeLessThanOrEqual(0.1);
  // the stitch shows on the cloth in this look
  expect(contrast(stitch.color, cloth.background), `${label} stitch against the cloth`).toBeGreaterThanOrEqual(3);
  // the slip is paper, centred left to right on the cloth, and in from the line of the stitch by 3 px or more on each side and above
  expect(slip.background, `${label} slip is paper`).not.toBe("rgba(0, 0, 0, 0)");
  expect(Math.abs(slip.left - cloth.left - (cloth.right - slip.right)), `${label} slip centred on the cloth`).toBeLessThanOrEqual(1);
  const onCloth = (r: Rect): Rect => ({ left: r.left - cloth.left, top: r.top - cloth.top, right: r.right - cloth.left, bottom: r.bottom - cloth.top });
  const apart = 3 + stitch.width / 2;
  expect(roomInside(onCloth(slip), stitch.corners), `${label} slip from the stitch`).toBeGreaterThanOrEqual(apart);
  // the name is centred on the slip, both ways, and the slip is as long as the name with the same room above and below it
  const gaps = { left: text.left - slip.left, right: slip.right - text.right, top: text.top - slip.top, bottom: slip.bottom - text.bottom };
  expect(Math.abs(gaps.left - gaps.right), `${label} name centred left to right (${gaps.left.toFixed(2)} and ${gaps.right.toFixed(2)})`).toBeLessThanOrEqual(1);
  expect(Math.abs(gaps.top - gaps.bottom), `${label} name centred top to bottom (${gaps.top.toFixed(2)} and ${gaps.bottom.toFixed(2)})`).toBeLessThanOrEqual(2);
  expect(Math.min(gaps.top, gaps.bottom), `${label} room above and below the name`).toBeGreaterThanOrEqual(4.5);
  // a job that is done has its seal, and only that
  expect(seal !== null, `${label} seal only where the job is done`).toBe(done);
  if (seal === null) return;
  expect(roomInside(onCloth(seal), stitch.corners), `${label} seal from the stitch`).toBeGreaterThanOrEqual(apart);
  expect(seal.top - slip.bottom, `${label} seal clear of the slip`).toBeGreaterThanOrEqual(3);
  expect(Math.abs(seal.left - cloth.left - (cloth.right - seal.right)), `${label} seal centred on the cloth`).toBeLessThanOrEqual(1);
  expect(width(seal), `${label} seal size`).toBeGreaterThanOrEqual(16);
  expect(width(seal), `${label} seal size`).toBeLessThanOrEqual(28);
  // it stands out from the cloth: 3 to 1 against it, or a ring of paper round it (and the rouge is 3 to 1 against that paper)
  const ring = seal.padding >= 1.5 && seal.background !== "rgba(0, 0, 0, 0)";
  expect(ring || contrast(seal.color, cloth.background) >= 3, `${label} seal stands out from the cloth`).toBe(true);
  if (ring) expect(contrast(seal.color, seal.background), `${label} seal against its ring`).toBeGreaterThanOrEqual(3);
}

for (const size of SIZES) {
  for (const look of LOOKS) {
    test.describe(`the bookmarks, ${look.lang} ${look.theme} ${size.width}x${size.height} at ${size.ratio}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.ratio });

      test("are centred, stitched and inside the window, closed, open and done", async ({ lantern }) => {
        test.setTimeout(240_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern);
        // closed: no job done
        await fake.feedFrame(page, fake.moment("day2"));
        await expect(tab(page, "peace")).toHaveAttribute("data-state", "open");
        const closed = await measure(page);
        for (const g of closed.marks) check(g, `closed ${g.name}`, closed.width, false, false);
        // the slip is as long as the name needs: all alike in Chinese (two characters), each its own in English
        const heights = closed.marks.map((g) => Math.round(height(g.slip ?? g.cloth)));
        if (look.lang === "zh") expect(new Set(heights).size, "the three names are two characters each").toBe(1);
        else expect(new Set(heights).size, "each word has the slip it needs").toBeGreaterThan(1);
        // one open at a time: its cloth is wider and its slip is the size it was, centred on it
        for (const name of NAMES) {
          await tab(page, name).click();
          await expect(page.getByTestId("board")).toHaveAttribute("data-page", name);
          const opened = await measure(page);
          for (const g of opened.marks) {
            check(g, `${name} open, ${g.name}`, opened.width, g.name === name, false);
            const was = closed.marks.find((c) => c.name === g.name);
            if (was?.slip == null || g.slip === null) throw new Error("no slip");
            expect(width(g.slip), `${g.name} slip keeps its width`).toBeCloseTo(width(was.slip), 0);
            expect(height(g.slip), `${g.name} slip keeps its length`).toBeCloseTo(height(was.slip), 0);
          }
          await tab(page, name).click();
          await expect(page.getByTestId("board")).toHaveAttribute("data-open", "false");
        }
        // every job done: a seal on each, under the slip
        await fake.feedFrame(page, fake.moment("day5"));
        await expect(tab(page, "peace")).toHaveAttribute("data-state", "done");
        const done = await measure(page);
        for (const g of done.marks) check(g, `done ${g.name}`, done.width, false, true);
        // and one of them open, with the seal
        await tab(page, "truth").click();
        await expect(page.getByTestId("board")).toHaveAttribute("data-page", "truth");
        const doneOpen = await measure(page);
        for (const g of doneOpen.marks) check(g, `done, truth open, ${g.name}`, doneOpen.width, g.name === "truth", true);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
