import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { piecesAtRest } from "../support/play.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

const TOWN = "scenario=bridge&seed=7&pace=60&until=400";
// The base of the night is the dark tile (玄青) and the base of the day is the wall (铅白): tokens.css.
const DARK_BG = "#3d3b4f";
const LIGHT_BG = "#f0f0f4";

/** The value of a colour token of the interface chrome, and which theme the document is in. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return {
      bg: getComputedStyle(root).getPropertyValue("--bg").trim(),
      scheme: getComputedStyle(root).colorScheme,
      attribute: root.getAttribute("data-theme"),
      body: getComputedStyle(document.body).backgroundColor,
      pressed: ["auto", "light", "dark"].filter((id) => document.querySelector(`[data-testid="theme-${id}"]`)?.getAttribute("aria-pressed") === "true"),
    };
  });

test.describe("theme", () => {
  test("follows the system at first, in both directions, and repaints the page with it", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "dark" });
    await lantern.open(TOWN, { menu: false });
    expect(await chrome(page)).toMatchObject({ bg: DARK_BG, scheme: "dark", attribute: null, body: "rgb(61, 59, 79)", pressed: ["auto"] });

    await page.emulateMedia({ colorScheme: "light" });
    expect(await chrome(page)).toMatchObject({ bg: LIGHT_BG, scheme: "light", attribute: null, body: "rgb(240, 240, 244)", pressed: ["auto"] });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("can be set by hand to either one, whatever the system says, and set back to follow it", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "light" });
    await lantern.open(TOWN, { menu: false });

    await lantern.setTheme("dark");
    expect(await chrome(page)).toMatchObject({ bg: DARK_BG, scheme: "dark", attribute: "dark", pressed: ["dark"] });
    await page.emulateMedia({ colorScheme: "dark" });
    await lantern.setTheme("light");
    expect(await chrome(page)).toMatchObject({ bg: LIGHT_BG, scheme: "light", attribute: "light", pressed: ["light"] });

    await lantern.setTheme("auto");
    expect(await chrome(page)).toMatchObject({ bg: DARK_BG, attribute: null, pressed: ["auto"] });
    await page.emulateMedia({ colorScheme: "light" });
    expect(await chrome(page)).toMatchObject({ bg: LIGHT_BG, attribute: null, pressed: ["auto"] });
  });

  test("is remembered by the viewer", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "light" });
    await lantern.open(TOWN, { menu: false });
    await lantern.setTheme("dark");
    expect(await page.evaluate(() => localStorage.getItem("lantern.theme"))).toBe("dark");
    await lantern.open(TOWN, { menu: false });
    expect(await chrome(page)).toMatchObject({ bg: DARK_BG, attribute: "dark", pressed: ["dark"] });
    await lantern.setTheme("auto");
    await lantern.open(TOWN, { menu: false });
    expect(await chrome(page)).toMatchObject({ bg: LIGHT_BG, attribute: null, pressed: ["auto"] });
  });

  test("changes the chrome and leaves the map as it is: the map keeps its own day and night", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "dark" });
    // A tick in the middle of the night, with the clock of the map held still.
    await lantern.open("scenario=bridge&seed=7&pace=80&until=1950", { menu: false });
    await lantern.waitForTick(1950);
    // The frame that holds the world is the last one. What is put into a frame stays only if no frame comes after it.
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await page.evaluate(() => {
      window.__lantern.view.clock = () => 12;
      // A night without rain, whatever the core plans, so that nothing on the map moves.
      window.__lantern.inject({ weather: "clear" });
    });
    await expect.poll(() => page.evaluate(() => window.__lantern.view.stats().glow)).toBeGreaterThan(0.95);
    // The people are still on their way to where the last frame put them, by the time between the map's own frames. Wait for them.
    await expect.poll(() => piecesAtRest(page), { timeout: 60_000 }).toBe(true);

    // The pixels of the map alone: a screenshot of the element would take in the buttons laid over it.
    const shoot = (): Promise<string> => page.evaluate(() => window.__lantern.view.pixelHash());
    const dark = await shoot();
    expect(dark).not.toBe("");
    expect(await shoot()).toBe(dark);
    await lantern.setTheme("light");
    expect((await chrome(page)).bg).toBe(LIGHT_BG);
    await page.waitForTimeout(400);
    const light = await shoot();
    expect(light).toBe(dark);
    await lantern.setTheme("dark");
    await page.waitForTimeout(400);
    expect(await shoot()).toBe(dark);
    // The glow of the lamps is a property of the hour, not of the theme.
    expect(await page.evaluate(() => window.__lantern.view.stats().daylight)).toBeLessThan(0.3);
  });
});
