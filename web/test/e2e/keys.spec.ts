import { randomBytes } from "node:crypto";
import { expect, type LanternPage, test } from "../support/fixtures.ts";

const newKey = (): string => `sk-fake-${randomBytes(18).toString("hex")}`;

/** Every place the key could have been left, as text, for a search. */
async function everywhere(lantern: LanternPage): Promise<Record<string, string>> {
  const dump = await lantern.storageDump();
  return {
    localStorage: dump.localStorage,
    sessionStorage: dump.sessionStorage,
    indexedDB: dump.indexedDB,
    cacheStorage: dump.caches,
    cookies: dump.cookies,
    exportedFile: await lantern.downloadExport(),
    exportedViaApi: JSON.stringify(await lantern.exportReplay()),
    console: lantern.consoleLines.join("\n"),
    pageErrors: lantern.pageErrors.join("\n"),
    html: await lantern.page.content(),
    url: lantern.page.url(),
    passwordFieldValue: await lantern.page.getByTestId("input-key").inputValue().catch(() => ""),
  };
}

test.describe("key hygiene", () => {
  test("a key typed into the page reaches the chosen provider and nothing else", async ({ lantern, servers }) => {
    const page = lantern.page;
    const { mock } = servers;
    const key = newKey();
    // Applying a key from the page also resets the test-only base URL to the provider's real
    // one, so the world stays paused until the mock is in place. Otherwise a request the core
    // makes in between would go to the real provider. The host holds it after its first tick, as
    // the pause button would, so that the test does not race the world to the button.
    await lantern.open("pace=20&seed=9&until=1");
    await expect(page.getByTestId("status")).toHaveText("paused");

    // Through the page, as a player does it. "Remember" is off unless it is ticked.
    await page.getByTestId("select-provider").selectOption("bailian");
    await expect(page.getByTestId("chk-remember")).not.toBeChecked();
    await page.getByTestId("input-key").fill(key);
    await page.getByTestId("btn-apply").click();
    await expect(page.getByTestId("key-state")).toHaveText("key held");
    await expect(page.getByTestId("input-key")).toHaveValue("");
    await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("ok") });
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).not.toHaveText("paused");

    // Every way a call can end, several with a body or an error that quotes the key.
    const outcomes = [
      await lantern.request("h-ok"),
      await (async () => {
        await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("echo401") });
        return lantern.request("h-401");
      })(),
      await (async () => {
        await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("ratelimit") });
        return lantern.request("h-429");
      })(),
      await (async () => {
        await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("error500") });
        return lantern.request("h-500");
      })(),
      await (async () => {
        await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("slow", { gap: 100, chunks: 100 }) });
        return lantern.request("h-timeout", { timeoutMs: 400 });
      })(),
      await (async () => {
        await lantern.configure({ provider: "bailian", baseUrl: "http://127.0.0.1:1/v1" });
        return lantern.request("h-network");
      })(),
    ];
    expect(outcomes.map((o) => o.status)).toEqual(["ok", "error", "error", "error", "timeout", "error"]);
    // An error line from the worker's own logger, the way a failure path would write one.
    await lantern.e2e("log-probe", { text: `the request with ${key} failed` });

    // The game runs on, and is saved and exported.
    await lantern.waitForTick(600);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toContainText("saved #1");

    // The scan is not empty: the key did reach the provider, and the logs have lines.
    expect(mock.posts().filter((p) => p.authorization === `Bearer ${key}`).length).toBeGreaterThanOrEqual(5);
    const places = await everywhere(lantern);
    expect(places.console).toContain("[host]");
    expect(places.console).toContain("the request with [key] failed");
    expect(places.indexedDB).toContain("records");
    expect(places.exportedFile).toContain('"records"');

    for (const [place, text] of Object.entries(places)) {
      expect(text, place).not.toContain(key);
    }
    expect(places.localStorage).not.toContain("lantern.remembered");

    // On the network it went to the mock and only there, in the Authorization header of POSTs.
    const keyed = lantern.network.filter((n) => JSON.stringify(n).includes(key));
    expect(keyed.length).toBeGreaterThanOrEqual(5);
    for (const request of keyed) {
      expect(request.origin).toBe(mock.origin);
      expect(request.authorization).toBe(`Bearer ${key}`);
      expect(request.method).toBe("POST");
    }
    expect(lantern.network.filter((n) => n.origin === servers.app.origin && n.authorization !== undefined)).toEqual([]);
    expect((await lantern.snapshot()).error).toBeNull();
  });

  test("with remember ticked the key is in localStorage and only there, and it survives a reload", async ({ lantern, servers }) => {
    const page = lantern.page;
    const { mock } = servers;
    const key = newKey();
    await lantern.open("pace=20&seed=10&until=300");
    await page.getByTestId("select-provider").selectOption("deepseek");
    await page.getByTestId("chk-remember").check();
    await page.getByTestId("input-key").fill(key);
    await page.getByTestId("btn-apply").click();
    await expect(page.getByTestId("key-state")).toHaveText("key held");
    await lantern.configure({ provider: "deepseek", baseUrl: mock.baseUrl("ok") });
    expect((await lantern.request("r-1")).status).toBe("ok");
    await lantern.waitForTick(300);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toContainText("saved #1");

    const places = await everywhere(lantern);
    expect(places.localStorage).toContain(key);
    expect(places.localStorage).toContain("deepseek");
    for (const [place, text] of Object.entries(places)) {
      if (place !== "localStorage") expect(text, place).not.toContain(key);
    }

    // A new page picks it up and applies it, with the provider it was remembered for.
    await lantern.open("pace=20&seed=11");
    await expect(page.getByTestId("select-provider")).toHaveValue("deepseek");
    await expect(page.getByTestId("chk-remember")).toBeChecked();
    await expect(page.getByTestId("key-state")).toHaveText("key held");
    await lantern.configure({ provider: "deepseek", baseUrl: mock.baseUrl("ok") });
    expect((await lantern.request("r-2")).status).toBe("ok");
    // The world in the new page is running with a provider, so its own requests go out as well.
    // Every one of them carries the remembered key, and the first session's call and ours are among them.
    const posts = mock.posts();
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.every((p) => p.authorization === `Bearer ${key}`)).toBe(true);

    // Unticking forgets it at once.
    await page.getByTestId("chk-remember").uncheck();
    expect((await lantern.storageDump()).localStorage).not.toContain(key);
  });

  test("clearing the key removes it from the worker and from localStorage", async ({ lantern, servers }) => {
    const page = lantern.page;
    const key = newKey();
    await lantern.open("pace=1&seed=12");
    await page.getByTestId("select-provider").selectOption("bailian");
    await page.getByTestId("chk-remember").check();
    await page.getByTestId("input-key").fill(key);
    await page.getByTestId("btn-apply").click();
    await expect(page.getByTestId("key-state")).toHaveText("key held");
    expect((await lantern.storageDump()).localStorage).toContain(key);

    await page.getByTestId("btn-clear-key").click();
    await expect(page.getByTestId("key-state")).toHaveText("no key");
    expect((await lantern.storageDump()).localStorage).not.toContain(key);
    await lantern.configure({ provider: "bailian", baseUrl: servers.mock.baseUrl("ok") });
    expect(await lantern.request("c-1")).toMatchObject({ status: "error", code: "no_key" });
    expect(servers.mock.requests).toHaveLength(0);
  });
});
