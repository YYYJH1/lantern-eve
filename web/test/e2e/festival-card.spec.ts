import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The festival part of the board has the festival's own numbers, the households that promised, the turnout that is expected and the way across,
// and not the helpers and the work hours of the bridge, which the bridge part of the board has.
test.use({ map: true });

const HUD = { promised: 23, turnout: 1800 };

async function openBoard(lantern: import("../support/fixtures.ts").LanternPage, hud: Record<string, unknown>): Promise<void> {
  await fake.openFirstDay(lantern, { ...fake.moment("day4"), hud: { ...HUD, ...hud } });
  await lantern.page.getByTestId("board-toggle").click();
  await expect(lantern.page.getByTestId("hud-festival")).toBeVisible();
}

test.describe("the festival part of the board", () => {
  test("has the households, the turnout and the way across, and none of the bridge's helpers or work hours", async ({ lantern }) => {
    const page = lantern.page;
    await openBoard(lantern, { bridge: { done: 5, need: 5, percent: 40, hours: 4, hours_need: 10, state: "repairing", lacking: "bamboo" } });
    const festival = page.getByTestId("hud-festival");
    await expect(festival.locator(".stat")).toHaveCount(3);
    await expect(festival.getByTestId("stat-promised")).toContainText("23 households");
    await expect(festival.getByTestId("stat-turnout")).toContainText("1,800 people");
    await expect(festival.getByTestId("stat-passage")).toContainText("Way across");
    await expect(festival.getByTestId("passage")).toHaveText("No way across yet");
    await expect(festival.getByTestId("passage")).toHaveAttribute("data-passage", "none");
    // Nothing of the bridge's own: no workers, no hours, no meter, no missing bamboo.
    await expect(festival.getByTestId("stat-bridge")).toHaveCount(0);
    await expect(festival.locator("progress")).toHaveCount(0);
    await expect(festival).not.toContainText(/workers|work hours|short of|done/);
    await festival.scrollIntoViewIfNeeded();
    // They are on the bridge part, once.
    await expect(page.getByTestId("board-bridge").getByTestId("board-helpers")).toBeVisible();
    await expect(page.getByTestId("board-bridge").getByTestId("board-hours")).toHaveAttribute("data-done", "4");
    await expect(page.getByTestId("board-helpers")).toHaveCount(1);
    await expect(page.getByTestId("board-hours")).toHaveCount(1);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says how the festival can cross, in both languages and both themes: not yet, over the mended bridge, by the detour, and a dash where the frame does not say", async ({ lantern }) => {
    const page = lantern.page;
    const words = {
      broken: { en: "No way across yet", zh: "还没有路可走", passage: "none" },
      mended: { en: "The bridge is mended", zh: "桥修好了", passage: "mended" },
      detour: { en: "The detour is ready", zh: "绕路备好了", passage: "detour" },
    } as const;
    await openBoard(lantern, { bridge: { done: 0, need: 5, state: "broken" } });
    for (const state of ["broken", "mended", "detour"] as const) {
      await fake.feedFrame(page, { hud: { ...HUD, bridge: { done: 5, need: 5, state } } });
      for (const theme of ["light", "dark"] as const) {
        await lantern.setTheme(theme);
        for (const lang of ["en", "zh"] as const) {
          await lantern.setLang(lang);
          await expect(page.getByTestId("passage")).toHaveText(words[state][lang]);
          await expect(page.getByTestId("passage")).toHaveAttribute("data-passage", words[state].passage);
        }
      }
    }
    await lantern.setTheme("light");
    await lantern.setLang("en");
    // The frame has no bridge: a dash, as for every number that has not come.
    await fake.feedFrame(page, { hud: { ...HUD, bridge: null } });
    await expect(page.getByTestId("passage")).toHaveCount(0);
    await expect(page.getByTestId("stat-passage").locator(".dash")).toBeVisible();
    // The bridge as a bare percent says nothing of the way across.
    await fake.feedFrame(page, { hud: { ...HUD, bridge: 40 } });
    await expect(page.getByTestId("passage")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

});
