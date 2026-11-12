import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { advance, festival, frames, reasons, SHOTS, still } from "../support/festival.ts";
import { steady } from "../support/steady.ts";

// The festival night on the real core. A game of three days is played in the page (the helpers, the materials, the truth and the peace by the test
// actions of the core), the page watches its moments (the first lantern on each bank of the river, the first morning of work by both families) and
// takes a small picture for each while its show plays, and at the last night the festival night plays before the ending page, which has a row of
// the moments at its foot. The game saves itself at its end, and that recording is then played on a page of a recording to its end: it has the same
// night, the same moments with a picture each, and the same ending page. The shows play on a clock that the test moves by hand.
test.use({ map: true });

const GAME = "scenario=bridge&seed=7&pace=60&config=dev_actions:1,days:3&director=on&festival=on&showclock=manual&autosave=on";
const HEADS = ["li_laotai", "zhou_zhanggui"];
const JOINERS = ["cha_laoban", "li_da", "zhou_niangzi", "li_er", "li_xiaomei", "zhou_dalang", "zhou_erlang", "zhou_huoji", "old_he", "mujiang"];

const act = (page: Page, body: Record<string, unknown>) => page.evaluate((b) => window.__lantern.client.player(b), body);
const showOf = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('[data-testid="director"]')?.getAttribute("data-show") ?? null);
const tickOf = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.client.state.simTick);
/** A page that opened a recording: its host is ready (the game of the page does not begin under it, so the page is not ready in the other sense). */
async function recordingReady(page: Page): Promise<void> {
  await expect(page.getByTestId("replay-layer")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const status = window.__lantern.replay?.client.state.replay;
      return status?.phase === "ready" && !status.busy;
    },
    undefined,
    { timeout: 240_000 },
  );
}
const albumOf = (page: Page) => page.evaluate(() => ({ size: window.__lantern.play.album.size, kinds: (["echo", "together_work", "both_banks"] as const).filter((kind) => window.__lantern.play.album.get(kind) !== null) }));

/**
 * Plays the shows that come, one after the other, until the show of the festival night is on: a moment (the camera comes to it, the page takes its
 * picture, a click goes on) and then the night. Returns the moments that played, in order.
 */
async function untilTheNight(page: Page, timeout = 240_000, onMoment?: (kind: string) => Promise<void>): Promise<string[]> {
  const played: string[] = [];
  const stop = Date.now() + timeout;
  for (;;) {
    const show = await showOf(page);
    if (show === "festival") return played;
    if (show !== null) {
      played.push(show);
      await advance(page, 1700);
      await onMoment?.(show);
      await page.getByTestId("director-veil").click();
      // the show is over when another one is up or none is: between two shows the director is not on the page at all, for as long as the machine takes to begin the next
      await expect.poll(() => showOf(page), { timeout: 30_000 }).not.toBe(show);
    } else {
      // the paper, the recap and the summary of the night are open over the map until the player puts them away, which a show that comes after them would not wait for
      for (const sheet of ["gazette", "recap", "night"]) if ((await page.getByTestId(sheet).count()) > 0) await page.getByTestId(`${sheet}-done`).click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    if (Date.now() > stop) throw new Error(`the festival night did not begin; the shows so far: ${played.join(", ")}`);
  }
}

/** The night, from its first second to its last: the page goes on to the ending page by itself. */
async function throughTheNight(page: Page): Promise<void> {
  const { timeline } = await festival(page);
  await advance(page, (timeline.duration + 1) * 1000);
  await expect(page.getByTestId("ending")).toBeVisible();
  await expect(page.getByTestId("director")).toHaveCount(0);
}

/** The small pictures the page took of the moments, as files (when pictures are asked for), to look at what they show. */
async function keepAlbum(page: Page, label: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  const kept = await page.evaluate(() => (["echo", "together_work", "both_banks"] as const).map((kind) => [kind, window.__lantern.play.album.get(kind)] as const));
  for (const [kind, url] of kept) {
    if (url !== null) writeFileSync(path.join(SHOTS, `real-${label}-album-${kind}.jpg`), Buffer.from(url.split(",")[1] ?? "", "base64"));
  }
}

/** The ending page scrolled to the row of moments at its foot. */
async function toTheRow(page: Page): Promise<void> {
  await page.getByTestId("ending-moments").scrollIntoViewIfNeeded();
  await page.getByTestId("ending").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
}

let picture = 0;
async function snap(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await frames(page, 4);
  await steady(page);
  await page.screenshot({ path: path.join(SHOTS, `real-${String(++picture).padStart(2, "0")}-${name}.png`) });
}

test.describe("the festival night on the real core", () => {
  test("is played at the end of a real game and, on a recording of it, at the end of the recording: the same night, the same moments with a picture each, the same ending page", async ({ lantern }: { lantern: LanternPage }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await lantern.open(GAME, { menu: false });
    await page.waitForFunction(() => window.__lantern.play.director.port !== null, undefined, { timeout: 120_000 });
    // the page said that it watches the moments: the frames of the game have the key now
    await expect.poll(() => page.evaluate(() => (window.__lantern.client.state.frame as unknown as { moments?: unknown[] } | null)?.moments ?? null), { timeout: 60_000 }).toEqual([]);
    if (SHOTS !== "") await still(page);

    // A promise of a household on each bank of the river, the first moment: the world is held for it, the page takes its picture, a click goes on.
    await act(page, { type: "dev_goal", op: "join", npc: "cha_laoban" });
    await act(page, { type: "dev_goal", op: "join", npc: "li_da" });
    await expect.poll(() => showOf(page), { timeout: 60_000 }).toBe("both_banks");
    await expect(page.getByTestId("director-caption")).toHaveText("Lanterns hang on both banks.");
    const heldAt = await tickOf(page);
    await advance(page, 1700);
    expect(await tickOf(page)).toBe(heldAt);
    expect((await albumOf(page)).kinds).toEqual(["both_banks"]);
    await snap(page, "moment-both-banks");
    await page.getByTestId("director-veil").click();
    await expect(page.getByTestId("director")).toHaveCount(0);

    // The rest of the call, the bamboo and the timber for the bridge, the truth and the peace: the bridge is mended on the third morning by helpers of both
    // families, which is the second moment, and the last night is a full one.
    for (const npc of JOINERS.slice(2)) await act(page, { type: "dev_goal", op: "join", npc });
    await act(page, { type: "dev_goal", op: "material", npc: "li_da" });
    await act(page, { type: "dev_goal", op: "material", npc: "zhou_zhanggui" });
    await act(page, { type: "dev_goal", op: "truth" });
    await act(page, { type: "dev_goal", op: "reconcile" });
    await act(page, { type: "dev_goal", op: "grudge", value: 12 });
    const moments = await untilTheNight(page, 240_000, (kind) => snap(page, `moment-${kind.replace("_", "-")}`));
    expect(moments).toEqual(["together_work"]);
    expect((await albumOf(page)).kinds.sort()).toEqual(["both_banks", "together_work"]);
    await keepAlbum(page, "live");

    // The night plays over the map, from what the real core says: the bridge, the two families together, both heads at the lantern, up to 120 people.
    await expect(page.getByTestId("director-caption")).toHaveText("The fifth night. The lantern festival.");
    const live = await festival(page);
    expect(live.plan).toMatchObject({ route: "bridge", together: true });
    expect(live.stage.lighters).toEqual(HEADS);
    expect(live.stage.bearers).toBeGreaterThan(0);
    expect(live.stage.bearers).toBeLessThanOrEqual(120);
    expect(live.stage.named + live.stage.lighters.length).toBe(20);
    const ending = await page.evaluate(() => window.__lantern.play.state.ending);
    expect(ending?.id).toBe("ending_full");
    expect(live.plan.seed).toBe(ending?.tick);
    await snap(page, "night-opening");
    await advance(page, 6000);
    await snap(page, "night-parade");
    await advance(page, ((live.timeline.lightAt as number) + 3 - 6) * 1000);
    expect((await festival(page)).stage.flare).toBe(1);
    await snap(page, "night-lantern-lit");
    await throughTheNight(page);
    const row = page.getByTestId("ending-moments");
    await expect(row.getByTestId("moment")).toHaveCount(2);
    await expect(row.getByTestId("moment").evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).resolves.toEqual(["both_banks", "together_work"]);
    await expect(row.getByTestId("moment-picture")).toHaveCount(2);
    await expect(row.getByTestId("moment-words")).toHaveText(["Lanterns hang on both banks.", "People of the Li and Zhou families carry materials together for the first time."]);
    await toTheRow(page);
    await snap(page, "ending-moments");
    const finalTick = ending?.tick as number;

    // The game saved itself at its end, with the pictures in the notes of the page.
    interface Kept {
      id: number;
      tick: number;
      page: { auto?: { kind?: string }; moments?: { pictures: Record<string, string> } } | null;
    }
    const savesOf = (): Promise<Kept[]> => page.evaluate(() => window.__lantern.client.state.saves.map((s) => ({ id: s.id, tick: s.tick, page: (s.page ?? null) as Kept["page"] })));
    await expect.poll(async () => (await savesOf()).some((s) => s.page?.auto?.kind === "ending"), { timeout: 60_000 }).toBe(true);
    const kept = (await savesOf()).filter((s) => s.page?.auto?.kind === "ending").at(-1) as Kept;
    expect(kept.tick).toBeGreaterThanOrEqual(finalTick);
    expect(Object.keys(kept.page?.moments?.pictures ?? {}).sort()).toEqual(["both_banks", "together_work"]);
    const id = kept.id;

    // The recording is played on a page of a recording, at sixteen times the speed, to its end: the moments play on it too, each with its picture,
    // and the night after them, the same night, and then the ending page with its row.
    await page.goto(`${lantern.servers.app.origin}/?scenario=bridge&seed=7&director=on&festival=on&showclock=manual#replay=save-${id}`);
    await recordingReady(page);
    if (SHOTS !== "") await still(page);
    await page.getByTestId("replay-speed").selectOption("16");
    const replayMoments = await untilTheNight(page, 420_000);
    expect(replayMoments).toEqual(["both_banks", "together_work"]);
    const recorded = await page.evaluate(() => {
      const play = window.__lantern.replay?.play;
      return { size: play?.album.size ?? 0 };
    });
    expect(recorded.size).toBe(2);
    const again = await festival(page);
    expect(again.plan).toEqual(live.plan);
    expect(again.timeline).toEqual(live.timeline);
    await expect(page.getByTestId("director-caption")).toHaveText("The fifth night. The lantern festival.");
    await throughTheNight(page);
    await expect(page.getByTestId("ending-title")).toHaveText("A perfect night");
    const rowAgain = page.getByTestId("ending-moments");
    await expect(rowAgain.getByTestId("moment")).toHaveCount(2);
    await expect(rowAgain.getByTestId("moment-picture")).toHaveCount(2);
    await expect(rowAgain.getByTestId("moment-words")).toHaveText(["Lanterns hang on both banks.", "People of the Li and Zhou families carry materials together for the first time."]);
    await toTheRow(page);
    await snap(page, "recording-ending-moments");

    // The same recording taken straight to its end plays the same night, with a card for each moment, since no moment played on the way.
    await page.goto(`${lantern.servers.app.origin}/?scenario=bridge&seed=7&director=on&festival=on&showclock=manual#replay=save-${id}&tick=${kept.tick}`);
    await recordingReady(page);
    await expect.poll(() => showOf(page), { timeout: 240_000 }).toBe("festival");
    const sought = await festival(page);
    expect(sought.plan).toEqual(live.plan);
    expect(sought.timeline).toEqual(live.timeline);
    await throughTheNight(page);
    const cards = page.getByTestId("ending-moments");
    await expect(cards.getByTestId("moment-card")).toHaveCount(2);
    await expect(cards.getByTestId("moment-picture")).toHaveCount(0);
    await toTheRow(page);
    await snap(page, "sought-ending-cards");
    await expect.poll(() => reasons(page)).not.toContain("show");
    expect(lantern.pageErrors).toEqual([]);
  });
});
