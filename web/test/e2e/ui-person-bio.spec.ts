import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, REPO_DIR, test } from "../support/fixtures.ts";
import { mapDrawn, pickAtSpot } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

/** What the town says of each person, as the content has it (the cast that the core is built from). */
const CAST = JSON.parse(readFileSync(path.join(REPO_DIR, "content", "compiled", "cast_bridge_v0.json"), "utf8")) as {
  people: Array<{ id: string; bio: { zh: string; en: string } }>;
};
const bioOf = (id: string): { zh: string; en: string } => {
  const person = CAST.people.find((p) => p.id === id);
  if (person === undefined) throw new Error(`there is no ${id} in the cast`);
  return person.bio;
};

const TITLE = { en: "What the town says", zh: "镇上人说" } as const;

/** Picks a person by clicking their piece on the map, on the body: the feet of a person can lie under the body of the one next to them once the sprites are drawn. */
async function pickOnMap(page: Page, id: string): Promise<void> {
  await mapDrawn(page);
  const spot = await page.evaluate((who) => window.__lantern.view.bodyPositionOf(who), id);
  if (spot === null) throw new Error(`there is no ${id} on the map`);
  await pickAtSpot(page, spot, id);
  await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", id);
}

test.describe("what the town says of a person", () => {
  test("is on the card from the first minute, under the name and the role, headed and in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const card = page.getByTestId("person-card");
    // Granny Li has a card of the frame, the Clan Elder has none and has not been met: the card is the same for both.
    for (const id of ["li_laotai", "zuzhang"]) {
      await pickOnMap(page, id);
      for (const theme of ["light", "dark"] as const) {
        await lantern.setTheme(theme);
        for (const lang of ["en", "zh"] as const) {
          await lantern.setLang(lang);
          const label = `${id} ${theme} ${lang}`;
          await expect(card.getByTestId("person-bio-title"), label).toHaveText(TITLE[lang]);
          await expect(card.getByTestId("person-bio-text"), label).toHaveText(bioOf(id)[lang]);
          // Under the name and the role (the Clan Elder has no role apart from his name), over the rows of facts.
          const head = await card.locator(".person-head").boundingBox();
          const bio = await card.getByTestId("person-bio").boundingBox();
          const facts = await card.locator("dl.facts").boundingBox();
          if (head === null || bio === null || facts === null) throw new Error(`no box for ${label}`);
          expect(bio.y, label).toBeGreaterThanOrEqual(head.y + head.height);
          expect(facts.y, label).toBeGreaterThanOrEqual(bio.y + bio.height - 1);
          for (const selector of ['[data-testid="person-bio-title"]', '[data-testid="person-bio-text"]']) {
            expect(await fake.contrast(page, selector), `${label} ${selector}`).toBeGreaterThan(4.5);
          }
          expect(await fake.fitsWidth(page), label).toBe(true);
        }
      }
    }
    await lantern.setLang("en");
    await expect(card.getByTestId("person-bio-text")).toContainText("Clan Elder");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the role under the name, but not where the role is the name itself", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const card = page.getByTestId("person-card");
    const cast = await page.evaluate(() => (window.__lantern.play.scene?.cast ?? []).map((p) => ({ id: p.id, name: p.name, role: p.role })));
    // Five of the twenty are called by what they do, so their role is their name, and it is said once.
    expect(cast.filter((p) => p.role.zh === p.name.zh).map((p) => p.id).sort()).toEqual(["cha_laoban", "miaozhu", "mujiang", "zhadeng_shifu", "zuzhang"]);
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const id of ["li_laotai", "zuzhang"]) {
        const person = cast.find((p) => p.id === id);
        if (person === undefined) throw new Error(`there is no ${id} in the scene`);
        const label = `${id} ${lang}`;
        await pickOnMap(page, id);
        await expect(card.getByTestId("person-name"), label).toHaveText(person.name[lang]);
        if (id === "zuzhang") {
          await expect(card.locator(".person-role"), label).toHaveCount(0);
        } else {
          await expect(card.locator(".person-role"), label).toHaveText(person.role[lang]);
        }
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is in the scene for all twenty people, and the page reads it as the content has it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const bios = await page.evaluate(() => Object.fromEntries((window.__lantern.play.scene?.cast ?? []).map((p) => [p.id, p.bio])));
    expect(Object.keys(bios).sort()).toEqual(CAST.people.map((p) => p.id).sort());
    for (const person of CAST.people) {
      expect(bios[person.id], person.id).toEqual(person.bio);
      expect(person.bio.zh.length, person.id).toBeLessThanOrEqual(70);
      expect(person.bio.en.length, person.id).toBeLessThanOrEqual(320);
    }
    // It comes with the scene, so no frame the page is fed has it.
    const frame = await page.evaluate(() => JSON.stringify(window.__lantern.client.state.frame));
    expect(frame).not.toContain('"bio"');
  });

  test("is open outside a talk, and in a talk is one line that opens on a click, before the hour the person has to go", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const card = page.getByTestId("person-card");
    // Outside a talk the words are open to read, and there is nothing to click.
    await pickOnMap(page, "li_laotai");
    await expect(card.getByTestId("person-bio")).toHaveAttribute("data-folded", "false");
    await expect(card.getByTestId("person-bio-text")).toBeVisible();
    await expect(card.locator("details.person-bio-fold")).toHaveCount(0);
    const open = await card.getByTestId("person-bio").boundingBox();
    // In a talk the controls of the talk sit under the card, so what the town says is folded to its heading: one line.
    await fake.startTalk(page, "li_laotai");
    const bio = card.getByTestId("person-bio");
    await expect(bio).toHaveAttribute("data-folded", "true");
    await expect(card.getByTestId("person-bio-title")).toHaveText(TITLE.en);
    await expect(card.getByTestId("person-bio-text")).toBeHidden();
    const folded = await bio.boundingBox();
    if (open === null || folded === null) throw new Error("no box");
    expect(folded.height).toBeLessThan(open.height / 2);
    expect(folded.height).toBeLessThan(40);
    await expect(card.getByTestId("person-leaves")).toBeVisible();
    // A click on the heading opens it, in the words of the content, and another puts it away again.
    await card.getByTestId("person-bio-title").click();
    await expect(card.getByTestId("person-bio-text")).toHaveText(bioOf("li_laotai").en);
    const leaves = await card.getByTestId("person-leaves").boundingBox();
    const text = await card.getByTestId("person-bio-text").boundingBox();
    if (leaves === null || text === null) throw new Error("no box");
    expect(leaves.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
    // The rest of what is known is still behind its fold.
    await expect(page.getByTestId("person-wants")).toBeHidden();
    await lantern.setLang("zh");
    await expect(card.getByTestId("person-bio-title")).toHaveText(TITLE.zh);
    await expect(card.getByTestId("person-bio-text")).toHaveText(bioOf("li_laotai").zh);
    await card.getByTestId("person-bio-title").click();
    await expect(card.getByTestId("person-bio-text")).toBeHidden();
    // When the talk is over the words are open again.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null }, hud: { verbs: fake.FREE_VERBS } }, [{ kind: "talk_end", tick: 9, npc: "li_laotai", reason: "left" }]);
    await expect(card.getByTestId("person-bio")).toHaveAttribute("data-folded", "false");
    await expect(card.getByTestId("person-bio-text")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is left out where the scene has none: the demo world has a card without the heading", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=m0&seed=3&pace=30&until=300", { menu: false });
    await lantern.waitForTick(300);
    await mapDrawn(page);
    const id = await page.evaluate(() => window.__lantern.play.scene?.cast[0]?.id ?? null);
    if (id === null) throw new Error("the demo world has no one");
    await pickOnMap(page, id);
    await expect(page.getByTestId("person-name")).toBeVisible();
    await expect(page.getByTestId("person-bio")).toHaveCount(0);
    await expect(page.getByTestId("person-bio-title")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
