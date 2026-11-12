import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The red slip says one thing (what to do, where and when, and the phrase that does it), keeps why and what stands in the way behind a line
// of its own and the other tasks behind "and more", and says what the bridge's crew still lacks where the bridge is the thing: here on fake
// frames, and the same lack on the ledger's page for the bridge.

test.use({ map: true });

/** The helpers' task of the days after the first, followed, with the crew of the bridge as the core reports it. */
function crew(short: number, families: string[], tracked = "t_helper_zhou"): Record<string, unknown> {
  const base = fake.moment("day3");
  const bridge = (base.hud as { bridge: Record<string, unknown> }).bridge;
  return { ...base, ...fake.laterTasks(tracked), statement: null, hud: { bridge: { ...bridge, short, families_missing: families } } };
}

test.describe("the slip", () => {
  test("says one thing: what to do, where and when, and the phrase that does it, with the reasons behind a line of their own", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const note = page.locator("#slip-note");
    await expect(page.getByTestId("task-next")).toHaveText("Find out who started that talk.");
    await expect(page.getByTestId("task-window")).toHaveText("Li Family House, 08:00 to 17:00");
    await expect(page.getByTestId("task-do")).toHaveText("Talk to Granny Li");
    // Why it is so, and what is in the way, are there but folded: one line says "Why".
    await expect(page.getByTestId("slip-why").locator("summary")).toHaveText(en["slip.why"]);
    await expect(page.getByTestId("task-why")).toBeHidden();
    await expect(page.getByTestId("task-blocker")).toBeHidden();
    await expect(page.getByTestId("task-expected")).toHaveCount(0);
    // No line of the note is more than the one thing and what stands behind it: what to do, and where and when.
    await expect(note.locator("p.note-line:visible, p.note-when:visible")).toHaveCount(2);
    await page.getByTestId("slip-why").locator("summary").click();
    await expect(page.getByTestId("task-why")).toHaveText("The town is saying Li Er broke the bridge. Granny Li is angry that you, the manager, have said nothing.");
    await expect(page.getByTestId("task-blocker")).toContainText("The Li family will not give the bamboo");
    // The other tasks are behind "and more", with how many.
    await expect(page.getByTestId("task-more").locator("summary")).toHaveText(translateMore(en, 3));
    await expect(page.getByTestId("task-other").first()).toBeHidden();
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says it in Chinese too, and the people it is expected to meet stay behind the line of reasons", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, fake.tasks("t_evening"));
    await lantern.setLang("zh");
    await expect(page.getByTestId("slip-why").locator("summary")).toHaveText(zh["slip.why"]);
    await expect(page.getByTestId("task-more").locator("summary")).toHaveText(translateMore(zh, 3));
    // The evening has its people, who are to be there: they are reasons, and are folded.
    await expect(page.getByTestId("task-expected")).toBeHidden();
    await page.getByTestId("slip-why").locator("summary").click();
    await expect(page.getByTestId("task-expected-person")).toHaveCount(3);
    await expect(page.getByTestId("task-do")).toHaveText("去茶馆");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has no line for the reasons of a task that has none, and no way to fold what is not there", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const bare = fake.tasks("t_promise");
    (bare.tasks as Array<Record<string, unknown>>)[3] = { ...(bare.tasks as Array<Record<string, unknown>>)[3], action: null };
    await fake.feedFrame(page, bare);
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_promise");
    await expect(page.getByTestId("slip-why")).toHaveCount(0);
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveText("Once Granny Li lets go, ask Li Da to bring it");
  });

  test("keeps every act where it is: the slip stresses one task and the strip, the people and the ledger are the same", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: [...fake.FREE_VERBS, "speak"] } });
    await fake.recordSent(page);
    await expect(page.getByTestId("verb-listen")).toBeVisible();
    await expect(page.getByTestId("verb-look")).toBeVisible();
    await expect(page.getByTestId("verb-rally")).toBeVisible();
    await expect(page.getByTestId("verb-speak")).toBeVisible();
    // Another task takes the slip: the acts are as they were.
    await fake.feedFrame(page, fake.tasks("t_evening"));
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_evening");
    await expect(page.getByTestId("verb-rally")).toBeVisible();
    await page.getByTestId("verb-rally").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "rally" });
  });
});

test.describe("what the bridge's crew lacks", () => {
  test("is on the slip where the task is about the helpers, with how many and which family has nobody", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, crew(3, ["fam_zhou"]));
    const lack = page.getByTestId("task-short");
    await expect(lack).toHaveText("Helpers still missing: 3. Nobody from the Zhou family has come to help yet.");
    await expect(lack).toHaveAttribute("data-short", "3");
    await expect(lack).toHaveAttribute("data-families", "fam_zhou");
    await lantern.setLang("zh");
    await expect(lack).toHaveText("帮手还差三个。周家还没人来帮忙。");
    // Both families have nobody yet: both are said.
    await fake.feedFrame(page, crew(5, ["fam_li", "fam_zhou"]));
    await expect(lack).toHaveText("帮手还差五个。李家和周家还没人来帮忙。");
    // A crew that is full in number and lacks a family says only the family.
    await fake.feedFrame(page, crew(0, ["fam_li"]));
    await expect(lack).toHaveText("李家还没人来帮忙。");
    expect(await fake.fitsWidth(page)).toBe(true);
  });

  test("is not on the slip where the bridge is not the thing, nor where the crew is complete or the frame says nothing", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    // The bamboo is a task of the bridge, and the crew is not what it is about.
    await fake.feedFrame(page, crew(3, ["fam_zhou"], "t_bamboo_more"));
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_more");
    await expect(page.getByTestId("task-short")).toHaveCount(0);
    await fake.feedFrame(page, crew(0, [], "t_helper_zhou"));
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_helper_zhou");
    await expect(page.getByTestId("task-short")).toHaveCount(0);
    // A frame from before the numbers says nothing, and the slip does not make it up.
    const old = crew(3, ["fam_zhou"]);
    const bridge = (old.hud as { bridge: Record<string, unknown> }).bridge;
    delete bridge.short;
    delete bridge.families_missing;
    await fake.feedFrame(page, old);
    await expect(page.getByTestId("task-short")).toHaveCount(0);
  });

  test("is on the ledger's page for the bridge, under the helpers, and goes when the bridge is mended", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, crew(2, ["fam_zhou"]));
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("board")).toBeVisible();
    const lack = page.getByTestId("board-short");
    await expect(lack).toHaveText("Helpers still missing: 2. Nobody from the Zhou family has come to help yet.");
    await expect(lack).toHaveAttribute("data-short", "2");
    // It is a line of the helpers' row, under what the row says, and not a row of its own.
    const helpers = await page.getByTestId("board-helpers").boundingBox();
    const said = await lack.boundingBox();
    const total = await page.getByTestId("board-helpers").locator(".helper-total").boundingBox();
    if (helpers === null || said === null || total === null) throw new Error("no box");
    expect(said.y).toBeGreaterThan(total.y);
    expect(said.y + said.height).toBeLessThanOrEqual(helpers.y + helpers.height + 1);
    await lantern.setLang("zh");
    await expect(lack).toHaveText("帮手还差两个。周家还没人来帮忙。");
    // The bridge is mended: the core says nothing is missing, and the page says nothing.
    await fake.feedFrame(page, { ...fake.moment("day5"), statement: null });
    await expect(page.getByTestId("board-short")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

/** The words of "and more" for a count, from the table, so that the test says what the page says. */
function translateMore(table: Record<string, string>, n: number): string {
  const text = table["slip.more"] ?? "";
  const shown = table === zh ? ["零", "一", "两", "三"][n] ?? String(n) : String(n);
  return text.replace("{n}", shown);
}
