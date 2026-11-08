import { expect, test } from "@playwright/test";
import type { ModelRequest, ProviderId } from "../../src/shared/protocol.ts";
import { PROVIDERS } from "../../src/shared/providers.ts";
import { describeError, redact } from "../../src/shared/secrets.ts";
import { buildRequestBody, HOST_TIMEOUT_MS, type ModelOutcome, StreamingTransport } from "../../src/shared/transport.ts";
import { type MockServer, startMockServer } from "../support/mock-server.ts";

const KEY = "sk-unit-test-key-0123456789abcdef";
let mock: MockServer;
let other: MockServer;

test.beforeAll(async () => {
  mock = await startMockServer();
  other = await startMockServer();
});
test.afterAll(async () => {
  await mock.close();
  await other.close();
});
test.beforeEach(() => {
  mock.reset();
  other.reset();
});

const request = (id = "q1", tier = "cheap", maxTokens = 32): ModelRequest => ({
  request_id: id,
  tier,
  messages: [{ role: "user", content: "say hello" }],
  max_tokens: maxTokens,
});

function transport(provider: ProviderId | null, baseUrl?: string, key: string | undefined = KEY, model?: string): StreamingTransport {
  const t = new StreamingTransport();
  t.configure({ provider, key, baseUrl, model });
  return t;
}

async function waitFor(condition: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return condition();
}

test.describe("request bodies", () => {
  test("Bailian: qwen-flash and qwen-plus by tier, thinking off", () => {
    const spec = PROVIDERS.bailian;
    expect(buildRequestBody(spec, request("a", "cheap"))).toEqual({
      enable_thinking: false,
      model: "qwen-flash",
      messages: request().messages,
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(buildRequestBody(spec, request("a", "strong")).model).toBe("qwen-plus");
    expect(spec.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  test("DeepSeek: the current model names, thinking disabled", () => {
    const spec = PROVIDERS.deepseek;
    const cheap = buildRequestBody(spec, request("a", "cheap"));
    expect(cheap.model).toBe("deepseek-flash");
    expect(cheap.thinking).toEqual({ type: "disabled" });
    expect(buildRequestBody(spec, request("a", "strong")).model).toBe("deepseek-v4-pro");
    expect(spec.baseUrl).toBe("https://api.deepseek.com");
  });

  test("Ollama: one local model for both tiers, which the player can name", () => {
    const spec = PROVIDERS.ollama;
    expect(buildRequestBody(spec, request("a", "strong"), "llama3.2:3b").model).toBe("llama3.2:3b");
    expect(spec.baseUrl).toBe("http://localhost:11434/v1");
    expect(buildRequestBody(spec, request("a", "whatever")).model).toBe(spec.models.cheap);
  });
});

test.describe("StreamingTransport against the mock", () => {
  test("streams a reply and takes the usage from the last chunk", async () => {
    const call = transport("bailian", mock.baseUrl("ok")).start({ ...request(), interaction_id: "i-1", valid_if: [], reserve: { input_tokens: 9, output_tokens: 32 } });
    const outcome = await call.done;
    expect(outcome).toMatchObject({
      status: "ok",
      text: "Hello from the mock.",
      usage: { input_tokens: 11, output_tokens: 5 },
      usageReported: true,
    });
    expect(outcome.latency_ms).toBeGreaterThanOrEqual(0);
    expect(outcome.firstTokenMs).toBeDefined();

    const [post] = mock.posts();
    expect(mock.posts()).toHaveLength(1);
    expect(post?.path).toBe("/ok/v1/chat/completions");
    expect(post?.authorization).toBe(`Bearer ${KEY}`);
    expect(post?.body).toMatchObject({
      model: "qwen-flash",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 32,
      enable_thinking: false,
    });
    // What the core keeps for itself stays with the core.
    expect(Object.keys(post?.body ?? {}).sort()).toEqual(["enable_thinking", "max_tokens", "messages", "model", "stream", "stream_options"]);
  });

  test("a usage chunk that is cut in two writes still arrives whole", async () => {
    for (let i = 0; i < 5; i++) {
      const outcome = await transport("deepseek", mock.baseUrl("ok")).start(request(`q${i}`)).done;
      expect(outcome.usage).toEqual({ input_tokens: 11, output_tokens: 5 });
    }
  });

  test("a stream without usage ends ok with usage unknown, which the core books at the reservation", async () => {
    const outcome = await transport("bailian", mock.baseUrl("nousage")).start(request()).done;
    expect(outcome).toMatchObject({ status: "ok", text: "Hello from the mock.", usage: null, usageReported: false });
  });

  test("text with half a surrogate pair is made well formed, because the core refuses the other kind", async () => {
    const outcome = await transport("bailian", mock.baseUrl("surrogate")).start(request()).done;
    expect(outcome.status).toBe("ok");
    expect(outcome.text).toBe("ok \ufffd");
    expect(outcome.text.isWellFormed()).toBe(true);
  });

  test("sends the key to a provider that needs one and to no other", async () => {
    await transport("ollama", mock.baseUrl("ok"), KEY).start(request()).done;
    expect(mock.posts()[0]?.authorization).toBeUndefined();
    await transport("deepseek", mock.baseUrl("ok"), KEY).start(request()).done;
    expect(mock.posts()[1]?.authorization).toBe(`Bearer ${KEY}`);
  });

  test("a key set for one provider is not used for another", async () => {
    const t = new StreamingTransport();
    t.configure({ provider: "bailian", key: KEY, baseUrl: mock.baseUrl("ok") });
    t.configure({ provider: "deepseek", baseUrl: other.baseUrl("ok") });
    const outcome = await t.start(request()).done;
    expect(outcome).toMatchObject({ status: "error", code: "no_key" });
    expect(other.requests).toHaveLength(0);
    expect(mock.requests).toHaveLength(0);
    t.configure({ provider: "bailian", baseUrl: mock.baseUrl("ok") });
    expect((await t.start(request()).done).status).toBe("ok");
  });

  test("no provider and no key fail at once, without touching the network", async () => {
    const none = await transport(null).start(request()).done;
    expect(none).toMatchObject({ status: "error", code: "no_provider", text: "no_provider", usage: { input_tokens: 0, output_tokens: 0 } });
    const nokey = await transport("bailian", mock.baseUrl("ok"), "").start(request()).done;
    expect(nokey).toMatchObject({ status: "error", code: "no_key", usage: { input_tokens: 0, output_tokens: 0 } });
    expect(mock.requests).toHaveLength(0);
  });

  test("401, 429 and 5xx become error results with a short code, and a 4xx cost nothing while a 5xx is unknown", async () => {
    const cases: Array<[Parameters<MockServer["baseUrl"]>[0], string, number, unknown]> = [
      ["unauthorized", "http_401", 401, { input_tokens: 0, output_tokens: 0 }],
      ["ratelimit", "http_429", 429, { input_tokens: 0, output_tokens: 0 }],
      ["error500", "http_500", 500, null],
      ["error503", "http_503", 503, null],
    ];
    for (const [mode, code, status, usage] of cases) {
      const outcome = await transport("bailian", mock.baseUrl(mode)).start(request()).done;
      expect(outcome).toMatchObject({ status: "error", code, text: code, httpStatus: status, usage });
    }
  });

  test("reads Retry-After from a 429", async () => {
    const outcome = await transport("bailian", mock.baseUrl("ratelimit")).start(request()).done;
    expect(outcome.retryAfterMs).toBe(3000);
  });

  test("an error body that quotes the key does not reach the outcome", async () => {
    const outcome = await transport("bailian", mock.baseUrl("echo401")).start(request()).done;
    expect(outcome.status).toBe("error");
    expect(JSON.stringify(outcome)).not.toContain(KEY);
    expect(outcome.text).toBe("http_401");
  });

  test("a refused connection is a network error", async () => {
    const outcome = await transport("bailian", "http://127.0.0.1:1/v1").start(request()).done;
    expect(outcome).toMatchObject({ status: "error", code: "network", text: "network", usage: null });
  });

  test("a stream that ends without [DONE] or a finish is truncated, a torn connection is a network error, a line that is not JSON is bad", async () => {
    expect(await transport("bailian", mock.baseUrl("truncated")).start(request()).done).toMatchObject({ status: "error", code: "truncated" });
    expect(await transport("bailian", mock.baseUrl("reset")).start(request()).done).toMatchObject({ status: "error", code: "network" });
    expect(await transport("bailian", mock.baseUrl("malformed")).start(request()).done).toMatchObject({ status: "error", code: "bad_stream" });
  });

  test("the host timeout is 8 seconds", () => {
    expect(HOST_TIMEOUT_MS).toBe(8000);
  });

  test("a call that outlasts its timeout ends as a timeout and the connection is dropped", async () => {
    const started = Date.now();
    const outcome = await transport("bailian", mock.baseUrl("slow", { gap: 100, chunks: 100 })).start(request(), { timeoutMs: 300 }).done;
    expect(outcome.status).toBe("timeout");
    expect(outcome.text).toBe("");
    expect(outcome.usage).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await waitFor(() => mock.posts()[0]?.aborted === true)).toBe(true);
  });

  test("a timeout before any response also ends as a timeout", async () => {
    const outcome = await transport("bailian", mock.baseUrl("hang")).start(request(), { timeoutMs: 200 }).done;
    expect(outcome.status).toBe("timeout");
  });

  test("an abort ends the call as cancelled and the connection is dropped", async () => {
    const call = transport("bailian", mock.baseUrl("slow", { gap: 100, chunks: 100 })).start(request());
    await new Promise((r) => setTimeout(r, 250));
    call.abort("cancel");
    const outcome = await call.done;
    expect(outcome.status).toBe("cancelled");
    expect(outcome.usage).toBeNull();
    expect(await waitFor(() => mock.posts()[0]?.aborted === true)).toBe(true);
  });

  test("an abort before the response, and one after the end, behave", async () => {
    const early = transport("bailian", mock.baseUrl("hang")).start(request());
    early.abort("cancel");
    expect((await early.done).status).toBe("cancelled");

    const call = transport("bailian", mock.baseUrl("ok")).start(request());
    const outcome = await call.done;
    call.abort("cancel");
    expect(outcome.status).toBe("ok");
  });

  test("a redirect is refused, so the key cannot follow it to another origin", async () => {
    mock.setRedirectTarget(other.origin);
    const outcome = await transport("bailian", mock.baseUrl("redirect")).start(request()).done;
    expect(outcome).toMatchObject({ status: "error", code: "network" });
    expect(other.requests).toHaveLength(0);
  });

  test("calls run side by side and end independently", async () => {
    const t = transport("bailian", mock.baseUrl("ok"));
    const outcomes: ModelOutcome[] = await Promise.all([1, 2, 3, 4].map((i) => t.start(request(`p${i}`)).done));
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(mock.posts()).toHaveLength(4);
  });
});

test.describe("secrets", () => {
  test("a key that was set is scrubbed from text, from errors, and stays scrubbed after it is cleared", () => {
    const t = new StreamingTransport();
    t.configure({ provider: "bailian", key: KEY });
    expect(redact(`header Bearer ${KEY} sent`)).toBe("header Bearer [key] sent");
    expect(describeError(new Error(`failed with ${KEY}`))).toBe("Error: failed with [key]");
    t.configure({ provider: "bailian", key: "" });
    expect(redact(`still ${KEY}`)).toBe("still [key]");
  });

  test("short strings are left alone", () => {
    const t = new StreamingTransport();
    t.configure({ provider: "bailian", key: "abc" });
    expect(redact("abc def")).toBe("abc def");
  });
});
