/**
 * A game the follower played, put into the page. The follower (tools/bots/follower.py) is a manager who does only what the top bar says. The
 * core under CPython plays it to a moment of the game and writes a recording (`follower_recording.py`), which the helpers here put into IndexedDB
 * as a save and load in the page of the game the opening page starts: the core in the browser (Pyodide) plays it again tick by tick and checks every
 * hash on the way, and the page shows what it makes of the real frames at that moment. Nothing is fed to the page by hand.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { OUT_DIR, REPO_DIR, WEB_DIR } from "./fixtures.ts";

export interface Recording {
  replay: unknown;
  tick: number;
  hash: string;
}

/** Plays the follower to the time under CPython (uv run) and returns its recording: the moment, the tick it reached and the hash there. */
export function recordFollower(day: number, hour: number, minute: number): Recording {
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
export async function putSave(page: Page, name: string, recording: Recording): Promise<number> {
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

/**
 * Opens the game the opening page starts, loads the recording as a save, and waits until the core in the browser has it and the page shows it.
 * `until` is a tick at which the host holds the world itself once it is let go (the page's `?until=`): a test that needs the world to stand still
 * at a moment of the game that lasts a few seconds at the pace of the page cannot get there by watching the page and pausing, which is as late as
 * the machine is slow.
 */
export async function loadMoment(page: Page, waitReady: () => Promise<void>, origin: string, name: string, recording: Recording, until: number | null = null): Promise<void> {
  await page.goto(`${origin}/?start=1&pace=3${until === null ? "" : `&until=${until}`}`);
  await waitReady();
  const id = await putSave(page, name, recording);
  await page.evaluate((save) => window.__lantern.client.load(save), id);
  const loaded = await page.waitForFunction(() => window.__lantern.client.state.loaded?.match ?? null, undefined, { timeout: 240_000 });
  expect(await loaded.jsonValue()).toBe(true);
  await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick, recording.tick, { timeout: 60_000 });
  await expect(page.getByTestId("topbar-task-text")).toBeVisible();
}

/** The frame the page was given, as the page keeps it. */
export interface Seen {
  tracked: string | null;
  tasks: Array<{ id: string; state: string; action: { verb: string; place?: string } | null; window: { day: number; from: number; to: number; place: string } | null }>;
  board: { hours: { done: number; need: number }; window: { day: number } | null; truth: { state: string }; peace: { state: string; witnessed: boolean }; helpers: Array<{ family: string | null; count: number }> };
  site: { bamboo: number; timber: number };
  time: { day: number; hour: number; minute: number };
}

export const frameOf = (page: Page): Promise<Seen> => page.evaluate(() => window.__lantern.client.state.frame as unknown as Seen);

/**
 * Makes the page the page of a player: the help is on (the world is held under the cards of the guide, the paper and the night among them), but
 * the hints are off, so that the elder does not come by while the world is let go and nobody plays. A page made for a test has none of it.
 */
export async function asPlayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const guide = window.__lantern.play.guide;
    guide.enabled = true;
    guide.setHintsOn(false);
  });
}

/**
 * Lets the world go after a recording or a save is loaded (the page opens it held), and waits until it has run on: the tick of the page's frame is past the one it stood at.
 * A wait for `paused === false` is not the same. Where the next card that holds the world is minutes of the game on (the paper at seven, the summary of the night at nine),
 * the core holds the world again within a fraction of a second, and a poll of the page that comes after that never sees it running.
 */
export async function letGo(page: Page): Promise<void> {
  const from = await page.evaluate(() => window.__lantern.client.state.simTick);
  await page.getByTestId("btn-pause").click();
  await page.waitForFunction((tick) => window.__lantern.client.state.simTick > tick, from, { timeout: 30_000 });
}
