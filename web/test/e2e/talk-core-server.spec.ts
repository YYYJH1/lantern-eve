import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Replay } from "../../src/shared/protocol.ts";
import { replayInCpython } from "../support/fixtures.ts";
import { openRequest, talkTo, untilHeld } from "../support/real.ts";
import { startServerHost } from "../support/server-host.ts";

// The same card as on the browser host, against a real `lantern-eve play`: the preview is asked of the server (the call `preview` of
// the WebSocket), it is the core's answer to the action, and the action goes out with the version of that preview.

test.use({ actionTimeout: 20_000 });

interface CorePreview {
  version: number;
  cost: number;
  asks: { zh: string; en: string };
  blockers: Array<{ zh: string; en: string }>;
  odds: string | null;
}

test.describe("a request on the server host", () => {
  test("is previewed by the core in the server, sent with the version of that preview, and the game that is recorded replays under CPython", async ({ page }) => {
    test.setTimeout(300_000);
    const server = await startServerHost("preview", ["--pace", "3"]);
    try {
      await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
      await page.goto(`${server.origin}/?host=ws&map=off`);
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      await page.getByTestId("opening-start").click();
      await expect(page.getByTestId("status")).toHaveText("running");
      await talkTo(page, "li_laotai");
      await untilHeld(page);

      await openRequest(page, "lend");
      const card = page.getByTestId("request-card");
      await expect(card).toHaveAttribute("data-phase", "preview");
      // The server answers the call, and the card says what it answered.
      const core = await page.evaluate(() => window.__lantern.client.call<CorePreview>({ op: "preview", action: { verb: "entrust", npc: "li_laotai", kind: "lend" } }));
      expect(core.cost).toBe(20);
      expect(core.odds).toBe("low");
      await expect(page.getByTestId("request-asks").locator("dd")).toHaveText(core.asks.en);
      await expect(page.getByTestId("request-blocker")).toHaveText(core.blockers.map((b) => b.en));
      await expect(card).toHaveAttribute("data-cost", "20");
      await expect(card).not.toHaveAttribute("data-fake", /.*/);
      // A call the server cannot read is an error reply, and the page does not stop.
      const refused = await page.evaluate(() => window.__lantern.client.call({ op: "preview", action: { verb: "dance", npc: "li_laotai" } }).then(
        () => "answered",
        (err: unknown) => (err as { code?: string }).code ?? "error",
      ));
      expect(refused).toBe("bad_action");
      expect(await page.evaluate(() => window.__lantern.client.state.phase)).toBe("ready");

      // Confirm. A model that words the answer may land in the held talk and move the state on first, and then the page looks again,
      // as it should: it goes on until the answer is there.
      for (let tries = 0; tries < 4 && (await card.getAttribute("data-phase")) !== "result"; tries++) {
        const phase = await card.getAttribute("data-phase");
        if (phase === "preview") await page.getByTestId("request-confirm").click();
        await page.waitForTimeout(400);
      }
      await expect(card).toHaveAttribute("data-phase", "result", { timeout: 30_000 });
      await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "false");
      await expect(page.getByTestId("request-result")).toHaveText("×Granny Li has a condition you have not met yet. That comes first.");
      await expect(page.getByTestId("request-spent")).toHaveText("That took 20 minutes.");
      const replay = await page.evaluate(() => window.__lantern.client.exportReplay());
      const sent = replay.records.filter((r) => r[2] === "player" && r[3].type === "entrust");
      expect(sent).toHaveLength(1);
      expect(sent[0]?.[3]).toMatchObject({ kind: "lend" });
      expect(typeof sent[0]?.[3].version).toBe("number");
      expect(sent[0]?.[3].version).toBeGreaterThanOrEqual(core.version);
    } finally {
      expect(await server.stop()).toBe(0);
    }
    // What the server wrote has the preview nowhere in it, and plays again with the same hashes.
    const files = readdirSync(server.runsDir).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(path.join(server.runsDir, files[0] ?? ""), "utf8")) as Replay;
    expect(written.records.some((r) => r[2] !== "player" && r[2] !== "pause" && r[2] !== "resume" && r[2] !== "model_result" && r[2] !== "host")).toBe(false);
    const report = replayInCpython(written, "talk-core-server");
    expect(report.ok, JSON.stringify(report)).toBe(true);
  });
});
