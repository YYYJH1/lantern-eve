import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { recordMornings } from "../support/people.ts";
import { askUntilNoted, leaveTalk, startGame, talkTo, untilHeld, untilSettled } from "../support/real.ts";
import * as fake from "../support/slice.ts";

// The people of the real core in the browser host, met through the page the way a player meets them. The first morning of three games of the three stories
// is played under CPython, and the page is given the frames.
test.use({ map: true });

const textOf = async (page: Page, testid: string): Promise<string> => ((await page.getByTestId(testid).innerText()) ?? "").replace(/\s+/g, " ").trim();

interface Row {
  id: string;
  known: boolean;
  hearts: number;
  met: Array<{ tick: number; day: number; hour: number; minute: number; place: string | null }>;
  asked: { what: { en: string }; for: { en: string } } | null;
}

const rowOf = (page: Page, id: string): Promise<Row> =>
  page.evaluate((who) => ((window.__lantern.client.state.frame as unknown as { people: Row[] }).people.find((row) => row.id === who) ?? null) as Row, id);

const openPeople = async (page: Page): Promise<void> => {
  if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
  await page.getByTestId("workspace-tab-people").click();
  await expect(page.getByTestId("people-leaf")).toBeVisible();
};

const closeBook = async (page: Page): Promise<void> => {
  await page.getByTestId("notebook-close").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
};

/** Asks the person of the talk for something, as a player does: the verb, the request in the list, and the confirmation of what the preview says. */
async function askFor(page: Page, request: string): Promise<void> {
  await page.getByTestId("verb-entrust").click();
  await page.locator(`[data-testid="picker-option"][data-id="${request}"]`).click();
  await page.getByTestId("request-confirm").click();
}

test.describe("meeting people on the real game", () => {
  test("a first talk puts who the person is beside them, and the book has the person with where and when, the hearts and what came of the talk", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    await startGame(lantern);
    await expect(page.getByTestId("people-six")).toHaveCount(0); // a player with no tutorial goes straight in

    // --- Granny Li, the first time: the note beside the speaker has her name and the line the town says of her.
    await talkTo(page, "li_laotai");
    await untilHeld(page);
    const note = page.getByTestId("meeting-note");
    await expect(note).toBeVisible();
    const cast = await page.evaluate(() => (window.__lantern.client.state.scene as unknown as { cast: Array<{ id: string; en: string; intro: { en: string } }> }).cast);
    const granny = cast.find((person) => person.id === "li_laotai");
    await expect(note.getByTestId("meeting-name")).toHaveText(granny?.en ?? "");
    await expect(note.getByTestId("meeting-intro")).toHaveText(granny?.intro.en ?? "");
    await expect(note.getByTestId("meeting-added")).toHaveText("Now in the people book.");
    // The frame has her known, with the half heart of a first talk and the place and the time the talk began.
    const first = await rowOf(page, "li_laotai");
    expect(first).toMatchObject({ known: true, hearts: 1 });
    expect(first.met).toHaveLength(1);
    const asked = await rowOf(page, "zhou_zhanggui");
    expect(asked).toMatchObject({ known: false, hearts: 0, met: [], asked: null });
    await leaveTalk(page);
    await expect(note).toHaveCount(0);

    // --- A request that is turned down for want of weight: the shopkeeper asks a return, and the book keeps it.
    await talkTo(page, "zhou_zhanggui");
    await untilHeld(page);
    await expect(page.getByTestId("meeting-name")).toHaveText("Shopkeeper Zhou");
    await askFor(page, "material");
    await untilSettled(page);
    await expect.poll(async () => (await rowOf(page, "zhou_zhanggui")).asked?.what.en ?? "", { timeout: 30_000 }).toBe("a front-row stall at the festival");
    if (await page.getByTestId("verb-leave").count()) await leaveTalk(page);

    // --- What the madam of the teahouse says of Li Er: a line in the notebook, written under her name in the book with when and where.
    await askUntilNoted(page, "cha_laoban", "li_er", 1);
    await leaveTalk(page);

    // --- The book: a line each, in the order the player met them, from the frame and nothing else.
    await openPeople(page);
    const lines = page.getByTestId("people-line");
    await expect(lines).toHaveCount(3);
    expect(await lines.evaluateAll((items) => items.map((item) => item.getAttribute("data-person")))).toEqual(["li_laotai", "zhou_zhanggui", "cha_laoban"]);
    const grannyLine = lines.nth(0);
    await expect(grannyLine.getByTestId("people-name")).toHaveText("Granny Li");
    const row = await rowOf(page, "li_laotai");
    const when = `Day ${row.met[0]?.day} ${String(row.met[0]?.hour).padStart(2, "0")}:${String(row.met[0]?.minute).padStart(2, "0")}`;
    await expect(grannyLine.getByTestId("people-met-at")).toHaveText([new RegExp(`^${when}, (at .+|in the street)$`)]);
    await expect(grannyLine.getByTestId("hearts")).toHaveAttribute("data-value", String(row.hearts));
    // The hearts open the sheet of what stands behind them, the same sheet as in a talk, and the sheet is put away again.
    await grannyLine.getByTestId("hearts").click();
    const sheet = page.getByTestId("hearts-sheet");
    await expect(sheet).toHaveAttribute("data-person", "li_laotai");
    await expect(sheet.getByTestId("hearts-change").first()).toContainText(/first talk of the day/i);
    await sheet.getByTestId("hearts-close").click();
    await expect(sheet).toHaveCount(0);
    const shopkeeper = lines.nth(1);
    await expect(shopkeeper.getByTestId("people-asked-what")).toHaveText("a front-row stall at the festival");
    await expect(shopkeeper.getByTestId("people-asked-for")).toHaveText("For: Ask Shopkeeper Zhou to bring the timber to the bridge");
    const madam = lines.nth(2);
    await expect(madam.getByTestId("people-said-entry").first()).toContainText("Li Er");
    await expect(madam.getByTestId("people-said-at").first()).toHaveText(/^Day 1 \d\d:\d\d, (at .+|in the street)$/);
    // The note of a first meeting does not come again: the second talk with Granny Li has none.
    await closeBook(page);
    await talkTo(page, "li_laotai");
    await untilHeld(page);
    await expect(page.getByTestId("talk-strip")).toHaveAttribute("data-talking", "true");
    await expect(page.getByTestId("meeting-note")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("what the book is shown", () => {
  test("is the same in the three games that differ only in the story that is true, in the frame rows and in the words of the page", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    const mornings = recordMornings();
    expect(Object.keys(mornings).sort()).toEqual(["v_boat", "v_drunk", "v_flood"]);
    await fake.openFirstDay(lantern);
    const seen: Record<string, { words: string; people: unknown; notebook: unknown; heads: string[] }> = {};
    for (const [variant, frame] of Object.entries(mornings)) {
      await fake.feedFrame(page, frame);
      await openPeople(page);
      await expect(page.getByTestId("people-line")).toHaveCount(4);
      // A portrait that is not drawn yet is the seal of the surname, which has a letter in it: the words are read when every portrait is drawn.
      await expect.poll(() => page.locator('[data-testid="portrait"][data-drawn="false"]').count(), { timeout: 30_000 }).toBe(0);
      const heads = await page.evaluate(() => window.__lantern.view.drawing().headLabels.filter((label) => label.known).map((label) => `${label.id}:${label.text}`).sort());
      seen[variant] = { words: await textOf(page, "people-leaf"), people: frame.people, notebook: (frame.notebook as Array<Record<string, unknown>>).map((entry) => ({ text: entry.text, source: entry.source, at: entry.at })), heads };
      await closeBook(page);
    }
    // The town did other things behind the manager's back in each (what is said in the street, where the people stand, what the acts are off for), and the
    // manager was told the same: the frames are not the same, and what the book shows of them is.
    expect(JSON.stringify(mornings.v_flood)).not.toBe(JSON.stringify(mornings.v_boat));
    expect(JSON.stringify(mornings.v_drunk)).not.toBe(JSON.stringify(mornings.v_boat));
    expect(seen.v_flood).toEqual(seen.v_boat);
    expect(seen.v_drunk).toEqual(seen.v_boat);
    expect(seen.v_boat?.words).toContain("Shopkeeper Zhou");
    expect(seen.v_boat?.words).toContain("a front-row stall at the festival");
    // None of it says which story is true.
    for (const word of ["v_boat", "v_flood", "v_drunk", "variant", "drunk", "flood"]) expect(seen.v_boat?.words.toLowerCase(), word).not.toContain(word);
    expect(lantern.pageErrors).toEqual([]);
  });
});
