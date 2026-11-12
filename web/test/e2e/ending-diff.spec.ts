import { expect, test } from "../support/fixtures.ts";
import { CASES, type Case, endingOf, nightFrame, pressTelling } from "../support/festival.ts";
import * as fake from "../support/slice.ts";

// On the ending page's tree of a rumour, choosing a telling shows the words that changed from the telling before it: characters in Chinese, words in English.
test.use({ map: true });

const FULL = CASES[0] as Case;

async function open(lantern: Parameters<Parameters<typeof test>[2]>[0]["lantern"], lang: "zh" | "en" = "en"): Promise<void> {
  await fake.openFirstDay(lantern, nightFrame(FULL), fake.TOWN);
  await lantern.setLang(lang);
  const ending = endingOf(FULL);
  await fake.feedFrame(lantern.page, nightFrame(FULL, { ending }), [ending]);
  await expect(lantern.page.getByTestId("ending")).toBeVisible();
}

const edge = (lantern: Parameters<Parameters<typeof test>[2]>[0]["lantern"], id: string) => lantern.page.locator(`[data-testid="tree-edge"][data-id="${id}"]`);
const marks = (lantern: Parameters<Parameters<typeof test>[2]>[0]["lantern"], where: "diff-before" | "diff-after") => lantern.page.getByTestId(where).getByTestId("diff-mark");

test.describe("the words that changed in a telling", () => {
  test("are marked in English by the word: choosing the telling that changed a story shows it beside the telling before, with the new words marked", async ({ lantern }) => {
    await open(lantern);
    const page = lantern.page;
    await expect(page.getByTestId("tree-diff-hint")).toHaveText("Choose a line of the tree to see which words changed in that telling.");
    // c6: Niangzi told Huoji "The Li family wrecked the bridge on purpose, to spoil the Zhou family's night." (p3), which she had heard from Zhanggui as the same words
    // c7: Huoji told the shopkeeper p4: the same, with "and blamed a drunk" added
    await pressTelling(lantern.page, "c7");
    const diff = page.getByTestId("tree-diff");
    await expect(diff).toHaveAttribute("data-telling", "c7");
    await expect(page.getByTestId("tree-diff-hint")).toHaveCount(0);
    await expect(page.getByTestId("diff-before")).toHaveText("The Li family wrecked the bridge on purpose, to spoil the Zhou family's night.");
    await expect(page.getByTestId("diff-after")).toHaveText("The Li family wrecked the bridge on purpose, to spoil the Zhou family's night, and blamed a drunk.");
    await expect(marks(lantern, "diff-after")).toHaveText(["and blamed a drunk."]);
    await expect(marks(lantern, "diff-before")).toHaveCount(0);
    await expect(edge(lantern, "c7")).toHaveAttribute("data-picked", "true");
    // choosing another telling takes the choice there
    await pressTelling(lantern.page, "c3");
    await expect(diff).toHaveAttribute("data-telling", "c3");
    await expect(edge(lantern, "c7")).toHaveAttribute("data-picked", "false");
    // c3: Zhanggui to Niangzi, p3, which he had from Huoji as p2 ("Dalang ... kicked the bridge, drunk.")
    await expect(page.getByTestId("diff-before")).toHaveText("Dalang of the Zhou family kicked the bridge, drunk.");
    await expect(marks(lantern, "diff-after").first()).toBeVisible();
    // the same one again puts the choice away
    await pressTelling(lantern.page, "c3");
    await expect(page.getByTestId("tree-diff")).toHaveCount(0);
    await expect(page.getByTestId("tree-diff-hint")).toBeVisible();
  });

  test("are marked in Chinese by the character", async ({ lantern }) => {
    await open(lantern, "zh");
    const page = lantern.page;
    await expect(page.getByTestId("tree-diff-hint")).toHaveText("点一条线，看这一回改了哪些字。");
    await pressTelling(lantern.page, "c7");
    await expect(page.getByTestId("diff-before")).toHaveText("李家故意毁桥，不想让周家出风头。");
    await expect(page.getByTestId("diff-after")).toHaveText("李家故意毁桥，不想让周家出风头，还嫁祸给醉汉。");
    await expect(marks(lantern, "diff-after")).toHaveText(["还嫁祸给醉汉"]);
    await pressTelling(lantern.page, "c3");
    await expect(page.getByTestId("diff-before")).toHaveText("周家大郎醉酒踢坏了桥。");
    // the characters that are new are marked and those that were passed on as they were are not: "家" is in both, and "周" and "桥" too
    const marked = (await marks(lantern, "diff-after").allTextContents()).join("");
    expect(marked.length).toBeGreaterThan(5);
    expect(marked).not.toContain("，");
    expect(marked).not.toContain("。");
  });

  test("say where a telling is the first, and where nothing changed, and can be chosen with the keyboard", async ({ lantern }) => {
    await open(lantern);
    const page = lantern.page;
    // c1 is what Li Er, who saw it, told Granny Li: nobody told him, so there is no telling before it
    await edge(lantern, "c1").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tree-diff")).toHaveAttribute("data-telling", "c1");
    await expect(page.getByTestId("diff-first")).toHaveText("This is where the story starts.");
    await expect(page.getByTestId("diff-after")).toHaveText("Li Er was looking for his lantern by the bridge.");
    // c4: Granny Li passed on what Li Er told her, as it was
    await edge(lantern, "c4").focus();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("tree-diff")).toHaveAttribute("data-telling", "c4");
    await expect(page.getByTestId("diff-same")).toHaveText("Nothing changed this time.");
    await expect(page.getByTestId("diff-mark")).toHaveCount(0);
    await expect(page.getByTestId("tree-diff")).toHaveAttribute("data-same", "true");
    // the line has a name for a reader that cannot see it
    await expect(edge(lantern, "c4")).toHaveAttribute("aria-label", "Show what changed when Granny Li told Li Xiaomei");
    await expect(edge(lantern, "c4")).toHaveAttribute("role", "button");
  });
});
