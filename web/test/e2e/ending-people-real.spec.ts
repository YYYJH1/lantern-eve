import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, REPO_DIR, test } from "../support/fixtures.ts";
import { putSave, type Recording, recordFollower } from "../support/follower.ts";
import { leaveTalk, startGame, talkTo, untilHeld } from "../support/real.ts";
import { fitsWidth } from "../support/slice.ts";

// What became of the people who carry the days, on the ending of a real game. The game is the follower's (a manager who does only what the
// top bar says), played to its last night by the core under CPython and loaded as a save, so that the ending is the real one: the bridge
// mended, the truth told in public (the boatman's, which the follower states on the fourth evening) and the two families at one table.
// The page shows one or two sentences for each of the ten under the name of the ending, before the numbers of the night and the reveal.
// The same ten greet the manager as a talk opens and say a last word as the manager leaves: the words come from the core, over the head and
// in the line of the dialogue bar.

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";
const TEN = ["li_laotai", "li_da", "li_er", "zhou_zhanggui", "zhou_dalang", "zhou_huoji", "cha_laoban", "old_he", "zuzhang", "gengfu"];
// The entry of each person's list that the last night of this game chose: the bridge, the truth and the peace all done, the boatman's
// story told, and the promises the follower made to Li Da, Shopkeeper Zhou, the watchman and the elder kept (not one to Granny Li). The
// boatman's epilogue and Zhou Dalang's say what was told, and no other says who broke the rail.
const CHOSEN = { li_laotai: "full", li_da: "full_kept", li_er: "full", zhou_zhanggui: "full_kept", zhou_dalang: "cleared", zhou_huoji: "told", cha_laoban: "full", old_he: "owned", zuzhang: "full_kept", gengfu: "heard_kept" };
const OPENING = "pace=60&map=off";

type Lantern = import("../support/fixtures.ts").LanternPage;
interface Line {
  npc: string;
  id: string;
  text: { zh: string; en: string };
}

let ended: Recording;
test.beforeAll(() => {
  // the ending comes at 21:02 of the fifth day: this is a moment just after it
  ended = recordFollower(5, 21, 3);
});

/** Opens the page of a player, loads the game that reached its end as the newest save and continues from the opening page. */
async function toTheEnd(lantern: Lantern): Promise<Page> {
  const page = lantern.page;
  await page.addInitScript(() => {
    if (localStorage.getItem("lantern.tutorial") === null) localStorage.setItem("lantern.tutorial", "skipped");
  });
  await page.goto(`${lantern.servers.app.origin}/?${OPENING}`);
  await lantern.waitReady();
  await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
  await putSave(page, "the fifth night", ended);
  await page.evaluate(() => window.__lantern.client.refreshSaves());
  await expect(page.getByTestId("opening-continue")).toBeEnabled();
  await page.getByTestId("opening-continue").click();
  await expect(page.getByTestId("ending")).toBeVisible({ timeout: 240_000 });
  return page;
}

const epilogueOf = (page: Page): Promise<Line[]> => page.evaluate(() => (window.__lantern.play.state.ending?.epilogue ?? []) as unknown as Line[]);

let shots = 0;
/** A picture of the top of the ending, where the epilogue stands under the name of the ending. */
async function snap(page: Page, tag: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.getByTestId("ending").evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `people-${String(++shots).padStart(2, "0")}-ending-${tag}.png`) });
}

test.describe("the people at the end of a real game", () => {
  test("have one or two sentences each under the name of the ending, in the order of the cast and in both languages", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = await toTheEnd(lantern);
    const lines = await epilogueOf(page);
    expect(lines.map((line) => line.npc)).toEqual(TEN);
    expect(Object.fromEntries(lines.map((line) => [line.npc, line.id]))).toEqual(CHOSEN);

    const card = page.getByTestId("reveal-epilogue");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading")).toHaveText("Afterwards");
    const shown = card.getByTestId("epilogue-line");
    await expect(shown).toHaveCount(10);
    for (const [i, line] of lines.entries()) {
      const row = shown.nth(i);
      await expect(row).toHaveAttribute("data-npc", line.npc);
      await expect(row).toHaveAttribute("data-entry", line.id);
      await expect(row.locator(".epilogue-text")).toHaveText(line.text.en);
      expect(line.text.en).toMatch(/^[A-Z].*[.!?]$/);
      expect(line.text.zh).toMatch(/[。！？]$/);
    }
    // The names are those of the cast, in the language of the page.
    const names = await page.evaluate(() => Object.fromEntries((window.__lantern.play.scene?.cast ?? []).map((p) => [p.id, p.name])));
    await expect(card.locator(".epilogue-name")).toHaveText(TEN.map((id) => names[id]?.en ?? id));
    await expect(card).not.toContainText(/[一-鿿]/);

    // Under the name of the ending, before the numbers of the night and the reveal.
    const top = (await card.boundingBox())?.y ?? 0;
    expect(top).toBeGreaterThan((await page.getByTestId("ending-title").boundingBox())?.y ?? 1e9);
    expect(top).toBeLessThan((await page.getByTestId("ending-numbers").boundingBox())?.y ?? 0);
    expect(top).toBeLessThan((await page.getByTestId("reveal-truth").boundingBox())?.y ?? 0);

    // The story that was told is the boatman's, and his epilogue and Zhou Dalang's say so. No other epilogue names the cause.
    const said = (id: string) => lines.find((line) => line.npc === id)?.text.en ?? "";
    expect(said("old_he")).toContain("owned that the boat had struck the railing");
    expect(said("zhou_dalang")).toContain("nobody made a point of the smell of wine");
    for (const line of lines.filter((l) => !["old_he", "zhou_dalang"].includes(l.npc))) expect(line.text.en + line.text.zh).not.toMatch(/boat|rail(ing)? broke|撑船|船头|秋汛|踢/i);

    await lantern.setLang("zh");
    await expect(card.getByRole("heading")).toHaveText("后来");
    await expect(card.locator(".epilogue-name")).toHaveText(TEN.map((id) => names[id]?.zh ?? id));
    await expect(card.locator(".epilogue-text")).toHaveText(lines.map((line) => line.text.zh));
    await expect(card).not.toContainText(/[A-Za-z]{4,}/);

    // Put away and brought back, the card is still there; and what the page keeps of the game that is over is the whole ending.
    await page.getByTestId("ending-back").click();
    await page.getByTestId("ending-tab").click();
    await expect(page.getByTestId("reveal-epilogue").getByTestId("epilogue-line")).toHaveCount(10);
    expect(lantern.pageErrors).toEqual([]);
  });
});

// The pictures: Chinese on the light theme and English on the dark one. They are taken only when a folder is named. Every line stays inside its
// card, and the page needs no sideways scroll.
for (const [locale, scheme, tag, size] of [
  ["zh-CN", "light", "zh-light", { width: 1280, height: 760 }],
  ["en-US", "dark", "en-dark", { width: 1280, height: 760 }],
] as const) {
  test.describe(`the epilogue, ${tag}`, () => {
    test.use({ locale, colorScheme: scheme, viewport: size });

    test(`stays inside its card and the screen, ${tag}`, async ({ lantern }) => {
      test.setTimeout(900_000);
      const page = await toTheEnd(lantern);
      const card = page.getByTestId("reveal-epilogue");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("epilogue-line")).toHaveCount(10);
      await expect(card.getByRole("heading")).toHaveText(locale === "zh-CN" ? "后来" : "Afterwards");
      expect(await fitsWidth(page)).toBe(true);
      const box = (await card.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      for (const row of await card.getByTestId("epilogue-line").all()) {
        const at = (await row.boundingBox()) ?? { x: -1, y: 0, width: 1e9, height: 0 };
        expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
        expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
      }
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      // A line is read in full: its words are not cut off by the box they sit in.
      for (const text of await card.locator(".epilogue-text").all()) expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await snap(page, tag);
      expect(lantern.pageErrors).toEqual([]);
    });
  });
}

// The greeting and the last word, on the real core in the browser: the first morning, a talk with Granny Li, who has not met the manager.
const GAME = (process.env.LANTERN_SHOTS_DIR ?? "") === "" ? "pace=3&map=off" : "pace=3";

interface Pair {
  zh: string;
  en: string;
}
interface Entry {
  id: string;
  lines: Pair[];
}
const voices = JSON.parse(readFileSync(path.join(REPO_DIR, "content/compiled/voices.json"), "utf8")) as Record<string, { greet: Entry[]; chat: Entry[] }>;
const linesOf = (person: string, list: "greet" | "chat", id: string): Pair[] => voices[person]?.[list].find((entry) => entry.id === id)?.lines ?? [];

const bubbleOf = (page: Page, npc: string): Promise<Pair | null> =>
  page.evaluate((id) => {
    const frame = window.__lantern.client.state.frame as unknown as { bubbles: Array<{ npc: string; text: { zh: string; en: string } | null }> };
    return frame.bubbles.find((b) => b.npc === id && b.text !== null)?.text ?? null;
  }, npc);

test.describe("a greeting and a last word on the real core", () => {
  test("stand over the head and in the line of the dialogue bar as a talk opens and as the manager leaves, from the person's own list", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await talkTo(page, "li_laotai");
    await untilHeld(page);

    // The first talk of the game: the greeting for someone who has not met the manager, in the words of the core, in the bar as well.
    const greeting = await bubbleOf(page, "li_laotai");
    expect(greeting).not.toBeNull();
    expect(linesOf("li_laotai", "greet", "new")).toContainEqual(greeting);
    await expect(page.getByTestId("dialogue-line")).toContainText(greeting?.en ?? "?");
    // The log of the talk begins with it too, and it is not a line of the talk that the player made or was answered.
    await expect(page.getByTestId("talk-opening")).toHaveText(greeting?.en ?? "?");
    await expect(page.getByTestId("talk-line")).toHaveCount(0);

    // As the manager leaves she has a last word, over her head and in the bar.
    await leaveTalk(page);
    const parting = await bubbleOf(page, "li_laotai");
    expect(parting).not.toBeNull();
    expect(linesOf("li_laotai", "chat", "plain")).toContainEqual(parting);
    await expect(page.getByTestId("dialogue-line")).toContainText(parting?.en ?? "?");

    // A second talk the same day is greeted as such, in the state the game is in.
    await talkTo(page, "li_laotai");
    await untilHeld(page);
    const again = await bubbleOf(page, "li_laotai");
    expect(linesOf("li_laotai", "greet", "again")).toContainEqual(again);
    expect(lantern.pageErrors).toEqual([]);
  });
});

