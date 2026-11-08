import { expect, replayInCpython, test } from "../support/fixtures.ts";

const SUMMON = { type: "summon", npc: "npc03", x: 31, y: 10 };

test("a player action the core refuses is dropped with a notice, and the session goes on", async ({ lantern }) => {
  const page = lantern.page;
  await lantern.open("pace=10&seed=21");
  await lantern.waitForTick(40);

  // An action type the core does not know. The call that carried it is made again without it.
  await page.evaluate(() => window.__lantern.client.player({ action_id: "bad-1", type: "teleport" }));
  await expect(page.getByTestId("host-notice")).toContainText("refused 1 player input");
  const afterBad = await lantern.tick();
  await lantern.waitForTick(afterBad + 30);
  const snap = await lantern.snapshot();
  expect(snap.error).toBeNull();
  expect(snap.notices.map((n) => n.code)).toEqual(["input_refused"]);

  // A good action next to a bad one goes down with it, and a later good one is applied.
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "good-1" });
  await page.getByTestId("btn-pause").click();
  await expect(page.getByTestId("status")).toHaveText("paused");
  const replay = await lantern.exportReplay();
  expect(replay.records.filter((r) => r[2] === "player").map((r) => r[3].action_id)).toEqual(["good-1"]);
  // The number the refused action used is not reused: it is a gap in the log, which is allowed. Where
  // the gap falls depends on what the world did before the action came, so the test looks for the one
  // gap and for the good action coming after it.
  const seqs = replay.records.map((r) => r[1]);
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  expect(new Set(seqs).size).toBe(seqs.length);
  const gaps = Array.from({ length: Math.max(...seqs) + 1 }, (_, n) => n).filter((n) => !seqs.includes(n));
  expect(gaps).toHaveLength(1);
  expect(replay.records.find((r) => r[2] === "player")?.[1]).toBeGreaterThan(gaps[0] ?? Number.POSITIVE_INFINITY);

  const cpython = replayInCpython(replay, "refused-input");
  expect(cpython).toMatchObject({ ok: true, final_hash: replay.final.hash, mismatches: [] });
});

test("an action sent twice is one action: the resend is logged and the core acknowledges it as a duplicate", async ({ lantern }) => {
  const page = lantern.page;
  await lantern.open("pace=10&seed=22");
  await lantern.waitForTick(20);
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "twice" });
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "twice" });
  await lantern.waitForTick((await lantern.tick()) + 10);
  // The docstring names the acknowledgements "applied" and "duplicate" and not the key that carries them.
  const acks = await page.evaluate(() =>
    window.__lantern.client.state.events.filter((e) => e.kind === "action_ack").map((e) => JSON.stringify(e)),
  );
  expect(acks).toHaveLength(2);
  expect(acks[0]).toContain("applied");
  expect(acks[1]).toContain("duplicate");
});
