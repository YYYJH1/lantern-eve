import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { putSave, recordFollower } from "../support/follower.ts";

// The show when a job is done, on the real core in the browser host: the flags that the core raises come to the page as events, and the card comes with
// them. The truth and the peace are raised by the test actions of the game (`dev_goal`), and the bridge by the helpers at work, on a recording of the
// follower (tools/bots/follower.py) that the core in the browser plays again up to the fourth morning.
test.use({ map: true });

const card = (page: Page) => page.getByTestId("show-card");

test.describe("the card of a job, on the real core", () => {
  test("the truth and then the peace: a card each, from the flags the core raises, and a light where it was done", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await page.goto(`${lantern.servers.app.origin}/?scenario=bridge&seed=7&pace=20&guide=on&config=dev_actions:1`);
    await lantern.waitReady();
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect(card(page)).toHaveCount(0);

    // The truth is told: the core raises `truth_told`, and the board says it is done in the same frame.
    await page.evaluate(() => window.__lantern.client.player({ type: "dev_goal", op: "truth" }));
    await expect(card(page)).toBeVisible({ timeout: 60_000 });
    await expect(card(page)).toHaveAttribute("data-job", "truth");
    await expect(page.getByTestId("show-title")).toHaveText("The truth is out");
    expect(await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { board: { truth: { state: string } } }).board.truth.state)).toBe("done");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-at", /^p_/);
    // The world waits for the card: the tick stands still until it is put away.
    const tick = await page.evaluate(() => window.__lantern.client.state.simTick);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBe(tick);
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.simTick)).toBeGreaterThan(tick);

    // The peace: the grudge is low and a reconciliation was seen.
    await page.evaluate(() => {
      window.__lantern.client.player({ type: "dev_goal", op: "grudge", value: 10 });
      window.__lantern.client.player({ type: "dev_goal", op: "reconcile" });
    });
    await expect(card(page)).toBeVisible({ timeout: 60_000 });
    await expect(card(page)).toHaveAttribute("data-job", "peace");
    await expect(page.getByTestId("show-title")).toHaveText("The two families are at peace");
    expect(await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { board: { peace: { state: string } } }).board.peace.state)).toBe("done");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-at", "player");
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    // Each job is told once: the cards do not come again.
    await page.waitForTimeout(1500);
    await expect(card(page)).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the bridge, on a recording of the follower", () => {
  test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

  test("the helpers mend the bridge on the fourth morning, and the card comes with the flag, in Chinese, over the bridge", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    const recording = recordFollower(4, 6, 10);
    await page.goto(`${lantern.servers.app.origin}/?start=1&pace=3&guide=on`);
    await lantern.waitReady();
    const id = await putSave(page, "fourth morning", recording);
    await page.evaluate((save) => window.__lantern.client.load(save), id);
    const loaded = await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 240_000 });
    expect(await loaded.jsonValue()).toBe(true);
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick, recording.tick, { timeout: 60_000 });
    expect(await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { hud: { bridge: { state: string } } }).hud.bridge.state)).not.toBe("mended");
    await expect(card(page)).toHaveCount(0);
    // The world is let go, and the paper of the morning is put away when it comes (it would hold the card back).
    await page.getByTestId("btn-pause").click();
    await expect
      .poll(
        async () => {
          if ((await page.getByTestId("gazette-done").count()) > 0) await page.getByTestId("gazette-done").click({ timeout: 2000 }).catch(() => undefined);
          return card(page).count();
        },
        { timeout: 240_000, intervals: [300] },
      )
      .toBe(1);
    await expect(card(page)).toHaveAttribute("data-job", "bridge");
    await expect(page.getByTestId("show-title")).toHaveText("桥修好了");
    expect(await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { hud: { bridge: { state: string } } }).hud.bridge.state)).toBe("mended");
    await expect(page.getByTestId("show-glow")).toHaveAttribute("data-at", "p_bridge");
    await page.getByTestId("show-close").click();
    await expect(card(page)).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
