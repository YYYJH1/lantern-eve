import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { SeekStart } from "../../src/shared/player.ts";
import { DIST_E2E, OUT_DIR, REPO_DIR } from "../support/fixtures.ts";

interface ServerHost {
  origin: string;
  /** Ends the server with SIGTERM, which makes it write its replays, and waits for it to exit. */
  stop(): Promise<number | null>;
}

/** Starts `lantern-eve play` on a free port with the folder for its replays, and returns where it listens. */
async function startServerHost(runsDir: string, options: string[]): Promise<ServerHost> {
  const child: ChildProcess = spawn(
    "uv",
    ["run", "--project", REPO_DIR, "--directory", REPO_DIR, "lantern-eve", "play", "--port", "0", "--web-dir", DIST_E2E, "--runs-dir", runsDir, ...options],
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
    async stop() {
      if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
      return exited;
    },
  };
}

test("the gallery lists the replays that the server wrote, plays one in the browser, and seeks by the snapshots it carries", async ({ page }) => {
  test.setTimeout(420_000);
  const runsDir = path.join(OUT_DIR, "server-host", "gallery");
  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));

  // A game of the bridge town on a server host, which writes its replay when it stops.
  const first = await startServerHost(runsDir, ["--pace", "20"]);
  try {
    await page.goto(`${first.origin}/?host=ws&seed=4242&scenario=bridge&map=off`);
    await page.waitForFunction(() => (window.__lantern?.client.state.simTick ?? 0) >= 760, undefined, { timeout: 120_000 });
  } finally {
    await first.stop();
  }
  const written = readdirSync(runsDir).filter((name) => name.endsWith(".json"));
  expect(written).toHaveLength(1);
  const id = (written[0] ?? "").replace(/\.json$/, "");

  const second = await startServerHost(runsDir, ["--pace", "1"]);
  try {
    await page.goto(`${second.origin}/?host=ws&seed=1&scenario=bridge&map=off`);
    await page.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 120_000 });

    // What the endpoint says: the one replay, with what a list shows. The browser has no saves.
    const listing = await page.evaluate(() => fetch("api/replays").then((r) => r.json() as Promise<{ replays: Array<Record<string, unknown>> }>));
    expect(listing.replays).toHaveLength(1);
    expect(listing.replays[0]).toMatchObject({ id, seed: 4242, scenario: "bridge", host: "server" });
    expect(Number(listing.replays[0]?.endTick)).toBeGreaterThanOrEqual(760);
    expect(Number(listing.replays[0]?.snapshots)).toBeGreaterThanOrEqual(6);
    // A name that is not a file of the folder is not served, and neither is a way out of it.
    for (const bad of ["nothing-here", "..", "%2e%2e%2f%2e%2e%2fpackage", ".hidden"]) {
      const status = await page.evaluate((name) => fetch(`api/replays/${name}`).then((r) => r.status), bad);
      expect(status, bad).toBe(404);
    }
    expect(await page.evaluate(() => fetch("api/replays", { method: "POST", body: "{}" }).then((r) => r.status))).toBe(405);

    await page.getByTestId("btn-menu").click();
    await page.getByTestId("btn-replays").click();
    await expect(page.getByTestId("gallery")).toBeVisible();
    await expect(page.getByTestId("gallery-browser-empty")).toBeVisible();
    const row = page.locator(`[data-testid="gallery-server"] [data-testid="gallery-entry"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-id", id);
    await expect(row).toHaveAttribute("data-source", "server");
    await expect(row.getByTestId("gallery-name")).toHaveText("Game with seed 4242");
    await expect(row.getByTestId("gallery-meta")).toContainText(/\d+ ticks, bridge, .* (KB|MB), core /);
    await page.getByTestId("gallery").getByTestId("lang-zh").click();
    await expect(row.getByTestId("gallery-name")).toHaveText("种子 4242 的一局");
    await expect(page.getByTestId("gallery-server").locator("h3")).toContainText("这台服务器上打过的");

    // Watch it: the browser plays what the server wrote, with the core of its own.
    await row.getByTestId("gallery-watch").click();
    const layer = page.getByTestId("replay-layer");
    await expect(layer).toBeVisible();
    await page.waitForFunction(
      () => {
        const status = window.__lantern.replay?.client.state.replay;
        return status?.phase === "ready" && !status.busy;
      },
      undefined,
      { timeout: 120_000 },
    );
    const status = await page.evaluate(() => window.__lantern.replay?.client.state.replay);
    expect(status).toMatchObject({ seed: 4242, scenario: "bridge", host: "server", error: null });
    // The recording carries a snapshot for each game hour, so the host has them before it has played a tick.
    expect(status?.snapshots).toBeGreaterThanOrEqual(6);
    await layer.getByTestId("replay-play").click();
    const seek = async (tick: number): Promise<void> => {
      await layer.getByTestId("replay-seek").fill(String(tick));
      await expect.poll(() => page.evaluate(() => window.__lantern.replay?.client.state.simTick ?? 0), { timeout: 60_000 }).toBe(tick);
    };
    await seek(600);
    await seek(200);
    await seek(500);
    await layer.getByTestId("replay-start").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.replay?.client.state.simTick ?? 0)).toBe(1);
    // Where each jump started: the latest snapshot before its tick, or the beginning, never the whole way from tick 0.
    const starts = (await page.evaluate(() => window.__lantern.replay?.client.e2e<{ starts: SeekStart[] }>("state"))) as { starts: SeekStart[] };
    expect(starts.starts.map((s) => [s.target, s.kind, s.from])).toEqual([
      [1, "start", 0],
      [600, "snapshot", 480],
      [200, "snapshot", 120],
      [500, "snapshot", 480],
      [1, "start", 0],
    ]);
    // The page asked the server for the file of the recording once (the other names it asked for were the probes above).
    expect(requests.filter((p) => p === `/api/replays/${id}`)).toHaveLength(1);
    await layer.getByTestId("replay-close").click();

    // A link to a moment in it, on the server host's page.
    await page.goto(`${second.origin}/?host=ws&scenario=bridge&map=off#replay=${id}&tick=400`);
    await expect(page.getByTestId("replay-layer")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__lantern.replay?.client.state.simTick ?? 0), { timeout: 120_000 }).toBe(400);
    expect(await page.evaluate(() => window.__lantern.client.state.phase)).toBe("boot");
    await page.getByTestId("replay-layer").getByTestId("replay-close").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.phase), { timeout: 60_000 }).toBe("ready");
  } finally {
    await second.stop();
  }
});
