import type { Page } from "@playwright/test";
import type { ModelCallRecord } from "../../src/shared/protocol.ts";
import { expect, test } from "../support/fixtures.ts";

const TOWN = "scenario=bridge&seed=7&pace=60&until=300";

/** Gives the page a message as if the host had sent it. The views cannot tell the difference. */
async function feed(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate((m) => (window.__lantern.client as unknown as { onMessage(m: unknown): void }).onMessage(m), message);
}

const base: ModelCallRecord = {
  id: "",
  tick: 0,
  category: "reply",
  asked: "cheap",
  tier: "cheap",
  reason: null,
  model: "qwen-flash",
  hold: 196,
  status: "ok",
  code: null,
  latency_ms: 842,
  usage: { input_tokens: 50, output_tokens: 20 },
  cost: 70,
  settled: 0,
  late: false,
  voided: null,
};

/** One of each kind of call, oldest first, as the host sends them. */
const CALLS: ModelCallRecord[] = [
  { ...base, id: "r10-0", tick: 10, settled: 14 },
  { ...base, id: "r20-0", tick: 20, category: "director", asked: "strong", tier: "cheap", reason: "budget", status: "timeout", usage: null, latency_ms: 8000, cost: 196, settled: 28 },
  { ...base, id: "r30-0", tick: 30, category: "paper", asked: "cheap", tier: "template", reason: "cloud_down", model: null, hold: 0, status: "template", usage: null, latency_ms: null, cost: 0, settled: 30 },
  { ...base, id: "r40-0", tick: 40, category: "prefetch", status: "error", code: "http_429", usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 120, cost: 0, settled: 41 },
  { ...base, id: "r50-0", tick: 50, category: "reflection", status: "cancelled", voided: "cancelled", usage: null, latency_ms: 300, cost: 196, settled: 52 },
  { ...base, id: "r60-0", tick: 60, asked: "strong", tier: "strong", hold: 980, status: "pending", usage: null, latency_ms: null, cost: null, settled: null },
  { ...base, id: "r70-0", tick: 70, status: "timeout", usage: null, latency_ms: 8000, cost: 196, settled: 79, late: true },
];
/** What the core booked for them: the sum of what the settled ones cost. */
const BOOKED = 70 + 196 + 0 + 0 + 196 + 196;

test.describe("the model call log", () => {
  test("lists the calls the browser host makes, with the model of the tier, the outcome and the time each took", async ({ lantern, servers }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    const key = "sk-fake-calllog-5a1d9c3e7b2f4086";
    // Paused at tick 0 until the provider is set, so that the first requests already have somewhere to go.
    await page.addInitScript(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    });
    await lantern.open("pace=20&seed=4&until=600");
    await expect(page.getByTestId("calls-empty")).toHaveText("No model has been called yet.");
    await lantern.configure({ provider: "bailian", key, baseUrl: servers.mock.baseUrl("ok") });
    await lantern.setVisibility("visible");
    await lantern.waitForTick(600);
    await expect.poll(async () => (await lantern.snapshot()).stats?.models.inflight).toBe(0);

    const started = (await lantern.snapshot()).stats?.models.started ?? 0;
    expect(started).toBeGreaterThan(2);
    await expect(page.getByTestId("calls-total")).toHaveText(String(started));
    await expect(page.getByTestId("call")).toHaveCount(started);
    const ok = page.locator('[data-testid="call"][data-status="ok"]').first();
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("chatter");
    await expect(ok).toContainText("cheap");
    await expect(ok).toContainText("qwen-flash");
    await expect(ok).toContainText(/\d+ ms/);
    await expect(ok).toContainText("11 in, 5 out");
    await expect(ok).toHaveAttribute("data-asked", "cheap");
    // Newest first: the ticks go down the list.
    const ticks = await page.getByTestId("call").evaluateAll((rows) => rows.map((r) => Number(/tick (\d+)/.exec(r.textContent ?? "")?.[1])));
    expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
    // The demo world has no prices: nothing is said about money, and the page did not break.
    await expect(page.getByTestId("calls-booked")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);

    await lantern.setLang("zh");
    await expect(ok).toContainText("闲聊");
    await expect(ok).toContainText("便宜档");
    await expect(ok).toContainText("毫秒");
    await expect(ok).toContainText("输入 11，输出 5");
    await expect(page.locator('[data-testid="call"][data-status="ok"] .call-status').first()).toHaveText("成功");
  });

  test("says for each call what was asked, what answered, how it ended, what was held and what was charged, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN);
    await lantern.waitForTick(300);
    await expect(page.getByTestId("calls-empty")).toBeVisible();

    await feed(page, { type: "model-calls", replace: false, calls: CALLS });
    await page.evaluate((spent) => window.__lantern.inject({ hud: { spent, held: 980, cap: 3_000_000, stage: 0, cloud: true, local: false } }), BOOKED);
    await expect(page.getByTestId("calls-total")).toHaveText("7");
    await expect(page.getByTestId("call")).toHaveCount(7);
    await expect(page.getByTestId("call").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")))).resolves.toEqual(["r70-0", "r60-0", "r50-0", "r40-0", "r30-0", "r20-0", "r10-0"]);

    const row = (id: string) => page.locator(`[data-testid="call"][data-id="${id}"]`);
    // Asked on the strong tier, went out on the cheap one because of the budget, and never came back.
    await expect(row("r20-0").locator(".call-asked")).toHaveText("strong");
    await expect(row("r20-0").locator(".call-given")).toHaveText("cheap");
    await expect(row("r20-0")).toContainText("director");
    await expect(row("r20-0")).toContainText("timed out");
    await expect(row("r20-0")).toContainText("8000 ms");
    await expect(row("r20-0")).toContainText("Moved down: the budget is running out.");
    await expect(row("r20-0")).toContainText("held ¥0.000196");
    await expect(row("r20-0")).toContainText("charged ¥0.000196");
    // A request the gate turned into a script line never went out.
    await expect(row("r30-0").locator(".call-given")).toHaveText("script line");
    await expect(row("r30-0")).toContainText("not sent");
    await expect(row("r30-0")).toContainText("Moved down: the cloud could not be reached.");
    await expect(row("r30-0")).toContainText("no model");
    await expect(row("r30-0")).toContainText("Town Gazette");
    // An error shows its code. A call in flight shows what is held for it and nothing charged.
    await expect(row("r40-0")).toContainText("http_429");
    await expect(row("r60-0")).toContainText("in flight");
    await expect(row("r60-0")).toContainText("held ¥0.00098");
    await expect(row("r60-0")).not.toContainText("charged");
    // An answer the game dropped, and one that came late.
    await expect(row("r50-0")).toContainText("The game had cancelled the call, so the answer was not used.");
    await expect(row("r70-0")).toContainText("The answer came late. It was not charged again.");
    await expect(row("r10-0")).toContainText("50 in, 20 out");
    await expect(row("r10-0")).toContainText("charged ¥0.00007");
    await expect(row("r10-0")).toHaveAttribute("data-status", "ok");

    // The figures add up to what the core says the game has spent.
    await expect(page.getByTestId("calls-count")).toHaveText("7");
    await expect(page.getByTestId("calls-pending")).toHaveText("1");
    await expect(page.getByTestId("calls-lines")).toHaveText("1");
    await expect(page.getByTestId("calls-moved")).toHaveText("2");
    await expect(page.getByTestId("calls-booked")).toHaveText("¥0.000658");
    await expect(page.getByTestId("calls-spent")).toHaveText("¥0.000658");
    await expect(page.getByTestId("calls-held")).toHaveText("¥0.00098");
    await expect(page.getByTestId("calls-earlier")).toHaveCount(0);
    // Money spent before the list began (a page that came back to a game) is said, so that the two figures reconcile.
    await page.evaluate((spent) => window.__lantern.inject({ hud: { spent: spent + 30_000, held: 980, cap: 3_000_000, stage: 0 } }), BOOKED);
    await expect(page.getByTestId("calls-earlier")).toHaveText("¥0.03");

    await lantern.setLang("zh");
    await expect(page.getByTestId("calls").locator("summary")).toContainText("模型调用记录");
    await expect(row("r20-0").locator(".call-asked")).toHaveText("强档");
    await expect(row("r20-0").locator(".call-given")).toHaveText("便宜档");
    await expect(row("r20-0")).toContainText("导演");
    await expect(row("r20-0")).toContainText("超时");
    await expect(row("r20-0")).toContainText("预算快用完了，降了档。");
    await expect(row("r20-0")).toContainText("预留 ¥0.000196");
    await expect(row("r20-0")).toContainText("扣费 ¥0.000196");
    await expect(row("r30-0")).toContainText("台词库");
    await expect(row("r30-0")).toContainText("未发出");
    await expect(row("r30-0")).toContainText("连不上云端，降了档。");
    await expect(row("r30-0")).toContainText("无模型");
    await expect(row("r40-0")).toContainText("预取");
    await expect(row("r50-0")).toContainText("反思");
    await expect(row("r50-0")).toContainText("游戏已经取消了这次调用，答复没用上。");
    await expect(row("r70-0")).toContainText("答复来得太晚，没有再扣一次钱。");
    await expect(row("r60-0")).toContainText("第 60 拍");
    await expect(page.getByTestId("calls-moved").locator("..")).toContainText("已降档");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the newest calls in the list, counts all of them, and starts over with a new game", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN);
    await lantern.waitForTick(300);
    const many = Array.from({ length: 230 }, (_, i): ModelCallRecord => ({ ...base, id: `c${i}`, tick: i, cost: 1, settled: i }));
    await feed(page, { type: "model-calls", replace: true, calls: many });
    await expect(page.getByTestId("call")).toHaveCount(200);
    await expect(page.getByTestId("calls-total")).toHaveText("230");
    await expect(page.getByTestId("call").first()).toHaveAttribute("data-id", "c229");
    await expect(page.getByTestId("call").last()).toHaveAttribute("data-id", "c30");
    await expect(page.getByTestId("calls-cap")).toHaveText("Only the newest 200 calls are listed. The figures above count them all.");
    await expect(page.getByTestId("calls-booked")).toHaveText("¥0.00023");
    // A call that was heard of before changes where it stands.
    await feed(page, { type: "model-calls", replace: false, calls: [{ ...many[229], status: "timeout", late: true }] });
    await expect(page.getByTestId("call").first()).toHaveAttribute("data-status", "timeout");
    await expect(page.getByTestId("call")).toHaveCount(200);
    await page.getByTestId("btn-new").click();
    await expect(page.getByTestId("calls-empty")).toBeVisible();
    await expect(page.getByTestId("call")).toHaveCount(0);
  });

  test("looks right in the light theme and in the dark one: the rows are readable and the list scrolls inside the drawer", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN);
    await lantern.waitForTick(300);
    await feed(page, { type: "model-calls", replace: true, calls: CALLS });
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      const colours = await page.getByTestId("call").evaluateAll((rows) =>
        rows.map((r) => {
          const style = getComputedStyle(r.querySelector(".call-status") as Element);
          return { background: getComputedStyle(r.closest("ol") as Element).backgroundColor, status: style.color };
        }),
      );
      for (const c of colours) expect(c.background).not.toBe(c.status);
      const box = await page.getByTestId("calls-list").boundingBox();
      const drawer = await page.getByTestId("menu").boundingBox();
      expect(box).not.toBeNull();
      expect(drawer).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((drawer?.x ?? 0) + (drawer?.width ?? 0) + 1);
    }
  });
});
