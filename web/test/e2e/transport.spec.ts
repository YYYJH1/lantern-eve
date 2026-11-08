import { expect, test } from "../support/fixtures.ts";
import { startMockServer } from "../support/mock-server.ts";

const KEY = "sk-e2e-transport-key-4f9a1c7e2b6d8035";

async function until(condition: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return condition();
}

test.describe("the model transport, from the page's worker, against the mock", () => {
  test.beforeEach(async ({ lantern }) => {
    // Paused: these tests are about the transport, so the world has nothing to do.
    await lantern.open("pace=1&seed=5");
    await lantern.page.getByTestId("btn-pause").click();
  });

  test("streams a reply across origins: the preflight allows Authorization, the usage comes from the last chunk", async ({ lantern, servers }) => {
    const { mock, app } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("ok") });
    const outcome = await lantern.request("c1", { maxTokens: 24 });
    expect(outcome).toMatchObject({ status: "ok", text: "Hello from the mock.", usage: { input_tokens: 11, output_tokens: 5 }, usageReported: true });
    expect(outcome.latency_ms).toBeGreaterThan(0);

    const preflight = mock.preflights()[0];
    expect(preflight?.origin).toBe(app.origin);
    expect(preflight?.accessControlRequestHeaders?.split(",").map((h) => h.trim().toLowerCase()).sort()).toEqual(expect.arrayContaining(["authorization", "content-type"]));
    const post = mock.posts()[0];
    expect(post?.origin).toBe(app.origin);
    expect(post?.authorization).toBe(`Bearer ${KEY}`);
    expect(post?.path).toBe("/ok/v1/chat/completions");
    expect(post?.body).toMatchObject({ model: "qwen-flash", stream: true, stream_options: { include_usage: true }, max_tokens: 24, enable_thinking: false });
    expect((preflight?.id ?? 0) < (post?.id ?? 0)).toBe(true);
  });

  test("each provider sends its own model names and its own switch for thinking", async ({ lantern, servers }) => {
    const { mock } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("ok") });
    await lantern.request("b-cheap", { tier: "cheap" });
    await lantern.request("b-strong", { tier: "strong" });
    await lantern.configure({ provider: "deepseek", key: KEY, baseUrl: mock.baseUrl("ok") });
    await lantern.request("d-cheap", { tier: "cheap" });
    await lantern.request("d-strong", { tier: "strong" });
    await lantern.configure({ provider: "ollama", model: "llama3.2:3b", baseUrl: mock.baseUrl("ok") });
    await lantern.request("o-strong", { tier: "strong" });
    const bodies = mock.posts().map((p) => p.body);
    expect(bodies.map((b) => b?.model)).toEqual(["qwen-flash", "qwen-plus", "deepseek-flash", "deepseek-v4-pro", "llama3.2:3b"]);
    expect(bodies[0]?.enable_thinking).toBe(false);
    expect(bodies[2]?.thinking).toEqual({ type: "disabled" });
    expect(bodies[4]?.reasoning_effort).toBe("none");
    expect(bodies[4]).not.toHaveProperty("thinking");
    expect(bodies[4]).not.toHaveProperty("enable_thinking");
  });

  test("401, 429, 500 and 503 come back as error results with a short code", async ({ lantern, servers }) => {
    const { mock } = servers;
    const cases = [
      ["unauthorized", "http_401"],
      ["ratelimit", "http_429"],
      ["error500", "http_500"],
      ["error503", "http_503"],
    ] as const;
    for (const [mode, code] of cases) {
      await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl(mode) });
      const outcome = await lantern.request(`e-${mode}`);
      expect(outcome).toMatchObject({ status: "error", code, text: code });
    }
    // Retry-After is readable across origins because the provider exposes it.
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("ratelimit") });
    expect((await lantern.request("e-retry")).retryAfterMs).toBe(3000);
  });

  test("a refused connection and a stream that is torn down are network errors", async ({ lantern, servers }) => {
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: "http://127.0.0.1:1/v1" });
    expect(await lantern.request("n-1")).toMatchObject({ status: "error", code: "network" });
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: servers.mock.baseUrl("reset") });
    expect(await lantern.request("n-2")).toMatchObject({ status: "error", code: "network" });
  });

  test("a call that outlasts its timeout is reported as a timeout and the connection is dropped", async ({ lantern, servers }) => {
    const { mock } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("slow", { gap: 150, chunks: 200 }) });
    const started = Date.now();
    const outcome = await lantern.request("t-1", { timeoutMs: 600 });
    expect(outcome).toMatchObject({ status: "timeout", text: "", usage: null });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await until(() => mock.posts()[0]?.aborted === true)).toBe(true);
  });

  test("the host timeout is 8 seconds", async ({ lantern, servers }) => {
    test.setTimeout(60_000);
    const { mock } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("slow", { gap: 400, chunks: 100 }) });
    const started = Date.now();
    const outcome = await lantern.request("t-8");
    const took = Date.now() - started;
    expect(outcome.status).toBe("timeout");
    expect(outcome.latency_ms).toBeGreaterThanOrEqual(7900);
    expect(outcome.latency_ms).toBeLessThan(9500);
    expect(took).toBeLessThan(10_500);
    expect(await until(() => mock.posts()[0]?.aborted === true)).toBe(true);
  });

  test("an abort, as the core's cancels ask for, ends a running call as cancelled and drops the connection", async ({ lantern, servers }) => {
    const { mock } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("slow", { gap: 100, chunks: 200 }) });
    const pending = lantern.request("a-1");
    expect(await until(() => mock.posts().length === 1)).toBe(true);
    await lantern.page.waitForTimeout(250);
    await lantern.e2e("cancel", { ids: ["a-1"] });
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: "cancelled", text: "", usage: null });
    expect(outcome.latency_ms).toBeLessThan(2000);
    expect(await until(() => mock.posts()[0]?.aborted === true)).toBe(true);
  });

  test("calls are independent: one is aborted while another finishes", async ({ lantern, servers }) => {
    const { mock } = servers;
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("slow", { gap: 100, chunks: 8 }) });
    const slow = lantern.request("i-slow");
    const doomed = lantern.request("i-doomed");
    expect(await until(() => mock.posts().length === 2)).toBe(true);
    await lantern.e2e("cancel", { ids: ["i-doomed"] });
    expect((await doomed).status).toBe("cancelled");
    expect((await slow).status).toBe("ok");
  });

  test("Ollama: an origin that is not on the allow list is refused, an allowed one is served", async ({ lantern, servers }) => {
    const { mock, app } = servers;
    await lantern.configure({ provider: "ollama", model: "qwen3:4b", baseUrl: mock.baseUrl("ollama") });

    mock.allowOllamaOrigins([]);
    const refused = await lantern.request("o-1");
    // The browser reports a refused CORS check as a failed fetch, with no detail, so this is a network error.
    expect(refused).toMatchObject({ status: "error", code: "network" });
    expect(mock.preflights().map((r) => r.status)).toEqual([403]);
    expect(mock.posts()).toHaveLength(0);

    mock.allowOllamaOrigins([app.origin]);
    const served = await lantern.request("o-2");
    expect(served).toMatchObject({ status: "ok", text: "Hello from the mock." });
    expect(mock.posts()).toHaveLength(1);
    expect(mock.posts()[0]?.origin).toBe(app.origin);
    expect(mock.posts()[0]?.body?.model).toBe("qwen3:4b");
    // No key was involved, and none is sent to a local server.
    expect(mock.posts()[0]?.authorization).toBeUndefined();
  });

  test("a key goes to the provider that was chosen and to no other, and a redirect cannot carry it away", async ({ lantern, servers }) => {
    const { mock, mock2 } = servers;
    // A key for Bailian, which points at the first server.
    await lantern.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("ok") });
    expect((await lantern.request("k-1")).status).toBe("ok");
    expect(mock.posts().map((p) => p.authorization)).toEqual([`Bearer ${KEY}`]);

    // DeepSeek was chosen, which has no key yet: nothing is sent anywhere, and Bailian's key is not borrowed.
    await lantern.configure({ provider: "deepseek", baseUrl: mock2.baseUrl("ok") });
    expect(await lantern.request("k-2")).toMatchObject({ status: "error", code: "no_key" });
    expect(mock2.requests).toHaveLength(0);
    expect(mock.posts()).toHaveLength(1);

    // Its own key goes to its own server only.
    const other = "sk-e2e-other-provider-9d3b6a5c1e7f2048";
    await lantern.configure({ provider: "deepseek", key: other, baseUrl: mock2.baseUrl("ok") });
    expect((await lantern.request("k-3")).status).toBe("ok");
    expect(mock2.posts().map((p) => p.authorization)).toEqual([`Bearer ${other}`]);
    expect(mock.posts()).toHaveLength(1);

    // A server that answers with a redirect to another origin gets no second request there.
    mock.setRedirectTarget(mock2.origin);
    await lantern.configure({ provider: "bailian", baseUrl: mock.baseUrl("redirect") });
    expect(await lantern.request("k-4")).toMatchObject({ status: "error", code: "network" });
    expect(mock2.posts()).toHaveLength(1);

    // Everything the page's own network log saw carrying a key went to the server it was meant for.
    const keyed = lantern.network.filter((n) => n.authorization !== undefined);
    for (const request of keyed) {
      expect(request.authorization === `Bearer ${KEY}` ? request.origin === mock.origin : request.origin === mock2.origin).toBe(true);
    }
    expect(keyed.length).toBe(3);
  });

  test("no provider means no call: the result is an error at once and nothing is sent", async ({ lantern, servers }) => {
    await lantern.configure({ provider: null });
    expect(await lantern.request("z-1")).toMatchObject({ status: "error", code: "no_provider", text: "no_provider" });
    expect(servers.mock.requests).toHaveLength(0);
    expect(lantern.network.filter((n) => n.origin !== servers.app.origin)).toEqual([]);
  });

  test("an origin that the policy does not list cannot be reached at all", async ({ lantern }) => {
    const stranger = await startMockServer();
    try {
      await lantern.configure({ provider: "bailian", key: KEY, baseUrl: stranger.baseUrl("ok") });
      expect(await lantern.request("p-1")).toMatchObject({ status: "error", code: "network" });
      // Blocked before the network: the server saw not even a preflight.
      expect(stranger.requests).toHaveLength(0);
      await expect.poll(async () => (await lantern.snapshot()).cspViolations.map((v) => v.directive)).toContain("connect-src");
    } finally {
      await stranger.close();
    }
  });
});
