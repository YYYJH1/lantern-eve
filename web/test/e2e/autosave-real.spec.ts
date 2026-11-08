import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { SaveMeta } from "../../src/shared/protocol.ts";
import { expect, OUT_DIR, REPO_DIR, test, WEB_DIR } from "../support/fixtures.ts";
import { closeCards, closeElder, startGame, waitForClock } from "../support/real.ts";

// The page saves the game by itself on the real core, in the browser host: each morning when its paper comes (07:00 from the second day), and Continue on the
// opening page loads the newest save of all. The game is the one the opening page starts, played by nobody but the clock.
test.use({ map: true });

// When a test fails, say what the page was doing: a picture of a held world (the paper up, the clock at 07:00) does not say whether the page asked for a
// save, was refused one, or waited. The lines are printed, so that they are in the log of the run and in the report.
test.afterEach(async ({ lantern }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const looked = await lantern.page
    .evaluate(() => {
      const autosave = (window.__lantern.play as unknown as { autosave: { enabled: boolean; saved: number | null; pending: unknown; running: boolean } }).autosave;
      const state = window.__lantern.client.state;
      return {
        autosave: { enabled: autosave.enabled, saved: autosave.saved, pending: autosave.pending, running: autosave.running },
        clock: (state.frame as unknown as { time?: unknown } | null)?.time ?? null,
        paused: state.paused,
        saves: state.saves.map((save) => save.name),
      };
    })
    .catch((err: unknown) => ({ unreadable: String(err) }));
  console.log(`page at the failure of "${testInfo.title}": ${JSON.stringify(looked)}`);
  console.log(`page console: ${JSON.stringify(lantern.consoleLines.slice(-40))}`);
  console.log(`page errors: ${JSON.stringify(lantern.pageErrors)}`);
});

/** The saves the host lists, newest first, as the page has them. */
const savesOf = (page: Page): Promise<SaveMeta[]> => page.evaluate(() => window.__lantern.client.state.saves as unknown as SaveMeta[]);

const autoOf = (save: SaveMeta): { kind: string; day: number; hour: number; minute: number } | undefined => (save.page as { auto?: { kind: string; day: number; hour: number; minute: number } } | undefined)?.auto;

test.describe("the saves the page makes by itself, on the real core", () => {
  test("a save at the hour of the recap of the second morning, and Continue on a page that is opened again loads it", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    await startGame(lantern, "pace=100");
    expect(await savesOf(page)).toEqual([]);
    // The clock reaches 07:00 of the second day. Nobody has done anything, and the elder comes by now and then, which waitForClock deals with.
    await waitForClock(page, 7, 0, 2, 420_000);
    await expect.poll(async () => (await savesOf(page)).length, { timeout: 60_000 }).toBe(1);
    const [made] = await savesOf(page);
    expect(made?.name).toBe("Autosave, Day 2 07:00");
    expect(made ? autoOf(made) : undefined).toEqual({ kind: "morning", day: 2, hour: 7, minute: 0 });
    // It says so over the map for a moment.
    expect(made?.tick).toBeGreaterThanOrEqual(2070);

    // A page that is opened again: Continue is there, and loads that save with every hash matching.
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("opening-continue")).toBeEnabled();
    await page.getByTestId("opening-continue").click();
    await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 240_000 });
    const loaded = await page.evaluate(() => window.__lantern.client.state.loaded);
    expect(loaded).toMatchObject({ id: made?.id, match: true, tick: made?.tick });
    await expect(page.getByTestId("opening")).toHaveCount(0);
    const time = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { time: { day: number; hour: number } }).time);
    expect(time).toMatchObject({ day: 2, hour: 7 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a morning is saved at the frame of its paper when the world is held right there, as the paper holds it for a player who reads it at once", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    // The core makes the paper of the second morning in tick 2190 (07:00 of the second day, which starts at tick 2070 at 06:00 and has 120 ticks to the hour),
    // and the frame of that tick reads 07:00 like the one before it. The page's own card of the paper holds the world as soon as it has it, so for a player
    // who is quick the next minute never comes while the paper is up. `until` holds the world after that tick, which is the same thing. Nothing has been done
    // in this game, so the core has nothing to recap, and says nothing of it: the paper is all there is to go by.
    await startGame(lantern, "pace=100&until=2191");
    await expect
      .poll(
        async () => {
          // The elder comes by, and the summary of the first night holds the world until it is put away. The paper of the morning is left up.
          await closeElder(page);
          const night = page.getByTestId("night-done");
          if ((await night.count()) > 0) await night.click({ timeout: 3000 }).catch(() => undefined);
          return page.evaluate(() => {
            const state = window.__lantern.client.state;
            return state.paused && state.simTick >= 2191;
          });
        },
        { timeout: 180_000, intervals: [150] },
      )
      .toBe(true);
    const time = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { time: { day: number; hour: number; minute: number } }).time);
    expect(time).toMatchObject({ day: 2, hour: 7, minute: 0 });
    await expect(page.getByTestId("gazette")).toBeVisible();
    // The page saved the morning at the frame of the paper, which is the last frame there is, and the paper is in the notes of the save.
    await expect.poll(async () => (await savesOf(page)).length, { timeout: 60_000 }).toBe(1);
    const [made] = await savesOf(page);
    expect(made?.name).toBe("Autosave, Day 2 07:00");
    expect(made?.tick).toBe(2191);
    expect(Object.keys(made?.page ?? {}).sort()).toEqual(["auto", "recap"]);
    expect((made?.page as { recap?: { gazette?: { day?: number } } } | undefined)?.recap?.gazette?.day).toBe(2);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the last three through the five days and the ending, the player's own save stays, and Continue brings back the end of the game", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    await startGame(lantern, "pace=100");
    // A save of the player's own, made on the first morning: it is the oldest of all, and is never taken for the page's.
    const mine = await page.evaluate(() => window.__lantern.client.save("my own save"));
    for (const day of [2, 3, 4, 5]) {
      await waitForClock(page, 7, 0, day, 420_000);
      await expect.poll(async () => (await savesOf(page)).some((save) => autoOf(save)?.day === day && autoOf(save)?.kind === "morning"), { timeout: 60_000 }).toBe(true);
    }
    // Four mornings were saved, and the first of them is gone.
    await expect.poll(async () => (await savesOf(page)).map((save) => save.name), { timeout: 30_000 }).toEqual(["Autosave, Day 5 07:00", "Autosave, Day 4 07:00", "Autosave, Day 3 07:00", "my own save"]);
    // The festival night: the ending comes, the page saves it, and the oldest of the page's saves goes again.
    await expect
      .poll(
        async () => {
          await closeCards(page);
          return page.evaluate(() => window.__lantern.play.state.ending !== null);
        },
        { timeout: 420_000, intervals: [200] },
      )
      .toBe(true);
    await expect.poll(async () => (await savesOf(page)).map((save) => save.name), { timeout: 60_000 }).toEqual(["Autosave, Festival night", "Autosave, Day 5 07:00", "Autosave, Day 4 07:00", "my own save"]);
    expect((await savesOf(page)).find((save) => save.id === mine.id)?.name).toBe("my own save");
    // A save that is not the page's is not in the way of Continue: the newest of all is the ending.
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-continue").click();
    await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 420_000 });
    expect(await page.evaluate(() => window.__lantern.client.state.loaded)).toMatchObject({ match: true });
    await expect(page.getByTestId("ending")).toBeVisible({ timeout: 30_000 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

interface Recording {
  replay: unknown;
  tick: number;
  hash: string;
}

/** Plays the follower to the time under CPython (uv run) and returns its recording: the moment, the tick it reached and the hash there. */
function recordFollower(day: number, hour: number, minute: number): Recording {
  const dir = path.join(OUT_DIR, "recordings");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `follower-d${day}-${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}.json`);
  const run = spawnSync("uv", ["run", "--project", REPO_DIR, "--directory", REPO_DIR, "python", path.join(WEB_DIR, "test/support/follower_recording.py"), file, String(day), String(hour), String(minute)], {
    encoding: "utf8",
    timeout: 240_000,
  });
  const last = run.stdout.trim().split("\n").at(-1) ?? "";
  let reached: { tick: number; hash: string };
  try {
    reached = JSON.parse(last) as { tick: number; hash: string };
  } catch {
    throw new Error(`no recording from follower_recording.py (status ${run.status}): ${run.stderr.slice(-800)}`);
  }
  return { replay: JSON.parse(readFileSync(file, "utf8")) as unknown, ...reached };
}

/** Puts a recording into IndexedDB as a save, as the host does, and gives its number. */
async function putSave(page: Page, name: string, recording: Recording): Promise<number> {
  return page.evaluate(
    ([saveName, replay, tick, hash]) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("lantern-eve", 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id", autoIncrement: true });
          if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["saves", "replays"], "readwrite");
          const added = tx.objectStore("saves").add({ name: saveName, savedAt: new Date(0).toISOString(), tick, hash });
          added.onsuccess = () => {
            const id = added.result as number;
            tx.objectStore("replays").put({ id, replay });
            tx.oncomplete = () => {
              db.close();
              resolve(id);
            };
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [name, recording.replay, recording.tick, recording.hash] as const,
  );
}

test.describe("the paper of the morning, on a recording of the follower", () => {
  test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

  test("is kept with the autosave of its morning, and comes back with it when Continue loads the save", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    const recording = recordFollower(3, 6, 10);
    // The game is on the third morning, ten past six, and the page saves by itself when the clock reaches seven.
    await page.goto(`${lantern.servers.app.origin}/?start=1&pace=3&autosave=on`);
    await lantern.waitReady();
    const id = await putSave(page, "third morning", recording);
    await page.evaluate((save) => window.__lantern.client.load(save), id);
    const loaded = await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 240_000 });
    expect(await loaded.jsonValue()).toBe(true);
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick, recording.tick, { timeout: 60_000 });
    await page.getByTestId("btn-pause").click();
    // A line over the map says that the game was saved, for a few seconds.
    await expect(page.getByTestId("autosave-note")).toHaveText("已自动存档：第三日 07:00", { timeout: 120_000 });
    const made = (await savesOf(page)).find((save) => autoOf(save)?.day === 3);
    // The recording that was put in the browser is the player's own save, and is the older of the two.
    expect((await savesOf(page)).map((save) => save.name)).toEqual(["自动存档，第三日 07:00", "third morning"]);
    // The paper of the morning is on show, and the player has not put it away: it is in the notes of the save.
    await expect(page.getByTestId("gazette")).toBeVisible();
    const head = await page.getByTestId("gazette-head").innerText();
    const news = await page.getByTestId("gazette-item").allInnerTexts();
    expect(head.length).toBeGreaterThan(0);
    expect(Object.keys(made?.page ?? {}).sort()).toEqual(["auto", "recap"]);

    // A page that is opened again: Continue loads the newest save of all, which is that one, with the recap of the morning on show again.
    await page.goto(`${lantern.servers.app.origin}/?pace=3`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-continue")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-continue").click();
    await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 240_000 });
    expect(await page.evaluate(() => window.__lantern.client.state.loaded)).toMatchObject({ id: made?.id, match: true });
    await expect(page.getByTestId("gazette")).toBeVisible();
    await expect(page.getByTestId("gazette-head")).toHaveText(head);
    expect(await page.getByTestId("gazette-item").allInnerTexts()).toEqual(news);
    expect(lantern.pageErrors).toEqual([]);
  });
});
