import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The small paper labels of the page, with their words centred on their paper and inside their frame: the placard at the top left (the day, the hour and the
// sky, in a frame of ink a little inside its edge) at every part of the day and in every weather, and the tags that hold a word or a number (the state of the world,
// the count on the notebook). Measured at 1280 by 760 and at 1536 by 730 with a ratio of 1.25 (a laptop with its screen scaled to 125 percent), in Chinese on the
// light theme and in English on the dark one.

const SIZES = [
  { width: 1280, height: 760, ratio: 1 },
  { width: 1536, height: 730, ratio: 1.25 },
];

const LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

const WEATHERS = ["clear", "light_rain", "heavy_rain"] as const;
/** One time in each part of the day, with the widest English name of a part ("Afternoon") among them. */
const TIMES = [
  { hour: 5, minute: 5, clock: "05:05" },
  { hour: 8, minute: 30, clock: "08:30" },
  { hour: 12, minute: 0, clock: "12:00" },
  { hour: 14, minute: 0, clock: "14:00" },
  { hour: 17, minute: 40, clock: "17:40" },
  { hour: 22, minute: 5, clock: "22:05" },
] as const;

interface Line {
  line: string;
  rows: number;
  /** The room between the frame and the words, on the left and on the right (the space that the letter spacing leaves after the last character is not words). */
  left: number;
  right: number;
}

/** The lines of the placard and how they stand in its frame. */
async function placard(page: Page): Promise<{ height: number; lines: Line[] }> {
  return page.evaluate(() => {
    const placard = document.querySelector(".placard");
    if (placard === null) throw new Error("no placard");
    const box = placard.getBoundingClientRect();
    // the frame is a line of ink drawn inside the edge, as far in as the outline offset says
    const frame = Math.abs(parseFloat(getComputedStyle(placard).outlineOffset) || 0);
    const lines = [".pl-day", ".pl-hour", ".pl-sky"].map((selector) => {
      const element = placard.querySelector(selector);
      if (element === null) throw new Error(`no ${selector}`);
      // the words only: the boxes of the text, and not the boxes of the elements that hold it
      const rects: DOMRect[] = [];
      let spacing = 0;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0));
        spacing = Math.max(spacing, parseFloat(getComputedStyle(node.parentElement as Element).letterSpacing) || 0);
      }
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right)) - spacing;
      return { line: selector, rows: new Set(rects.map((r) => Math.round(r.top))).size, left: left - (box.left + frame), right: box.right - frame - right };
    });
    return { height: box.height, lines };
  });
}

for (const size of SIZES) {
  for (const look of LOOKS) {
    test.describe(`the small labels, ${look.lang} ${look.theme} ${size.width}x${size.height} at ${size.ratio}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.ratio });

      test("the placard keeps its words inside its frame and in the middle of it, at every hour and in every weather, on as few lines as there are things to say", async ({ lantern }) => {
        test.setTimeout(240_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }) }, fake.GUIDED);
        const heights = new Set<number>();
        for (const weather of WEATHERS) {
          for (const time of TIMES) {
            await fake.feedFrame(page, { weather, time: { day: 3, hour: time.hour, minute: time.minute, phase: "day" } });
            await expect(page.getByTestId("hud-clock")).toHaveText(time.clock);
            await expect(page.getByTestId("hud-weather")).toHaveAttribute("data-weather", weather);
            const { height, lines } = await placard(page);
            heights.add(Math.round(height));
            for (const l of lines) {
              const here = `${weather} ${time.clock} ${l.line}`;
              expect(l.left, `${here}: room left of the words`).toBeGreaterThanOrEqual(3);
              expect(l.right, `${here}: room right of the words`).toBeGreaterThanOrEqual(3);
              expect(Math.abs(l.left - l.right), `${here}: words in the middle (${l.left.toFixed(1)} and ${l.right.toFixed(1)})`).toBeLessThanOrEqual(1.5);
              // the sky is one line, in either language
              if (l.line === ".pl-sky") expect(l.rows, `${here}: one line`).toBe(1);
            }
          }
        }
        // the placard is as tall at every hour and in every weather: no line of it wraps into two
        expect([...heights], "one height for the placard").toHaveLength(1);
        expect(lantern.pageErrors).toEqual([]);
      });

      test("the tags that hold a word or a number have it in the middle of their paper", async ({ lantern }) => {
        const page = lantern.page;
        await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }) }, fake.GUIDED);
        for (const [testId, sideTolerance] of [["status", 1.5], ["notebook-count", 1.5]] as const) {
          const gaps = await page.getByTestId(testId).evaluate((tag) => {
            const range = document.createRange();
            range.selectNodeContents(tag);
            const text = range.getBoundingClientRect();
            const paper = tag.getBoundingClientRect();
            return { left: text.left - paper.left, right: paper.right - text.right, top: text.top - paper.top, bottom: paper.bottom - text.bottom };
          });
          expect(Math.abs(gaps.left - gaps.right), `${testId}: left and right (${gaps.left.toFixed(1)} and ${gaps.right.toFixed(1)})`).toBeLessThanOrEqual(sideTolerance);
          expect(Math.abs(gaps.top - gaps.bottom), `${testId}: top and bottom (${gaps.top.toFixed(1)} and ${gaps.bottom.toFixed(1)})`).toBeLessThanOrEqual(2);
        }
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
