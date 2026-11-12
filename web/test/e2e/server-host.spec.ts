import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { DIST_E2E, OUT_DIR, REPO_DIR, replayInCpython } from "../support/fixtures.ts";
import { clearTheMap } from "../support/play.ts";
import { openTopic } from "../support/real.ts";

interface ServerHost {
  origin: string;
  runsDir: string;
  /** Ends the server with SIGTERM, which makes it write its replays, and waits for it to exit. */
  stop(): Promise<number | null>;
  stderr(): string;
}

/**
 * Starts `lantern-eve play` on a free port, serving the test build, and returns where it listens.
 * The options are those of `play`: by default the demo world with its busy talk.
 */
async function startServerHost(name: string, options: string[] = ["--config", "chatter_per_mille=900"]): Promise<ServerHost> {
  const runsDir = path.join(OUT_DIR, "server-host", name);
  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  const child: ChildProcess = spawn(
    "uv",
    [
      "run", "--project", REPO_DIR, "--directory", REPO_DIR,
      "lantern-eve", "play",
      "--port", "0", "--web-dir", DIST_E2E, "--runs-dir", runsDir,
      ...options,
    ],
    // A group of its own, so that one signal reaches uv and the server it started.
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

  const origin = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`the server did not say where it listens in 90 s: ${stderr}`)), 90_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    void exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`the server exited with ${String(code)} before it listened: ${stderr}`));
    });
  });

  return {
    origin,
    runsDir,
    stderr: () => stderr,
    async stop() {
      if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
      return exited;
    },
  };
}

test("the page drives a server host over a WebSocket: frames advance, pause holds, and the replay it exports checks out", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await startServerHost("drive");
  const consoleLines: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const documentResponse = page.waitForResponse((response) => response.request().resourceType() === "document");

  try {
    await page.goto(`${server.origin}/?host=ws&seed=4242&scenario=m0&map=off`);
    const policy = (await (await documentResponse).allHeaders())["content-security-policy"];
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("worker-src 'self'");
    await page.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 60_000 });

    // The server host's frames arrive and move the world.
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 25, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect(page.getByTestId("seed")).toHaveText("4242");
    const frames = await page.evaluate(() => window.__lantern.client.state.frameCount);
    expect(frames).toBeGreaterThanOrEqual(25);
    const ready = await page.evaluate(() => window.__lantern.client.state.ready);
    expect(ready?.pythonVersion).toContain("server");
    expect(ready?.coreFormat).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.stats?.calls ?? 0)).toBeGreaterThan(20);

    // Nothing of the browser host was loaded: no Pyodide, no wheel, and the worker was not started.
    expect(requests.filter((p) => p.startsWith("/pyodide/") || p.startsWith("/core/"))).toEqual([]);

    // Pause from the page: the server holds the world, and the page sees it.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    const held = await page.evaluate(() => window.__lantern.client.state.simTick);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBe(held);

    // An action sent while the world is held is applied at once and acknowledged by the core.
    await page.evaluate(() => window.__lantern.client.player({ action_id: "e2e-1", type: "summon", npc: "npc03", x: 31, y: 10 }));
    await page.waitForFunction(
      () => window.__lantern.client.state.events.some((e) => e.kind === "action_ack" && e.action_id === "e2e-1"),
      undefined,
      { timeout: 15_000 },
    );
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBe(held);

    // Resume: the world goes on from where it was held.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick + 15, held, { timeout: 30_000 });

    // The connection drops. The server holds the world while nobody is there, the page asks for its
    // session again, and the game goes on from where it was held.
    const dropped = await page.evaluate(() => window.__lantern.client.state.simTick);
    await page.evaluate(() => (window.__lantern.client as unknown as { port: { ws: WebSocket } }).port.ws.close());
    await page.waitForFunction(() => window.__lantern.client.state.notices.some((n) => n.code === "connection_lost"), undefined, { timeout: 15_000 });
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick + 15, dropped, { timeout: 30_000 });
    await expect(page.getByTestId("status")).toHaveText("running");

    // A frame whose number jumps is not drawn. The page asks for the whole state instead, gets it,
    // and the frames that follow are in sequence again.
    type Port = { receive(text: string): void; lastSeq: number; awaitingState: boolean };
    const jumped = await page.evaluate(() => {
      const port = (window.__lantern.client as unknown as { port: Port }).port;
      const bogus = { type: "frame", seq: port.lastSeq + 9, tick: 999_999, advanced: true, frame: { npcs: [] }, events: [], clock: { paused: false, rate: [1, 1] } };
      port.receive(JSON.stringify(bogus));
      return { asked: port.awaitingState, tick: window.__lantern.client.state.simTick };
    });
    expect(jumped.asked).toBe(true);
    expect(jumped.tick).toBeLessThan(100_000);
    await page.waitForFunction(() => !(window.__lantern.client as unknown as { port: Port }).port.awaitingState, undefined, { timeout: 15_000 });
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick + 10, jumped.tick, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBeLessThan(100_000);

    // The replay as the page exports it is the server's, and the browser tests' checker agrees with it.
    const replay = await page.evaluate(() => window.__lantern.client.exportReplay());
    expect(replay.host).toEqual({ name: "server", version: expect.any(String), replayFormat: 1 });
    expect(replay.header).toMatchObject({ format: 1, seed: 4242, scenario: "m0" });
    expect(replay.base).toBeNull();
    // Pause and resume from the page, the action, and the hold and release for the lost connection.
    expect(replay.records.filter((r) => r[2] !== "model_result").map((r) => r[2])).toEqual(["pause", "player", "resume", "pause", "resume"]);
    const cpython = replayInCpython(replay, "server-host");
    expect(cpython.error).toBeUndefined();
    expect(cpython).toMatchObject({ ok: true, final_tick: replay.end_tick, final_hash: replay.final.hash, mismatches: [] });

    // No policy violation and no error on the way.
    const snap = await page.evaluate(() => ({ error: window.__lantern.client.state.error, notices: window.__lantern.client.state.notices }));
    expect(snap.error).toBeNull();
    expect(snap.notices.map((n) => n.code)).toEqual(["connection_lost"]);
    expect(consoleLines.filter((l) => /Content Security Policy|^\[(error|pageerror)\]/.test(l))).toEqual([]);
  } finally {
    const status = await server.stop();
    expect(status, server.stderr()).toBe(0);
  }

  // Stopping the server wrote the game's replay to its runs directory, and it is the one that was exported.
  const files = readdirSync(server.runsDir).filter((f) => f.endsWith(".json"));
  expect(files).toHaveLength(1);
  const written = JSON.parse(readFileSync(path.join(server.runsDir, files[0] ?? ""), "utf8")) as { header: { seed: number }; end_tick: number };
  expect(written.header.seed).toBe(4242);
  expect(written.end_tick).toBeGreaterThanOrEqual(25);
});

test("the page draws the bridge town from a server host too: the scene comes with the state, and the numbers and the names follow the language", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await startServerHost("bridge-town", ["--pace", "20"]);
  const lines: string[] = [];
  page.on("console", (message) => lines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => lines.push(`[pageerror] ${error.message}`));
  try {
    await page.goto(`${server.origin}/?host=ws&seed=7&scenario=bridge`);
    await page.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 60_000 });
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 60, undefined, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.__lantern.view.stats().people), { timeout: 30_000 }).toBe(20);
    await expect(page.getByTestId("map")).toHaveAttribute("data-dots", "20");
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");
    // The slip of the first day: the core follows its first task from the start, and the speed of the day is the page's own choice, which the server host does not take. It is chosen in the menu, as the language is.
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Get the first load of bamboo from the Li family");
    await page.getByTestId("btn-menu").click();
    await page.getByTestId("speed-slow").click();
    await expect(page.getByTestId("speed-slow")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.phase)).toBe("ready");
    await expect.poll(() => page.evaluate(() => window.__lantern.view.texts().labels.p_teahouse)).toBe("Teahouse");
    await page.getByTestId("lang-zh").click();
    await page.getByTestId("menu-close").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.view.texts().labels.p_teahouse)).toBe("茶馆");
    await expect(page.getByTestId("hud-day")).toHaveText("第一天");
    // The server sends the scene with every whole state, and the page draws the town once.
    expect(await page.evaluate(() => window.__lantern.client.state.sceneVersion)).toBe(1);
    expect(lines.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[error]"))).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("the player plays the bridge town through a server host: a walk, a talk with a question, a call for helpers, and the ending", async ({ page }) => {
  test.setTimeout(240_000);
  // A game of one day, with the test actions, at ten times the speed.
  const server = await startServerHost("play", ["--scenario", "bridge", "--pace", "10", "--config", "days=1", "--config", "dev_actions=1"]);
  const lines: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => lines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => lines.push(`[pageerror] ${error.message}`));
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  try {
    await page.goto(`${server.origin}/?host=ws&seed=7&scenario=bridge`);
    await page.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.__lantern.view.stats().people), { timeout: 30_000 }).toBe(20);
    expect(requests.filter((p) => p.startsWith("/pyodide/") || p.startsWith("/core/"))).toEqual([]);
    await page.evaluate(() => window.__lantern.client.pause());
    await expect(page.getByTestId("status")).toHaveText("paused");

    // The player is on the map, and a click on a building walks them to its door: the server acknowledges, and the page marks the way.
    await expect.poll(async () => (await page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).dataset.player)) ?? "").toMatch(/^\d+,\d+$/);
    const building = await page.evaluate(() => window.__lantern.play.scene?.buildings.find((b) => b.place === "p_teahouse"));
    const door = await page.evaluate(() => window.__lantern.play.scene?.places.find((p) => p.id === "p_teahouse")?.door);
    if (building === undefined || door == null) throw new Error("no teahouse");
    const at = await page.evaluate(([x, y]) => window.__lantern.view.cellToScreen(x as number, y as number), [building.x + 1, building.y + 1]);
    await clearTheMap(page);
    await page.getByTestId("map").click({ position: at });
    await expect.poll(async () => (await page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).dataset.destination)) ?? "").toBe(`${door[0]},${door[1]}`);
    await page.evaluate(() => window.__lantern.client.resume());
    await page.waitForFunction(([x, y]) => window.__lantern.play.view?.player?.x === x && window.__lantern.play.view?.player?.y === y, door, { timeout: 30_000 });
    // The keeper of the teahouse is at work from seven until noon, and a talk with the keeper ends when the keeper has to go, so the world runs on to eight o'clock first: the question below costs minutes, and a talk that begins just before seven would be over in the middle of it.
    await page.waitForFunction(() => window.__lantern.client.state.simTick >= 240, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__lantern.client.pause());
    await expect(page.getByTestId("status")).toHaveText("paused");

    // A refusal comes back over the same connection, with its reason.
    const river = await page.evaluate(() => {
      const scene = window.__lantern.play.scene;
      // A few rows below the top of the river: the slip hangs over the top of the map and takes a click.
      const cells: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < (scene?.rows.length ?? 0); y++) for (let x = 0; x < (scene?.rows[y]?.length ?? 0); x++) if (scene?.legend.get(scene.rows[y]?.charAt(x) ?? "") === "river") cells.push({ x, y });
      const top = cells[0];
      if (top === undefined) throw new Error("no river");
      return cells.find((cell) => cell.y >= top.y + 6) ?? top;
    });
    const wet = await page.evaluate(([x, y]) => window.__lantern.view.cellToScreen(x as number, y as number), [river.x, river.y]);
    await clearTheMap(page);
    await page.getByTestId("map").click({ position: wet });
    await expect(page.getByTestId("game-note").last()).toHaveText("You cannot walk onto that spot.");

    // Talk to the keeper of the teahouse, who is somewhere near, and ask her about the boat.
    const spot = await page.evaluate(() => window.__lantern.view.screenPositionOf("cha_laoban"));
    if (spot === null) throw new Error("no keeper");
    await clearTheMap(page);
    await page.getByTestId("map").click({ position: spot });
    await expect(page.getByTestId("person-name")).toHaveText("Teahouse Keeper");
    if ((await page.getByTestId("card-talk").getAttribute("data-near")) !== "true") {
      await page.getByTestId("card-talk").click();
      await page.evaluate(() => window.__lantern.client.resume());
    } else {
      await page.getByTestId("card-talk").click();
    }
    await expect(page.getByTestId("talk-badge")).toBeVisible({ timeout: 30_000 });
    // The talk holds the world by itself: the core's clock is paused at the normal rate, the badge says that the world stands still and when the person has to go, and the bar says that the time is held. The page lets go of its own pause, so that nothing else holds it.
    await page.evaluate(() => window.__lantern.client.resume());
    await expect(page.getByTestId("status")).toHaveText("time stopped");
    expect(await page.evaluate(() => window.__lantern.client.state.rate)).toEqual([1, 1]);
    expect(await page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await expect(page.getByTestId("talk-still")).toBeVisible();
    await expect(page.getByTestId("talk-leaves")).toHaveText(/^Leaves at \d\d:\d\d$/);
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    // A question costs ten minutes. The world runs through them at once and holds again, and the server's mock model, whose answer is due a good many ticks after the question, answers while it is held: the clock of the model's transport goes on when the clock of the game does not.
    expect(await openTopic(page, "t_he_boat")).toBe(true);
    await page.locator('[data-testid="topic-chip"][data-id="t_he_boat"]').click();
    await expect(page.getByTestId("talk-line")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.stats?.models.ok ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await expect(page.getByTestId("talk-badge")).toBeVisible();
    // The tape has it: the answer went into the game at the tick the world stood at once the question was paid for, twenty ticks (ten minutes of the day) after the question.
    const tape = await page.evaluate(() => window.__lantern.client.exportReplay());
    const question = tape.records.find((r) => r[2] === "player" && r[3].type === "ask");
    const answer = tape.records.find((r) => r[2] === "model_result");
    expect(question).toBeDefined();
    expect(answer?.[0]).toBe((question?.[0] ?? -1) + 20);
    const entries = await page.evaluate(() => (window.__lantern.client.state.frame?.notebook as unknown[]).length);
    await expect(page.getByTestId("notebook-count")).toHaveText(String(entries));
    // Leaving lets the world run at its pace again.
    await page.getByTestId("verb-leave").click();
    await expect(page.getByTestId("talk-badge")).toHaveCount(0);
    const left = await page.evaluate(() => window.__lantern.client.state.simTick);
    await page.waitForFunction((tick) => window.__lantern.client.state.simTick >= tick + 20, left, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__lantern.client.state.rate)).toEqual([1, 1]);
    await expect(page.getByTestId("status")).toHaveText("running");
    // The page holds the world again for what follows, as it did before the talk.
    await page.evaluate(() => window.__lantern.client.pause());
    await expect(page.getByTestId("status")).toHaveText("paused");

    // Call for helpers, and let the day run to its last night. The page shows the ending that the server's core wrote.
    await page.getByTestId("verb-rally").click();
    // Whoever joins at once is a note too, after it.
    await expect(page.getByTestId("game-note").filter({ hasText: "You called on the town to come and help." })).toHaveCount(1);
    await page.evaluate(() => {
      window.__lantern.client.player({ type: "dev_goal", op: "truth" });
      window.__lantern.client.resume();
    });
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 150_000 });
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("status")).toHaveText("paused");
    const label = await page.evaluate(() => (window.__lantern.client.state.events.find((e) => e.kind === "ending")?.label as { en: string }).en);
    await expect(page.getByTestId("ending-title")).toHaveText(label);
    await expect(page.getByTestId("reveal-chain")).not.toHaveCount(0);
    await expect(page.getByTestId("ending-checks")).toBeVisible();
    const trees = await page.getByTestId("tree-node").count();

    // The world goes on a little after the ending, and its frames carry the ending without the reveal. The page keeps the whole one.
    await page.evaluate(() => window.__lantern.client.resume());
    await page.waitForFunction(
      () => {
        const ending = window.__lantern.client.state.frame?.ending as Record<string, unknown> | null | undefined;
        return ending != null && !("reveal" in ending);
      },
      undefined,
      { timeout: 30_000 },
    );
    expect(await page.evaluate(() => window.__lantern.play.state.ending?.reveal != null)).toBe(true);
    await page.evaluate(() => window.__lantern.client.pause());
    // The host answers a pause with a frame, after the ticks that were due when the pause came. A frame that carries the ending gives a page that has none its ending (as a page
    // that comes to a game that is over has it), so the page forgets the ending below only once the answer is in: it says it is paused when it has read that frame.
    await page.waitForFunction(() => window.__lantern.client.state.paused === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("tree-node")).toHaveCount(trees);

    // The page comes back to the game that is over: it has forgotten the ending, the connection is made again, and the
    // state that the server then sends has the whole ending in it, with its reveal. Its frame has the compact one.
    await page.evaluate(() => {
      const play = window.__lantern.play;
      play.state.ending = null;
      play.state.endingOpen = false;
      // The page draws again when something tells it to, and a paused world whose answer is in sends nothing that does: it is told.
      play.touch();
    });
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await page.evaluate(() => (window.__lantern.client as unknown as { port: { ws: WebSocket } }).port.ws.close());
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("ending-title")).toHaveText(label);
    await expect(page.getByTestId("tree-node")).toHaveCount(trees);
    expect(lines.filter((l) => /Content Security Policy|^\[(error|pageerror)\]/.test(l))).toEqual([]);
    expect(await page.evaluate(() => window.__lantern.client.state.error)).toBeNull();
  } finally {
    await server.stop();
  }
});
