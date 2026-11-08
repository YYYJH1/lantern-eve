import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { MIN_WINDOW } from "../../src/page/ui/window.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

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
  elder: '[data-testid="elder"]',
};

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
      await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
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
        tutorial.index = 4;
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
  // The help is on, so the corner has the button of the hints, and the notebook lies over the corner: it ends above that button.
  [
    "notebook-help",
    async ({ page }) => {
      await click(page, "btn-notebook");
      await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
      await expect(page.getByTestId("btn-hints")).toBeVisible();
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
