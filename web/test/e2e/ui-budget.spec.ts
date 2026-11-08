import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";

const TOWN = "scenario=bridge&seed=7&pace=60&until=300";
const CAP = 3_000_000;

async function budget(page: Page, hud: Record<string, unknown>): Promise<void> {
  await page.evaluate((h) => window.__lantern.inject({ hud: h }), hud);
}

/** The share of the gauge that a part of it covers, in percent. */
async function share(page: Page, part: string): Promise<number> {
  return page.evaluate((selector) => {
    const gauge = document.querySelector('[data-testid="budget-gauge"]') as HTMLElement;
    const bit = document.querySelector(selector) as HTMLElement;
    return (bit.getBoundingClientRect().width / gauge.getBoundingClientRect().width) * 100;
  }, part);
}

test.describe("the budget in the side column", () => {
  test("shows how much is spent and held against the cap, with the two limits marked", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    // The core sends the budget from the first frame: nothing spent, every model on.
    await expect(page.getByTestId("budget")).toHaveAttribute("data-stage", "0");
    await expect(page.getByTestId("budget-gauge")).toHaveAttribute("data-used", "0");
    await expect(page.getByTestId("budget-notes")).toHaveText("Every model is on.");

    await budget(page, { spent: 750_000, held: 150_000, cap: CAP, stage: 0, cloud: true, local: false });
    await expect(page.getByTestId("budget")).toHaveAttribute("data-stage", "0");
    await expect(page.getByTestId("budget-gauge")).toHaveAttribute("data-used", "30");
    await expect(page.getByTestId("budget-gauge")).toHaveAttribute("aria-label", "30% of the budget is spent or held");
    expect(await share(page, ".budget-spent")).toBeCloseTo(25, 0);
    expect(await share(page, ".budget-held")).toBeCloseTo(5, 0);
    await expect(page.locator(".budget-scale")).toContainText("70%");
    await expect(page.locator(".budget-scale")).toContainText("90%");
    await expect(page.getByTestId("budget-notes")).toHaveText("Every model is on.");
    await expect(page.getByTestId("stat-cost")).toContainText("¥0.75");
    await expect(page.getByTestId("stat-cost")).toContainText("of ¥3.00");
    expect(lantern.consoleLines.filter((line) => /content security policy/i.test(line))).toEqual([]);
  });

  test("says plainly that the strong model is off from 70 percent and that the cloud stops at 90", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);

    await budget(page, { spent: 2_200_000, held: 0, cap: CAP, stage: 1, cloud: true, local: false });
    await expect(page.getByTestId("budget")).toHaveAttribute("data-stage", "1");
    await expect(page.getByTestId("budget-notes")).toHaveText("The strong model is off: 70% of the budget is spent or held. The cheap model answers instead, and the cloud stops at 90%.");
    await expect(page.getByTestId("stat-cost")).toContainText("of ¥3.00, strong model off");

    await budget(page, { spent: 2_800_000, held: 0, cap: CAP, stage: 2, cloud: true, local: false });
    await expect(page.getByTestId("budget")).toHaveAttribute("data-stage", "2");
    await expect(page.getByTestId("budget-notes")).toHaveText("Cloud models are off: 90% of the budget is spent or held.Lines from the script answer instead.");
    await expect(page.getByTestId("stat-cost")).toContainText("cloud models off");

    // With a local model, it is the local model that answers.
    await budget(page, { spent: 2_800_000, held: 0, cap: CAP, stage: 2, cloud: true, local: true });
    await expect(page.getByTestId("budget-notes")).toHaveText("Cloud models are off: 90% of the budget is spent or held.A local model answers instead.");
    await expect(page.getByTestId("budget")).toHaveAttribute("data-local", "true");

    // The cloud can be off with the budget untouched: the host said it cannot be reached.
    await budget(page, { spent: 300_000, held: 0, cap: CAP, stage: 0, cloud: false, local: false });
    await expect(page.getByTestId("budget")).toHaveAttribute("data-cloud", "false");
    await expect(page.getByTestId("budget-notes")).toHaveText("The cloud cannot be reached.Lines from the script answer instead.");
    await budget(page, { spent: 300_000, held: 0, cap: CAP, stage: 0, cloud: false, local: true });
    await expect(page.getByTestId("budget-notes")).toHaveText("The cloud cannot be reached.A local model answers instead.");
  });

  test("counts the calls that the gate moved down, from the list of calls, and says so in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await budget(page, { spent: 2_200_000, held: 0, cap: CAP, stage: 1, cloud: true, local: false });
    await expect(page.getByTestId("budget-moved")).toHaveCount(0);
    const call = { tick: 10, category: "reply", reason: null, model: "qwen-flash", hold: 100, status: "ok", code: null, latency_ms: 50, usage: null, cost: 100, settled: 11, late: false, voided: null };
    await page.evaluate((c) => {
      const client = window.__lantern.client as unknown as { onMessage(m: unknown): void };
      client.onMessage({
        type: "model-calls",
        replace: true,
        calls: [
          { ...c, id: "a", asked: "cheap", tier: "cheap" },
          { ...c, id: "b", asked: "strong", tier: "cheap", reason: "budget" },
          { ...c, id: "c", asked: "cheap", tier: "template", reason: "cloud_down", model: null, hold: 0, status: "template", cost: 0 },
        ],
      });
    }, call);
    await expect(page.getByTestId("budget-moved")).toHaveText("Calls moved down so far: 2 (1 answered from the script).");
    await lantern.setLang("zh");
    await expect(page.getByTestId("budget-moved")).toHaveText("到现在已降档的调用：2 次（其中 1 次由台词库回答）。");
  });

  test("says the same in Chinese", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await lantern.setLang("zh");
    await budget(page, { spent: 750_000, held: 0, cap: CAP, stage: 0 });
    await expect(page.getByTestId("budget-notes")).toHaveText("所有模型都开着。");
    await budget(page, { spent: 2_200_000, held: 0, cap: CAP, stage: 1 });
    await expect(page.getByTestId("budget-notes")).toHaveText("强档已停：预算用到或预留到了 70%。改由便宜档回答，到 90% 云端全停。");
    await budget(page, { spent: 2_800_000, held: 0, cap: CAP, stage: 2, local: true });
    await expect(page.getByTestId("budget-notes")).toHaveText("云端模型已停：预算用到或预留到了 90%。改由本机模型回答。");
    await budget(page, { spent: 2_800_000, held: 0, cap: CAP, stage: 0, cloud: false });
    await expect(page.getByTestId("budget-notes")).toHaveText("连不上云端。改用台词库里的话回答。");
    await expect(page.getByTestId("budget-gauge")).toHaveAttribute("aria-label", "预算已用或已预留 93%");
  });

  test("tells the player when a limit is crossed and when the cloud goes, in a note over the map", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    const feedFrame = (events: unknown[], hud: Record<string, unknown>) =>
      page.evaluate(
        ([e, h]) => {
          const client = window.__lantern.client as unknown as { onMessage(m: unknown): void };
          const frame = { ...(window.__lantern.client.state.frame as object), hud: h };
          client.onMessage({ type: "frame", tick: 301, advanced: false, frame, events: e, clock: { paused: true, rate: [1, 1] } });
        },
        [events, hud] as const,
      );
    await feedFrame([], { cap: CAP, spent: 100, stage: 0, cloud: true });
    await feedFrame([{ kind: "budget_stage", tick: 301, stage: 1, previous: 0, spent: 2_200_000, held: 0, cap: CAP }], { cap: CAP, spent: 2_200_000, stage: 1, cloud: true });
    const notes = page.getByTestId("game-note");
    await expect(notes.last()).toContainText("The strong model is off: 70% of the budget is spent or held.");
    await expect(notes.last()).toHaveAttribute("data-kind", "bad");
    await feedFrame([], { cap: CAP, spent: 2_200_000, stage: 1, cloud: false });
    await expect(notes.last()).toContainText("The cloud cannot be reached.");
    await lantern.setLang("zh");
    await expect(notes.last()).toContainText("连不上云端。");
  });

  test("has no budget to show in the demo world, and looks right in both themes", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await budget(page, { spent: 2_800_000, held: 100_000, cap: CAP, stage: 2, cloud: false, local: false });
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      const colours = await page.evaluate(() => {
        const note = getComputedStyle(document.querySelector(".budget-note") as Element);
        const card = getComputedStyle(document.querySelector('[data-testid="menu"]') as Element);
        return { text: note.color, card: card.backgroundColor };
      });
      expect(colours.text).not.toBe(colours.card);
      await expect(page.getByTestId("budget")).toBeVisible();
    }
    const demo = await lantern.page.context().newPage();
    await demo.goto(`${lantern.servers.app.origin}/?scenario=m0&map=off`);
    await demo.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 60_000 });
    await expect(demo.getByTestId("budget")).toHaveCount(0);
    await demo.close();
  });
});
