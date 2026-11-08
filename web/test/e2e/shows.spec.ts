import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The show when a job is done, on a page of fake frames: a card over the map with a light where it happened, once for each job, holding the world
// until it is put away. The world is held at tick 300 and what a test feeds stays as it was fed.
test.use({ map: true });

const flag = (name: string): Record<string, unknown> => ({ kind: "flag", tick: 1, flag: name });

/** The first day with the help on and what is true taken as the start, as the page does with the first frame of a game. */
async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { notebook: [], commitments: [], ...fake.tasksWhere({ t_bamboo_first: "open" }), ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

const BRIDGE_MENDED = { hud: { bridge: { done: 6, need: 5, percent: 100, hours: 10, hours_need: 10, state: "mended" } } };
const TRUTH_TOLD = { board: fake.boardKey({ truth: { state: "done", last: fake.CLEARED } }) };
const AT_PEACE = { board: fake.boardKey({ peace: { state: "done", grudge: 18, acts: fake.peaceActs(fake.PEACE_ACTS.map((a) => a.id)), witnessed: true } }) };

const card = (page: Page) => page.getByTestId("show-card");

/** Where the map puts a cell of the ground on the screen, as the light of a show is put there. */
const screenOfCell = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([cx, cy]) => window.__lantern.view.cellToScreen(cx as number, cy as number), [x, y] as const);

const translation = async (page: Page): Promise<{ x: number; y: number }> => {
  const transform = (await page.getByTestId("show-glow").evaluate((el) => (el as HTMLElement).style.transform)) ?? "";
  const found = /translate\((-?\d+)px, (-?\d+)px\)/.exec(transform);
  return { x: Number(found?.[1]), y: Number(found?.[2]) };
};

test.describe("the card of a job that is done", () => {
  test("the bridge: a card in both languages, a light on the bridge, the world held, and one button that lets it go", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("show-glow")).toHaveCount(0);
    await fake.feedFrame(page, BRIDGE_MENDED, [flag("bridge_fixed")]);
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute("data-job", "bridge");
    await expect(page.getByTestId("show-title")).toHaveText("The bridge is mended");
    await expect(page.getByTestId("show-text")).toHaveText("The Stone Bridge is whole again, and the lantern parade can cross.");
    await expect(page.getByTestId("show-close")).toHaveText("Carry on");
    await expect(page.getByTestId("show-close")).toBeFocused();
    // The world is held while it is up, and the button of the pause does not let it go.
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    // The elder does not open over it, as he does not over the card of the first day.
    await expect(page.getByTestId("btn-elder")).toBeDisabled();
    // The light is on the bridge, where the map has it.
    const glow = page.getByTestId("show-glow");
    await expect(glow).toHaveAttribute("data-job", "bridge");
    await expect(glow).toHaveAttribute("data-at", "p_bridge");
    await expect(glow).toHaveAttribute("data-fading", "false");
    const door = await screenOfCell(page, 27, 15);
    const at = await translation(page);
    expect(Math.abs(at.x - Math.round(door.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(at.y - Math.round(door.y))).toBeLessThanOrEqual(2);
    await lantern.setLang("zh");
    await expect(page.getByTestId("show-title")).toHaveText("桥修好了");
    await expect(page.getByTestId("show-text")).toHaveText("石桥又完整了，游灯的队伍可以过去了。");
    await expect(page.getByTestId("show-close")).toHaveText("接着办");
    await lantern.setLang("en");
    // Putting it away lets the world go, and the light goes out over a moment.
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    await expect(page.getByTestId("btn-elder")).toBeEnabled();
    await expect(glow).toHaveAttribute("data-fading", "true");
    await expect(glow).toHaveCount(0, { timeout: 8000 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the truth is lit where it was told and the peace on the manager, and each job is told once", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, TRUTH_TOLD, [flag("truth_told")]);
    await expect(card(page)).toHaveAttribute("data-job", "truth");
    await expect(page.getByTestId("show-title")).toHaveText("The truth is out");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-at", "p_teahouse");
    const teahouse = await screenOfCell(page, 34, 14);
    const at = await translation(page);
    expect(Math.abs(at.x - Math.round(teahouse.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(at.y - Math.round(teahouse.y))).toBeLessThanOrEqual(2);
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    // The same flag again, and a frame that says it is done: nothing.
    await fake.feedFrame(page, TRUTH_TOLD, [flag("truth_told")]);
    await expect(card(page)).toHaveCount(0);
    // The peace.
    await fake.feedFrame(page, { ...TRUTH_TOLD, ...AT_PEACE, board: fake.boardKey({ truth: { state: "done", last: fake.CLEARED }, peace: { state: "done", grudge: 18, acts: fake.peaceActs(fake.PEACE_ACTS.map((a) => a.id)), witnessed: true } }) }, [flag("reconciled")]);
    await expect(card(page)).toHaveAttribute("data-job", "peace");
    await expect(page.getByTestId("show-title")).toHaveText("The two families are at peace");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-job", "peace");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-at", "player");
    await lantern.setLang("zh");
    await expect(page.getByTestId("show-title")).toHaveText("两家和解了");
    await expect(page.getByTestId("show-text")).toHaveText("李、周两家的人坐到了一处，旧账不再挂在嘴上。");
    await lantern.setLang("en");
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("two jobs done together come one after the other, and the world is let go only after the second", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, { ...BRIDGE_MENDED, ...TRUTH_TOLD }, [flag("bridge_fixed"), flag("truth_told")]);
    await expect(card(page)).toHaveAttribute("data-job", "bridge");
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveAttribute("data-job", "truth");
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    // Escape puts the second away too.
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("waits behind the recap of the morning, and comes when it is put away", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, { ...fake.recap(), ...BRIDGE_MENDED, time: { day: 3, hour: 7, minute: 0, phase: "day" } }, [{ kind: "recap", tick: 1, lines: 3 }, flag("bridge_fixed")]);
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await page.getByTestId("recap-done").click();
    await expect(card(page)).toHaveAttribute("data-job", "bridge");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not for what was done when the page began to look, and not on a page without the help", async ({ lantern }) => {
    const page = lantern.page;
    // A game that was loaded with the bridge mended: the first frame has it, and the flag that comes after is no news.
    await fake.openFirstDay(lantern, { notebook: [], commitments: [], ...fake.tasksWhere({ t_bamboo_first: "open" }), ...BRIDGE_MENDED }, fake.GUIDED);
    await fake.primeHelp(page);
    await fake.feedFrame(page, BRIDGE_MENDED, [flag("bridge_fixed")]);
    await expect(card(page)).toHaveCount(0);
    // A page made for a test of something else has none of it.
    await fake.openFirstDay(lantern, { notebook: [] });
    await fake.feedFrame(page, BRIDGE_MENDED, [flag("bridge_fixed")]);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("reads in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, BRIDGE_MENDED, [flag("bridge_fixed")]);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        expect(await fake.contrast(page, '[data-testid="show-text"]'), `${theme} ${lang} text`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="show-title"]'), `${theme} ${lang} title`).toBeGreaterThan(4.5);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});
