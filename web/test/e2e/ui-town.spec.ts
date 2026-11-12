import { chromium, type Page } from "@playwright/test";
import { CELL, CELL_DEPTH } from "../../src/page/map/projection.ts";
import { expect, LanternPage, type LanternPage as Lantern, test } from "../support/fixtures.ts";
import { clearTheMap } from "../support/play.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

interface Sample {
  tick: number;
  glow: number;
  daylight: number;
  people: number;
  labels: number;
}

const canvasData = (page: Page) => page.getByTestId("map").evaluate((el) => ({ ...(el as HTMLCanvasElement).dataset }));
const stats = (page: Page) => page.evaluate(() => window.__lantern.view.stats());
const camera = (page: Page) => page.evaluate(() => ({ x: window.__lantern.view.camera.x, y: window.__lantern.view.camera.y, zoom: window.__lantern.view.camera.zoom, fitted: window.__lantern.view.camera.fitted }));

/** Waits for the map to have drawn the people of the town. */
async function drawn(lantern: Lantern, people = 20): Promise<void> {
  await expect.poll(() => stats(lantern.page).then((s) => s.people)).toBe(people);
}

/** Screen position of a person on the map, in the pixels of the canvas. */
const where = (page: Page, id: string) => page.evaluate((who) => window.__lantern.view.screenPositionOf(who), id);

test.describe("the town on the map", () => {
  test("is drawn through a whole game day, the day and the night after it, without a single error", async ({ lantern }, testInfo) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    // 2,070 ticks: the day phase from 06:00 to 21:00 and the night phase to the next dawn.
    await lantern.open("scenario=bridge&seed=7&pace=40&until=2070", { menu: false });
    // One sample for every 25 ticks of the game, so that how many there are follows the game and not how
    // fast the machine ran it.
    await page.evaluate(() => {
      const samples: Sample[] = [];
      (window as unknown as { __samples: Sample[] }).__samples = samples;
      let next = 0;
      window.__lantern.client.subscribe(() => {
        const tick = window.__lantern.client.state.simTick;
        if (tick < next) return;
        next = tick + 25;
        const s = window.__lantern.view.stats();
        samples.push({ tick, glow: s.glow, daylight: s.daylight, people: s.people, labels: s.labelsShown });
      });
    });
    await lantern.waitForTick(2070, 90_000);
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.waitForTimeout(500);
    const samples = await page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);

    expect(samples.length).toBeGreaterThan(20);
    const drawnSamples = samples.filter((s) => s.people > 0);
    expect(drawnSamples.length).toBeGreaterThan(10);
    // Twenty people, always, once the first frame is in.
    expect(new Set(drawnSamples.map((s) => s.people))).toEqual(new Set([20]));
    // The day is bright and unlit, the night dark with the lamps lit, and the light moves between them.
    expect(Math.min(...drawnSamples.map((s) => s.glow))).toBe(0);
    expect(Math.max(...drawnSamples.map((s) => s.glow))).toBeGreaterThan(0.95);
    expect(Math.max(...drawnSamples.map((s) => s.daylight))).toBe(1);
    expect(Math.min(...drawnSamples.map((s) => s.daylight))).toBeLessThan(0.2);
    expect(drawnSamples.some((s) => s.glow > 0.1 && s.glow < 0.9)).toBe(true);
    expect(Math.max(...drawnSamples.map((s) => s.labels))).toBeGreaterThanOrEqual(12);

    // The last frame is the dawn of the second day, and the page shows it.
    await expect(page.getByTestId("hud-day")).toHaveText("Day 2");
    await expect(page.getByTestId("hud-clock")).toHaveText("06:00");
    const data = await canvasData(page);
    expect(data.dots).toBe("20");
    const lit = await page.evaluate(() => window.__lantern.view.litPixels());
    expect(lit.lit).toBeGreaterThan(lit.width * lit.height * 0.5);

    const snap = await lantern.snapshot();
    expect(snap.error).toBeNull();
    expect(snap.cspViolations).toEqual([]);
    expect(lantern.pageErrors).toEqual([]);
    expect(lantern.consoleLines.filter((l) => /^\[(page|worker):error\]/.test(l))).toEqual([]);
    // Everything came from the page's own origin: the fonts, the scripts, the runtime.
    expect(lantern.network.filter((n) => n.origin !== lantern.servers.app.origin)).toEqual([]);
    await testInfo.attach("samples", { body: JSON.stringify({ count: samples.length, first: samples[0], last: samples[samples.length - 1] }), contentType: "application/json" });
  });

  test("shows the weather the world has: clear, light rain, heavy rain", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=200", { menu: false });
    await lantern.waitForTick(200);
    await drawn(lantern);
    const names = { clear: "Clear", light_rain: "Light rain", heavy_rain: "Heavy rain" } as const;
    const rains = { clear: "none", light_rain: "light", heavy_rain: "heavy" } as const;

    // The weather that the core plans for the day is the weather on the screen.
    const planned = await page.evaluate(() => window.__lantern.client.state.frame?.weather as keyof typeof names);
    expect(Object.keys(names)).toContain(planned);
    await expect(page.getByTestId("hud-weather")).toHaveText(names[planned]);
    await expect.poll(async () => (await canvasData(page)).rain).toBe(rains[planned]);

    // And each kind has its own chip, its own rain and its own tint, the rain with a grey over the town.
    const tints: string[] = [];
    for (const kind of ["clear", "light_rain", "heavy_rain"] as const) {
      await page.evaluate((weather) => window.__lantern.inject({ weather }), kind);
      await expect(page.getByTestId("hud-weather")).toHaveText(names[kind]);
      await expect(page.getByTestId("hud-weather")).toHaveAttribute("data-weather", kind);
      await expect.poll(async () => (await canvasData(page)).rain).toBe(rains[kind]);
      tints.push(await page.evaluate(() => window.__lantern.view.tint()));
    }
    expect(new Set(tints).size).toBe(3);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("draws the map at a capped rate, and slowly when only the water and the lanterns stir", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=100", { menu: false });
    await lantern.waitForTick(100);
    await drawn(lantern);
    // Frames drawn a second, on the clock of the page.
    const sample = () => page.evaluate(() => ({ frames: window.__lantern.view.stats().frames, at: performance.now() }));
    const rate = async (ms: number): Promise<number> => {
      const from = await sample();
      await page.waitForTimeout(ms);
      const to = await sample();
      return ((to.frames - from.frames) * 1000) / (to.at - from.at);
    };

    // The world is held, in clear weather, with no rumour on its way and no lantern lit: only the glints on the river move.
    await page.evaluate(() => window.__lantern.inject({ weather: "clear", dots: [], lanterns: [], bubbles: [] }));
    await page.waitForTimeout(600);
    expect(await rate(2000)).toBeLessThanOrEqual(8);

    // Rain needs the full rate, which is capped well under the refresh rate of a display.
    await page.evaluate(() => window.__lantern.inject({ weather: "heavy_rain" }));
    await page.waitForTimeout(600);
    const first = await sample();
    expect(await rate(2000)).toBeLessThanOrEqual(35);
    expect((await sample()).frames).toBeGreaterThan(first.frames);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("draws the rumours, the lanterns and the lines of talk that a frame carries, and fills the numbers of the side panel", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=1700", { menu: false });
    await lantern.waitForTick(1700);
    await drawn(lantern);

    // With nothing in the frame but the people, the numbers are dashes and nothing is drawn but the town. The numbers of the festival are in the ledger,
    // which is shut until the player opens it.
    await page.getByTestId("board-toggle").click();
    await page.evaluate(() => window.__lantern.inject({ bubbles: [], dots: [], lanterns: [], hud: {} }));
    for (const id of ["promised", "turnout", "passage", "reputation", "cost"]) await expect(page.getByTestId(`stat-${id}`)).toContainText("–");
    expect(await canvasData(page)).toMatchObject({ bubbles: "0", rumours: "0", lanterns: "0" });

    await page.evaluate(() =>
      window.__lantern.inject({
        lanterns: [
          { household: "fam_li", place: "p_li_house", x: 7, y: 5 },
          { household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 },
          { household: "tea", place: "p_teahouse", x: 34, y: 14 },
        ],
        bubbles: [
          { npc: "zhou_zhanggui", until: 999_999, text: { zh: "听说李家那小子昨晚在桥边转悠。", en: "They say the Li boy was by the bridge last night." } },
          { npc: "cha_laoban", until: 999_999, text: { zh: "这事我可没说过。", en: "I never said that." } },
        ],
        dots: [
          { id: "d1", from: "zhou_zhanggui", to: "cha_laoban", topic: "blame", progress: 420 },
          { id: "d2", from: "zuzhang", to: "miaozhu", topic: "clear", progress: 650 },
          { id: "d3", from: "li_er", to: "mujiang", topic: "other", progress: 300 },
        ],
        hud: { promised: 23, turnout: 1800, bridge: { done: 3, need: 5, lacking: "bamboo", state: "repairing" }, reputation: 2, spent: 310_000, cap: 3_000_000, stage: 1 },
      }),
    );
    await expect.poll(async () => canvasData(page)).toMatchObject({ bubbles: "2", rumours: "3", lanterns: "3" });
    expect(await stats(page)).toMatchObject({ bubbles: 2, rumours: 3, lanterns: 3 });
    await expect(page.getByTestId("stat-promised")).toContainText("23 households");
    await expect(page.getByTestId("stat-turnout")).toContainText("1,800 people");
    await expect(page.getByTestId("stat-passage")).toContainText("No way across yet");
    await expect(page.getByTestId("hud-festival")).not.toContainText("workers");
    await expect(page.getByTestId("stat-reputation").getByRole("img")).toHaveAttribute("data-stars", "2");
    await expect(page.getByTestId("stat-cost")).toContainText("¥0.31");
    await expect(page.getByTestId("stat-cost")).toContainText("of ¥3.00, strong model off");
    await expect(page.getByTestId("map-legend")).toBeVisible();

    await lantern.setLang("zh");
    await expect(page.getByTestId("stat-promised")).toContainText("二十三户");
    await expect(page.getByTestId("stat-turnout")).toContainText("1,800人");
    await expect(page.getByTestId("stat-passage")).toContainText("还没有路可走");
    await expect(page.getByTestId("hud-festival")).not.toContainText("缺竹料");
    await expect(page.getByTestId("stat-cost")).toContainText("上限 ¥3.00，强档已停");
    await expect.poll(() => page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual(expect.arrayContaining(["这事我可没说过。"]));

    // A line that has run out is taken down.
    await page.evaluate(() => window.__lantern.inject({ bubbles: [{ npc: "cha_laoban", until: 1, text: { zh: "旧话", en: "old" } }] }));
    await expect.poll(async () => (await canvasData(page)).bubbles).toBe("1");
    await expect.poll(() => stats(page).then((s) => s.bubbles)).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("tells that two people talk beyond hearing with a marker over each and no words, and the legend of the rumours has the words for the three topics the core sends", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=1700", { menu: false });
    await lantern.waitForTick(1700);
    await drawn(lantern);
    await page.evaluate(() => window.__lantern.inject({ bubbles: [], dots: [], lanterns: [] }));
    await expect.poll(() => stats(page).then((s) => s.talkers)).toBe(0);

    // The core's far bubble: the speaker, until when, no text, and that they talk.
    const far = [
      { npc: "zhou_zhanggui", until: 999_999, text: null, talking: true },
      { npc: "cha_laoban", until: 999_999, text: null, talking: true },
    ];
    await page.evaluate((bubbles) => window.__lantern.inject({ bubbles }), far);
    await expect.poll(() => stats(page).then((s) => s.talkers)).toBe(2);
    expect(await stats(page)).toMatchObject({ talkers: 2, bubbles: 0 });
    expect(await canvasData(page)).toMatchObject({ talkers: "2" });
    // The marker has no words: the map shows none, and nothing is said at the foot of the page.
    expect(await page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual([]);
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    // A near one has its words, and the far ones keep their markers beside it.
    const near = { npc: "zuzhang", until: 999_999, text: { zh: "我来说两句。", en: "Let me say a word." } };
    await page.evaluate((bubbles) => window.__lantern.inject({ bubbles }), [...far, near]);
    await expect.poll(() => stats(page).then((s) => s.bubbles)).toBe(1);
    expect(await stats(page)).toMatchObject({ talkers: 2, bubbles: 1 });
    expect(await page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual(["Let me say a word."]);
    // A bubble with words and the flag has no words either: it is a marker.
    await page.evaluate(() => window.__lantern.inject({ bubbles: [{ npc: "zhou_zhanggui", until: 999_999, text: { zh: "不该听见", en: "Not for your ears" }, talking: true }] }));
    await expect.poll(() => stats(page).then((s) => s.talkers)).toBe(1);
    expect(await page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual([]);
    await expect(page.locator("body")).not.toContainText("Not for your ears");
    // The marker goes when the frame no longer has the bubble, and stays out of the way of the words in the other language.
    await lantern.setLang("zh");
    await page.evaluate(() => window.__lantern.inject({ bubbles: [] }));
    await expect.poll(() => stats(page).then((s) => s.talkers)).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has a legend of the rumours with the words for blaming, clearing the blame and other talk, in both languages and themes, in the colours of the lights", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=300", { menu: false });
    await lantern.waitForTick(300);
    await drawn(lantern);
    const items = page.locator('[data-testid="map-legend"] .legend-item');
    const words = { en: ["Blames someone", "Clears the blame", "Other talk"], zh: ["怪到某人头上", "洗清罪名", "别的闲话"] } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        await expect(items).toHaveText([...words[lang]]);
        // Each light on the map is red, blue or pale by the topic the core sent, and each has its colour in the legend.
        const colours = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const token = (name: string): string => root.getPropertyValue(name).trim();
          const dot = (kind: string): string => getComputedStyle(document.querySelector(`.dot-${kind}`) as Element).backgroundColor;
          return { tokens: { blame: token("--blame"), clear: token("--clear"), other: token("--other") }, dots: { blame: dot("blame"), clear: dot("clear"), other: dot("other") } };
        });
        expect(new Set(Object.values(colours.dots)).size).toBe(3);
        expect(colours.tokens.blame).not.toBe("");
      }
    }
    // The three topics the core sends are three lights, one for each.
    await page.evaluate(() =>
      window.__lantern.inject({
        dots: [
          { id: "d1", from: "zhou_zhanggui", to: "cha_laoban", topic: "blame", progress: 420 },
          { id: "d2", from: "zuzhang", to: "miaozhu", topic: "clear", progress: 650 },
          { id: "d3", from: "li_er", to: "mujiang", topic: "other", progress: 300 },
        ],
      }),
    );
    await expect.poll(() => stats(page).then((s) => s.rumours)).toBe(3);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("moves and zooms: drag to pan, wheel and pinch to zoom, a button to fit the town on the screen again", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=600", { menu: false });
    await lantern.waitForTick(600);
    await drawn(lantern);
    // The note of the slip and the small act that hangs over the manager lie over a few cells of the map, and a pointer put there is theirs: they are put away first.
    await clearTheMap(page);
    const canvas = page.getByTestId("map");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("the map has no box");

    const start = await camera(page);
    expect(start.fitted).toBe(true);
    // The whole town is in view at the start.
    expect(start.x).toBeGreaterThanOrEqual(0);
    expect(start.y).toBeGreaterThanOrEqual(0);
    // The town is 56 by 34 cells, and on the screen a cell is 32 pixels wide and 25.22 deep.
    expect(start.x + 56 * CELL * start.zoom).toBeLessThanOrEqual(box.width + 1);
    expect(start.y + 34 * CELL_DEPTH * start.zoom).toBeLessThanOrEqual(box.height + 1);

    // A wheel turned towards the player zooms in around the pointer, which stays over the same ground.
    const px = box.x + box.width * 0.4;
    const py = box.y + box.height * 0.5;
    const before = await page.evaluate(([x, y]) => window.__lantern.view.camera.unproject(x as number, y as number), [px - box.x, py - box.y]);
    await page.mouse.move(px, py);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(start.zoom * 1.5);
    const zoomed = await camera(page);
    expect(zoomed.fitted).toBe(false);
    const after = await page.evaluate(([x, y]) => window.__lantern.view.camera.unproject(x as number, y as number), [px - box.x, py - box.y]);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    // The canvas publishes its data on the next frame it draws, which on a busy machine is not the moment the camera has moved.
    await expect.poll(async () => (await canvasData(page)).fitted).toBe("false");

    // Dragging moves the map by as much as the pointer moved.
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px + 60, py + 25, { steps: 8 });
    await page.mouse.up();
    const panned = await camera(page);
    expect(panned.x - zoomed.x).toBeCloseTo(60, 0);
    expect(panned.y - zoomed.y).toBeCloseTo(25, 0);
    expect(panned.zoom).toBe(zoomed.zoom);

    // The zoom has a floor and a ceiling.
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
    await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(start.zoom * 0.85);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(3);
    expect((await camera(page)).zoom).toBeLessThanOrEqual(3.4);

    // Two fingers: spread apart to zoom in, with pointer events as a touch screen sends them.
    await page.getByTestId("map-fit").click();
    await expect.poll(async () => (await camera(page)).fitted).toBe(true);
    const fitted = await camera(page);
    expect(fitted.zoom).toBeCloseTo(start.zoom, 3);
    await page.evaluate(
      ({ cx, cy }) => {
        const target = document.querySelector<HTMLCanvasElement>('[data-testid="map"]');
        if (target === null) throw new Error("no map");
        const fire = (type: string, id: number, x: number, y: number): void => {
          target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, buttons: type === "pointerup" ? 0 : 1 }));
        };
        fire("pointerdown", 1, cx - 40, cy);
        fire("pointerdown", 2, cx + 40, cy);
        for (let step = 1; step <= 10; step++) {
          fire("pointermove", 1, cx - 40 - step * 6, cy);
          fire("pointermove", 2, cx + 40 + step * 6, cy);
        }
        fire("pointerup", 1, cx - 100, cy);
        fire("pointerup", 2, cx + 100, cy);
      },
      { cx: box.x + box.width / 2, cy: box.y + box.height / 2 },
    );
    const pinched = await camera(page);
    expect(pinched.zoom).toBeGreaterThan(fitted.zoom * 1.8);
    expect(pinched.fitted).toBe(false);

    // The buttons and the keys.
    await page.getByTestId("map-fit").click();
    await page.getByTestId("map-zoom-in").click();
    await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(fitted.zoom * 1.3);
    await page.getByTestId("map-zoom-out").click();
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(fitted.zoom, 2);
    await canvas.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await camera(page)).x).toBeCloseTo(fitted.x + 60, 0);
    await page.keyboard.press("0");
    await expect.poll(async () => (await camera(page)).fitted).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the town in the window when the window changes size, until the player has moved the map", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await lantern.open("scenario=bridge&seed=7&pace=60&until=300", { menu: false });
    await drawn(lantern);
    const wide = await camera(page);
    const widthBefore = await page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).clientWidth);

    await page.setViewportSize({ width: 1000, height: 640 });
    await expect.poll(() => page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).clientWidth)).toBeLessThan(widthBefore - 200);
    await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(wide.zoom * 0.9);
    expect((await camera(page)).fitted).toBe(true);

    // Moved by hand, the camera stays where it is put.
    await page.getByTestId("map-zoom-in").click();
    const moved = await camera(page);
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(500);
    expect((await camera(page)).zoom).toBeCloseTo(moved.zoom, 3);
    expect((await camera(page)).fitted).toBe(false);
  });

  test("lets the player pick a person: a click shows who it is, and the empty ground takes the pick away", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=60&until=700", { menu: false });
    await lantern.waitForTick(700);
    await drawn(lantern);
    await page.waitForTimeout(800);
    const canvas = page.getByTestId("map");

    // Zoomed in on the teahouse, where people stand apart.
    await page.getByTestId("map-fit").click();
    const spot = await where(page, "cha_laoban");
    if (spot === null) throw new Error("the teahouse keeper is not on the map");
    await canvas.hover({ position: spot });
    await expect(page.getByTestId("tooltip")).toContainText("Teahouse Keeper");
    // Her role is her name, so the tooltip says it once.
    await expect(page.getByTestId("tooltip").locator(".tooltip-card > span")).toHaveCount(0);
    await canvas.click({ position: spot });
    await expect.poll(async () => (await canvasData(page)).selected).toBe("cha_laoban");
    await expect(page.getByTestId("person-name")).toHaveText("Teahouse Keeper");
    await expect(page.getByTestId("person-card")).toContainText("Teahouse");

    await lantern.setLang("zh");
    await expect(page.getByTestId("person-name")).toHaveText("茶馆老板娘");

    await canvas.click({ position: { x: 20, y: 20 } });
    await expect.poll(async () => (await canvasData(page)).selected).toBe("");
    await expect(page.getByTestId("person-card")).toHaveCount(0);
    // The tooltip and the cards are placed by script, which the policy allows, as it allows no style attribute.
    expect(lantern.consoleLines.filter((l) => /Refused to|Content Security Policy/i.test(l))).toEqual([]);
    expect(await canvas.getAttribute("aria-label")).toBe("小镇地图");
  });

  test("starts the town over for a new game: the people are drawn afresh and the day is the first again", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=40&until=1100");
    await lantern.waitForTick(1100);
    await drawn(lantern);
    await expect(page.getByTestId("hud-clock")).not.toHaveText("06:00");
    await page.getByTestId("btn-new").click();
    await expect.poll(() => lantern.tick()).toBeLessThan(900);
    await drawn(lantern);
    expect((await lantern.snapshot()).error).toBeNull();
    await page.evaluate(() => window.__lantern.client.pause());
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says so when the browser has no WebGL, and the rest of the page and the game go on", async ({ servers }) => {
    const browser = await chromium.launch({ args: ["--disable-3d-apis", "--disable-gpu", "--disable-software-rasterizer"] });
    try {
      const lantern = new LanternPage(await (await browser.newContext()).newPage(), servers);
      await lantern.open("scenario=bridge&seed=7&pace=40&until=400", { menu: false });
      await lantern.waitForTick(400);
      await expect(lantern.page.getByTestId("veil")).toContainText("The map needs WebGL");
      expect(await lantern.page.evaluate(() => window.__lantern.view.ready)).toBe(false);
      // The numbers, the clock and the controls are DOM, and they work without the map.
      await expect(lantern.page.getByTestId("hud-clock")).not.toHaveText("–");
      await expect(lantern.page.getByTestId("hud-day")).toHaveText("Day 1");
      await expect(lantern.page.getByTestId("status")).toHaveText("paused");
      await lantern.page.getByTestId("btn-pause").click();
      await expect(lantern.page.getByTestId("status")).toHaveText("running");
      expect(lantern.pageErrors).toEqual([]);
      expect((await lantern.snapshot()).error).toBeNull();
    } finally {
      await browser.close();
    }
  });

  test("leaves the map out of a page opened with ?map=off, and the rest of the page and the game go on", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=40&until=200", { menu: false, map: false });
    await lantern.waitForTick(200);
    expect(await page.evaluate(() => window.location.search)).toContain("map=off");
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.evaluate(() => window.__lantern.view.ready)).toBe(false);
    // Nothing waits for the map: no veil over the stage, and the numbers and the controls work.
    await expect(page.getByTestId("veil")).toHaveCount(0);
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
    expect((await lantern.snapshot()).error).toBeNull();
  });

  test("keeps the demo world playable: a plain grid with a piece for each person", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=m0&seed=3&pace=30&until=300", { menu: false });
    await lantern.waitForTick(300);
    await drawn(lantern, 12);
    expect(await canvasData(page)).toMatchObject({ dots: "12" });
    const lit = await page.evaluate(() => window.__lantern.view.litPixels());
    expect(lit.lit).toBeGreaterThan(lit.width * lit.height * 0.3);
    // The demo has no town layers, so no legend of rumours and no weather of its own.
    await expect(page.getByTestId("map-legend")).toHaveCount(0);
    await expect(page.getByTestId("hud-weather")).toHaveText("Clear");
    expect(lantern.pageErrors).toEqual([]);
    expect((await lantern.snapshot()).error).toBeNull();
  });
});
