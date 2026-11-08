import { MIN_WINDOW } from "../../src/page/ui/window.ts";
import { expect, test } from "../support/fixtures.ts";
import { contrast } from "../support/slice.ts";
import { byAnotherVersion, tamper } from "../support/stored-saves.ts";

// The opening page is the first thing a player sees. These tests open the test build with no game named in the address, which is
// how the real page opens, and the game behind the page is the slice that the core names.
test.use({ map: true });

const OPENING = "pace=60";

/**
 * The ledger is opened at the peace and has the grudge that the core set on the incense, and then it is shut. The opening page lies over the game
 * and the ledger is behind it, so the bookmark is pressed by the page's own click and not by a pointer.
 */
async function expectGrudge(page: import("@playwright/test").Page, grudge: number): Promise<void> {
  await page.getByTestId("board-tab-peace").evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId("peace-meter")).toHaveAttribute("value", String(grudge));
  await expect(page.getByTestId("peace-grudge")).toHaveText(`Grudge ${grudge}`);
  await page.getByTestId("board-tab-peace").evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId("board")).toHaveAttribute("data-open", "false");
}

/** Opens the page as a player does: no game named, so the opening page and the world held behind it. */
async function openPage(lantern: import("../support/fixtures.ts").LanternPage, query = OPENING): Promise<void> {
  await lantern.page.goto(`${lantern.servers.app.origin}/?${query}`);
  await lantern.waitReady();
  await expect(lantern.page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
}

test.describe("the opening page", () => {
  test("says what the game is for in a title, a chapter, one line and three things, in both languages and both themes, and holds the world", async ({ lantern }) => {
    const page = lantern.page;
    await openPage(lantern);
    const words = {
      en: {
        title: "Lantern Eve",
        chapter: "The Broken Bridge, Five Days",
        goal: "In five days, get the Li and Zhou families across the bridge together, lanterns lit.",
        things: ["Mend the bridge", "Set it straight", "Make peace"],
        start: "Start",
        cont: "Continue",
        gallery: "Recordings",
        settings: "Settings",
        none: "No saved game yet",
      },
      zh: {
        title: "灯会前夕",
        chapter: "断桥篇，五日",
        goal: "五天后，让李、周两家一起提灯过桥。",
        things: ["修桥", "说清", "说和"],
        start: "开始",
        cont: "继续",
        gallery: "录像馆",
        settings: "设置",
        none: "还没有存档",
      },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((choice) => document.documentElement.setAttribute("data-theme", choice), theme);
      for (const lang of ["en", "zh"] as const) {
        await page.getByTestId("opening").getByTestId(`lang-${lang}`).click();
        const w = words[lang];
        await expect(page.getByTestId("opening-title")).toHaveText(w.title);
        await expect(page.getByTestId("opening-chapter")).toHaveText(w.chapter);
        await expect(page.getByTestId("opening-goal")).toHaveText(w.goal);
        await expect(page.getByTestId("opening-things").locator("strong")).toHaveText([...w.things]);
        await expect(page.getByTestId("opening-start")).toHaveText(w.start);
        await expect(page.getByTestId("opening-continue")).toHaveText(w.cont);
        await expect(page.getByTestId("opening-gallery")).toHaveText(w.gallery);
        await expect(page.getByTestId("opening-settings")).toHaveText(w.settings);
        // Start and Continue are the main buttons, and the gallery and the settings come after them.
        const start = await page.getByTestId("opening-start").boundingBox();
        const gallery = await page.getByTestId("opening-gallery").boundingBox();
        expect(start?.height ?? 0).toBeGreaterThan(gallery?.height ?? 99);
        expect(start?.y ?? 0).toBeLessThan(gallery?.y ?? 0);
        // There is nothing to continue yet, and the page says so.
        await expect(page.getByTestId("opening-continue")).toBeDisabled();
        await expect(page.getByTestId("opening-continue-note")).toHaveText(w.none);
        await expect(page.locator("html")).toHaveAttribute("lang", lang === "zh" ? "zh-CN" : "en");
        for (const selector of ['[data-testid="opening-goal"]', '[data-testid="opening-chapter"]', '[data-testid="opening-start"]', '[data-testid="opening-continue-note"]']) {
          expect(await contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(theme === "dark" && selector.includes("start") ? 3 : 4.5);
        }
      }
    }
    // The world has not run: the page that is behind this one is held at the first tick, however long the page is open.
    await page.waitForTimeout(1200);
    const held = await page.evaluate(() => ({ tick: window.__lantern.client.state.simTick, paused: window.__lantern.client.state.paused }));
    expect(held).toEqual({ tick: 0, paused: true });
    // A tab that is hidden and shown again does not let it go.
    await lantern.setVisibility("hidden");
    await lantern.setVisibility("visible");
    await page.waitForTimeout(600);
    expect(await lantern.tick()).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("starts the core's game `slice` when Start is pressed: its seed, its config with the texts in it, and the first task", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await openPage(lantern);
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick(40);
    // The seed and the config are the core's: the page never said them.
    const state = await page.evaluate(() => ({ seed: window.__lantern.client.state.seed, scenario: window.__lantern.client.state.scenario, preset: window.__lantern.client.state.preset }));
    expect(state).toEqual({ seed: 492, scenario: "bridge", preset: "slice" });
    const replay = await lantern.exportReplay();
    expect(replay.header.seed).toBe(492);
    expect(replay.header.config).toMatchObject({ variant: "v_boat", opening: "op_li_er_hearsay", weather_heavy: 0 });
    // The page learned the seed from the host, and the menu lists it with the numbers of the game.
    await expect(page.getByTestId("seed")).toHaveText("492");
    // And it is the slice: the elder's first job is the first task of the frame.
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(page.getByTestId("task-text")).toHaveText("Get the first bamboo from the Li family");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the board say the peace as it stands from the first frame: the grudge the two heads hold, and not a peace of 100% before the first tick", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await openPage(lantern);
    // The world is held at the first tick behind the opening page, and the frame it has shown has the grudge that the first tick sets.
    expect(await lantern.tick()).toBe(0);
    const grudge = (): Promise<number | null> => page.evaluate(() => (window.__lantern.client.state.frame as unknown as { board: { peace: { grudge: number | null } } }).board.peace.grudge);
    const first = (await grudge()) ?? 0;
    expect(first).toBeGreaterThan(0);
    await expectGrudge(page, first);
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick(5);
    expect(await grudge()).toBe(first);
    await expectGrudge(page, first);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the choices of the settings, and a page that is told not to show the tutorial begins without it", async ({ lantern }) => {
    const page = lantern.page;
    await openPage(lantern);
    await page.getByTestId("opening-settings").click();
    const settings = page.getByTestId("settings");
    await expect(settings).toBeVisible();
    const hints = settings.getByTestId("setting-hints").locator("input");
    const tutorial = settings.getByTestId("setting-tutorial").locator("input");
    await expect(hints).toBeChecked();
    await expect(tutorial).toBeChecked();
    await tutorial.uncheck();
    await hints.uncheck();
    expect(await page.evaluate(() => [localStorage.getItem("lantern.tutorial"), localStorage.getItem("lantern.hints")])).toEqual(["skipped", "off"]);
    await page.getByTestId("opening").getByTestId("lang-zh").click();
    await expect(settings.locator("h2")).toHaveText("设置");
    await expect(settings.getByTestId("setting-hints")).toContainText("世界里的提示");
    await expect(settings.getByTestId("setting-tutorial")).toContainText("第一天的带教");
    await page.getByTestId("settings-close").click();
    await expect(settings).toHaveCount(0);
    await page.getByTestId("opening-start").click();
    // Without the tutorial the world runs at once.
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("进行中");
    await lantern.waitForTick(30);
    // The hints are off, and a viewer who turned them on again finds the choice kept after a reload.
    await page.reload();
    await lantern.waitReady();
    await page.getByTestId("opening-settings").click();
    await expect(page.getByTestId("setting-hints").locator("input")).not.toBeChecked();
    await expect(page.getByTestId("setting-tutorial").locator("input")).not.toBeChecked();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes on from the newest save with Continue, and the game is the one that was saved", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await openPage(lantern);
    await page.getByTestId("opening-start").click();
    await lantern.waitForTick(150);
    await page.evaluate(() => window.__lantern.client.pause());
    const saved = await page.evaluate(() => window.__lantern.client.save("first round"));
    await expect(page.getByTestId("status")).toHaveText("paused");
    // The page is closed, and opened again: the opening page has a game to continue.
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-continue")).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("opening-continue-note")).toHaveText("");
    expect(await lantern.tick()).toBe(0);
    await page.getByTestId("opening-continue").click();
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.loaded?.id)).toBe(saved.id);
    expect(await page.evaluate(() => window.__lantern.client.state.loaded?.match)).toBe(true);
    // The world runs on from where it stood. A game that is loaded is let go, and no tutorial comes with it.
    await expect.poll(() => lantern.tick()).toBeGreaterThanOrEqual(saved.tick);
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says in plain words, in both languages, that the newest save was made by another version of the game, and stays on the opening page", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await openPage(lantern);
    await page.getByTestId("opening-start").click();
    await lantern.waitForTick(150);
    await page.evaluate(() => window.__lantern.client.pause());
    const saved = await page.evaluate(() => window.__lantern.client.save("first round"));
    // The save is of another version of the game: its core and its content are not this game's, and the hash it ends in cannot be reached.
    await tamper(lantern, saved.id, byAnotherVersion);
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-continue")).toBeEnabled({ timeout: 30_000 });
    const note = page.getByTestId("opening-continue-note");
    await expect(note).toHaveText("");
    await page.getByTestId("opening-continue").click();
    await expect(note).toHaveText("This save was made by another version of the game, which this one cannot read. Press Start for a new game.");
    await expect(note).toHaveAttribute("data-why", "version");
    // The page does not go in: it is the opening page still, with Start for a new game.
    await expect(page.getByTestId("opening")).toBeVisible();
    await expect(page.getByTestId("opening-start")).toBeEnabled();
    await page.getByTestId("opening").getByTestId("lang-zh").click();
    await expect(note).toHaveText("这份存档是另一个版本的游戏存的，这一版读不出来。点「开始」开一局新的。");
    expect(await page.evaluate(() => window.__lantern.client.state.loaded)).toBeNull();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a page that names its game in a test address has no opening", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=m0&seed=5&pace=1", { menu: false });
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await lantern.waitForTick(5);
  });

  test("opens the gallery of recordings over itself, and comes back to the opening page", async ({ lantern }) => {
    const page = lantern.page;
    await openPage(lantern);
    await page.getByTestId("opening-gallery").click();
    await expect(page.getByTestId("gallery-layer")).toBeVisible();
    await expect(page.getByTestId("opening")).toBeVisible();
    await page.getByTestId("gallery-close").click();
    await expect(page.getByTestId("gallery-layer")).toHaveCount(0);
    await expect(page.getByTestId("opening")).toBeVisible();
    expect(await lantern.tick()).toBe(0);
  });
});

// A window that is smaller than the page is laid out for gets a notice in place of the game. The opening page is where it is shown.
test.describe("a window that is smaller than the page is laid out for", () => {
  const { width, height } = MIN_WINDOW;
  const WORDS = {
    en: { text: `The game is played in a computer's browser, in a window of at least ${width} × ${height}. Make the window larger, or open it on a computer.`, anyway: "Open anyway" },
    zh: { text: `这个游戏在电脑的浏览器里玩，窗口至少要 ${width}×${height}。把窗口拉大，或者换电脑打开。`, anyway: "仍然打开" },
  } as const;

  async function openSmall(lantern: import("../support/fixtures.ts").LanternPage, size: { width: number; height: number }): Promise<void> {
    await lantern.page.setViewportSize(size);
    await lantern.page.goto(`${lantern.servers.app.origin}/?${OPENING}`);
    await lantern.waitReady();
    await expect(lantern.page.getByTestId("size-notice")).toBeVisible();
  }

  test("is told so on the opening page in both languages, with the size, in place of the game, and the button opens the game anyway", async ({ lantern }) => {
    const page = lantern.page;
    await openSmall(lantern, { width: width - 1, height: height + 200 });
    await expect(page.getByTestId("opening")).toBeVisible();
    // the words of the game are not there: no title card, no Start
    await expect(page.getByTestId("opening-start")).toHaveCount(0);
    await expect(page.getByTestId("opening-goal")).toHaveCount(0);
    await expect(page.getByTestId("size-notice-text")).toHaveText(WORDS.en.text);
    await expect(page.getByTestId("size-notice-open")).toHaveText(WORDS.en.anyway);
    expect(await fitsWidthOf(page)).toBe(true);
    await page.getByTestId("opening").getByTestId("lang-zh").click();
    await expect(page.getByTestId("size-notice-text")).toHaveText(WORDS.zh.text);
    await expect(page.getByTestId("size-notice-open")).toHaveText(WORDS.zh.anyway);
    expect(await fitsWidthOf(page)).toBe(true);
    // the notice is readable in both themes
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((choice) => document.documentElement.setAttribute("data-theme", choice), theme);
      expect(await contrast(page, '[data-testid="size-notice-text"]'), `${theme} words`).toBeGreaterThan(4.5);
    }
    // the button shows the game: the opening page as it is in a window of a size it is laid out for
    await page.getByTestId("size-notice-open").click();
    await expect(page.getByTestId("size-notice")).toHaveCount(0);
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("opening-goal")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is told in a window that is too short as well, and not in one of exactly the smallest size", async ({ lantern }) => {
    const page = lantern.page;
    await openSmall(lantern, { width: width + 300, height: height - 1 });
    await expect(page.getByTestId("size-notice-text")).toContainText(`${width} × ${height}`);
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("size-notice")).toHaveCount(0);
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes when the window is made larger, comes back when it is made small again, and stays away once the game was asked for", async ({ lantern }) => {
    const page = lantern.page;
    await openSmall(lantern, { width: width - 100, height: height - 100 });
    await page.setViewportSize({ width: width + 100, height: height + 100 });
    await expect(page.getByTestId("size-notice")).toHaveCount(0);
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.setViewportSize({ width: width - 100, height: height - 100 });
    await expect(page.getByTestId("size-notice")).toBeVisible();
    await page.getByTestId("size-notice-open").click();
    await page.setViewportSize({ width: width - 200, height: height - 200 });
    await expect(page.getByTestId("size-notice")).toHaveCount(0);
    await expect(page.getByTestId("opening-start")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not come on a page that names its game in the address, which has no opening page", async ({ lantern }) => {
    await lantern.page.setViewportSize({ width: width - 200, height: height - 200 });
    await lantern.open("scenario=m0&seed=5&pace=1", { menu: false });
    await expect(lantern.page.getByTestId("size-notice")).toHaveCount(0);
    await expect(lantern.page.getByTestId("opening")).toHaveCount(0);
  });
});

/** Whether the page has no sideways scroll. */
const fitsWidthOf = (page: import("@playwright/test").Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
