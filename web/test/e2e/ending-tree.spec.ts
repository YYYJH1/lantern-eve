import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { CASES, type Case, endingOf, nightFrame, REVEAL } from "../support/festival.ts";
import * as fake from "../support/slice.ts";

// The lines of the tree of a rumour on the ending page are lines to be seen. A line that tells a story that is not true is dashed, and a line that changed the story has a numbered
// circle on it. A line between two names that are as wide as their column can be left with two stubs, one on each side of its circle, in which no dash shows. Each line has a run of
// its own, outside the frames of the two names it joins and outside the circle of its number, and the run is long enough for three dashes of the dash pattern of the page.
test.use({ map: true });

const FULL = CASES[0] as Case;
const BASE = REVEAL.chains[0] as (typeof REVEAL.chains)[number];

/** A chain of four tellings, each of which changed the story, between the names that are the widest of the cast in English: each of them is the widest of its column and a line leaves it straight. */
const WIDEST = {
  ...BASE,
  planted: [["p1", "li_er", "zhou_zhanggui"]],
  told: [
    ["c1", "li_er", "zhou_zhanggui", "p1", "level", 10],
    ["c2", "zhou_zhanggui", "cha_laoban", "p3", "assimilate", 20],
    ["c3", "cha_laoban", "gengfu", "p3", "sharpen", 30],
    ["c4", "gengfu", "zhou_huoji", "p4", "fill", 40],
  ],
  held: [],
  reached: ["zhou_zhanggui", "cha_laoban", "gengfu", "zhou_huoji"],
};

const CHAINS = [
  { what: "of the chain that the other specs of the ending use", chains: [BASE], lines: 5 },
  { what: "between the widest names of the cast", chains: [WIDEST], lines: 4 },
];

type Lantern = Parameters<Parameters<typeof test>[2]>[0]["lantern"];

async function open(lantern: Lantern, lang: "zh" | "en", chains: readonly unknown[]): Promise<void> {
  await fake.openFirstDay(lantern, nightFrame(FULL), fake.TOWN);
  await lantern.setLang(lang);
  const ending = { ...endingOf(FULL), reveal: { ...REVEAL, chains } };
  await fake.feedFrame(lantern.page, nightFrame(FULL, { ending }), [ending]);
  await expect(lantern.page.getByTestId("ending")).toBeVisible();
}

interface Seen {
  id: string;
  /** The longest stretch of the line that no frame of a name and no circle lies over, in the units of the drawing. */
  run: number;
  /** The dash and the gap of the pattern of the line, in the same units. */
  dash: [number, number];
}

/** What can be seen of each line of the tree, measured where the browser put the line, the frames of the names and the circles. */
const seen = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => {
    const out: Seen[] = [];
    const number = (text: string): number => Number.parseFloat(text);
    const moved = (el: Element | null): { x: number; y: number } => {
      const at = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(el?.getAttribute("transform") ?? "") as RegExpExecArray;
      return { x: number(at[1] as string), y: number(at[2] as string) };
    };
    for (const group of Array.from(document.querySelectorAll('[data-testid="tree-edge"]'))) {
      const svg = (group as SVGGElement).ownerSVGElement as SVGSVGElement;
      const path = group.querySelector("path.tree-edge") as SVGPathElement;
      // a frame is the rectangle that a name stands in, with the half of its stroke on each side
      const frames = Array.from(svg.querySelectorAll('[data-testid="tree-node"]')).map((node) => {
        const rect = node.querySelector("rect") as SVGRectElement;
        const half = number(getComputedStyle(rect).strokeWidth) / 2;
        const at = moved(node);
        return { left: at.x - half, right: at.x + rect.width.baseVal.value + half, top: at.y - half, bottom: at.y + rect.height.baseVal.value + half };
      });
      const circle = group.querySelector('[data-testid="tree-flag"] circle');
      const flag = circle === null ? null : { ...moved(circle.parentElement), reach: number(circle.getAttribute("r") ?? "0") + number(getComputedStyle(circle).strokeWidth) / 2 };
      const step = 0.25;
      const total = path.getTotalLength();
      let run = 0;
      let longest = 0;
      for (let along = 0; along <= total; along += step) {
        const point = path.getPointAtLength(along);
        const covered = frames.some((f) => point.x > f.left && point.x < f.right && point.y > f.top && point.y < f.bottom) || (flag !== null && Math.hypot(point.x - flag.x, point.y - flag.y) < flag.reach);
        run = covered ? 0 : run + step;
        longest = Math.max(longest, run);
      }
      const pattern = (getComputedStyle(path).strokeDasharray.match(/[\d.]+/g) ?? ["6", "4"]).map(Number);
      out.push({ id: group.getAttribute("data-id") ?? "", run: longest, dash: [pattern[0] ?? 6, pattern[1] ?? 4] });
    }
    return out;
  });

test.describe("the lines of the tree of a rumour", () => {
  for (const lang of ["en", "zh"] as const) {
    for (const { what, chains, lines } of CHAINS) {
      test(`each has a run of three dashes to be seen, in ${lang === "en" ? "English" : "Chinese"}, ${what}`, async ({ lantern }) => {
        await open(lantern, lang, chains);
        const all = await seen(lantern.page);
        expect(all.length, "the lines of the tree").toBe(lines);
        for (const line of all) {
          // three dashes with the two gaps between them
          const least = 3 * line.dash[0] + 2 * line.dash[1];
          expect(line.run, `the longest run to be seen of the line ${line.id}, where three dashes take ${least}`).toBeGreaterThanOrEqual(least);
        }
      });
    }
  }
});
