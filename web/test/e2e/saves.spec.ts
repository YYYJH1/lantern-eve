import { expect, replayInCpython, test } from "../support/fixtures.ts";
import { byAnotherVersion, readSaved, tamper } from "../support/stored-saves.ts";

const SUMMON = { type: "summon", npc: "npc03", x: 31, y: 10 };
/** What the menu says of a save: no number of the save, no tick, only the game time. */
const SAVED_NOTICE = /^saved, Day \d+ \d\d:\d\d$/;

test.describe("saves", () => {
  test("a save is the replay in IndexedDB: save, reload the page, load, the same hash", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=777");
    await lantern.waitForTick(150);
    await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "save-1" });
    await lantern.waitForTick(450);

    await page.getByTestId("save-name").fill("round trip");
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    const saved = await page.evaluate(() => window.__lantern.client.state.lastSaved);
    expect(saved).toMatchObject({ id: 1, name: "round trip" });
    expect(saved?.tick).toBeGreaterThanOrEqual(450);
    expect(saved?.hash).toMatch(/^[0-9a-f]{64}$/);
    // The world did not stop for the save.
    await lantern.waitForTick((saved?.tick ?? 0) + 30);

    // A new page, a different seed, a new worker with a world of its own.
    await lantern.open("pace=30&seed=999");
    await expect(page.getByTestId("seed")).toHaveText("999");
    await expect(page.getByTestId("select-saves")).toContainText("round trip");
    await page.getByTestId("btn-load").click();

    const loaded = page.getByTestId("loaded");
    await expect(loaded).toBeVisible();
    await expect(loaded).toHaveAttribute("data-match", "true");
    await expect(loaded).toHaveAttribute("data-hash", saved?.hash ?? "");
    await expect(loaded).toHaveAttribute("data-saved-hash", saved?.hash ?? "");
    await expect(loaded).toHaveAttribute("data-tick", String(saved?.tick));
    await expect(page.getByTestId("tick")).toHaveText(String(saved?.tick));
    await expect(page.getByTestId("seed")).toHaveText("777");
    // Held after a load, until the player says go.
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.waitForTimeout(500);
    expect(await lantern.tick()).toBe(saved?.tick);

    // The rebuilt session carries on, and what it records replays in CPython to the same hashes.
    await page.getByTestId("btn-pause").click();
    await lantern.waitForTick((saved?.tick ?? 0) + 200);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    const replay = await lantern.exportReplay();
    expect(replay.header.seed).toBe(777);
    expect(replay.records.filter((r) => r[2] === "player").map((r) => r[3].action_id)).toEqual(["save-1"]);
    const cpython = replayInCpython(replay, "after-load");
    expect(cpython).toMatchObject({ ok: true, final_hash: replay.final.hash, mismatches: [] });

    // The save itself replays in CPython to the hash that was taken when it was saved.
    const stored = await readSaved(lantern, 1);
    const fromSave = replayInCpython(stored, "save-1");
    expect(fromSave).toMatchObject({ ok: true, final_tick: saved?.tick, final_hash: saved?.hash });
  });

  test("a save made while paused loads to the same hash, and saves list newest first and delete", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=31");
    await lantern.waitForTick(120);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    // Where the pause lands depends on how fast the machine is, so the save is compared with
    // the tick it was made at rather than with a fixed range.
    const savedTick = (await page.getByTestId("tick").textContent())?.trim() ?? "";
    expect(Number(savedTick)).toBeGreaterThanOrEqual(120);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await page.getByTestId("btn-pause").click();
    await lantern.waitForTick(Number(savedTick) + 140);
    await page.getByTestId("save-name").fill("later");
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.lastSaved?.id)).toBe(2);
    const options = await page.getByTestId("select-saves").locator("option").allTextContents();
    expect(options).toHaveLength(2);
    expect(options[0]).toContain("later");

    await page.getByTestId("select-saves").selectOption("1");
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-match", "true");
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-tick", savedTick);

    await page.getByTestId("btn-delete").click();
    await expect(page.getByTestId("select-saves").locator("option")).toHaveCount(1);
    await expect(page.getByTestId("select-saves")).toContainText("later");
  });

  test("a save whose hash was altered is refused, and the running game is left alone", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=41");
    await lantern.waitForTick(300);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await tamper(lantern, 1, (replay) => {
      replay.final.hash = "0".repeat(64);
    });
    const before = await lantern.tick();
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("notice")).toContainText("hash_mismatch");
    await expect(page.getByTestId("loaded")).toHaveCount(0);
    await lantern.waitForTick(before + 30);
    expect((await lantern.snapshot()).error).toBeNull();
  });

  test("a save that another version of the game made is said so in plain words, in the language of the page, with the host's own words after them", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=45");
    await lantern.waitForTick(300);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await tamper(lantern, 1, byAnotherVersion);
    const before = await lantern.tick();
    await page.getByTestId("btn-load").click();
    const notice = page.getByTestId("notice");
    await expect(notice).toContainText("This save was made by another version of the game, which this one cannot read.");
    await expect(notice).toHaveAttribute("data-kind", "load-version");
    // The host's own words follow them: the code, where the hashes part, and what made the save.
    await expect(notice).toContainText(/hash_mismatch: .*\(saved by core 0\.0\.0 \/ c0ffee00, running /);
    // The plain words follow the language of the page as it is switched, and the host's words stay as the host gave them.
    await lantern.switchLang("zh");
    await expect(notice).toContainText("这份存档是另一个版本的游戏存的，这一版读不出来。");
    await expect(notice).toContainText("hash_mismatch");
    await lantern.switchLang("en");
    await expect(notice).toContainText("This save was made by another version of the game");
    // The game that runs is left alone.
    await expect(page.getByTestId("loaded")).toHaveCount(0);
    await lantern.waitForTick(before + 30);
    expect((await lantern.snapshot()).error).toBeNull();
  });

  test("a save whose record was altered is caught at the next hash, with the tick named", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=42");
    await lantern.waitForTick(60);
    await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "t-1" });
    await lantern.waitForTick(450);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await tamper(lantern, 1, (replay) => {
      // The summoned NPC is sent somewhere else.
      const record = replay.records.find((r) => r[2] === "player");
      if (record !== undefined) record[3].y = 3;
    });
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("notice")).toContainText(/hash_mismatch: checkpoint hash differs at tick \d+/);
    await expect(page.getByTestId("loaded")).toHaveCount(0);
  });

  test("a save with something the core refuses fails with a code, not a crash", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=30&seed=43");
    await lantern.waitForTick(60);
    await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "t-2" });
    await lantern.waitForTick(120);
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(SAVED_NOTICE);
    await tamper(lantern, 1, (replay) => {
      const record = replay.records.find((r) => r[2] === "player");
      if (record !== undefined) record[3].type = "teleport";
    });
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("notice")).toContainText("replay_failed");
    expect((await lantern.snapshot()).error).toBeNull();
  });
});
