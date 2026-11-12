import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { advance, CASES, type Case, endingOf, festival, MOMENTS, nightFrame, TOWN } from "../support/festival.ts";
import * as fake from "../support/slice.ts";

// The shows of the page drive its sound, on a page of fake frames and the soundscape the page has: the festival night starts the music of the procession
// when a parade walks and stops it when the night is over or skipped, a night with no parade has none, and a moment plays its cymbal once. The test
// begins the sound as the press of Start does, and the sound only reads what the page does.
test.use({ map: true });

interface Heard {
  begun: boolean;
  on: boolean;
  engine: { started: boolean; festival: boolean; cues: number };
}

const heard = (page: Page): Promise<Heard> => page.evaluate(() => window.__lantern.sound?.snapshot() as never);

/** The sound is begun, as a press of Start does, and its engine is there. */
async function begun(page: Page): Promise<void> {
  await page.evaluate(() => window.__lantern.sound?.begin());
  await expect.poll(async () => (await heard(page)).engine.started, { timeout: 10_000 }).toBe(true);
}

test.describe("the sound of the festival night", () => {
  test("is the music of the procession while a parade walks, and it stops when the night is skipped", async ({ lantern }) => {
    const page = lantern.page;
    const full = CASES[0] as Case;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, nightFrame(full), TOWN);
    await begun(page);
    expect((await heard(page)).engine.festival).toBe(false);
    const ending = endingOf(full);
    await fake.feedFrame(page, nightFrame(full, { ending }), [ending]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await expect.poll(async () => (await heard(page)).engine.festival, { timeout: 10_000 }).toBe(true);
    const { timeline: tl } = await festival(page);
    for (let t = 0; t < tl.arrive; t += 2) await advance(page, 2000);
    expect((await heard(page)).engine.festival).toBe(true);
    await page.getByTestId("director-skip").click();
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect.poll(async () => (await heard(page)).engine.festival, { timeout: 10_000 }).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not the music of a procession in a night with no parade", async ({ lantern }) => {
    const page = lantern.page;
    const none = CASES.find((c) => c.name === "split-apart") as Case;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, nightFrame(none), TOWN);
    await begun(page);
    const ending = endingOf(none);
    await fake.feedFrame(page, nightFrame(none, { ending }), [ending]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await advance(page, 5000);
    await page.waitForTimeout(600);
    expect((await heard(page)).engine.festival).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the sound of a moment", () => {
  test("is the cymbal of the sound, played once when the show of the moment comes and not again while it plays", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, { notebook: [], commitments: [], moments: [], moment_hold: [] }, `${fake.TOWN}&director=on&showclock=manual`);
    await page.waitForFunction(() => window.__lantern.play.director.port !== null);
    await begun(page);
    const before = (await heard(page)).engine.cues;
    const { kind, ...rest } = MOMENTS[1] as Record<string, unknown>;
    await fake.feedFrame(page, { moments: [MOMENTS[1]], moment_hold: [kind as string] }, [{ kind: "moment", moment: kind, ...rest }]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", kind as string);
    await expect.poll(async () => (await heard(page)).engine.cues, { timeout: 10_000 }).toBe(before + 1);
    await advance(page, 1700);
    await page.waitForTimeout(500);
    expect((await heard(page)).engine.cues).toBe(before + 1);
    expect(lantern.pageErrors).toEqual([]);
  });
});
