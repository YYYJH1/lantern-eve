import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The street talk of the paper with the line that says who went about the day before (the errands that the people of the town chose in the
// night, done in public), which takes the place of a line that only says how the street stands: the two lines of talk of a morning, in both
// languages and both themes, that the core's own words are shown as they come, and, when LANTERN_SHOTS_DIR names a folder,
// a picture of each state.
test.use({ map: true });

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";
const n = (zh: string, en: string): { zh: string; en: string } => ({ zh, en });
const AT_SEVEN = { time: { day: 3, hour: 7, minute: 0, phase: "day" } };
const OPEN = fake.tasksWhere({ t_bamboo_first: "open" });

const TALK = [
  { kind: "festival_down", text: n("街上盼灯会的人比昨天少了。茶馆里也没几个人提灯会。", "Fewer people on the street look forward to the festival than yesterday. The teahouse hardly mentions it.") },
  { kind: "walk_look", text: n("昨天有人特地去桥边看了看。", "Some people made a point of going down to look at the bridge yesterday.") },
] as const;

async function guided(lantern: LanternPage): Promise<void> {
  await fake.openFirstDay(lantern, { ...OPEN, notebook: [], commitments: [], board: fake.boardKey() }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

async function snap(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `paper-walk-${name}.png`) });
}

test.describe("the street talk of the paper, with who went about", () => {
  test("has two lines, the last of them the errands of the day before, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette({ day: 3, talk: TALK }), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["zh", "en"] as const) {
        await lantern.setLang(lang);
        await expect(page.getByTestId("gazette-talk-line")).toHaveText(TALK.map((line) => line.text[lang]));
        await expect(page.getByTestId("gazette-talk-line").nth(1)).toContainText(lang === "zh" ? "特地去桥边看了看" : "look at the bridge");
        expect(await fake.contrast(page, '[data-testid="gazette-talk-line"]'), `${theme} ${lang} talk`).toBeGreaterThan(4.5);
      }
    }
    await lantern.setTheme("light");
    await lantern.setLang("zh");
    await snap(page, "zh-light-desktop");
    expect(lantern.pageErrors).toEqual([]);
  });

});
