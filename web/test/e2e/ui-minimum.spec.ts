import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { MIN_WINDOW } from "../../src/page/ui/window.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { feedPeople, known, peopleRows, stamp } from "../support/people.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";
import { scaled } from "../support/time-scale.ts";

// The smallest window that the page is laid out for (`MIN_WINDOW`), and a larger one. The desktop layout, in each state of the game that has something of its own to lay
// out, is looked at, and nothing may lie over anything it should not, run off the window, or make the page scroll. LANTERN_MIN_SIZES (for example "1366x625,1280x600")
// names other sizes to look at instead; the findings of each state are written, with its picture, into LANTERN_SHOTS_DIR
// when that is set. A state that has a layer of its own over the page (a card, the menu, the sheet of the elder) is looked at in the same way: the controls in the layer
// have nothing of the page over them, and the controls that the page keeps in reach have nothing over them but the layer, behind which what lies is not looked at.

const OUT = process.env.LANTERN_SHOTS_DIR ?? "";
const NAMED = (process.env.LANTERN_MIN_SIZES ?? "")
  .split(",")
  .filter((s) => s !== "")
  .map((s) => {
    const [width, height] = s.split("x").map(Number);
    return { width: width ?? 0, height: height ?? 0 };
  });
const SIZES = NAMED.length > 0 ? NAMED : [{ width: MIN_WINDOW.width, height: MIN_WINDOW.height }, { width: 1440, height: 900 }];

interface Finding {
  scroll: { x: number; y: number };
  outside: string[];
  covered: string[];
  overlaps: string[];
}

/**
 * What is wrong with the page as it stands: the page scrolls, a block runs off the window, a control has something else over it, two blocks lie over each other.
 * `layer` is the open layer of a state that has one (a card, the menu, the elder's sheet): the controls in it must have nothing of the page over them, and the
 * controls that the page keeps in reach must have nothing over them but the layer, behind which what lies is not looked at.
 */
async function audit(page: Page, layer: string | null): Promise<Finding> {
  return page.evaluate((layerSel) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const name = (el: Element): string => {
      const id = el.getAttribute("data-testid");
      return id !== null ? `[${id}]` : `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : ""}`;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05 && el.closest("[inert], [aria-hidden='true'], [hidden]") === null;
    };
    const out: Finding = { scroll: { x: document.documentElement.scrollWidth - W, y: document.documentElement.scrollHeight - H }, outside: [], covered: [], overlaps: [] };
    const open = layerSel === null ? null : document.querySelector(layerSel);
    if (layerSel !== null && open === null) throw new Error(`the layer ${layerSel} is not there`);
    // what lies behind the open layer: its own box, and the scrim that the menu has
    const behind = (el: Element): boolean => open !== null && (open.contains(el) || el.closest(".scrim") !== null);
    // 1. the blocks of the layout stay in the window
    const BLOCKS = [".placard", ".slip", ".run", ".mark", "aside.side", ".talk-strip", ".slips > *", ".person-note", ".ledger", ".notebook", ".sheet", ".menu", ".corner", ".tut-chip", ".hint-pill", ".toasts", ".ending", ".talk-dock"];
    const seen: Array<{ el: Element; n: string; sel: string }> = [];
    for (const selector of BLOCKS) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.outside.push(`${name(el)} ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${W}x${H}`);
        seen.push({ el, n: name(el), sel: selector });
      }
    }
    // 2. a control has nothing of another block over it: what is on top at the middle of it and near its corners is the control (or in it), or is in the same block
    const blockOf = (el: Element): Element | null => {
      for (let node: Element | null = el; node !== null; node = node.parentElement) if (BLOCKS.some((selector) => node?.matches(selector))) return node;
      return null;
    };
    const scrolling = (el: Element): Element[] => {
      const list: Element[] = [];
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden)/.test(style.overflowY + style.overflowX)) list.push(node);
      }
      return list;
    };
    /** What lies over the control at the middle of it or near its corners, as a finding, or null where only what may lie there does. */
    const under = (el: Element, free: (top: Element) => boolean): string | null => {
      const r = el.getBoundingClientRect();
      const frames = scrolling(el).map((f) => f.getBoundingClientRect());
      const points = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 4, r.top + 4],
        [r.right - 4, r.bottom - 4],
      ];
      for (const [x, y] of points as Array<[number, number]>) {
        if (x < 0 || y < 0 || x > W || y > H) continue;
        // a point that a frame of the control (a list that scrolls, a sheet with a clipped edge) does not show is not looked at
        if (frames.some((f) => x < f.left || x > f.right || y < f.top || y > f.bottom)) continue;
        const top = document.elementFromPoint(x, y);
        if (top !== null && !el.contains(top) && !top.contains(el) && !free(top)) return `${name(el)} is under ${name(top)} at ${Math.round(x)},${Math.round(y)}`;
      }
      return null;
    };
    // (the controls that the page keeps in reach: the two drawings, the bookmarks, the three things of the corner and the acts round the manager)
    const KEPT = "[data-testid='btn-pause'], [data-testid='btn-menu'], .mark, .corner button, aside.side button, .talk-strip button";
    for (const el of Array.from(document.querySelectorAll(KEPT))) {
      if (!visible(el)) continue;
      const found = under(el, (top) => blockOf(top) === blockOf(el) || behind(top));
      if (found !== null) out.covered.push(found);
    }
    // the controls in the open layer: nothing outside the layer lies over them
    if (open !== null) {
      for (const el of Array.from(open.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [role='button']"))) {
        if (!visible(el)) continue;
        const found = under(el, (top) => open.contains(top));
        if (found !== null) out.covered.push(`in the layer: ${found}`);
      }
    }
    // 3. two blocks of the fixed layout do not lie one over the other
    const FIXED = [".placard", ".slip", ".run > *", ".mark", "aside.side", ".talk-strip", ".slips > *", ".person-note", ".corner button[data-testid]", ".tut-chip", ".hint-pill"];
    const fixed: Array<{ n: string; r: DOMRect }> = [];
    for (const selector of FIXED) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height === 0) continue;
        fixed.push({ n: name(el), r });
      }
    }
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) {
        const a = fixed[i]?.r as DOMRect;
        const b = fixed[j]?.r as DOMRect;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 4 && h > 4) out.overlaps.push(`${fixed[i]?.n} and ${fixed[j]?.n} overlap by ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    // the sheets over the fixed layout that must stay free of them (the open layer lies over what is behind it on purpose)
    for (const sheet of seen.filter((s) => [".ledger", ".notebook", ".sheet", ".menu", ".ending"].includes(s.sel) && !(open !== null && (open.contains(s.el) || s.el.contains(open))))) {
      const a = sheet.el.getBoundingClientRect();
      // (the bookmark of the page that is open reaches into the sheet on purpose, as the tab of a divider does)
      for (const f of fixed.filter((x) => !/note/.test(x.n) && !/tutorial-chip|hint-pill/.test(x.n) && !/board-(toggle|tab)/.test(x.n))) {
        const w = Math.min(a.right, f.r.right) - Math.max(a.left, f.r.left);
        const h = Math.min(a.bottom, f.r.bottom) - Math.max(a.top, f.r.top);
        // (the lower edge of the head of the slip is cut into a V and the top edge of a sheet is torn: a few pixels of one under the other are the paper's edges)
        if (w > 8 && h > 8) out.overlaps.push(`${sheet.n} over ${f.n} by ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    return out;
  }, layer);
}

const click = (page: Page, id: string) => page.getByTestId(id).click();

/** The states that have a layer of their own over the page, and the element that is the layer. */
const LAYER: Record<string, string> = {
  gazette: '[data-testid="gazette"]',
  night: '[data-testid="night"]',
  clarify: '[data-testid="clarify"]',
  menu: '[data-testid="menu"]',
  "menu-hints": '[data-testid="menu"]',
  elder: '[data-testid="elder"]',
};

/** The first task with the title it is given: a title that is long makes the slip taller, and the ledger and the notebook start under it. */
function titled(text: { zh: string; en: string }): Record<string, unknown> {
  const frame = fake.tasks("t_bamboo_first") as { tasks: Array<Record<string, unknown>> };
  return { ...frame, tasks: frame.tasks.map((task) => (task.id === "t_bamboo_first" ? { ...task, text } : task)) };
}

/** A title that runs to three lines of the slip in English, whatever the words of the script are. */
const LONG_TITLE = { zh: "先把桥是怎么断的查清楚，再当着全镇人的面说出来，把闲话了结", en: "Find out how the bridge broke and then say it in public, before the whole town" };

const longTitle = (): Record<string, unknown> => titled(LONG_TITLE);

const STATES: Array<[string, (lantern: LanternPage) => Promise<void>]> = [
  ["main", async () => undefined],
  ["ledger-bridge", async ({ page }) => click(page, "board-toggle")],
  ["ledger-truth", async ({ page }) => click(page, "board-tab-truth")],
  ["ledger-peace", async ({ page }) => click(page, "board-tab-peace")],
  [
    "day4-ledger",
    async ({ page }) => {
      await fake.feedFrame(page, fake.moment("day4"));
      await click(page, "board-toggle");
    },
  ],
  ["notebook", async ({ page }) => click(page, "btn-notebook")],
  [
    "ledger-long-title",
    async ({ page }) => {
      await fake.feedFrame(page, longTitle());
      await expect(page.getByTestId("topbar-task-text")).toContainText("Find out how the bridge broke");
      await click(page, "board-toggle");
    },
  ],
  [
    "notebook-long-title",
    async ({ page }) => {
      await fake.feedFrame(page, longTitle());
      await expect(page.getByTestId("topbar-task-text")).toContainText("Find out how the bridge broke");
      await click(page, "btn-notebook");
    },
  ],
  [
    "statement-card",
    async ({ page }) => {
      await fake.feedFrame(page, { statement: stmt.statementKey() });
      await click(page, "btn-notebook");
      await click(page, "workspace-tab-statement");
    },
  ],
  [
    "talk-tags",
    async ({ page }) => {
      await fake.recordSent(page);
      await fake.startTalk(page, "li_laotai");
      await click(page, "verb-ask");
      await expect(page.getByTestId("topic-chips")).toBeVisible();
    },
  ],
  [
    "talk-request",
    async ({ page }) => {
      await fake.recordSent(page);
      await fake.answerPreview(page, fake.PREVIEW);
      await fake.startTalk(page, "li_laotai");
      await click(page, "verb-entrust");
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    },
  ],
  [
    "person-note",
    async ({ page }) => {
      await page.evaluate(() => {
        const view = window.__lantern.view;
        view.events.select?.("li_laotai");
      });
      await expect(page.getByTestId("person-card")).toBeVisible();
    },
  ],
  [
    "gazette",
    async ({ page }) => {
      await fake.feedFrame(page, { ...fake.moment("day2"), ...fake.gazette() });
      await expect(page.getByTestId("gazette")).toBeVisible();
    },
  ],
  [
    "night",
    async ({ page }) => {
      await fake.feedFrame(page, { ...fake.moment("day2"), ...fake.night() });
      await expect(page.getByTestId("night")).toBeVisible();
    },
  ],
  [
    "clarify",
    async ({ page }) => {
      await fake.feedFrame(page, {}, [fake.clarified()]);
      await expect(page.getByTestId("clarify")).toBeVisible();
    },
  ],
  [
    "menu",
    async ({ page }) => {
      await click(page, "btn-menu");
      await expect(page.getByTestId("menu")).toBeVisible();
    },
  ],
  [
    "slip-crew",
    async ({ page }) => {
      const day3 = fake.moment("day3");
      const bridge = (day3.hud as { bridge: Record<string, unknown> }).bridge;
      await fake.feedFrame(page, { ...day3, ...fake.laterTasks("t_helper_zhou"), statement: null, hud: { bridge: { ...bridge, short: 5, families_missing: ["fam_li", "fam_zhou"] } } });
      await expect(page.getByTestId("task-short")).toBeVisible();
    },
  ],
  [
    "acts-grey",
    async ({ page }) => {
      await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: { listen: "far", look: "far", speak: "not_yet", speak_publicly: "not_yet" } } });
      await page.getByTestId("verb-speak").click({ force: true });
      await expect(page.getByTestId("around-why")).toBeVisible();
    },
  ],
  [
    "pairing-answers",
    async ({ page }) => {
      await click(page, "btn-notebook");
      await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
      await page.locator('[data-testid="note"][data-id="n_broke"]').getByTestId("note-claim").click();
      await page.locator('[data-testid="note"][data-id="n_clerk"]').getByTestId("note-show").click();
      await expect(page.getByTestId("answers")).toBeVisible();
    },
  ],
];

const GUIDED_STATES: Array<[string, (lantern: LanternPage) => Promise<void>]> = [
  [
    "elder",
    async ({ page }) => {
      await click(page, "btn-elder");
      await expect(page.getByTestId("elder")).toBeVisible();
    },
  ],
  [
    "tutorial-line",
    async ({ page }) => {
      await fake.beginTutorial(page);
      await page.evaluate(() => {
        const tutorial = window.__lantern.play.guide.tutorial;
        tutorial.index = 2;
        tutorial.phase = "doing";
        window.__lantern.play.touch();
      });
      await expect(page.getByTestId("tutorial-chip")).toBeVisible();
    },
  ],
  [
    "hint-pill",
    async ({ page }) => {
      await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
      await expect(page.getByTestId("hint-pill")).toBeVisible();
    },
  ],
  [
    "teach-card",
    async ({ page }) => {
      await fake.startTalk(page, "li_laotai", {}, ["leave", "ask", "track"], []);
      await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "teach.ask");
    },
  ],
  [
    "menu-hints",
    async ({ page }) => {
      await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
      await click(page, "btn-menu");
      await click(page, "btn-hints");
      await expect(page.getByTestId("hint-log-entry").first()).toBeVisible();
    },
  ],
];

for (const size of SIZES) {
  test.describe(`the layout in a window of ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    for (const [name, setup] of [...STATES, ...GUIDED_STATES]) {
      test(`${name}`, async ({ lantern }) => {
        test.setTimeout(90_000);
        const guided = GUIDED_STATES.some(([n]) => n === name);
        await fake.openFirstDay(lantern, guided ? { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: fake.notebook(), commitments: [] } : {}, guided ? fake.GUIDED : undefined);
        if (guided) await fake.primeHelp(lantern.page);
        await setup(lantern);
        await lantern.page.evaluate(() => {
          window.__lantern.view.clock = () => 3.2;
        });
        await lantern.page.waitForTimeout(700);
        const found = await audit(lantern.page, LAYER[name] ?? null);
        if (OUT !== "") {
          const dir = path.join(OUT, `${size.width}x${size.height}`);
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(found, null, 1));
          await lantern.page.screenshot({ path: path.join(dir, `${name}.png`) });
        }
        expect(found.scroll, "the page does not scroll").toEqual({ x: expect.any(Number), y: expect.any(Number) });
        expect(found.scroll.x, "no sideways scroll").toBeLessThanOrEqual(0);
        expect(found.scroll.y, "no scroll down").toBeLessThanOrEqual(0);
        expect(found.outside, "nothing runs off the window").toEqual([]);
        expect(found.covered, "no control lies under another block").toEqual([]);
        expect(found.overlaps, "no two blocks lie one over the other").toEqual([]);
        expect(lantern.pageErrors).toEqual([]);
      });
    }
  });
}

/** What of the three answers of the pair lies outside the page of the notes that shows them: above it, under it, or under the phrase that turns the page. Nothing where they are whole in view. */
async function answersOutOfPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const leaf = document.querySelector('[data-testid="notes-leaf"]');
    if (leaf === null) return ["there is no page of the notes"];
    const room = leaf.getBoundingClientRect();
    const turn = leaf.querySelector('[data-testid="notes-turn"]')?.getBoundingClientRect() ?? null;
    const out: string[] = [];
    const answers = Array.from(document.querySelectorAll('[data-testid="answers"] .answer'));
    if (answers.length !== 3) out.push(`${answers.length} answers`);
    for (const answer of answers) {
      const r = answer.getBoundingClientRect();
      const name = answer.getAttribute("data-testid") ?? "an answer";
      if (r.top < room.top - 0.5) out.push(`${name} begins ${Math.round(room.top - r.top)} px above the page`);
      else if (r.bottom > room.bottom + 0.5) out.push(`${name} ends ${Math.round(r.bottom - room.bottom)} px under the page`);
      else if (turn !== null && r.bottom > turn.top + 0.5) out.push(`${name} ends ${Math.round(r.bottom - turn.top)} px under the phrase that turns the page`);
    }
    return out;
  });
}

/**
 * What a leaf of the book cuts, as it stands or at an offset: where the page is, how much of the paper lies under its foot, whether the phrase that turns it is up, what the top
 * edge of that phrase cuts in half, what the head of the page cuts in half, and the texts the head begins in the middle of.
 */
interface Cuts {
  at: number;
  below: number;
  turn: boolean;
  /** A line of text, a control or a mark that the top edge of the phrase falls inside of. */
  foot: string[];
  /** A line of text, a control or a mark that the head of the page falls inside of. */
  headLines: string[];
  /** A text (a sentence of one line or more) that the head of the page falls inside of, so that its first line or lines are above the page. */
  headTexts: string[];
}

/**
 * Reads what a leaf of the book cuts, as it stands (`offsets` is null) or at each of the offsets, after the page has had two frames to answer the scroll. It runs in the page and has
 * nothing of the test in it. An edge cuts a box when it falls inside it by more than a pixel (the box of a line is a little taller than its ink).
 */
async function lookAtLeaf([selector, offsets]: [string, number[] | null]): Promise<Cuts[]> {
  const leaf = document.querySelector<HTMLElement>(selector);
  if (leaf === null) throw new Error(`there is no ${selector}`);
  const settle = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  const read = (): Cuts => {
    const head = leaf.getBoundingClientRect().top + leaf.clientTop;
    const bar = leaf.querySelector<HTMLElement>(".turn-bar");
    const edge = bar === null ? Number.NaN : bar.getBoundingClientRect().top;
    const cut = (r: { top: number; bottom: number }, at: number): boolean => r.top < at - 1 && r.bottom > at + 1;
    const where = (r: { top: number; bottom: number }): string => `${Math.round(r.top)}..${Math.round(r.bottom)}`;
    const found: Cuts = { at: leaf.scrollTop, below: leaf.scrollHeight - leaf.clientHeight - leaf.scrollTop, turn: bar !== null, foot: [], headLines: [], headTexts: [] };
    const range = document.createRange();
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
      const words = node.data.trim();
      const parent = node.parentElement;
      if (words === "" || parent === null || parent.closest(".turn") !== null) continue;
      const frame = parent.getBoundingClientRect();
      // (words that are there for a reader of the screen only have a box of a pixel)
      if (frame.width < 2 || frame.height < 2) continue;
      range.selectNodeContents(node);
      const lines = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
      if (lines.length === 0) continue;
      const name = `text "${words.slice(0, 28)}"`;
      for (const r of lines) {
        if (bar !== null && cut(r, edge)) found.foot.push(`${name} at ${where(r)}, the phrase begins at ${Math.round(edge)}`);
        if (cut(r, head)) found.headLines.push(`${name} at ${where(r)}, the page begins at ${Math.round(head)}`);
      }
      const whole = { top: Math.min(...lines.map((r) => r.top)), bottom: Math.max(...lines.map((r) => r.bottom)) };
      if (cut(whole, head)) found.headTexts.push(`${name} at ${where(whole)}, the page begins at ${Math.round(head)}`);
    }
    for (const el of Array.from(leaf.querySelectorAll("button, summary, input, select, textarea, img, canvas, svg"))) {
      // (the phrase itself, and a mark inside a control, which is a part of the control)
      if (el.closest(".turn") !== null || (el.tagName === "svg" && (el.parentElement?.closest("button, summary") ?? null) !== null)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // (a button that runs to several lines, or a box of three answers, is kept whole by its lines)
      if (r.height > 48 && el.matches("button, summary")) continue;
      const name = `${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? String(el.getAttribute("class") ?? "")}`;
      if (bar !== null && cut(r, edge)) found.foot.push(`${name} at ${where(r)}, the phrase begins at ${Math.round(edge)}`);
      if (cut(r, head)) found.headLines.push(`${name} at ${where(r)}, the page begins at ${Math.round(head)}`);
    }
    return found;
  };
  if (offsets === null) return [read()];
  const out: Cuts[] = [];
  for (const offset of offsets) {
    leaf.scrollTop = offset;
    await settle();
    out.push(read());
  }
  return out;
}

/** Reads what a leaf of the book cuts, as it stands (`offsets` null) or at each of the offsets. */
const readLeaf = (page: Page, selector: string, offsets: number[] | null): Promise<Cuts[]> => page.evaluate(lookAtLeaf, [selector, offsets] as [string, number[] | null]);

/**
 * Waits until the leaf has stopped moving, which is when its place has not changed for `still` milliseconds (a turn of the page is a smooth scroll, which a page that is slow to draw
 * begins late and goes on with for as long as it takes), and gives the place it stopped at. It runs in the page.
 */
async function leafStops([selector, still]: [string, number]): Promise<number> {
  const leaf = document.querySelector<HTMLElement>(selector);
  if (leaf === null) throw new Error(`there is no ${selector}`);
  let last = leaf.scrollTop;
  let since = performance.now();
  while (performance.now() - since < still) {
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
    if (leaf.scrollTop !== last) {
      last = leaf.scrollTop;
      since = performance.now();
    }
  }
  return last;
}

/** The offsets from the head of a page to its foot, every `step` pixels and at the foot. */
const offsetsTo = (max: number, step: number): number[] => [...Array.from({ length: Math.floor(max / step) + 1 }, (_, n) => n * step), max];

/** The windows of the book that are looked at, the least the game is laid out for and two a little above it, in Chinese on the light theme and in English on the dark one. */
const BOOK_SIZES = [
  { width: MIN_WINDOW.width, height: MIN_WINDOW.height },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];
const BOOK_LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

const NOTES_LEAF = '[data-testid="notes-leaf"]';
const CARD_LEAF = '[data-testid="workspace-statement"]';
const PEOPLE_LEAF = '[data-testid="people-leaf"]';

/** The notebook of the first evening three times over, so that its notes run past the foot of their page. */
const manyNotes = (): Array<Record<string, unknown>> => [0, 1, 2].flatMap((k) => fake.notebook().map((entry) => ({ ...entry, id: `${String(entry.id)}_${k}` })));

/** Opens the book at two pages: the notes (more of them than the page holds) on the left and a card with a choice made in each part on the right. */
async function openBook(lantern: LanternPage): Promise<Page> {
  const page = lantern.page;
  await fake.openFirstDay(lantern, { statement: stmt.readyKey(), notebook: manyNotes() });
  await click(page, "btn-notebook");
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-spread", "true");
  await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
  return page;
}

// The phrase that turns a page of the book lies over the last lines in view. It reaches up to the first line or control that its own top edge would cut in half, so that no line of the
// page is cut at the foot, at any place the page is turned to: the card of the statement, the notes and the people.
for (const size of BOOK_SIZES) {
  for (const look of BOOK_LOOKS) {
    test.describe(`the phrase that turns a page of the book, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      test("cuts no line, control or mark in half at any place of the card, the notes and the people", async ({ lantern }) => {
        test.setTimeout(180_000);
        const page = await openBook(lantern);
        const scanned: Array<[string, string]> = [
          ["the card of the statement", CARD_LEAF],
          ["the notes", NOTES_LEAF],
        ];
        // twenty people that were talked with: the page of the people runs past its foot as well
        const rows = await peopleRows(page, {});
        await feedPeople(page, Object.fromEntries(rows.map((row, n) => [String(row.id), known({ hearts: 1 + (n % 5), met: [stamp(8, 10 + n, null)] })])));
        for (const [name, leaf] of [...scanned, ["the people", PEOPLE_LEAF]] as Array<[string, string]>) {
          if (leaf === PEOPLE_LEAF) {
            await click(page, "workspace-tab-people");
            await expect(page.locator(PEOPLE_LEAF)).toBeVisible();
          }
          const max = await page.locator(leaf).evaluate((el) => el.scrollHeight - el.clientHeight);
          expect(max, `${name} runs past its foot`).toBeGreaterThan(100);
          const found = await readLeaf(page, leaf, offsetsTo(max, 17));
          // the phrase is up wherever there is more below, which is every place but the last few pixels
          expect(found.filter((c) => c.below >= 12 && !c.turn).map((c) => c.at), `${name}: the places where more lies below and the phrase is not up`).toEqual([]);
          expect(
            found.filter((c) => c.foot.length > 0).map((c) => `at ${Math.round(c.at)}: ${c.foot.join("; ")}`),
            `${name}: the places where the phrase cuts something in half`,
          ).toEqual([]);
        }
        expect(lantern.pageErrors).toEqual([]);
      });

      test("turns a page to the line that comes next: each page begins and ends at a line, and the last turn brings the last line into view", async ({ lantern }) => {
        test.setTimeout(180_000);
        const page = await openBook(lantern);
        for (const [name, leaf] of [
          ["the card of the statement", CARD_LEAF],
          ["the notes", NOTES_LEAF],
        ] as const) {
          let turns = 0;
          let missed = 0;
          for (;;) {
            const [now] = await readLeaf(page, leaf, null);
            if (now === undefined) throw new Error("no reading");
            expect(now.foot, `${name}, after ${turns} turns: what the phrase cuts`).toEqual([]);
            // the page that a turn brought to begins at a line, unless it is the last, which the end of the paper holds back
            if (turns > 0 && now.turn) expect(now.headLines, `${name}, after ${turns} turns: what the head of the page cuts`).toEqual([]);
            if (!now.turn) break;
            expect(turns, `${name} turns to its end in fewer turns than that`).toBeLessThan(30);
            // a phrase that goes with the end of the paper between the reading and the press is read again
            const pressed = await page.locator(`${leaf} .turn-bar button`).click({ timeout: scaled(15_000) }).then(() => true, () => false);
            if (!pressed) {
              expect(++missed, `${name}: the phrase is up and cannot be pressed`).toBeLessThan(5);
              continue;
            }
            await expect.poll(() => page.locator(leaf).evaluate((el) => el.scrollTop), { message: `${name}: a turn brings the page on` }).toBeGreaterThan(now.at);
            await page.evaluate(leafStops, [leaf, scaled(700)] as [string, number]);
            turns++;
          }
          expect(turns, `${name} runs to more than a page`).toBeGreaterThan(0);
          // at the end of the paper the last line is in view
          const last = await page.locator(leaf).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
          expect(last, `${name}: nothing but the foot of the paper is left below`).toBeLessThanOrEqual(11);
        }
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}

// The pair of the notebook in the windows of a laptop and above, where the book is open at two pages (the card of the statement on the right, the notes on the left, a page some 450 px wide)
// and the book starts under a slip whose title runs to one, two or three lines: the three answers, which are what the player presses, stand whole in the page of the notes, from the first, above the
// phrase that turns it, and the page of the notes does not begin in the middle of a line or of a sentence of the pair. The two lines of the pair are in the words that a game gives them, each of
// which runs to two lines of the narrow page.
const PAIR_TITLES: Array<[number, { zh: string; en: string }]> = [
  [1, { zh: "借竹料", en: "Get bamboo" }],
  [2, { zh: "借到李家的第一批竹料", en: "Get the first load of bamboo from the Li family" }],
  [3, LONG_TITLE],
];

/** The notebook of the first evening with the words of the two lines of the pair as the core makes them, each long enough to run to two lines of the page. */
function pairNotes(): Array<Record<string, unknown>> {
  const long: Record<string, { zh: string; en: string }> = {
    n_broke: { zh: "李二昨晚把栏杆弄坏了，是眼红人家出风头。", en: "Li Er broke the bridge railing last night, out of envy." },
    n_clerk: { zh: "船夫老何跟我说，李二昨晚把栏杆弄坏了。还说是眼红人家出风头。", en: "Boatman He told me that Li Er broke the bridge railing last night. They say it was out of envy." },
  };
  return fake.notebook().map((entry) => ({ ...entry, text: long[String(entry.id)] ?? entry.text }));
}

for (const size of BOOK_SIZES) {
  for (const look of BOOK_LOOKS) {
    test.describe(`the answers of the pair, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      for (const [lines, title] of PAIR_TITLES) {
        test(`stand whole in the page of the notes under a title of the slip of ${lines} line${lines === 1 ? "" : "s"}, which does not begin in the middle of the pair`, async ({ lantern }) => {
          test.setTimeout(90_000);
          const page = lantern.page;
          await fake.openFirstDay(lantern, { ...titled(title), statement: stmt.statementKey(), notebook: pairNotes() });
          await expect(page.getByTestId("topbar-task-text")).toContainText(title[look.lang]);
          await click(page, "btn-notebook");
          await expect(page.getByTestId("notebook")).toHaveAttribute("data-spread", "true");
          await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
          await page.locator('[data-testid="note"][data-id="n_broke"]').getByTestId("note-claim").click();
          await page.locator('[data-testid="note"][data-id="n_clerk"]').getByTestId("note-show").click();
          await expect(page.getByTestId("answers")).toBeVisible();
          // The slip runs to the lines that the title was chosen for (in English, for which the titles were chosen), and the page brings the pair into view in the frame after it came up.
          if (look.lang === "en") expect(await page.locator(".shell").evaluate((shell) => (shell as HTMLElement).style.getPropertyValue("--slip-lines"))).toBe(String(lines));
          await expect.poll(() => answersOutOfPage(page)).toEqual([]);
          // the page of the notes begins at a line and not in the middle of a sentence, and nothing of it or of the card is cut by the phrase that turns the page
          await expect
            .poll(async () => {
              const [notes] = await readLeaf(page, NOTES_LEAF, null);
              const [card] = await readLeaf(page, CARD_LEAF, null);
              return [...(notes?.headLines ?? []), ...(notes?.headTexts ?? []), ...(notes?.foot ?? []), ...(card?.foot ?? [])];
            })
            .toEqual([]);
          expect(lantern.pageErrors).toEqual([]);
        });
      }
    });
  }
}

// The audit has teeth in a state that has a layer: a control of the layer that something outside it covers is found, and so is a control that the page keeps in reach that
// something other than the layer covers, while what lies behind the layer is not looked at.
test.describe("the audit of a state that has a layer", () => {
  test.use({ viewport: { width: MIN_WINDOW.width, height: MIN_WINDOW.height } });

  test("finds what covers a control of the open layer and a control that the page keeps in reach, and nothing in the layer as it stands", async ({ lantern }) => {
    test.setTimeout(90_000);
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { ...fake.moment("day2"), ...fake.gazette() });
    await expect(page.getByTestId("gazette")).toBeVisible();
    await page.evaluate(() => {
      window.__lantern.view.clock = () => 3.2;
    });
    await page.waitForTimeout(700);
    const layer = LAYER.gazette ?? null;
    expect((await audit(page, layer)).covered, "nothing covers a control of the layer or a control in reach").toEqual([]);
    // Something lies over the button that puts the paper away, and something else over the button of the menu.
    await page.evaluate(() => {
      for (const id of ["gazette-done", "btn-menu"]) {
        const box = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        if (box === undefined) throw new Error(`no ${id}`);
        const cover = document.createElement("div");
        cover.style.cssText = `position:fixed;z-index:99999;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
        document.body.append(cover);
      }
    });
    const found = (await audit(page, layer)).covered;
    expect(found.some((line) => line.startsWith("in the layer: [gazette-done] is under"))).toBe(true);
    expect(found.some((line) => line.startsWith("[btn-menu] is under"))).toBe(true);
  });
});
