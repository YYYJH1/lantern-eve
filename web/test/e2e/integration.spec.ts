import { expect, replayInCpython, test } from "../support/fixtures.ts";

test("the requests the core makes go through the streaming transport and come back as inputs", async ({ lantern, servers }) => {
  test.setTimeout(120_000);
  const page = lantern.page;
  const { mock } = servers;
  const key = "sk-fake-integration-5a1d9c3e7b2f4086";
  // Paused at tick 0 until the provider is set, so that the first requests already have somewhere to go.
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  });
  await lantern.open("pace=20&seed=4&until=900");
  await lantern.configure({ provider: "bailian", key, baseUrl: mock.baseUrl("ok") });
  await lantern.setVisibility("visible");
  await lantern.waitForTick(900);
  await expect(page.getByTestId("status")).toHaveText("paused");
  await expect.poll(async () => (await lantern.snapshot()).stats?.models.inflight).toBe(0);

  const replay = await lantern.exportReplay();
  const results = replay.records.filter((r) => r[2] === "model_result");
  const stats = (await lantern.snapshot()).stats;
  expect(stats).not.toBeNull();
  const models = stats?.models;
  console.log(`integration: ${models?.started} requests, ${models?.ok} ok, ${models?.cancelled} cancelled, ${models?.error} error, ${models?.timeout} timeout, ${models?.cancelUnknown} cancels for finished calls`);

  // Exactly one result for each request, whatever became of it.
  expect(new Set(results.map((r) => r[3].request_id)).size).toBe(results.length);
  expect(results.length).toBe(models?.started);
  expect(models?.started ?? 0).toBeGreaterThan(0);
  expect(models?.ok ?? 0).toBeGreaterThan(0);

  // What came back is what the mock streamed, in the shape the core takes.
  for (const [, , , body] of results) {
    expect(typeof body.latency_ms).toBe("number");
    expect(Number.isInteger(body.latency_ms)).toBe(true);
    if (body.status === "ok") {
      expect(body).toMatchObject({ text: "Hello from the mock.", usage: { input_tokens: 11, output_tokens: 5 } });
    } else {
      expect(["cancelled", "timeout", "error"]).toContain(body.status);
      expect(body.text === "" || typeof body.text === "string").toBe(true);
    }
  }

  // What went out is what the core asked for: messages, a token limit, a model of its tier.
  // A call that the core cancelled at once can be aborted before its request reaches the mock, so the mock
  // has received every call that was not cancelled, and no more than were started.
  const posts = mock.posts();
  expect(posts.length).toBeLessThanOrEqual(models?.started ?? 0);
  expect(posts.length).toBeGreaterThanOrEqual((models?.started ?? 0) - (models?.cancelled ?? 0));
  for (const post of posts) {
    expect(post.authorization).toBe(`Bearer ${key}`);
    expect(["qwen-flash", "qwen-plus"]).toContain(post.body?.model);
    expect(post.body).toMatchObject({ stream: true, stream_options: { include_usage: true }, enable_thinking: false });
    const messages = post.body?.messages as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect(["system", "user", "assistant"]).toContain(m.role);
    expect(post.body?.max_tokens).toBeGreaterThanOrEqual(1);
  }

  // The tape, with the model's answers on it, replays in CPython to the same hashes.
  const cpython = replayInCpython(replay, "integration");
  expect(cpython).toMatchObject({ ok: true, final_tick: 900, final_hash: replay.final.hash, mismatches: [], checkpoints_missing: [] });
  expect(cpython.requests_emitted).toBe(models?.started);
});
