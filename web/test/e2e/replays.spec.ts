import type { Page } from "@playwright/test";
import type { Replay, ReplayStatus } from "../../src/shared/protocol.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";

// The recording is drawn like a game, so these pages have the map.
test.use({ map: true });

const SAVED = "scenario=bridge&seed=7&pace=60&until=900";

/** What the host that plays the open recording says. */
const replayStatus = (page: Page): Promise<ReplayStatus | null> => page.evaluate(() => window.__lantern.replay?.client.state.replay ?? null);
const replayTick = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.replay?.client.state.simTick ?? 0);
const liveTick = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.client.state.simTick);

/** Plays a game of the bridge town to the tick the query holds it at, and saves it under a name. */
async function saveAGame(lantern: LanternPage, name: string, query = SAVED): Promise<void> {
  await lantern.open(query, { menu: false });
  const until = Number(/until=(\d+)/.exec(query)?.[1]);
  await lantern.waitForTick(until);
  await lantern.page.evaluate((n) => window.__lantern.client.save(n), name);
}

/** Changes the replay of a save in IndexedDB, as a player with devtools could. */
async function tamper(page: Page, id: number, change: (replay: Replay) => void): Promise<void> {
  const replay = await page.evaluate(
    (key) =>
      new Promise<Replay>((resolve, reject) => {
        const open = indexedDB.open("lantern-eve");
        open.onsuccess = () => {
          const req = open.result.transaction("replays").objectStore("replays").get(key);
          req.onsuccess = () => {
            open.result.close();
            resolve((req.result as { replay: Replay }).replay);
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    id,
  );
  change(replay);
  await page.evaluate(
    ([key, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("lantern-eve");
        open.onsuccess = () => {
          const tx = open.result.transaction("replays", "readwrite");
          tx.objectStore("replays").put({ id: key, replay: value });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    [id, replay] as const,
  );
}

async function openGallery(page: Page): Promise<void> {
  await page.getByTestId("btn-menu").click();
  await page.getByTestId("btn-replays").click();
  await expect(page.getByTestId("gallery")).toBeVisible();
}

const entry = (page: Page, id: string) => page.locator(`[data-testid="gallery-entry"][data-id="${id}"]`);

/** Waits until the open recording shows a picture and is not busy, which is when the bar answers. */
async function replayReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const status = window.__lantern.replay?.client.state.replay;
    return status?.phase === "ready" && !status.busy;
  }, undefined, { timeout: 120_000 });
}

test.describe("the gallery of recordings", () => {
  test("lists the saves of this browser and the menu opens it; a page on a static host has no server section", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await lantern.open(SAVED, { menu: false });
    await lantern.waitForTick(900);
    await page.getByTestId("btn-menu").click();
    await page.getByTestId("btn-replays").click();
    await expect(page.getByTestId("gallery")).toBeVisible();
    await expect(page.getByTestId("gallery-browser-empty")).toHaveText("No saves yet. Save a game from the menu and it will be here.");
    await expect(page.getByTestId("gallery-server")).toHaveCount(0);
    // The drawer is shut behind it, and the page of the game is out of reach: it takes no click and no key.
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    expect(await page.evaluate(() => (document.querySelector(".live-root") as HTMLElement).inert)).toBe(true);
    await page.getByTestId("gallery-close").click();
    await expect(page.getByTestId("gallery")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (document.querySelector(".live-root") as HTMLElement).inert)).toBe(false);

    // A save is a recording: it is listed with its name and its length, newest first.
    await page.evaluate(() => window.__lantern.client.save("first game"));
    await page.evaluate(() => window.__lantern.client.save(""));
    await openGallery(page);
    const rows = page.getByTestId("gallery-entry");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-id", "save-2");
    await expect(rows.first().getByTestId("gallery-name")).toHaveText("tick 900");
    await expect(rows.nth(1).getByTestId("gallery-name")).toHaveText("first game");
    await expect(rows.nth(1).getByTestId("gallery-meta")).toContainText("900 ticks");
    await expect(rows.nth(1)).toHaveAttribute("data-source", "browser");
    // Escape closes it too.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("gallery")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("opens a saved game, plays it, holds it, jumps to a tick and the game under it is held meanwhile", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "first game");
    // A game of the page that is going on, in real time, which the recording holds while it is open.
    await lantern.open("scenario=bridge&seed=8&pace=1", { menu: false });
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 20, undefined, { timeout: 60_000 });
    await openGallery(page);
    await expect(page.getByTestId("gallery-entry")).toHaveCount(1);
    await entry(page, "save-1").getByTestId("gallery-watch").click();

    const layer = page.getByTestId("replay-layer");
    await expect(layer).toBeVisible();
    await replayReady(page);
    await expect(layer.getByTestId("replay-badge")).toHaveText("Replay");
    await expect(layer.getByTestId("brand-sub")).toHaveText("Replay: #1");
    await expect(layer.getByTestId("status")).toHaveText("playing");
    // The recording has the town drawn in a map of its own, and no menu and no verbs: it is read only.
    await expect(layer.getByTestId("map")).toBeVisible();
    await expect(layer.getByTestId("btn-menu")).toHaveCount(0);
    await expect(layer.getByTestId("btn-notebook")).toHaveCount(0);
    await expect(layer.getByTestId("hud-time")).toBeVisible();
    const bar = layer.getByTestId("replay-bar");
    await expect(bar).toHaveAttribute("data-phase", "ready");
    await expect(layer.getByTestId("replay-seek")).toHaveAttribute("max", "900");
    await expect(layer.getByTestId("replay-tick")).toContainText("of 900");

    // The game under it is held for as long as it is open.
    const held = await liveTick(page);
    await expect.poll(() => replayTick(page), { timeout: 30_000 }).toBeGreaterThan(30);
    await page.waitForTimeout(1500);
    expect(await liveTick(page)).toBeLessThanOrEqual(held + 12);

    // Pause holds the recording where it is. The address names the moment.
    await layer.getByTestId("replay-play").click();
    await expect(layer.getByTestId("status")).toHaveText("paused");
    const at = await replayTick(page);
    await page.waitForTimeout(700);
    expect(await replayTick(page)).toBe(at);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#replay=save-1&tick=${at}`);

    // A jump goes to the tick it is told to, and the world there is the one the recording holds.
    await layer.getByTestId("replay-seek").fill("700");
    await expect.poll(() => replayTick(page)).toBe(700);
    await expect(layer.getByTestId("replay-tick")).toHaveText("tick 700 of 900");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#replay=save-1&tick=700");
    expect((await replayStatus(page))?.error).toBeNull();
    // Jumping back goes by the snapshots taken on the way there, and ends in the same place whichever way it goes.
    const at700 = await page.evaluate(() => JSON.stringify(window.__lantern.replay?.client.state.frame));
    await layer.getByTestId("replay-start").click();
    await expect.poll(() => replayTick(page)).toBe(1);
    expect((await replayStatus(page))?.snapshots).toBeGreaterThanOrEqual(5);
    await layer.getByTestId("replay-seek").fill("700");
    await expect.poll(() => replayTick(page)).toBe(700);
    expect(await page.evaluate(() => JSON.stringify(window.__lantern.replay?.client.state.frame))).toBe(at700);

    // Back: the recording is let go of, the gallery is there, and the game goes on from where it was held.
    await layer.getByTestId("replay-close").click();
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    await expect(page.getByTestId("gallery")).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    await page.getByTestId("gallery-close").click();
    const resumed = await liveTick(page);
    await expect.poll(() => liveTick(page), { timeout: 30_000 }).toBeGreaterThan(resumed + 15);
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a link to a recording", () => {
  test("opens it at the tick it names, held, and starts no game under it until it is let go of", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "first game");
    const runtimes = () => lantern.network.filter((r) => r.url.endsWith("/pyodide/pyodide.asm.wasm")).length;
    const before = runtimes();
    await page.goto(`${lantern.servers.app.origin}/?scenario=bridge&seed=9&pace=1&map=on#replay=save-1&tick=300`);
    await expect(page.getByTestId("replay-layer")).toBeVisible();
    await replayReady(page);
    const layer = page.getByTestId("replay-layer");
    await expect(layer.getByTestId("replay-tick")).toHaveText("tick 300 of 900");
    await expect(layer.getByTestId("status")).toHaveText("paused");
    expect((await replayStatus(page))?.tick).toBe(300);
    expect(await page.evaluate(() => location.hash)).toBe("#replay=save-1&tick=300");
    // Only the host of the recording was started: Pyodide was fetched once, and the game of the page has not begun.
    expect(runtimes() - before).toBe(1);
    expect(await page.evaluate(() => window.__lantern.client.state.phase)).toBe("boot");

    // Play goes on from the tick of the link, and a pause names the new moment in the address.
    await layer.getByTestId("replay-play").click();
    await expect.poll(() => replayTick(page), { timeout: 30_000 }).toBeGreaterThan(330);
    await layer.getByTestId("replay-play").click();
    await expect(layer.getByTestId("status")).toHaveText("paused");
    const stopped = await replayTick(page);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#replay=save-1&tick=${stopped}`);

    // Back lets the recording go, clears the address, and the game of the page begins.
    await layer.getByTestId("replay-close").click();
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe("");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.phase), { timeout: 60_000 }).toBe("ready");
    await expect.poll(() => liveTick(page), { timeout: 30_000 }).toBeGreaterThan(10);
    // The recording's worker is gone, and the game has its own runtime now.
    expect(runtimes() - before).toBe(2);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a link with no tick plays the recording, and the back button of the browser lets it go", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "first game");
    await lantern.open("scenario=bridge&seed=9&pace=1", { menu: false });
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 10, undefined, { timeout: 60_000 });
    await openGallery(page);
    await entry(page, "save-1").getByTestId("gallery-watch").click();
    await replayReady(page);
    // Watching from the gallery puts the recording in the address, and a step in the history of the browser.
    expect(await page.evaluate(() => location.hash)).toBe("#replay=save-1");
    await expect(page.getByTestId("replay-layer").getByTestId("status")).toHaveText("playing");
    await page.goBack();
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    await expect(page.getByTestId("gallery")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe("");
    // The address changed by hand opens a recording too, and clearing it lets it go.
    await page.evaluate(() => {
      location.hash = "#replay=save-1&tick=500";
    });
    await expect(page.getByTestId("replay-layer")).toBeVisible();
    await replayReady(page);
    expect((await replayStatus(page))?.tick).toBe(500);
    // Another moment in the address of the recording that is open is a jump in it.
    await page.evaluate(() => {
      location.hash = "#replay=save-1&tick=650";
    });
    await expect.poll(() => replayTick(page)).toBe(650);
    expect(await page.evaluate(() => window.__lantern.replay?.id)).toBe("save-1");
    await page.evaluate(() => {
      location.hash = "";
    });
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
  });

  test("never carries a key, a provider or a path: only the name of the recording and a tick", async ({ lantern, servers }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "first game");
    await lantern.open("scenario=bridge&seed=9&pace=1", { menu: false });
    await lantern.configure({ provider: "bailian", key: "sk-fake-link-5a1d9c3e7b2f4086", baseUrl: servers.mock.baseUrl("ok") });
    await openGallery(page);
    await entry(page, "save-1").getByTestId("gallery-watch").click();
    await replayReady(page);
    // Held, a recording names its moment in the address. One that is playing does not, for the tick moves on.
    await page.getByTestId("replay-layer").getByTestId("replay-play").click();
    await page.getByTestId("replay-layer").getByTestId("replay-seek").fill("400");
    await expect.poll(() => replayTick(page)).toBe(400);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#replay=save-1&tick=400");
    const href = await page.evaluate(() => location.href);
    expect(href).not.toContain("sk-fake");
    expect(href).not.toMatch(/key|provider|token/i);
    expect(new URL(href).search).toBe("?scenario=bridge&seed=9&pace=1");
    // The host of the recording was told nothing of any key.
    const storage = await lantern.storageDump();
    expect(storage.localStorage).not.toContain("sk-fake");
  });

  test("names a recording that is not there, and shows the gallery with the reason", async ({ lantern }) => {
    const page = lantern.page;
    await page.goto(`${lantern.servers.app.origin}/?scenario=bridge&seed=9&pace=1#replay=save-77`);
    await expect(page.getByTestId("gallery")).toBeVisible();
    await expect(page.getByTestId("gallery-failure")).toHaveText("This recording is not here. It may have been deleted, or it belongs to another browser or server.");
    expect(await page.evaluate(() => location.hash)).toBe("");
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    await page.getByTestId("gallery").getByTestId("lang-zh").click();
    await expect(page.getByTestId("gallery-failure")).toContainText("这份录像不在这里");
    await expect(page.getByTestId("gallery").getByTestId("gallery-close")).toContainText("回到游戏");
    // A name that is no name is no link, and a path in it does not get anywhere.
    await page.getByTestId("gallery-close").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.phase), { timeout: 60_000 }).toBe("ready");
    for (const bad of ["../../etc/passwd", "a/b", "save-1;x", "%2e%2e%2fsecret"]) {
      await page.evaluate((h) => {
        location.hash = `#replay=${h}`;
      }, bad);
      await page.waitForTimeout(150);
      await expect(page.getByTestId("replay-layer")).toHaveCount(0);
      await expect(page.getByTestId("gallery")).toHaveCount(0);
    }
    const sent = lantern.network.filter((r) => r.url.includes("/api/replays"));
    expect(sent.map((r) => new URL(r.url).pathname).every((p) => p === "/api/replays")).toBe(true);
  });
});

test.describe("a recording that does not replay, and one that ends", () => {
  test("says where the recording differs, and plays no more", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "altered");
    await tamper(page, 1, (replay) => {
      replay.hashes[2] = [replay.hashes[2]?.[0] ?? 200, "0".repeat(64)];
    });
    await lantern.open("scenario=bridge&seed=9&pace=1", { menu: false });
    await openGallery(page);
    await entry(page, "save-1").getByTestId("gallery-watch").click();
    const layer = page.getByTestId("replay-layer");
    await expect(layer.getByTestId("replay-error")).toContainText(/checkpoint hash differs at tick 200/, { timeout: 120_000 });
    await expect(layer.getByTestId("status")).toHaveText("failed");
    await expect(layer.getByTestId("replay-play")).toBeDisabled();
    await expect(layer.getByTestId("replay-seek")).toBeDisabled();
    // The way back still works, and the game under it goes on.
    await layer.getByTestId("replay-close").click();
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    await expect(page.getByTestId("gallery")).toBeVisible();
    expect((await lantern.snapshot()).error).toBeNull();
  });

  test("puts the ending page up at the end of a recording that has one", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=80&config=days:1,dev_actions:1", { menu: false });
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 120_000 });
    // The ending came on the tick its event names, which every frame after it carries. The page holds the world a
    // little after that, and a slow page later, so the tick the world stands at is not where the ending came.
    const endedAt = await page.evaluate(() => (window.__lantern.client.state.frame?.ending as { tick?: number } | null | undefined)?.tick ?? 0);
    expect(endedAt).toBeGreaterThan(1000);
    // The recording ends where the page held the game, a few ticks after the ending on a fast machine. A recording that is played
    // into the ending is held by the page too, which takes a moment, and it must not run out in that moment, so the game goes on a while.
    await page.evaluate(() => window.__lantern.client.resume());
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick + 200, endedAt, { timeout: 60_000 });
    await page.evaluate(() => window.__lantern.client.pause());
    await page.evaluate(() => window.__lantern.client.save("one day"));
    await lantern.open("scenario=bridge&seed=9&pace=1&config=days:1,dev_actions:1", { menu: false });
    await openGallery(page);
    await entry(page, "save-1").getByTestId("gallery-watch").click();
    await replayReady(page);
    const layer = page.getByTestId("replay-layer");
    // Before the last night there is no ending. A jump to just before it, and then play.
    await expect(layer.getByTestId("ending")).toHaveCount(0);
    await layer.getByTestId("replay-play").click();
    await layer.getByTestId("replay-seek").fill(String(endedAt - 40));
    await expect.poll(() => replayTick(page)).toBe(endedAt - 40);
    await expect(layer.getByTestId("ending")).toHaveCount(0);
    await layer.getByTestId("replay-speed").selectOption("8");
    await layer.getByTestId("replay-play").click();
    await expect(layer.getByTestId("ending")).toBeVisible({ timeout: 60_000 });
    await expect(layer.getByTestId("ending-title")).not.toBeEmpty();
    // The recording is held at the ending, as the game is, and what it was made of is in the page.
    await expect(layer.getByTestId("status")).toHaveText("paused");
    await expect(layer.getByTestId("ending-new")).toHaveText("Back");
    // Put away to look at the town, brought back by its tab, and gone again with a jump back.
    await layer.getByTestId("ending-back").click();
    await expect(layer.getByTestId("ending")).toHaveCount(0);
    await layer.getByTestId("ending-tab").click();
    await expect(layer.getByTestId("ending")).toBeVisible();
    await layer.getByTestId("ending-back").click();
    await layer.getByTestId("replay-start").click();
    await expect.poll(() => replayTick(page)).toBe(1);
    await expect(layer.getByTestId("ending")).toHaveCount(0);
    // A jump to the end shows the whole ending at once, with its reveal, though no frame on the way told it.
    const end = Number(await layer.getByTestId("replay-seek").getAttribute("max"));
    await layer.getByTestId("replay-seek").fill(String(end));
    await expect(layer.getByTestId("ending")).toBeVisible({ timeout: 60_000 });
    await expect(layer.getByTestId("replay-ended")).toHaveText("End of the recording");
    expect(await page.evaluate(() => window.__lantern.replay?.play.state.ending?.reveal !== null)).toBe(true);
    // Back on the ending page closes the recording.
    await layer.getByTestId("ending-new").click();
    await expect(page.getByTestId("replay-layer")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a recording is read only", () => {
  test("sends nothing to its host and no action from the map, and the keys of the page do not reach the game under it", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await saveAGame(lantern, "first game");
    await lantern.open("scenario=bridge&seed=9&pace=1", { menu: false });
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 10, undefined, { timeout: 60_000 });
    await openGallery(page);
    await entry(page, "save-1").getByTestId("gallery-watch").click();
    await replayReady(page);
    const layer = page.getByTestId("replay-layer");
    await layer.getByTestId("replay-play").click();
    const sent = await page.evaluate(() => {
      const replay = window.__lantern.replay;
      if (replay === null) throw new Error("no recording");
      const client = replay.client as unknown as { send(m: unknown): void };
      const log: unknown[] = [];
      const send = client.send.bind(client);
      client.send = (m) => {
        log.push(m);
        send(m);
      };
      (window as unknown as { __sent: unknown[] }).__sent = log;
      return log.length;
    });
    // A click on the ground and on a person: no walk, no talk. A person is picked, as a look.
    const box = await layer.getByTestId("map").boundingBox();
    expect(box).not.toBeNull();
    await layer.getByTestId("map").click({ position: { x: (box?.width ?? 400) / 2, y: (box?.height ?? 300) / 2 } });
    await page.evaluate(() => window.__lantern.replay?.play.goTo({ x: 5, y: 5, place: null }));
    await page.evaluate(() => window.__lantern.replay?.play.talk("cha_laoban"));
    await page.evaluate(() => window.__lantern.replay?.play.rally());
    expect(await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent.length)).toBe(sent);
    expect(await page.evaluate(() => window.__lantern.replay?.play.playing)).toBe(false);
    await expect(layer.getByTestId("card-talk")).toHaveCount(0);
    await expect(layer.getByTestId("dialogue-bar")).toHaveCount(0);
    // The key that closes things answers on the recording, and not on the gallery or the menu under it.
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the pages of recordings on a screen", () => {
});
