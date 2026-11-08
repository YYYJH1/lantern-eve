import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// The line of the tutorial (`tutorial-chip`) and the hint pill (`hint-pill`) hang in the same place, over the head of whatever sheet is open under them. A sheet that
// reaches their band (the notebook with its statement card, the ledger, the card of the elder) starts below the line while one is up, measured as the page
// runs, keeps its own scrolling, and starts where it did when the line goes. The line stays where it is and stays on top. Measured at three window sizes (a
// laptop, a laptop with its screen scaled to 125 percent and a large monitor), in Chinese on the light theme and in English on the dark one, in the steps 5
// and 6 of the tutorial and with a hint lit.

const SIZES = [
  { width: 1280, height: 760, ratio: 1 },
  { width: 1536, height: 730, ratio: 1.25 },
  { width: 1920, height: 1080, ratio: 1 },
];

const LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

/** The gap that the page leaves between the line and the sheet under it, in pixels, with the little that a fractional layout can take away from it. */
const GAP = 8;
const SLACK = 1;

const NOTEBOOK_TWO = [
  { id: "n_clerk", text: { zh: "周家伙计说他看见李二那晚在桥边。", en: "Zhou's Clerk says he saw Li Er by the bridge that night." }, source: { kind: "heard", who: { zh: "周家伙计", en: "Zhou's Clerk" }, hand: 1 }, marks: [], chain: [] },
  { id: "n_broke", text: { zh: "李二弄坏了桥。", en: "Li Er broke the bridge." }, source: { kind: "heard", who: { zh: "茶馆老板娘", en: "Teahouse Keeper" }, hand: 3 }, marks: ["unconfirmed"], chain: [] },
];

type Line = "step5" | "step6" | "hint";

const LINE_SELECTOR: Record<Line, string> = { step5: '[data-testid="tutorial-chip"]', step6: '[data-testid="tutorial-chip"]', hint: '[data-testid="hint-pill"]' };

/** The first day with the help on and no line up yet: the notebook has its two lines, the card of the statement is on the right page. */
async function guided(lantern: LanternPage, line: Line): Promise<void> {
  const lines = line === "hint" ? [] : NOTEBOOK_TWO;
  await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: lines, commitments: [], statement: stmt.statementKey() }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

/** Puts the line up: the tutorial at its fifth step (the card put away, the judgement waited for) or its sixth (the evening waited for), or a hint that stays lit. */
async function raise(page: Page, line: Line): Promise<void> {
  if (line === "hint") {
    await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
    await expect(page.getByTestId("hint-pill")).toBeVisible();
    return;
  }
  await fake.beginTutorial(page);
  await page.evaluate((step) => {
    const tutorial = window.__lantern.play.guide.tutorial;
    tutorial.index = step === "step5" ? 4 : 5;
    tutorial.phase = step === "step5" ? "doing" : "waiting";
    window.__lantern.play.touch();
  }, line);
  await expect(page.getByTestId("tutorial-chip")).toBeVisible();
}

/** Takes the line down again: the player skips the tutorial, or puts the hint away. */
async function lower(page: Page, line: Line): Promise<void> {
  if (line === "hint") await page.getByTestId("hint-pill-close").click();
  else await page.getByTestId("tutorial-skip").click();
  await expect(page.locator(LINE_SELECTOR[line])).toHaveCount(0);
}

type Sheet = "notebook" | "ledger" | "elder";

/** The element that is the sheet: the notebook, the ledger, or the card of the clan elder. */
const sheetSelector = (sheet: Sheet): string => (sheet === "ledger" ? '[data-testid="board"]' : sheet === "elder" ? '[data-testid="elder"]' : '[data-testid="notebook"]');

async function open(page: Page, sheet: Sheet): Promise<void> {
  if (sheet === "ledger") {
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("board")).toHaveAttribute("data-page", "bridge");
  } else if (sheet === "elder") {
    await page.getByTestId("btn-elder").click();
    await expect(page.getByTestId("elder")).toBeVisible();
  } else {
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  }
}

async function close(page: Page, sheet: Sheet): Promise<void> {
  if (sheet === "ledger") await page.getByTestId("board-toggle").click();
  else if (sheet === "elder") await page.getByTestId("elder-close").click();
  else await page.getByTestId("btn-notebook").click();
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const boxOf = async (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

/**
 * What of the sheet lies under the line: its headings, its text and its controls that are in view (a line that is scrolled out of the sheet's frame
 * is not), each as a short description, where its box meets the box of the line.
 */
async function underTheLine(page: Page, sheetSel: string, lineSel: string): Promise<string[]> {
  return page.evaluate(
    ([sheetCss, lineCss]) => {
      const sheet = document.querySelector(sheetCss as string);
      const line = document.querySelector(lineCss as string);
      if (sheet === null || line === null) throw new Error("no sheet or no line");
      const l = line.getBoundingClientRect();
      type R = { left: number; top: number; right: number; bottom: number };
      const meet = (a: R, b: R): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const inView = (box: R, from: Element): R | null => {
        // the part of a box that the frames of the sheet that scroll or clip leave in view
        let out: R | null = box;
        for (let node: Element | null = from; node !== null && out !== null; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return null;
          if (node !== sheet && (style.overflowX !== "visible" || style.overflowY !== "visible")) {
            const f = node.getBoundingClientRect();
            out = { left: Math.max(out.left, f.left), top: Math.max(out.top, f.top), right: Math.min(out.right, f.right), bottom: Math.min(out.bottom, f.bottom) };
            if (out.right <= out.left || out.bottom <= out.top) return null;
          }
          if (node === sheet) break;
        }
        return out;
      };
      const readable = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(el).clipPath === "none";
      };
      const hits: string[] = [];
      const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (text === "" || parent === null || !readable(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          const seen = inView({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, parent);
          if (seen !== null && meet(seen, l)) hits.push(`text "${text.slice(0, 30)}" at ${Math.round(seen.top)}..${Math.round(seen.bottom)}`);
        }
      }
      for (const el of Array.from(sheet.querySelectorAll("button, a, input, select, textarea, summary, h1, h2, h3, h4, [role='tab'], [role='radio']"))) {
        if (!readable(el)) continue;
        const r = el.getBoundingClientRect();
        const seen = inView({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, el);
        if (seen !== null && meet(seen, l)) hits.push(`${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? el.className} at ${Math.round(seen.top)}..${Math.round(seen.bottom)}`);
      }
      return hits;
    },
    [sheetSel, lineSel],
  );
}

for (const size of SIZES) {
  for (const look of LOOKS) {
    test.describe(`the line of the help over a sheet, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.ratio });

      for (const line of ["step5", "step6", "hint"] as const) {
        test(`${line}: the notebook, the ledger and the elder's card start under the line, the line stays on top where it was, and the sheets are as they were when it goes`, async ({ lantern }) => {
          test.setTimeout(300_000);
          const page = lantern.page;
          for (const sheet of ["notebook", "ledger", "elder"] as const) {
            // each sheet on a page of its own, which has no line up yet
            await guided(lantern, line);
            const root = sheetSelector(sheet);
            // as it is with no line up
            await open(page, sheet);
            const before = await boxOf(page, root);
            await close(page, sheet);
            // with the line up
            await raise(page, line);
            const lineBox = await boxOf(page, LINE_SELECTOR[line]);
            await open(page, sheet);
            const lifted = await boxOf(page, root);
            expect(lifted.top, `${sheet} starts under the line`).toBeGreaterThanOrEqual(lineBox.bottom + GAP - SLACK);
            // a sheet with a foot of its own (the notebook, the ledger) ends where it did and is shorter; a card is as tall as what is on it
            if (sheet === "elder") expect(lifted.bottom - lifted.top, `${sheet} is no taller`).toBeLessThanOrEqual(before.bottom - before.top + 0.5);
            else expect(lifted.bottom, `${sheet} ends where it did`).toBeCloseTo(before.bottom, 0);
            expect(await underTheLine(page, root, LINE_SELECTOR[line]), `${sheet} has nothing of it under the line`).toEqual([]);
            // the line has not moved, and is on top: what is at its middle and at its skip or its cross is the line
            expect(await boxOf(page, LINE_SELECTOR[line]), "the line stays where it was").toEqual(lineBox);
            const onTop = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el === null) return false;
              const r = el.getBoundingClientRect();
              const middle = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              const corner = document.elementFromPoint(r.right - 10, r.top + r.height / 2);
              return el.contains(middle) && el.contains(corner);
            }, LINE_SELECTOR[line]);
            expect(onTop, "the line is over the sheet").toBe(true);
            // the line goes, and the sheet is back where it was
            await lower(page, line);
            await expect.poll(() => boxOf(page, root).then((b) => Math.round(b.top * 10)), { message: `${sheet} is back` }).toBe(Math.round(before.top * 10));
            expect((await boxOf(page, root)).bottom).toBeCloseTo(before.bottom, 0);
            await close(page, sheet);
          }
          expect(lantern.pageErrors).toEqual([]);
        });
      }

      test("gives the room back when the tutorial line goes and takes it again for a hint pill that comes after it", async ({ lantern }) => {
        test.setTimeout(240_000);
        const page = lantern.page;
        await guided(lantern, "step5");
        const ledger = '[data-testid="board"]';
        await page.getByTestId("board-toggle").click();
        await expect(page.getByTestId("board")).toHaveAttribute("data-page", "bridge");
        const before = await boxOf(page, ledger);
        await page.getByTestId("board-toggle").click();
        // the line of the tutorial comes up over the ledger, and goes when the tutorial is skipped
        await raise(page, "step5");
        await page.getByTestId("board-toggle").click();
        await expect(page.getByTestId("board")).toHaveAttribute("data-page", "bridge");
        const chip = await boxOf(page, LINE_SELECTOR.step5);
        expect((await boxOf(page, ledger)).top, "the ledger starts under the line of the tutorial").toBeGreaterThanOrEqual(chip.bottom + GAP - SLACK);
        await lower(page, "step5");
        await expect.poll(() => boxOf(page, ledger).then((b) => Math.round(b.top * 10))).toBe(Math.round(before.top * 10));
        // a hint is lit: the ledger goes under its pill, and back when the pill is put away
        await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
        await expect(page.getByTestId("hint-pill")).toBeVisible();
        const pill = await boxOf(page, LINE_SELECTOR.hint);
        expect((await boxOf(page, ledger)).top, "the ledger starts under the pill").toBeGreaterThanOrEqual(pill.bottom + GAP - SLACK);
        await lower(page, "hint");
        await expect.poll(() => boxOf(page, ledger).then((b) => Math.round(b.top * 10))).toBe(Math.round(before.top * 10));
        expect(lantern.pageErrors).toEqual([]);
      });

      test("a page of the ledger that runs past its foot still scrolls and has its phrase that turns it, in the shorter sheet", async ({ lantern }) => {
        test.setTimeout(240_000);
        test.skip(size.height > 1000, "a window this tall holds the whole page");
        const page = lantern.page;
        await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: NOTEBOOK_TWO, ...fake.moment("day4"), statement: stmt.statementKey() }, fake.GUIDED);
        const [first] = fake.commitments("delivered").commitments as Array<Record<string, unknown>>;
        await fake.feedFrame(page, { commitments: Array.from({ length: 8 }, (_, n) => ({ ...first, id: `c_${n}`, state: "delivered" })) });
        await fake.primeHelp(page);
        await page.getByTestId("board-toggle").click();
        const leaf = page.locator(".ledger-leaf");
        const full = await leaf.evaluate((el) => el.clientHeight);
        await page.getByTestId("board-toggle").click();
        await raise(page, "step5");
        await page.getByTestId("board-toggle").click();
        await expect(page.getByTestId("ledger-turn")).toBeVisible();
        const shorter = await leaf.evaluate((el) => el.clientHeight);
        // the line takes some of the sheet
        expect(shorter).toBeLessThan(full);
        await page.getByTestId("ledger-turn").getByRole("button").click();
        await expect.poll(() => leaf.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        expect(await underTheLine(page, sheetSelector("ledger"), LINE_SELECTOR.step5)).toEqual([]);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}

// The notices over the map (`.toasts`: what the town answered, the notice of a save that could not be made, what the host noted) hang at the top right, where the line
// of the help hangs too. They start under the line while one is up, in the town and in a talk, and are back where they were when it goes. Measured in the windows of
// the smallest size and a little above it, in Chinese on the light theme and in English on the dark one.

const TOAST_SIZES = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 760 },
];

/** Where the toasts hang when no line is up, in pixels. */
const TOASTS_TOP = 84;

type Scene = "hint" | "step5" | "talk";

/** The boxes of the line of the help and of what is up in the toasts, read in one go (a note of the town goes after a few seconds). */
async function toastBoxes(page: Page, lineSel: string): Promise<{ line: Box | null; toasts: Box | null; items: Array<Box & { id: string }> }> {
  return page.evaluate((line) => {
    const box = (el: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const lineEl = document.querySelector(line);
    const toasts = document.querySelector(".toasts");
    return {
      line: lineEl === null ? null : box(lineEl),
      toasts: toasts === null ? null : box(toasts),
      items: Array.from(document.querySelectorAll(".toasts > *")).map((el) => ({ id: el.getAttribute("data-testid") ?? el.className, ...box(el) })),
    };
  }, lineSel);
}

for (const size of TOAST_SIZES) {
  for (const look of LOOKS) {
    test.describe(`the toasts and the line of the help, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: { width: size.width, height: size.height } });

      for (const scene of ["hint", "step5", "talk"] as const satisfies readonly Scene[]) {
        test(`${scene}: the notice of a save that could not be made and the note of the town start under the line${scene === "talk" ? "" : ", and the toasts are back at the top when it goes"}`, async ({ lantern }) => {
          test.setTimeout(240_000);
          const page = lantern.page;
          const line: Line = scene === "step5" ? "step5" : "hint";
          await guided(lantern, line);
          await raise(page, line);
          if (scene === "talk") {
            await fake.recordSent(page);
            await fake.startTalk(page, "li_laotai");
          }
          const before = await boxOf(page, LINE_SELECTOR[line]);
          // The notice of a save that could not be made, and a note of the town, as the page puts them up.
          await page.evaluate(() => {
            window.__lantern.play.state.saveFailed = "storage";
            window.__lantern.play.touch();
          });
          await fake.feedFrame(page, fake.tasks("t_source"), [{ kind: "task_changed", tick: 5, from: "t_bamboo_first", to: "t_source", cause: "done", reason: { zh: "李老太撤回了阻拦", en: "Granny Li dropped her objection" } }]);
          await expect(page.getByTestId("save-failed")).toBeVisible();
          await expect(page.getByTestId("game-note").last()).toBeVisible();
          const up = await toastBoxes(page, LINE_SELECTOR[line]);
          expect(up.line, "the line stays where it was").toEqual(before);
          expect(up.toasts, "the toasts are there").not.toBeNull();
          expect(up.items.map((item) => item.id), "a note of the town and the notice of the save are in them").toEqual(expect.arrayContaining(["game-note", "save-failed"]));
          const edge = (up.line?.bottom ?? 0) + GAP - SLACK;
          expect(up.toasts?.top ?? 0, "the toasts start under the line").toBeGreaterThanOrEqual(edge);
          for (const item of up.items) expect(item.top, `${item.id} starts under the line`).toBeGreaterThanOrEqual(edge);
          // The line is over them still: what is at its middle and at its cross is the line.
          const onTop = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el === null) return false;
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          }, LINE_SELECTOR[line]);
          expect(onTop, "the line is on top").toBe(true);
          // The line goes: the toasts are where they hang with none. (In a talk the help lights its next hint as soon as one is put away, so there the line does not go.)
          if (scene !== "talk") {
            await lower(page, line);
            await expect.poll(async () => Math.round((await boxOf(page, ".toasts")).top)).toBe(TOASTS_TOP);
          }
          expect(lantern.pageErrors).toEqual([]);
        });
      }
    });
  }
}
