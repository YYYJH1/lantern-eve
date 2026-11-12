import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Replay } from "../../src/shared/protocol.ts";
import { replayInCpython } from "../support/fixtures.ts";
import { startServerHost } from "../support/server-host.ts";
import { pressStart } from "../support/start.ts";

// The opening game on a real `lantern-eve play`: the same page, the same opening, the game that the core names and not one the page
// made up, and what the server writes of it.

const SLICE = { variant: "v_boat", opening: "op_li_er_hearsay", weather_heavy: 0 };
// What every game of the slice's rules has, whatever its seed and the story that is true in it.
const RULES = { opening: "op_li_er_hearsay", weather_heavy: 0 };

const gameOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({ seed: window.__lantern.client.state.seed, scenario: window.__lantern.client.state.scenario, preset: window.__lantern.client.state.preset }));

test.describe("the opening game on the server host", () => {
  test("plays the game the core names for a page that names no seed, and the replay the server writes keeps the texts of its config and rebuilds under CPython", async ({ page }) => {
    test.setTimeout(300_000);
    const server = await startServerHost("slice", ["--pace", "20"]);
    let second = { seed: 492, scenario: "bridge", preset: null as string | null };
    try {
      await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
      await page.goto(`${server.origin}/?host=ws&map=off`);
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      // A server host has no saves, and the page says so.
      await expect(page.getByTestId("opening-continue")).toBeDisabled();
      await expect(page.getByTestId("opening-continue-note")).toHaveText("This server keeps no saves. Saves are kept when the game runs in your browser.");
      // The world is held behind the opening page, in the game the core names.
      expect(await gameOf(page)).toEqual({ seed: 492, scenario: "bridge", preset: "slice" });
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => ({ tick: window.__lantern.client.state.simTick, paused: window.__lantern.client.state.paused }))).toEqual({ tick: 0, paused: true });

      await pressStart(page);
      await expect(page.getByTestId("opening")).toHaveCount(0);
      await expect(page.getByTestId("status")).toHaveText("running");
      await page.waitForFunction(() => window.__lantern.client.state.simTick >= 60, undefined, { timeout: 60_000 });
      await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
      await expect(page.getByTestId("seed")).toHaveText("492");
      // What the page exports is a recording of the slice, with the texts of the config as the core has them.
      const replay = await page.evaluate(() => window.__lantern.client.exportReplay());
      expect(replay.host).toMatchObject({ name: "server" });
      expect(replay.header.seed).toBe(492);
      expect(replay.header.config).toMatchObject(SLICE);

      // A new game from the menu is the rules of the slice, asked for by name, at a seed of its own and with a story true that the page picks
      // (the first day is the same, so the first card is the bamboo), and the first game's replay is written.
      const before = await page.evaluate(() => window.__lantern.client.state.simTick);
      await page.getByTestId("btn-menu").click();
      await page.getByTestId("btn-new").click();
      await expect.poll(() => page.evaluate(() => window.__lantern.client.state.simTick), { timeout: 30_000 }).toBeLessThan(before);
      second = await gameOf(page);
      expect(second.preset).toBe("slice");
      expect(second.scenario).toBe("bridge");
      expect(second.seed).not.toBe(492);
      await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
      await page.waitForFunction(() => window.__lantern.client.state.simTick >= 20, undefined, { timeout: 60_000 });
      const replay2 = await page.evaluate(() => window.__lantern.client.exportReplay());
      expect(replay2.header.seed).toBe(second.seed);
      expect(replay2.header.config).toMatchObject(RULES);
      expect(["v_boat", "v_flood", "v_drunk"]).toContain(String(replay2.header.config.variant));
    } finally {
      expect(await server.stop()).toBe(0);
    }
    // The server wrote both games when it stopped, and each of them is the rules of the slice (the first game itself, the second at its
    // own seed) and plays again under CPython with the same hashes.
    const files = readdirSync(server.runsDir).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(2);
    const written = files.map((file) => JSON.parse(readFileSync(path.join(server.runsDir, file), "utf8")) as Replay);
    expect(written.map((w) => w.header.seed).sort()).toEqual([492, second.seed].sort());
    for (const [i, replay] of written.entries()) {
      expect(replay.header.config).toMatchObject(RULES);
      if (replay.header.seed === 492) expect(replay.header.config).toMatchObject(SLICE);
      const report = replayInCpython(replay, `guide-slice-${i}`);
      expect(report.ok, JSON.stringify(report)).toBe(true);
    }
  });

  test("holds the world under the first card of the tutorial and lets it go when the card is put away", async ({ page }) => {
    test.setTimeout(240_000);
    const server = await startServerHost("tutorial", ["--pace", "20"]);
    try {
      await page.goto(`${server.origin}/?host=ws&map=off`);
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      await pressStart(page);
      await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "granny");
      const held = await page.evaluate(() => window.__lantern.client.state.simTick);
      await page.waitForTimeout(1200);
      expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBe(held);
      await expect(page.getByTestId("status")).toHaveText("paused");
      await page.getByTestId("tutorial-next").click();
      await expect(page.getByTestId("tutorial-chip")).toBeVisible();
      await expect(page.getByTestId("status")).toHaveText("running");
      await expect.poll(() => page.evaluate(() => window.__lantern.client.state.simTick), { timeout: 30_000 }).toBeGreaterThan(held + 20);
      // Skipping from the line ends it.
      await page.getByTestId("tutorial-skip").click();
      await expect(page.getByTestId("tutorial-chip")).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("lantern.tutorial"))).toBe("skipped");
    } finally {
      expect(await server.stop()).toBe(0);
    }
  });

  test("lets a page that names its seed play that seed, whatever the server was started with", async ({ page }) => {
    test.setTimeout(240_000);
    const server = await startServerHost("named-seed", ["--pace", "20", "--preset", "slice"]);
    try {
      await page.goto(`${server.origin}/?host=ws&seed=5&scenario=bridge&map=off`);
      await page.waitForFunction(() => window.__lantern?.client.state.phase === "ready", undefined, { timeout: 90_000 });
      await expect(page.getByTestId("opening")).toHaveCount(0);
      await page.waitForFunction(() => window.__lantern.client.state.simTick >= 30, undefined, { timeout: 60_000 });
      expect(await gameOf(page)).toEqual({ seed: 5, scenario: "bridge", preset: null });
      const replay = await page.evaluate(() => window.__lantern.client.exportReplay());
      expect(replay.header.seed).toBe(5);
      expect(replay.header.config).not.toHaveProperty("opening");
      // And the page that names no game is the one the server was told to start: the slice, by its name.
      const other = await page.context().newPage();
      await other.goto(`${server.origin}/?host=ws&map=off`);
      await expect(other.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      expect(await gameOf(other)).toEqual({ seed: 492, scenario: "bridge", preset: "slice" });
      await other.close();
    } finally {
      expect(await server.stop()).toBe(0);
    }
  });
});
