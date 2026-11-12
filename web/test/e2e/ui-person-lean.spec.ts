import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { mapAtRest, pickAtSpot } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

/** What the card of Granny Li says in each language when she has said her stand and the other account with it. */
const WORDS = {
  en: { label: "Believes:", held: "Li Er broke the bridge railing last night.", by: "Also heard from Shopkeeper Zhou:", account: "Boatman He broke the bridge railing last night, by accident." },
  zh: { label: "信的是：", held: "李二昨晚把栏杆弄坏了。", by: "也听周掌柜说过：", account: "船夫老何昨晚把栏杆弄坏了，是不小心的。" },
} as const;

/** The frame's cards with the other account in the stance of Granny Li (the key is there only when she said it). */
function cardsWithRival(): Record<string, unknown> {
  const [first, ...rest] = fake.cards().cards as Array<Record<string, unknown>>;
  return { cards: [{ ...first, stance: { ...(first?.stance as Record<string, unknown>), rival: fake.RIVAL } }, ...rest] };
}

/** Picks a person by clicking their piece on the map. A card that is open for them already is the pick. */
async function pickOnMap(page: Page, id: string): Promise<void> {
  await mapAtRest(page);
  const open = page.getByTestId("person-card");
  if ((await open.count()) > 0 && (await open.getAttribute("data-person")) === id) return;
  const spot = await page.evaluate((who) => window.__lantern.view.screenPositionOf(who), id);
  if (spot === null) throw new Error(`there is no ${id} on the map`);
  await pickAtSpot(page, spot, id);
  await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", id);
}

test.describe("what a person leans to and the other account they were told", () => {
  test("is a line under what the town says, only when the person said it to the player, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const card = page.getByTestId("person-card");
    await pickOnMap(page, "li_laotai");
    // The stand she gave on her own has the row of the stand and no line: she said nothing of another account.
    await expect(card.getByTestId("person-stance")).toBeVisible();
    await expect(card.getByTestId("person-lean")).toHaveCount(0);
    await fake.feedFrame(page, cardsWithRival());
    const line = card.getByTestId("person-lean");
    await expect(line).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        const label = `${theme} ${lang}`;
        await expect(line.locator(".lean-label"), label).toHaveText(w.label);
        await expect(card.getByTestId("person-lean-held"), label).toHaveText(w.held);
        await expect(card.getByTestId("person-lean-rival").locator(".lean-by"), label).toHaveText(w.by);
        await expect(card.getByTestId("person-lean-rival").locator(".lean-account"), label).toHaveText(w.account);
        // One line of words, as the card sets them: Chinese joined, English set apart by spaces.
        const text = (await line.innerText()).replace(/\s+/g, " ").trim();
        expect(text, label).toBe(lang === "zh" ? `${w.label}${w.held}${w.by}${w.account}` : `${w.label} ${w.held} ${w.by} ${w.account}`);
        // Under what the town says of her and over the rows of facts.
        const bio = await card.getByTestId("person-bio").boundingBox();
        const lean = await line.boundingBox();
        const facts = await card.locator("dl.facts").boundingBox();
        if (bio === null || lean === null || facts === null) throw new Error(`no box for ${label}`);
        expect(lean.y, label).toBeGreaterThanOrEqual(bio.y + bio.height - 1);
        expect(facts.y, label).toBeGreaterThanOrEqual(lean.y + lean.height - 1);
        for (const selector of ['[data-testid="person-lean-held"]', '[data-testid="person-lean-rival"] .lean-by', '[data-testid="person-lean-rival"] .lean-account', ".lean-label"]) {
          expect(await fake.contrast(page, selector), `${label} ${selector}`).toBeGreaterThan(4.5);
        }
        expect(await fake.fitsWidth(page), label).toBe(true);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes when the next frame has a stand without it, and never shows for a person who has no stand", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, cardsWithRival());
    const card = page.getByTestId("person-card");
    await pickOnMap(page, "li_laotai");
    await expect(card.getByTestId("person-lean")).toBeVisible();
    await fake.feedFrame(page, fake.cards());
    await expect(card.getByTestId("person-lean")).toHaveCount(0);
    await expect(card.getByTestId("person-stance")).toBeVisible();
    // A person the player has not met and a person with no card at all have no line.
    await pickOnMap(page, "zuzhang");
    await expect(card.getByTestId("person-lean")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("stays in view in a talk, when the rest of what is known is folded away", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, cardsWithRival());
    const card = page.getByTestId("person-card");
    await pickOnMap(page, "li_laotai");
    await fake.startTalk(page, "li_laotai", cardsWithRival());
    await expect(card.getByTestId("person-bio")).toHaveAttribute("data-folded", "true");
    await expect(card.getByTestId("person-lean")).toBeVisible();
    await expect(card.getByTestId("person-lean-rival").locator(".lean-account")).toHaveText(WORDS.en.account);
    await expect(card.getByTestId("person-stance")).toBeHidden();
    expect(lantern.pageErrors).toEqual([]);
  });

});

// --- The paper says the street has two stories, as it says any short item ---------------------------------------------

const AT_SEVEN = { time: { day: 2, hour: 7, minute: 0, phase: "day" } };

/** The words of the item as the core makes them from the two accounts the street gave out in public (the script's line, with the accounts filled in). */
const STORIES = {
  zh: "街上有两种说法。有人说李二昨晚把栏杆弄坏了。也有人说船夫老何昨晚把栏杆弄坏了，是不小心的。",
  en: "The street has two stories. Some say that Li Er broke the bridge railing last night. Others say that Boatman He broke the bridge railing last night, by accident.",
} as const;

test.describe("the paper of the morning", () => {
  test("has the street's two stories among its short items, in both languages and themes, and nothing in it names which is true", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: [], commitments: [], board: fake.boardKey() }, fake.GUIDED);
    await fake.primeHelp(page);
    const news = fake.gazetteBody().news as Array<Record<string, unknown>>;
    const item = { kind: "two_accounts", text: { zh: STORIES.zh, en: STORIES.en } };
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette({ news: [news[0], item] }), ...AT_SEVEN }, [{ kind: "recap", tick: 900, lines: 3 }]);
    const card = page.getByTestId("gazette");
    await expect(card).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const label = `${theme} ${lang}`;
        const items = page.getByTestId("gazette-item");
        await expect(items.nth(1), label).toHaveText(STORIES[lang]);
        await expect(items.nth(1), label).toHaveAttribute("data-kind", "two_accounts");
        expect(await fake.contrast(page, '[data-testid="gazette-item"]:nth-of-type(2)'), label).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page), label).toBe(true);
        const shots = process.env.LANTERN_SHOTS_DIR ?? "";
        if (shots !== "" && ((theme === "light" && lang === "zh") || (theme === "dark" && lang === "en"))) {
          mkdirSync(shots, { recursive: true });
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(shots, `lean-paper-${lang}-${theme}.png`) });
        }
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});

// --- Pictures: skipped unless LANTERN_SHOTS_DIR names a folder ------------------------------------

const DIR = process.env.LANTERN_SHOTS_DIR;

test.describe("pictures of the line", () => {
  test.skip(DIR === undefined || DIR === "", "set LANTERN_SHOTS_DIR to take the pictures");

  for (const look of [
    { lang: "zh", theme: "light" },
    { lang: "en", theme: "dark" },
  ] as const) {
    test(`on the card of Granny Li, ${look.lang} ${look.theme}`, async ({ lantern }) => {
      const page = lantern.page;
      await fake.openFirstDay(lantern, cardsWithRival());
      await lantern.setTheme(look.theme);
      await lantern.setLang(look.lang);
      await pickOnMap(page, "li_laotai");
      await fake.feedFrame(page, cardsWithRival());
      await expect(page.getByTestId("person-lean")).toBeVisible();
      await page.getByTestId("person-card").screenshot({ path: path.join(DIR ?? "", `lean-card-${look.lang}-${look.theme}.png`) });
      await page.screenshot({ path: path.join(DIR ?? "", `lean-page-${look.lang}-${look.theme}.png`) });
      expect(lantern.pageErrors).toEqual([]);
    });
  }
});
