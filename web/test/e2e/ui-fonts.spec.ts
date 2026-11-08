import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DIST_E2E, expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

const TOWN = "scenario=bridge&seed=7&pace=60&until=200";
// The two faces of the page, cut down to the characters of the game (tools/fonts) and served from the page's own origin. The sizes are the
// budget of tests/test_fonts.py.
const FONTS = [
  { family: "WenKai", weight: "400", file: "fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2", licence: "fonts/lxgw-wenkai/OFL.txt", budget: 340_000 },
  { family: "WenKai", weight: "500", file: "fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2", licence: "fonts/lxgw-wenkai/OFL.txt", budget: 340_000 },
  { family: "Brush", weight: "400", file: "fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2", licence: "fonts/ma-shan-zheng/OFL.txt", budget: 100_000 },
] as const;

test.describe("the faces of the page", () => {
  test("ship with the build, each beside its licence, and are within their budget", () => {
    for (const font of FONTS) {
      expect(existsSync(path.join(DIST_E2E, font.file)), font.file).toBe(true);
      const licence = readFileSync(path.join(DIST_E2E, font.licence), "utf8");
      expect(licence, font.licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
      expect(licence, font.licence).toMatch(/^Copyright/);
      expect(statSync(path.join(DIST_E2E, font.file)).size, font.file).toBeLessThan(font.budget);
    }
    // The build has no Cormorant Garamond and no title face other than the subset.
    expect(existsSync(path.join(DIST_E2E, "fonts/cormorant-garamond"))).toBe(false);
    expect(existsSync(path.join(DIST_E2E, "fonts/ma-shan-zheng/MaShanZheng-title.woff2"))).toBe(false);
  });

  test("load from the page's own origin under a policy that allows fonts from nowhere else, and draw the text and the titles", async ({ lantern, servers }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    const faces = async () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`);
      });

    // The body is in WenKai, and the weight that stands out is its Medium. The titles (the name of the task on the slip) are in the brush face.
    await expect.poll(faces).toEqual(expect.arrayContaining(["WenKai 400 loaded", "WenKai 500 loaded", "Brush 400 loaded"]));
    expect(await page.evaluate(() => document.fonts.check('16px "WenKai"', "灯会前夕 Lantern Eve"))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('27px "Brush"', "灯会前夕"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("WenKai");
    expect(await page.getByTestId("topbar-task-text").evaluate((el) => getComputedStyle(el.closest(".slip-head") ?? el).fontFamily)).toContain("Brush");
    // English is set in the same hand as Chinese.
    await lantern.setLang("en");
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("WenKai");

    const served = servers.app.requests.filter((r) => r.path.startsWith("/fonts/"));
    for (const font of FONTS) {
      const hit = served.find((r) => r.path === `/${font.file}`);
      expect(hit, font.file).toBeDefined();
      expect(hit).toMatchObject({ status: 200, contentType: "font/woff2" });
    }
    expect(servers.app.csp).toContain("font-src 'self'");
    expect(served.every((r) => r.csp === servers.app.csp)).toBe(true);
    expect(lantern.network.filter((n) => n.origin !== servers.app.origin)).toEqual([]);
    expect(lantern.consoleLines.filter((l) => /Content Security Policy|Refused to/i.test(l))).toEqual([]);
  });
});

test.describe("the face of the paper", () => {
  test("is the one hand of the page in both languages, with a curly quote that is narrow", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 301 }]);
    await expect(page.getByTestId("recap")).toBeVisible();
    // The sheets, the notebook and the cards of the help share one stack (`--serif`), which is WenKai first in both languages.
    const stack = (selector: string) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel) as Element).fontFamily, selector);
    const quote = (selector: string) =>
      page.evaluate((sel) => {
        const style = getComputedStyle(document.querySelector(sel) as Element);
        const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
        context.font = `${style.fontSize} ${style.fontFamily}`;
        return context.measureText("“").width / Number.parseFloat(style.fontSize);
      }, selector);
    for (const selector of [".sheet", ".paper-page"]) {
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        expect((await stack(selector)).startsWith("WenKai"), `${selector} ${lang}`).toBe(true);
      }
      // A curly quote in a line of English is narrow: about a third of the height of a letter, and never the width of a Chinese character.
      await lantern.setLang("en");
      expect(await quote(selector), `${selector} quote`).toBeLessThan(0.6);
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});
