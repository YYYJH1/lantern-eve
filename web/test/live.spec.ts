import { isProviderId } from "../src/shared/providers.ts";
import { expect, test } from "./support/fixtures.ts";

// Not part of the regular suite. It runs against a real provider, so it is skipped unless both
// variables are set:
//
//   LANTERN_LIVE_PROVIDER   bailian, deepseek or ollama
//   LANTERN_LIVE_KEY        the provider's key (any text for ollama, which takes none)
//   LANTERN_LIVE_MODEL      optional, ollama only: the local model name
//
// It sends at most three streaming requests of the cheap tier, each with max_tokens of 32 or less,
// from the page's worker to the provider, and prints the status, the latency and the token counts of
// each. It prints nothing else of the exchange, and never the key.
const provider = process.env.LANTERN_LIVE_PROVIDER;
const key = process.env.LANTERN_LIVE_KEY;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(provider === undefined || provider === "" || key === undefined || key === "", "set LANTERN_LIVE_PROVIDER and LANTERN_LIVE_KEY to run this");

const REQUESTS = 3;
const MAX_TOKENS = 16;

test(`${REQUESTS} streaming requests to the real provider`, async ({ lantern }) => {
  test.setTimeout(180_000);
  if (!isProviderId(provider) || key === undefined) throw new Error("LANTERN_LIVE_PROVIDER must be bailian, deepseek or ollama");
  const scrub = (text: string): string => text.split(key).join("[key]");
  try {
    await lantern.open("pace=1&seed=1");
    await lantern.page.getByTestId("btn-pause").click();
    await lantern.configure({ provider, key, model: provider === "ollama" ? process.env.LANTERN_LIVE_MODEL : undefined });

    const summary: Array<Record<string, unknown>> = [];
    for (let i = 0; i < REQUESTS; i++) {
      const outcome = await lantern.request(`live-${i}`, { tier: "cheap", maxTokens: MAX_TOKENS, timeoutMs: 30_000 });
      const line = {
        provider,
        request: i + 1,
        status: outcome.status,
        code: outcome.code,
        latency_ms: outcome.latency_ms,
        first_token_ms: outcome.firstTokenMs === undefined ? undefined : Math.round(outcome.firstTokenMs),
        input_tokens: outcome.usage?.input_tokens,
        output_tokens: outcome.usage?.output_tokens,
        usage_reported: outcome.usageReported,
      };
      summary.push(line);
      console.log(JSON.stringify(line));
      expect(outcome.status, `request ${i + 1} ended ${outcome.status} ${outcome.code ?? ""}`).toBe("ok");
      if (outcome.usageReported) expect(outcome.usage?.output_tokens ?? 0).toBeLessThanOrEqual(MAX_TOKENS);
    }
    expect(summary).toHaveLength(REQUESTS);
    // The key stayed where it belongs.
    const stored = await lantern.storageDump();
    expect(Object.values(stored).join("\n")).not.toContain(key);
    expect(lantern.consoleLines.join("\n")).not.toContain(key);
  } catch (err) {
    throw new Error(scrub(err instanceof Error ? err.message : String(err)));
  }
});
