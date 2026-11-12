import { expect, test } from "@playwright/test";
import { askPreview, PreviewUnavailable, type PreviewAction, readPreview } from "../../src/page/preview.ts";
import type { CallOp } from "../../src/shared/protocol.ts";
import { PREVIEW, PROMISE_PREVIEW } from "../support/slice.ts";

const action: PreviewAction = { verb: "entrust", npc: "li_da", kind: "material" };

test.describe("a preview as the core sends it", () => {
  test("is read with its version, cost, what it asks and gives, the blockers, the odds and the reasons", () => {
    const preview = readPreview(PREVIEW);
    expect(preview).toMatchObject({ version: 42, cost: 20, odds: "mid" });
    expect(preview?.asks.en).toBe("Ask Li Da to bring the bamboo to the bridge");
    expect(preview?.gives).toBeNull();
    expect(preview?.blockers).toHaveLength(1);
    expect(preview?.reasons.map((r) => r.sign)).toEqual([1, -1]);
    // A promise gives what it asks.
    expect(readPreview(PROMISE_PREVIEW)?.gives?.en).toBe("Promise: the Li family lights the main lantern");
  });

  test("may give nothing and have no odds, and is not a preview without a version or a text of what it asks", () => {
    const bare = readPreview({ version: 1, cost: null, asks: { zh: "甲", en: "A" }, gives: null, blockers: [], odds: null, reasons: [] });
    expect(bare).toMatchObject({ version: 1, cost: null, gives: null, odds: null, blockers: [], reasons: [] });
    expect(readPreview(undefined)).toBeNull();
    expect(readPreview(null)).toBeNull();
    expect(readPreview("preview")).toBeNull();
    expect(readPreview({ cost: 1, asks: { zh: "甲", en: "A" } })).toBeNull();
    expect(readPreview({ version: 1, cost: 1 })).toBeNull();
    // A thing the page does not know in the odds is no odds, and a bad reason is left out.
    expect(readPreview({ version: 1, asks: "A", odds: "certain", reasons: [{ sign: 1 }, { text: "ok" }, "no"] })).toMatchObject({ odds: null, reasons: [{ sign: 1, text: { zh: "ok", en: "ok" } }] });
  });

  test("is the whole of what the page knows: it has no flag for a preview of its own", () => {
    expect(Object.keys(readPreview(PREVIEW) ?? {}).sort()).toEqual(["asks", "blockers", "cost", "gives", "odds", "reasons", "version"]);
  });
});

test.describe("asking the host for a preview", () => {
  test("takes the answer of the host, and asks it for exactly the action it was given", async () => {
    const asked: CallOp[] = [];
    const client = { call: <T>(call: CallOp) => (asked.push(call), Promise.resolve(PREVIEW as T)) };
    const preview = await askPreview(client, action);
    expect(preview.version).toBe(42);
    expect(asked).toEqual([{ op: "preview", action }]);
  });

  test("has no preview when the host answers with nothing, with something that is not a preview, or with an error, and makes none up", async () => {
    for (const answer of [undefined, null, 7, { nope: true }]) {
      const failure = await askPreview({ call: <T>() => Promise.resolve(answer as T) }, action).then(
        () => null,
        (err: unknown) => err,
      );
      expect(failure).toBeInstanceOf(PreviewUnavailable);
      expect((failure as PreviewUnavailable).why).toBe("none");
    }
    const refused = await askPreview({ call: () => Promise.reject(new Error("bad_action")) }, action).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(PreviewUnavailable);
    expect((refused as PreviewUnavailable).why).toBe("refused");
  });

  test("does not leave the player waiting on a host that never answers", async () => {
    const started = Date.now();
    const failure = await askPreview({ call: () => new Promise(() => undefined) }, action, 40).then(
      () => null,
      (err: unknown) => err,
    );
    expect((failure as PreviewUnavailable).why).toBe("silent");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
