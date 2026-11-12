import type { Browser } from "@playwright/test";
import { expect, LanternPage, type Servers, test } from "../support/fixtures.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

// A bridge town held at tick 300 (about 08:30 on the first day), with a line of talk put into the frame.
const TOWN = "scenario=bridge&seed=7&pace=60&until=300";
const SAYING = { npc: "zhou_zhanggui", until: 999_999, text: { zh: "听说李家那小子昨晚在桥边转悠。", en: "They say the Li boy was by the bridge last night." } };

async function openTown(browser: Browser, servers: Servers, options: { locale: string; blockStorage?: boolean }): Promise<LanternPage> {
  const context = await browser.newContext({ locale: options.locale });
  if (options.blockStorage === true) {
    // What a browser does with site data blocked: touching localStorage throws.
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
  }
  const lantern = new LanternPage(await context.newPage(), servers);
  await lantern.open(TOWN, { menu: false });
  await lantern.waitForTick(300);
  // The weather is put in as well, so that the words below do not depend on how the core plans it.
  await lantern.page.evaluate((line) => window.__lantern.inject({ bubbles: [line], weather: "clear" }), SAYING);
  await expect.poll(() => lantern.page.evaluate(() => window.__lantern.view.stats().bubbles)).toBe(1);
  return lantern;
}

/** The words of the interface and of the map, as a reader would see them. */
async function words(lantern: LanternPage) {
  const page = lantern.page;
  await expect.poll(() => page.evaluate(() => window.__lantern.view.texts().labels.p_teahouse)).toBeTruthy();
  return page.evaluate(() => {
    const text = (id: string): string => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? "";
    const texts = window.__lantern.view.texts();
    return {
      lang: document.documentElement.lang,
      title: document.title,
      heading: text("title"),
      pause: text("btn-pause"),
      status: text("status"),
      notebook: document.querySelector('[data-testid="btn-notebook"]')?.getAttribute("aria-label") ?? "",
      board: document.querySelector('[data-testid="board-tabs"]')?.getAttribute("aria-label") ?? "",
      weather: text("hud-weather"),
      day: text("hud-day"),
      teahouse: texts.labels.p_teahouse ?? "",
      bridge: texts.labels.p_bridge ?? "",
      bubble: texts.bubbles[0] ?? "",
      line: text("dialogue-line"),
      pressed: ["zh", "en"].filter((l) => document.querySelector(`[data-testid="lang-${l}"]`)?.getAttribute("aria-pressed") === "true"),
    };
  });
}

test.describe("language", () => {
  test("follows the browser at first, and the switch changes every string, every name and every line of talk at once", async ({ browser, servers }) => {
    const lantern = await openTown(browser, servers, { locale: "zh-CN" });
    try {
      const zh = await words(lantern);
      expect(zh).toMatchObject({
        lang: "zh-CN",
        title: "灯会前夕",
        heading: "灯会前夕",
        pause: "继续",
        status: "已暂停",
        notebook: "见闻簿",
        board: "筹备",
        weather: "晴",
        day: "第一天",
        teahouse: "茶馆",
        bridge: "石桥",
        bubble: SAYING.text.zh,
        pressed: ["zh"],
      });
      expect(zh.line).toContain("周掌柜：「听说李家那小子昨晚在桥边转悠。」");

      await lantern.setLang("en");
      const en = await words(lantern);
      expect(en).toMatchObject({
        lang: "en",
        title: "Lantern Eve",
        heading: "Lantern Eve",
        pause: "Resume",
        status: "paused",
        notebook: "Notebook",
        board: "Preparation",
        weather: "Clear",
        day: "Day 1",
        teahouse: "Teahouse",
        bridge: "Stone Bridge",
        bubble: SAYING.text.en,
        pressed: ["en"],
      });
      expect(en.line).toContain("Shopkeeper Zhou: “They say the Li boy was by the bridge last night.”");

      await lantern.setLang("zh");
      expect(await words(lantern)).toEqual(zh);
      expect((await lantern.snapshot()).error).toBeNull();
      expect(lantern.pageErrors).toEqual([]);
    } finally {
      await lantern.page.context().close();
    }
  });

  test("is English for a browser in English, or in a language the page does not have", async ({ browser, servers }) => {
    for (const locale of ["en-GB", "fr-FR"]) {
      const lantern = await openTown(browser, servers, { locale });
      try {
        expect(await words(lantern)).toMatchObject({ lang: "en", title: "Lantern Eve", teahouse: "Teahouse", pressed: ["en"] });
      } finally {
        await lantern.page.context().close();
      }
    }
  });

  test("is remembered by the viewer, and the choice beats the browser's language", async ({ browser, servers }) => {
    const lantern = await openTown(browser, servers, { locale: "zh-CN" });
    try {
      await lantern.setLang("en");
      expect(await lantern.page.evaluate(() => localStorage.getItem("lantern.lang"))).toBe("en");
      await lantern.open(TOWN, { menu: false });
      expect(await lantern.page.evaluate(() => document.documentElement.lang)).toBe("en");
      await expect(lantern.page.getByTestId("title")).toHaveText("Lantern Eve");
      expect(lantern.pageErrors).toEqual([]);
    } finally {
      await lantern.page.context().close();
    }
  });

  test("still works when the browser blocks storage: the switch changes the page and nothing is remembered", async ({ browser, servers }) => {
    const lantern = await openTown(browser, servers, { locale: "zh-CN", blockStorage: true });
    try {
      const page = lantern.page;
      expect(await page.evaluate(() => { try { void localStorage.length; return "open"; } catch { return "blocked"; } })).toBe("blocked");
      expect(await words(lantern)).toMatchObject({ lang: "zh-CN", title: "灯会前夕", teahouse: "茶馆" });

      await lantern.setLang("en");
      expect(await words(lantern)).toMatchObject({ lang: "en", title: "Lantern Eve", teahouse: "Teahouse", pressed: ["en"] });
      await lantern.setTheme("light");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      // The key of the model provider has the same guard, and the game runs on.
      await lantern.waitForTick(300);
      expect((await lantern.snapshot()).error).toBeNull();

      // Nothing was kept, so a new visit starts from the browser again.
      await lantern.open(TOWN, { menu: false });
      expect(await words(lantern)).toMatchObject({ lang: "zh-CN", title: "灯会前夕" });
      await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
      expect(lantern.pageErrors).toEqual([]);
      expect(lantern.consoleLines.filter((l) => l.startsWith("[page:error]"))).toEqual([]);
    } finally {
      await lantern.page.context().close();
    }
  });
});
