import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { MOMENT_HOLD_MS, MOMENT_TRAVEL_MS } from "../../src/page/director.ts";
import { advance } from "../support/festival.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { steady } from "../support/steady.ts";
import * as fake from "../support/slice.ts";
import { scaled } from "../support/time-scale.ts";

// The show controller on a page of fake frames: a moment of the festival takes the camera of the map to where it happened, puts its words over the
// map, holds the world with a pause reason of its own and, after about three seconds, a click or Esc, gives the camera back and tells the core to go on;
// and the show before the ending page. What the page sends the host is written down; the frames and the clock are the test's own. The shows play on a
// clock that the test moves by hand, so that no step of a test races the seconds a show takes on a machine that draws slowly (two cores take longer to
// find a button than a show takes to be over); one test lets a moment play on the clock of the page.
test.use({ map: true });

/** The town of the other specs, with the show controller on: a page made for a test of something else has none of it. The shows play on the clock of the test. */
const TOWN = `${fake.TOWN}&director=on&showclock=manual`;
/** The same town with the shows on the clock of the page. */
const TOWN_LIVE = `${fake.TOWN}&director=on`;

/** Where the pictures go, when a folder is named: a moment in each language and theme. */
const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

const ECHO = { kind: "echo", tick: 812, place: "p_zhou_house", x: 44, y: 6, prop: "pr_boat_scratched", from: "zhou_zhanggui" };
const TOGETHER = { kind: "together_work", tick: 4490, place: "p_bridge", x: 27, y: 15, round: 3 };
const BANKS = { kind: "both_banks", tick: 900, place: "p_bridge", x: 27, y: 15 };
const happened = (m: Record<string, unknown>): Record<string, unknown> => {
  const { kind, ...rest } = m;
  return { kind: "moment", moment: kind, ...rest };
};

const director = (page: Page) => page.getByTestId("director");
const camera = (page: Page) => page.evaluate(() => ({ ...window.__lantern.view.camera.pose(), width: window.__lantern.view.camera.size.width, height: window.__lantern.view.camera.size.height }));
const reasons = (page: Page): Promise<string[]> => page.evaluate(() => [...(window.__lantern.client.state.stats?.reasons ?? [])]);
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Array<Record<string, unknown>> }).__sent);
const released = async (page: Page): Promise<unknown[]> => (await sent(page)).filter((body) => body.type === "moment" && body.op === "release").map((body) => body.kind);
const screenOfCell = (page: Page, x: number, y: number) => page.evaluate(([cx, cy]) => window.__lantern.view.cellToScreen(cx as number, cy as number), [x, y] as const);

/** The town held on the morning of the first day, primed with a frame that has the key of the moments, and what the page sends written down. */
async function opened(lantern: LanternPage, town = TOWN): Promise<void> {
  await fake.openFirstDay(lantern, { notebook: [], commitments: [], moments: [], moment_hold: [] }, town);
  await lantern.page.waitForFunction(() => window.__lantern.play.director.port !== null);
  await fake.recordSent(lantern.page);
}

const moment = (page: Page, m: Record<string, unknown>, held = true) => fake.feedFrame(page, { moments: [m], moment_hold: held ? [m.kind] : [] }, [happened(m)]);

test.describe("a moment of the festival", () => {
  test("takes the camera to the cell, says its words, holds the world with the reason show, and after three seconds gives the camera back and tells the core to go on", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    const before = await camera(page);
    expect(await reasons(page)).not.toContain("show");
    await moment(page, ECHO);
    await expect(director(page)).toHaveAttribute("data-show", "echo");
    await expect(page.getByTestId("director-caption")).toHaveText("What you said came back to you from Shopkeeper Zhou.");
    await expect(page.getByTestId("director-skip")).toHaveCount(0);
    // the world is held with a reason of its own, and the pause the test host keeps is not touched
    await expect.poll(() => reasons(page)).toContain("show");
    expect(await reasons(page)).toContain("user");
    // the camera goes there: when its travel is over the cell of the moment is in the middle of the map, closer than the fit
    await advance(page, MOMENT_TRAVEL_MS);
    const near = await camera(page);
    expect(near.zoom).toBeGreaterThan(before.zoom * 2);
    const at = await screenOfCell(page, ECHO.x, ECHO.y);
    expect(Math.abs(at.x - near.width / 2)).toBeLessThan(3);
    expect(Math.abs(at.y - near.height / 2)).toBeLessThan(3);
    expect(await released(page)).toEqual([]);
    // about three seconds in all: on a moment before they are over, and over a moment after
    await advance(page, MOMENT_HOLD_MS - 100);
    await expect(director(page)).toHaveCount(1);
    expect(await released(page)).toEqual([]);
    await advance(page, 200);
    await expect(director(page)).toHaveCount(0);
    await expect.poll(() => reasons(page)).not.toContain("show");
    expect(await reasons(page)).toContain("user");
    expect(await released(page)).toEqual(["echo"]);
    const after = await camera(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(after.moved).toBe(before.moved);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("plays on the clock of the page where none is moved by hand: the camera goes there, the show is over by itself, and the camera is given back", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern, TOWN_LIVE);
    const before = await camera(page);
    // The page writes down what it sees at each of its animation frames, so that the test does not have to be quick: what a test on two cores reads a second late, the page has seen.
    await page.evaluate(() => {
      const seen = { on: null as number | null, off: null as number | null, zoom: 0 };
      (window as unknown as { __show: typeof seen }).__show = seen;
      const look = (): void => {
        const now = performance.now();
        if (window.__lantern.play.director.current !== null) {
          seen.on ??= now;
          seen.zoom = Math.max(seen.zoom, window.__lantern.view.camera.pose().zoom);
        } else if (seen.on !== null) {
          seen.off ??= now;
          return;
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await moment(page, ECHO);
    const seen = () => page.evaluate(() => (window as unknown as { __show: { on: number | null; off: number | null; zoom: number } }).__show);
    await expect.poll(async () => (await seen()).off, { timeout: scaled(30_000) }).not.toBeNull();
    const shown = await seen();
    // the page looks once a frame, so the seconds it counts are good to a frame at either end
    expect((shown.off ?? 0) - (shown.on ?? 0)).toBeGreaterThan(MOMENT_TRAVEL_MS + MOMENT_HOLD_MS - 1000);
    expect(shown.zoom).toBeGreaterThan(before.zoom * 2);
    await expect(director(page)).toHaveCount(0);
    await expect.poll(() => reasons(page)).not.toContain("show");
    expect(await reasons(page)).toContain("user");
    expect(await released(page)).toEqual(["echo"]);
    const after = await camera(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes on at a click, wherever it is, and the words are in the language of the page", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await lantern.setLang("zh");
    await fake.feedFrame(page, { notebook: [], commitments: [], moments: [], moment_hold: [] });
    await page.waitForFunction(() => window.__lantern.play.director.port !== null);
    await fake.recordSent(page);
    await moment(page, TOGETHER);
    await expect(page.getByTestId("director-caption")).toHaveText("李家和周家的人，第一次一起搬料。");
    await advance(page, 500);
    await page.getByTestId("director-veil").click();
    await expect(director(page)).toHaveCount(0);
    expect(await released(page)).toEqual(["together_work"]);
    await expect.poll(() => reasons(page)).not.toContain("show");
    await lantern.setLang("en");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes on at Esc, and Esc is the page's again when no show is on", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await moment(page, BANKS);
    await expect(director(page)).toHaveAttribute("data-show", "both_banks");
    await expect(page.getByTestId("director-caption")).toHaveText("Lanterns hang on both banks.");
    await page.keyboard.press("Escape");
    await expect(director(page)).toHaveCount(0);
    expect(await released(page)).toEqual(["both_banks"]);
    await expect.poll(() => reasons(page)).not.toContain("show");
    // no show: the Esc of the page, which puts the menu away
    await page.getByTestId("btn-menu").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "true");
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("two of one frame come one after the other under one hold, and each is let go in its turn; the same moment again is no news", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await fake.feedFrame(page, { moments: [BANKS, TOGETHER], moment_hold: ["both_banks", "together_work"] }, [happened(BANKS), happened(TOGETHER)]);
    await expect(director(page)).toHaveAttribute("data-show", "both_banks");
    await page.getByTestId("director-veil").click();
    await expect(director(page)).toHaveAttribute("data-show", "together_work");
    expect(await released(page)).toEqual(["both_banks"]);
    // the page has the reasons of the host from its stats, which come every half second when the world is held by the player already
    await expect.poll(() => reasons(page)).toContain("show");
    await page.getByTestId("director-veil").click();
    await expect(director(page)).toHaveCount(0);
    expect(await released(page)).toEqual(["both_banks", "together_work"]);
    await expect.poll(() => reasons(page)).not.toContain("show");
    await fake.feedFrame(page, { moments: [BANKS, TOGETHER], moment_hold: [] });
    await expect(director(page)).toHaveCount(0);
    expect(await released(page)).toHaveLength(2);
  });

  test("is let go of without a show where the map is not drawn, and the world is not held for one", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(300);
    await fake.feedFrame(page, { notebook: [], commitments: [], moments: [], moment_hold: [] });
    await fake.recordSent(page);
    await moment(page, ECHO);
    await expect.poll(() => released(page)).toEqual(["echo"]);
    await expect(director(page)).toHaveCount(0);
    expect(await reasons(page)).not.toContain("show");
  });

  test("says in the first frame of a game that the page shows the moments, once, and a game that has the key is not asked", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await fake.recordSent(page);
    await page.evaluate(() => window.__lantern.play.director.reset());
    await fake.feedFrame(page, { moments: undefined });
    await fake.feedFrame(page, {});
    expect((await sent(page)).filter((body) => body.type === "moment")).toEqual([expect.objectContaining({ type: "moment", op: "watch" })]);
    await fake.feedFrame(page, { moments: [], moment_hold: [] });
    expect((await sent(page)).filter((body) => body.type === "moment")).toHaveLength(1);
  });
});

test.describe("the show before the ending page", () => {
  const FESTIVAL = { route: "bridge", together: true, lighter: ["li_laotai", "zhou_zhanggui"], bearers: { p_li_house: 60, p_zhou_house: 60 }, named: [{ npc: "li_laotai", place: "p_li_house" }] };
  const ENDING = {
    kind: "ending",
    tick: 6000,
    ending: "ending_full",
    label: { zh: "圆满", en: "A perfect night" },
    hidden: [],
    inputs: { bridge_fixed: true, detour_done: true, reconciled: true, truth_told: true },
    passage: "mended",
    promised: 5,
    turnout: 900,
    festival: FESTIVAL,
    reveal: { truth: null, chains: [], believers: { false: [], true: [], none: [] }, told: { total: 0, mutated: 0 } },
    epilogue: [],
  };

  /** A show of three seconds, for the test, that the ending page waits for. */
  const register = (page: Page, hold = 3000): Promise<void> =>
    page.evaluate((ms) => {
      window.__lantern.registerEndingShow(() => ({
        id: "festival",
        skippable: true,
        stops: [
          { at: { place: "p_bridge" }, zoom: 2.4, travel: 600, hold: ms, caption: { key: "moment.both_banks" } },
          { at: "town", zoom: 1, travel: 400, hold: 0 },
        ],
      }));
    }, hold);

  test("is not played where none is registered: the ending page opens at once", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await fake.feedFrame(page, { ending: ENDING }, [ENDING]);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(director(page)).toHaveCount(0);
    expect(await reasons(page)).not.toContain("show");
  });

  test("plays before the ending page, which comes when it ends or when the button in the corner or Esc skips it", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await register(page, 500);
    // it ends by itself
    await fake.feedFrame(page, { ending: ENDING }, [ENDING]);
    await expect(director(page)).toHaveAttribute("data-show", "festival");
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await expect(page.getByTestId("ending-tab")).toHaveCount(0);
    await expect.poll(() => reasons(page)).toContain("show");
    // its stops take 0.6 s to the bridge, 0.5 s there and 0.4 s back to the town: the page is the show's until they are over, and then it is the ending's
    await advance(page, 1400);
    await expect(director(page)).toHaveCount(1);
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await advance(page, 200);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(director(page)).toHaveCount(0);
    await expect.poll(() => reasons(page)).not.toContain("show");
    expect(await released(page)).toEqual([]);
  });

  test("is kept for a map that is still coming up when the ending comes first, and plays when the map is there", async ({ lantern }) => {
    const page = lantern.page;
    // The pictures of the map are held back, so that the map comes up after the ending does (a recording that is open at its end has it so).
    let letThrough!: () => void;
    const held = new Promise<void>((resolve) => {
      letThrough = resolve;
    });
    await page.route("**/sprites/manifest.json", async (route) => {
      await held;
      await route.continue();
    });
    await fake.openFirstDay(lantern, { notebook: [], commitments: [], moments: [], moment_hold: [] }, TOWN);
    await register(page, 500);
    expect(await page.evaluate(() => window.__lantern.play.director.port)).toBeNull();
    await fake.feedFrame(page, { ending: ENDING }, [ENDING]);
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await expect(director(page)).toHaveCount(0);
    letThrough();
    // The controller looks at the map every ENDING_POLL_MS of the clock of the shows, and gives up on it after ENDING_GRACE_MS of that clock (the unit spec has both): the clock
    // of this page stands still while the map comes up at the speed of the machine, and one step of it is the look that finds the town on the map.
    await page.waitForFunction(() => window.__lantern.play.director.port?.ready() === true, undefined, { timeout: scaled(60_000) });
    await advance(page, 100);
    await expect(director(page)).toHaveAttribute("data-show", "festival");
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await advance(page, 1600);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(director(page)).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is skipped by the button, which is in the corner, and a click on the map does not skip it", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await register(page, 20_000);
    const before = await camera(page);
    await fake.feedFrame(page, { ending: ENDING }, [ENDING]);
    const button = page.getByTestId("director-skip");
    await expect(button).toHaveText("Skip");
    const box = await button.boundingBox();
    const view = page.viewportSize();
    if (box === null || view === null) throw new Error("no box");
    expect(box.x + box.width).toBeGreaterThan(view.width * 0.6);
    expect(box.y + box.height).toBeGreaterThan(view.height * 0.6);
    await page.getByTestId("director-veil").click({ position: { x: 200, y: 200 } });
    await expect(director(page)).toHaveAttribute("data-show", "festival");
    await advance(page, 700);
    expect((await camera(page)).zoom).toBeGreaterThan(before.zoom * 1.5);
    await button.click();
    await expect(director(page)).toHaveCount(0);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect.poll(() => reasons(page)).not.toContain("show");
    const after = await camera(page);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(after.moved).toBe(before.moved);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is skipped by Esc, with its button in the other language", async ({ lantern }) => {
    const page = lantern.page;
    await opened(lantern);
    await lantern.setLang("zh");
    await register(page, 20_000);
    await fake.feedFrame(page, { ending: ENDING }, [ENDING]);
    await expect(page.getByTestId("director-skip")).toHaveText("跳过");
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(director(page)).toHaveCount(0);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect.poll(() => reasons(page)).not.toContain("show");
    await lantern.setLang("en");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("pictures", () => {
  test.skip(SHOTS === "", "pictures are taken when LANTERN_SHOTS_DIR names a folder");

  for (const [lang, theme] of [
    ["zh", "light"],
    ["en", "dark"],
  ] as const) {
    test(`the button that skips the festival night, ${lang} ${theme}`, async ({ lantern }) => {
      const page = lantern.page;
      await page.setViewportSize({ width: 1280, height: 760 });
      await opened(lantern, TOWN_LIVE);
      await lantern.setLang(lang);
      await lantern.setTheme(theme);
      mkdirSync(SHOTS, { recursive: true });
      await page.evaluate(() => {
        window.__lantern.registerEndingShow(() => ({
          id: "festival",
          skippable: true,
          stops: [{ at: { place: "p_bridge" }, zoom: 2, travel: 400, hold: 20_000, caption: { key: "moment.both_banks" } }],
        }));
      });
      const ending = { kind: "ending", tick: 6000, ending: "ending_full", label: { zh: "圆满", en: "A perfect night" }, hidden: [], inputs: {}, passage: "mended", promised: 5, turnout: 900, festival: { route: "bridge", together: true, lighter: [], bearers: {}, named: [] }, reveal: { truth: null, chains: [], believers: { false: [], true: [], none: [] }, told: { total: 0, mutated: 0 } }, epilogue: [] };
      await fake.feedFrame(page, { ending }, [ending]);
      await expect(page.getByTestId("director-skip")).toBeVisible();
      await page.waitForTimeout(1200);
      await steady(page);
      await page.screenshot({ path: path.join(SHOTS, `after-skip-festival-${lang}-${theme}-1280x760.png`) });
      await page.getByTestId("director-skip").click();
      await expect(page.getByTestId("ending")).toBeVisible();
    });
  }

  for (const [lang, theme, m] of [
    ["zh", "light", ECHO],
    ["en", "dark", TOGETHER],
    ["zh", "light", BANKS],
    ["en", "dark", ECHO],
  ] as const) {
    test(`a moment, ${m.kind}, ${lang} ${theme}`, async ({ lantern }) => {
      const page = lantern.page;
      await page.setViewportSize({ width: 1280, height: 760 });
      await opened(lantern, TOWN_LIVE);
      await lantern.setLang(lang);
      await lantern.setTheme(theme);
      mkdirSync(SHOTS, { recursive: true });
      await moment(page, m);
      await expect(director(page)).toBeVisible();
      await page.waitForTimeout(1400);
      await steady(page);
      await page.screenshot({ path: path.join(SHOTS, `after-moment-${m.kind}-${lang}-${theme}-1280x760.png`) });
      await expect(director(page)).toHaveCount(0, { timeout: 6000 });
    });
  }
});
