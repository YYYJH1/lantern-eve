import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { HostClient } from "../../src/page/client.ts";
import { anotherVariant, randomSeed, readFinished, VARIANTS, writeFinished } from "../../src/page/truths.ts";
import type { PageToHost } from "../../src/shared/protocol.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A host client over a worker that only keeps what it is sent. */
function clientOver(preset: string | null): { client: HostClient; sent: PageToHost[] } {
  const sent: PageToHost[] = [];
  const worker = { addEventListener: () => undefined, postMessage: (message: PageToHost) => sent.push(message), terminate: () => undefined };
  const client = new HostClient(worker as unknown as Worker, { allowServer: false });
  client.state.preset = preset;
  return { client, sent };
}

/** localStorage of a browser that keeps what it is given, for the one test that needs it. */
function withStorage(run: (store: Map<string, string>) => void): void {
  const store = new Map<string, string>();
  const real = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  try {
    run(store);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = real;
  }
}

/** A random number generator that walks through [0, 1) in `steps` equal steps. */
function sweep(steps: number): () => number {
  let i = 0;
  return () => (i++ % steps) / steps;
}

test.describe("the stories the page can ask to be true", () => {
  test("are the variants of the script, no more and no fewer", () => {
    const script = JSON.parse(readFileSync(path.join(WEB, "../content/compiled/broken_bridge.json"), "utf8")) as { variants: Array<{ id: string }> };
    expect([...VARIANTS]).toEqual(script.variants.map((v) => v.id));
  });

  test("are told apart in the endings by the page's own words, one for each", async () => {
    const { en } = await import("../../src/i18n/en.ts");
    for (const variant of VARIANTS) expect(Object.keys(en), variant).toContain(`ending.truth.${variant}`);
  });

  test("one of the other two is picked when the story just played is known, each of them in turn", () => {
    for (const avoid of VARIANTS) {
      const picked = new Set<string>();
      const random = sweep(8);
      for (let i = 0; i < 16; i++) picked.add(anotherVariant(avoid, random));
      expect(picked.has(avoid), `avoiding ${avoid}`).toBe(false);
      expect([...picked].sort()).toEqual(VARIANTS.filter((v) => v !== avoid).sort());
    }
  });

  test("any of the three is picked when the page does not know the story just played, even when the dice come out at the top", () => {
    for (const avoid of [undefined, null, "", "v_nothing"]) {
      const picked = new Set<string>();
      const random = sweep(9);
      for (let i = 0; i < 18; i++) picked.add(anotherVariant(avoid, random));
      expect([...picked].sort()).toEqual([...VARIANTS].sort());
    }
    expect(VARIANTS).toContain(anotherVariant("v_boat", () => 0.9999999));
    expect(anotherVariant(undefined, () => 0.9999999)).toBe(VARIANTS[VARIANTS.length - 1]);
  });

  test("come with a seed from zero up to two to the thirty-first, whole", () => {
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.9999999999)).toBe(2 ** 31 - 1);
    for (let i = 0; i < 50; i++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31).toBe(true);
    }
  });
});

test.describe("a new game of the host client", () => {
  test("is the rules of the named game at a seed and with a story of its own, the first game of the name not again", () => {
    const { client, sent } = clientOver("slice");
    const seeds = new Set<number>();
    const stories = new Set<string>();
    for (let i = 0; i < 40; i++) {
      client.newGame();
      const message = sent.at(-1);
      expect(message).toMatchObject({ type: "new-game", preset: "slice" });
      if (message?.type !== "new-game") throw new Error("not a new game");
      expect(Number.isInteger(message.seed) && (message.seed ?? -1) >= 0).toBe(true);
      expect(VARIANTS as readonly string[]).toContain(message.variant);
      expect(message.scenario).toBeUndefined();
      seeds.add(message.seed ?? -1);
      stories.add(message.variant ?? "");
    }
    // It is a case of its own each time: nothing in it is the game the opening page began with.
    expect(seeds.size).toBeGreaterThan(30);
    expect(seeds.has(492)).toBe(false);
    expect([...stories].sort()).toEqual([...VARIANTS].sort());
  });

  test("keeps away from the story that the ending has just told", () => {
    const { client, sent } = clientOver("slice");
    for (let i = 0; i < 40; i++) client.newGame("v_flood");
    const stories = new Set(sent.map((m) => (m.type === "new-game" ? m.variant : "")));
    expect([...stories].sort()).toEqual(["v_boat", "v_drunk"]);
  });

  test("is a game of a seed where the page began with a seed, as it always was", () => {
    const { client, sent } = clientOver(null);
    client.newGame();
    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message).toMatchObject({ type: "new-game" });
    expect(message).not.toHaveProperty("preset");
    expect(message).not.toHaveProperty("variant");
    expect(typeof (message as { seed: number }).seed).toBe("number");
  });

  test("can start the first game of the name again, for the tutorial, which is of that game", () => {
    const { client, sent } = clientOver("slice");
    client.firstGame();
    expect(sent).toEqual([{ type: "new-game", preset: "slice" }]);
    const plain = clientOver(null);
    plain.client.firstGame();
    expect(plain.sent[0]).toMatchObject({ type: "new-game" });
    expect(plain.sent[0]).not.toHaveProperty("preset");
  });
});

test.describe("whether a game was played to its end", () => {
  test("is unknown to a browser that keeps nothing, and a write that cannot be kept is no error", () => {
    expect(readFinished()).toBeNull();
    expect(() => writeFinished("v_boat")).not.toThrow();
    expect(readFinished()).toBeNull();
  });

  test("is kept with the story that was told, if it is one of the three, else only that there was one", () => {
    withStorage((store) => {
      expect(readFinished()).toBeNull();
      writeFinished();
      expect(readFinished()).toEqual({ variant: null });
      writeFinished("v_drunk");
      expect(readFinished()).toEqual({ variant: "v_drunk" });
      writeFinished("v_nothing");
      expect(readFinished()).toEqual({ variant: null });
      writeFinished(null);
      expect(store.get("lantern.finished")).toBe("1");
      store.set("lantern.finished", "");
      expect(readFinished()).toBeNull();
    });
  });
});
