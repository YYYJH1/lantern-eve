import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, test } from "../support/fixtures.ts";
import { notes, run } from "../support/play.ts";
import { startGame, talkTo, untilSettled } from "../support/real.ts";

// The acts around the manager on the real core in the browser host: the reasons are the core's own (`hud.verbs_off`) and not a guess of the page,
// and the cards that teach an act come with the first talk of a game.
test.use({ map: true });

// The bridge town of seed 7, held (paused) at tick 60 (06:10), and at tick 400 (09:20).
const TOWN = "scenario=bridge&seed=7&pace=40&until=60";
const LATER = "scenario=bridge&seed=7&pace=40&until=400";

const reasonsOf = (page: import("@playwright/test").Page): Promise<Record<string, string>> => page.evaluate(() => (window.__lantern.client.state.frame?.hud as { verbs_off?: Record<string, string> }).verbs_off ?? {});

test.describe("the acts around the manager, in the real game", () => {
  test("show the reasons the core gives: all four are there from the first tick, those it cannot do are grey, and the call for helpers goes grey once made", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    const off = await reasonsOf(page);
    for (const act of ["listen", "look", "rally", "speak"]) await expect(page.getByTestId(`verb-${act}`)).toBeVisible();
    // Nobody talks within hearing, and this is no place to speak in public: the core says far for both, and the page says so in its words.
    expect(off.listen).toBe("far");
    expect(off.speak).toBe("far");
    await expect(page.getByTestId("verb-listen")).toHaveAttribute("data-off", "far");
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("data-off", "far");
    await expect(page.getByTestId("verb-listen")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("title", en["act.off.speak.far"]);
    // The railing is within reach at the start, and the call for helpers is open.
    await expect(page.getByTestId("verb-look")).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("aria-disabled", "false");
    await page.getByTestId("verb-listen").click({ force: true });
    await expect(page.getByTestId("around-why")).toHaveText(en["act.off.listen.far"]);
    // The call is made, and the core has nothing more to ask of it.
    await page.getByTestId("verb-rally").click();
    await expect(notes(page).first()).toHaveText(en["note.rally"]);
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("data-off", "done");
    expect((await reasonsOf(page)).rally).toBe("done");
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("title", en["act.off.rally.done"]);
    await page.getByTestId("verb-rally").click({ force: true });
    await expect(page.getByTestId("around-why")).toHaveText(en["act.off.rally.done"]);
    // No act shows minutes, and the words are in the other language when it is chosen.
    await expect(page.getByTestId("around").locator(".verb-cost")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("title", zh["act.off.rally.done"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("say busy for every one of them while the manager looks at something, and are back when the look is over", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await lantern.open(LATER, { menu: false });
    await lantern.waitForTick(400);
    await page.getByTestId("verb-look").click();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    // While the look takes its time, every act of the strip waits, and each says so.
    for (const act of ["listen", "look", "rally", "speak"]) await expect(page.getByTestId(`verb-${act}`)).toHaveAttribute("data-off", "busy");
    expect((await reasonsOf(page)).look).toBe("busy");
    await page.getByTestId("verb-look").click({ force: true });
    await expect(page.getByTestId("around-why")).toHaveText(en["act.off.busy"]);
    await run(page);
    await expect(notes(page).filter({ hasText: /You noted down|You found nothing/ })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("aria-disabled", "false");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the cards that teach an act, in the real game", () => {
  test("come with the first talk: asking is taught first, and what the player asks is learned and not taught again", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await startGame(lantern);
    await talkTo(page, "li_laotai");
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "teach.ask", { timeout: 30_000 });
    await expect(pill.getByTestId("hint-pill-title")).toHaveText(en["teach.ask.title"]);
    // The card lights the button of the talk that asks, and the list of questions is behind it.
    await expect(page.getByTestId("verb-ask")).toHaveClass(/is-signal/);
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await page.locator('[data-testid="topic-chip"]').first().click();
    await untilSettled(page);
    expect(await page.evaluate(() => localStorage.getItem("lantern.taught"))).toContain("ask");
    // What is learned is not given again, however many times the manager talks.
    const ids = await page.evaluate(() => window.__lantern.play.guide.hints.log.filter((e) => e.act !== null).map((e) => e.id));
    expect(ids.filter((id) => id === "teach.ask")).toHaveLength(1);
    expect(lantern.pageErrors).toEqual([]);
  });
});
