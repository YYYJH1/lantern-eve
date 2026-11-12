import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ambienceDuck, birdsOf, crowdOf, darkness, type Listener, type MixInput, nearness, NO_SOURCES, panOf, planMix, rainOf, SILENCE, sourcesOf, volumeGain, WHOLE_TOWN } from "../../src/page/audio/plan.ts";
import { LAYER_IDS } from "../../src/page/audio/layer.ts";
import { parseScene } from "../../src/page/scene.ts";

// What sounds when: the scheduler's judgement from the time of day, the weather, where the camera looks, where the night watchman is
// and what the player is doing. It is pure, so it is tested without a browser.

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAP = JSON.parse(readFileSync(path.join(WEB, "../content/compiled/map_bridge_town.json"), "utf8")) as {
  rows: string[];
  legend: Array<{ char: string; id: string }>;
  places: Array<{ id: string; kind: string; rect: number[] }>;
  width: number;
  height: number;
};

/** The scene of the bridge town as the page reads it, made from the compiled map. */
const scene = parseScene({ scenario: "bridge", layers: { terrain: { rows: MAP.rows, legend: MAP.legend } }, places: MAP.places, width: MAP.width, height: MAP.height });
const SOURCES = sourcesOf(scene);

const MARKET: Listener = { x: 19.5, y: 20.5, reach: 8 };
const LI_HOUSE: Listener = { x: 8, y: 5, reach: 8 };
const BANK: Listener = { x: 24.5, y: 15.5, reach: 10 };

function mix(hour: number, minute = 0, over: Partial<MixInput> = {}) {
  return planMix({ hour, minute, weather: "clear", listener: WHOLE_TOWN, watchman: null, sources: SOURCES, ...over });
}

test.describe("where the sounds of the town come from", () => {
  test("the river is every cell of the scene that is river, and the market is the place of that kind", () => {
    const riverChar = MAP.legend.find((entry) => entry.id === "river")?.char ?? "";
    const expected = MAP.rows.reduce((sum, row) => sum + [...row].filter((c) => c === riverChar).length, 0);
    expect(expected).toBeGreaterThan(100);
    expect(SOURCES.river.length).toBe(expected);
    for (const [x, y] of SOURCES.river) expect(MAP.rows[y]?.charAt(x)).toBe(riverChar);
    const market = MAP.places.find((place) => place.kind === "market");
    expect(SOURCES.market).toEqual({ x: market?.rect[0], y: market?.rect[1], w: market?.rect[2], h: market?.rect[3] });
  });

  test("a scene with no town in it (the demo world) and no scene at all have none, and are silent", () => {
    expect(sourcesOf(null)).toBe(NO_SOURCES);
    expect(sourcesOf(parseScene({ scenario: "m0", width: 4, height: 4, rows: ["....", "....", "....", "...."], legend: {}, places: [] }))).toBe(NO_SOURCES);
    const quiet = planMix({ hour: 12, minute: 0, weather: "clear", listener: WHOLE_TOWN, watchman: null, sources: NO_SOURCES });
    expect(quiet.river.level).toBe(0);
    expect(quiet.market.level).toBe(0);
  });
});

test.describe("the hours of the day", () => {
  test("the birds sing in the morning only: from first light, full from six to half past eight, gone by eleven, none in the afternoon or at night", () => {
    expect(mix(3, 0).birds.level).toBe(0);
    expect(mix(4, 30).birds.level).toBe(0);
    expect(mix(5, 30).birds.level).toBeGreaterThan(0.3);
    expect(mix(5, 30).birds.level).toBeLessThan(0.8);
    for (const [h, m] of [[6, 30], [7, 30], [8, 0]] as const) expect(mix(h, m).birds.level, `${h}:${m}`).toBeGreaterThan(0.95);
    expect(mix(9, 30).birds.level).toBeLessThan(0.8);
    expect(mix(9, 30).birds.level).toBeGreaterThan(0.2);
    expect(mix(11, 30).birds.level).toBe(0);
    for (const h of [13, 17, 19, 22, 1]) expect(mix(h).birds.level, `${h}`).toBe(0);
    expect(birdsOf(7, 0)).toBe(1);
  });

  test("the market is heard in the daytime: it wakes at seven, is busiest at noon and is gone by seven in the evening", () => {
    expect(mix(5, 0).market.level).toBe(0);
    expect(mix(6, 0).market.level).toBe(0);
    expect(mix(7, 0).market.level).toBeGreaterThan(0);
    expect(mix(7, 0).market.level).toBeLessThan(mix(12, 0).market.level);
    expect(mix(12, 0).market.level).toBeGreaterThan(0.9);
    expect(mix(15, 0).market.level).toBeLessThan(mix(12, 0).market.level);
    expect(mix(18, 0).market.level).toBeLessThan(mix(15, 0).market.level);
    for (const h of [19, 21, 23, 2, 4]) expect(mix(h).market.level, `${h}`).toBe(0);
    expect(crowdOf(12, 0)).toBeGreaterThan(crowdOf(9, 0));
  });

  test("the insects come with the dusk, are loudest in the night and are gone by morning light", () => {
    for (const h of [8, 12, 15, 17]) expect(mix(h).insects.level, `${h}`).toBe(0);
    expect(mix(18, 30).insects.level).toBeGreaterThan(0);
    expect(mix(18, 30).insects.level).toBeLessThan(0.5);
    for (const [h, m] of [[20, 30], [21, 0], [23, 0], [1, 0], [3, 0], [4, 30]] as const) expect(mix(h, m).insects.level, `${h}:${m}`).toBeGreaterThan(0.95);
    expect(mix(5, 30).insects.level).toBeLessThan(0.4);
    expect(mix(6, 30).insects.level).toBe(0);
    expect(darkness(12, 0)).toBe(0);
    expect(darkness(23, 0)).toBe(1);
  });

  test("the river runs all day and all night, a little lower in the night", () => {
    for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) expect(mix(h).river.level, `${h}`).toBeGreaterThan(0.6);
    expect(mix(23).river.level).toBeLessThan(mix(12).river.level);
  });
});

test.describe("the weather", () => {
  test("is read from the name the core gives", () => {
    expect(rainOf("clear")).toBe(0);
    expect(rainOf("light_rain")).toBe(0.5);
    expect(rainOf("heavy_rain")).toBe(1);
    expect(rainOf("something_else")).toBe(0);
  });

  test("rain sounds everywhere in the town the same, and covers the birds and the market", () => {
    const clear = mix(7, 30, { listener: MARKET });
    const light = mix(7, 30, { listener: MARKET, weather: "light_rain" });
    const heavy = mix(7, 30, { listener: MARKET, weather: "heavy_rain" });
    expect(clear.rain.level).toBe(0);
    expect(light.rain.level).toBe(0.5);
    expect(heavy.rain.level).toBe(1);
    expect(mix(7, 30, { listener: LI_HOUSE, weather: "heavy_rain" }).rain.level).toBe(1);
    // The birds are gone in rain of any kind, and the market is hushed, more in a heavy one.
    expect(clear.birds.level).toBeGreaterThan(0.9);
    expect(light.birds.level).toBeLessThan(0.2);
    expect(heavy.birds.level).toBe(0);
    expect(light.market.level).toBeLessThan(clear.market.level);
    expect(heavy.market.level).toBeLessThan(light.market.level);
    expect(heavy.market.level).toBeGreaterThan(0);
  });

  test("rain thins out the insects of the night", () => {
    expect(mix(23, 0, { weather: "heavy_rain" }).insects.level).toBeLessThan(mix(23, 0).insects.level * 0.3);
  });
});

test.describe("where the camera looks", () => {
  test("the river is louder the nearer the camera is to it, and the market the same", () => {
    expect(mix(12, 0, { listener: BANK }).river.level).toBeGreaterThan(mix(12, 0, { listener: LI_HOUSE }).river.level * 4);
    expect(mix(12, 0, { listener: MARKET }).market.level).toBeGreaterThan(mix(12, 0, { listener: LI_HOUSE }).market.level * 4);
    expect(mix(12, 0, { listener: MARKET }).market.level).toBeGreaterThan(0.95);
  });

  test("a camera that shows the whole town hears every source, and one that looks closely hears what is near", () => {
    const whole = mix(12, 0);
    const near = mix(12, 0, { listener: { ...LI_HOUSE, reach: 6 } });
    expect(whole.river.level).toBeGreaterThan(0.9);
    expect(whole.market.level).toBeGreaterThan(0.8);
    expect(near.river.level).toBeLessThan(0.15);
    expect(near.market.level).toBeLessThan(0.25);
  });

  test("a sound is on the side of the camera that it is on: the river is to the right of the Li house and to the left of the east bank", () => {
    expect(mix(12, 0, { listener: LI_HOUSE }).river.pan).toBeGreaterThan(0.5);
    expect(mix(12, 0, { listener: { x: 45, y: 15, reach: 8 } }).river.pan).toBeLessThan(-0.5);
    expect(mix(12, 0, { listener: MARKET }).market.pan).toBe(0);
    for (const id of LAYER_IDS) expect(Math.abs(mix(12, 0, { listener: LI_HOUSE })[id].pan)).toBeLessThanOrEqual(0.8);
  });

  test("nearness and pan only change loudness and side", () => {
    expect(nearness(0, 10)).toBe(1);
    expect(nearness(8, 10)).toBeCloseTo(0.5, 5);
    expect(nearness(40, 10)).toBeLessThan(0.05);
    expect(nearness(3, 20)).toBeGreaterThan(nearness(3, 6));
    expect(panOf(0, 10)).toBe(0);
    expect(panOf(100, 10)).toBeCloseTo(0.8, 5);
    expect(panOf(-100, 10)).toBeCloseTo(-0.8, 5);
  });
});

test.describe("the night watchman", () => {
  const watch = (patrolling: boolean, x = 31, y = 14, listener: Listener = { x: 27, y: 15.5, reach: 12 }) => mix(23, 0, { listener, watchman: { x, y, patrolling } }).watch;

  test("is heard on his round, near or far, and not when he is at the watch post or when there is no watchman", () => {
    expect(watch(true).level).toBeGreaterThan(0.3);
    expect(watch(false).level).toBe(0);
    expect(mix(23, 0, { watchman: null }).watch.level).toBe(0);
  });

  test("is louder the nearer he is to the camera, and on the side that he is on", () => {
    expect(watch(true, 29, 15).level).toBeGreaterThan(watch(true, 50, 5).level);
    expect(watch(true, 40, 15).pan).toBeGreaterThan(0);
    expect(watch(true, 10, 15).pan).toBeLessThan(0);
  });
});

test.describe("what the player's doing leaves of the ambience", () => {
  test("a world that runs has all of it, and a talk has half", () => {
    expect(ambienceDuck(false, "running")).toBe(1);
    expect(ambienceDuck(true, "running")).toBe(0.5);
  });

  test("a world the player paused, or a page that is hidden, has none", () => {
    expect(ambienceDuck(false, "player")).toBe(0);
    expect(ambienceDuck(true, "player")).toBe(0);
    expect(ambienceDuck(false, "tab")).toBe(0);
  });

  test("a sheet of the page that holds the world takes it down to a third, and in a talk to no more than half", () => {
    expect(ambienceDuck(false, "page")).toBe(0.35);
    expect(ambienceDuck(true, "page")).toBe(0.35);
  });

  test("a volume is a curve, so that the middle of the slider is a middle loudness", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBe(0.25);
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
  });
});

test.describe("silence", () => {
  test("has every layer at nothing", () => {
    for (const id of LAYER_IDS) expect(SILENCE[id]).toEqual({ level: 0, pan: 0 });
  });
});
