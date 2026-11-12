import { expect, test } from "@playwright/test";
import { translate } from "../../src/i18n/index.ts";
import type { EndingView, Festival, Reveal, RevealChain } from "../../src/page/ending.ts";
import { readEnding } from "../../src/page/ending.ts";
import { buildPlan, headArrives, storyCentre } from "../../src/page/festival/plan.ts";
import { stopsOf } from "../../src/page/festival/show.ts";
import { buildTimeline, CALM_STEP, calmEyeAtTime, captionAt, eyeAtTime, FLARE_SECONDS, LIGHT_DELAY, OPEN_TRAVEL, OPEN_UNTIL, type Timeline } from "../../src/page/festival/timeline.ts";
import { CLOSING_KEYS, closingKey, falseStory, HIDDEN_LEGEND, hasStoryteller, OPENING } from "../../src/page/festival/words.ts";
import type { Eye } from "../../src/page/map/camera.ts";
import { CELL, CELL_DEPTH } from "../../src/page/map/geometry.ts";
import { terrainAt } from "../../src/page/scene.ts";
import { TOWN_SCENE } from "../support/town-scene.ts";

// When things happen in the festival night, where the camera is, and which words are over the map.

const TOWN: Eye = { x: 900, y: 430, zoom: 1 };
const BEARERS = { p_li_house: 30, p_zhou_house: 26, p_he_home: 10 };
const festival = (over: Partial<Festival> = {}): Festival => ({ route: "bridge", together: true, lighter: ["li_laotai", "zhou_zhanggui"], bearers: BEARERS, named: [], ...over });

const night = (over: Partial<Festival> = {}, hidden = false, id = "ending_full"): Timeline => {
  const f = festival(over);
  return buildTimeline(buildPlan(f, TOWN_SCENE, 77, id), TOWN_SCENE, hidden, TOWN);
};

const CASES: Array<[string, Partial<Festival>, boolean, string]> = [
  ["a full night", {}, false, "ending_full"],
  ["peace and the bridge, the truth not told", {}, false, "ending_barely"],
  ["peace, and only the lane", { route: "lane" }, false, "ending_barely"],
  ["no peace, the bridge mended", { together: false, lighter: ["zuzhang"] }, false, "ending_barely"],
  ["no peace, the lane", { route: "lane", together: false, lighter: ["zuzhang"] }, false, "ending_barely"],
  ["no way across, no peace", { route: "none", together: false, lighter: [] }, false, "ending_split"],
  ["no way across, peace made", { route: "none", lighter: [] }, false, "ending_split"],
  ["the hidden ending on a full night", {}, true, "ending_full"],
  ["the hidden ending where no one walks", { route: "none", together: false, lighter: [] }, true, "ending_split"],
];

test.describe("the length of the night", () => {
  for (const [name, over, hidden, id] of CASES) {
    test(`is between forty seconds and a minute: ${name}`, () => {
      const tl = night(over, hidden, id);
      expect(tl.duration).toBeGreaterThanOrEqual(40);
      expect(tl.duration).toBeLessThanOrEqual(60);
    });
  }

  test("is longer by the storyteller's turn where the ending has one, and about the same turn each time", () => {
    const plain = night();
    const told = night({}, true);
    expect(told.duration - plain.duration).toBeGreaterThan(8);
    expect(told.story).not.toBeNull();
    expect(plain.story).toBeNull();
    const [from, until] = told.story as [number, number];
    expect(until - from).toBeGreaterThan(5);
    expect(until).toBeLessThan(told.closing + 0.01);
  });
});

test.describe("the order of the night", () => {
  test("begins with the opening line over the whole town, goes to the plaza, lights the lantern after the head of the parade is there and draws back to close", () => {
    const tl = night();
    expect(tl.captions[0]).toEqual({ from: 0.3, until: OPEN_UNTIL, kind: "open" });
    expect(OPEN_UNTIL).toBeGreaterThan(OPEN_TRAVEL);
    const plan = buildPlan(festival(), TOWN_SCENE, 77, "ending_full");
    expect(tl.arrive).toBeCloseTo(headArrives(plan), 9);
    expect(tl.lightAt).toBeCloseTo(tl.arrive + LIGHT_DELAY, 9);
    expect(tl.lightAt as number).toBeLessThan(tl.closing);
    expect(tl.closing).toBeGreaterThan((tl.lightAt as number) + FLARE_SECONDS + 3);
    const close = tl.captions.at(-1);
    expect(close?.kind).toBe("close");
    expect(close?.from).toBeGreaterThan(tl.closing);
    expect(close?.until).toBe(tl.duration);
    expect((close?.until as number) - (close?.from as number)).toBeGreaterThan(5);
  });

  test("has nobody light the lantern where nobody does, and no head of a parade to wait for where there is none", () => {
    const none = night({ route: "none", together: false, lighter: [] }, false, "ending_split");
    expect(none.lightAt).toBeNull();
    for (const [, over, hidden, id] of CASES) {
      const tl = night(over, hidden, id);
      expect(tl.lightAt === null).toBe((over.route ?? "bridge") === "none");
    }
  });

  test("says its words in the order opening, storyteller, closing, and one at a time", () => {
    const tl = night({}, true);
    expect(tl.captions.map((c) => c.kind)).toEqual(["open", "story", "close"]);
    for (let i = 1; i < tl.captions.length; i++) expect((tl.captions[i] as { from: number }).from).toBeGreaterThanOrEqual((tl.captions[i - 1] as { until: number }).until);
    expect(captionAt(tl, 1)).toBe("open");
    expect(captionAt(tl, OPEN_UNTIL + 1)).toBeNull();
    expect(captionAt(tl, (tl.story as [number, number])[0] + 1)).toBe("story");
    expect(captionAt(tl, tl.duration - 1)).toBe("close");
    expect(captionAt(tl, tl.duration + 1)).toBeNull();
  });

  test("is told to the controller as stops that fill it exactly and carry the words, the first of them bringing the camera to the whole town", () => {
    const tl = night({}, true);
    const words = { open: { key: "festival.open" }, story: { key: "festival.story" }, close: { key: "festival.close.full" } } as const;
    const stops = stopsOf(tl, words);
    expect(stops[0]).toMatchObject({ at: "town", travel: OPEN_TRAVEL * 1000, caption: words.open });
    expect(stops.slice(1).every((s) => s.travel === 0 && s.at === "town")).toBe(true);
    const length = stops.reduce((sum, s) => sum + s.travel + s.hold, 0);
    expect(length).toBeCloseTo(tl.duration * 1000, 3);
    expect(stops.map((s) => s.caption?.key ?? null).filter((k) => k !== null)).toEqual(["festival.open", "festival.story", "festival.close.full"]);
  });
});

test.describe("the camera", () => {
  const eyeSteps = (tl: Timeline): number[] => {
    const out: number[] = [];
    let before = eyeAtTime(tl, 0);
    for (let t = 0.05; t <= tl.duration; t += 0.05) {
      const now = eyeAtTime(tl, t);
      out.push(Math.hypot(now.x - before.x, now.y - before.y));
      before = now;
    }
    return out;
  };

  for (const [name, over, hidden, id] of CASES) {
    test(`never jumps, and begins and ends on the whole town: ${name}`, () => {
      const tl = night(over, hidden, id);
      expect(eyeAtTime(tl, 0)).toEqual(TOWN);
      expect(eyeAtTime(tl, tl.duration)).toEqual(TOWN);
      expect(Math.max(...eyeSteps(tl))).toBeLessThan(40);
      let before = eyeAtTime(tl, 0).zoom;
      for (let t = 0.05; t <= tl.duration; t += 0.05) {
        const zoom = eyeAtTime(tl, t).zoom;
        expect(Math.abs(Math.log(zoom / before))).toBeLessThan(0.08);
        before = zoom;
      }
    });
  }

  test("is at the bridgehead as the head of the parade crosses it, and over the plaza while the lantern is lit", () => {
    const tl = night();
    const plan = buildPlan(festival(), TOWN_SCENE, 77, "ending_full");
    const at = eyeAtTime(tl, 7);
    expect(at.zoom).toBeGreaterThan(2);
    // somewhere over the west bank or the bridge, on the main street
    expect(at.x).toBeGreaterThan(18 * CELL);
    expect(at.x).toBeLessThan(31 * CELL);
    expect(Math.abs(at.y - 16 * CELL_DEPTH)).toBeLessThan(2 * CELL_DEPTH);
    // the camera looks between the lantern and the crowd, on the side the parade came from, which is the west for the bridge
    const lit = eyeAtTime(tl, tl.arrive + 2);
    expect(Math.hypot(lit.x - plan.lantern.x, lit.y - plan.lantern.y)).toBeLessThan(4 * CELL);
    expect(lit.x).toBeLessThan(plan.lantern.x);
    expect(lit.zoom).toBeGreaterThan(2.1);
  });

  test("goes where the story is told for the hidden ending, to the lawn beside the teahouse", () => {
    const tl = night({}, true);
    const yard = storyCentre(TOWN_SCENE);
    const teahouse = TOWN_SCENE.places.find((p) => p.id === "p_teahouse");
    if (teahouse === undefined || teahouse.door === null) throw new Error("no teahouse");
    // east of the teahouse and off the main street that the parade walks
    expect(yard.x).toBeGreaterThan((teahouse.door[0] + 4) * CELL);
    expect(yard.y).toBeLessThan(14 * CELL_DEPTH);
    expect(terrainAt(TOWN_SCENE, Math.floor(yard.x / CELL), Math.floor(yard.y / CELL_DEPTH))).toBe("grass");
    const at = eyeAtTime(tl, ((tl.story as [number, number])[0] + (tl.story as [number, number])[1]) / 2);
    expect(Math.abs(at.x - yard.x)).toBeLessThan(CELL);
    expect(at.zoom).toBeGreaterThan(2.6);
  });

  test("tours the doors of the two families where no parade walks, each held for a while", () => {
    const tl = night({ route: "none", together: false, lighter: [] }, false, "ending_split");
    const li = TOWN_SCENE.places.find((p) => p.id === "p_li_house")?.door ?? [0, 0];
    const zhou = TOWN_SCENE.places.find((p) => p.id === "p_zhou_house")?.door ?? [0, 0];
    const near = (cell: readonly number[], t: number): boolean => {
      const eye = eyeAtTime(tl, t);
      return Math.hypot(eye.x - (cell[0] as number + 0.5) * CELL, eye.y - (cell[1] as number + 1.2) * CELL_DEPTH) < 1.5 * CELL;
    };
    expect(Array.from({ length: 120 }, (_, i) => near(li, i * 0.25)).some(Boolean)).toBe(true);
    expect(Array.from({ length: 120 }, (_, i) => near(zhou, i * 0.25)).some(Boolean)).toBe(true);
  });

  test("is cut and not glided for a player who asked for less motion, and still ends on the whole town", () => {
    const tl = night({}, true);
    const eyes = Array.from({ length: Math.floor(tl.duration / 0.25) }, (_, i) => calmEyeAtTime(tl, i * 0.25));
    let changes = 0;
    for (let i = 1; i < eyes.length; i++) {
      const a = eyes[i - 1] as Eye;
      const b = eyes[i] as Eye;
      if (a.x !== b.x || a.y !== b.y || a.zoom !== b.zoom) changes++;
    }
    // a cut at the start of each beat and one every few seconds of a moving one: far fewer than the frames
    expect(changes).toBeLessThan(tl.duration / CALM_STEP + tl.beats.length * 2);
    expect(changes).toBeGreaterThan(3);
    expect(calmEyeAtTime(tl, tl.duration - 0.01)).toEqual(TOWN);
  });
});

test.describe("the closing line", () => {
  const f = (route: Festival["route"], together: boolean): Pick<Festival, "route" | "together"> => ({ route, together });

  test("says what the night was: one line for each of the ways it can go", () => {
    expect(closingKey(f("bridge", true), "ending_full")).toBe("festival.close.full");
    // the three crossed cases of a night that is only just enough
    expect(closingKey(f("bridge", true), "ending_barely")).toBe("festival.close.bridgeTogether");
    expect(closingKey(f("lane", true), "ending_barely")).toBe("festival.close.laneTogether");
    expect(closingKey(f("bridge", false), "ending_barely")).toBe("festival.close.bridgeApart");
    expect(closingKey(f("lane", false), "ending_barely")).toBe("festival.close.laneApart");
    expect(closingKey(f("none", true), "ending_split")).toBe("festival.close.noWayTogether");
    expect(closingKey(f("none", false), "ending_split")).toBe("festival.close.noWayApart");
    expect(new Set(CLOSING_KEYS).size).toBe(7);
    // a full night is bridge and peace, so any other way a night is called full does not take the full line
    expect(closingKey(f("lane", true), "ending_full")).toBe("festival.close.laneTogether");
  });

  test("is in both languages for each, all different, with nobody called he or she and no count of hands", () => {
    const seen = new Set<string>();
    for (const key of [OPENING, ...CLOSING_KEYS, "festival.story", "festival.storyPlain"] as const) {
      for (const lang of ["zh", "en"] as const) {
        const text = translate(lang, key, { story: "x" });
        expect(text.length, `${lang} ${key}`).toBeGreaterThan(5);
        expect(text).not.toMatch(lang === "zh" ? /[他她它]|手/ : /\b(he|she|him|her|his|hers|sir)\b|hand/i);
        expect(text).not.toMatch(/[—;；]|--/);
        expect(seen.has(`${lang}|${text}`)).toBe(false);
        seen.add(`${lang}|${text}`);
      }
    }
    expect(translate("zh", OPENING)).toBe("第五夜，灯会。");
    expect(translate("en", OPENING)).toBe("The fifth night. The lantern festival.");
  });

  test("says in the storyteller's line the story that spread, between quotation marks, where it is known", () => {
    expect(translate("zh", "festival.story", { story: "「李家故意毁桥。」" })).toBe("茶馆旁边，说书人正讲：「李家故意毁桥。」听的人都信了。");
    expect(translate("en", "festival.story", { story: "“The Li family wrecked the bridge.”" })).toBe("Beside the teahouse a storyteller tells the story: “The Li family wrecked the bridge.” The listeners believe it.");
  });
});

const chain = (over: Partial<RevealChain> = {}): RevealChain => ({
  id: "ch",
  label: null,
  texts: { p1: { zh: "李二在桥边找灯笼。", en: "Li Er was looking for his lantern by the bridge." }, p2: { zh: "周家大郎踢坏了桥。", en: "Dalang of the Zhou family kicked the bridge." }, p3: { zh: "李家故意毁桥。", en: "The Li family wrecked the bridge." } },
  trueVersions: ["p1", "p2"],
  told: [
    { id: "c1", from: "li_er", to: "laotai", prop: "p1", op: "", tick: 18 },
    { id: "c3", from: "zhanggui", to: "niangzi", prop: "p3", op: "assimilate", tick: 43 },
    { id: "c6", from: "niangzi", to: "huoji", prop: "p3", op: "sharpen", tick: 80 },
  ],
  reached: [],
  held: { p1: 2, p3: 9 },
  ...over,
});
const reveal = (chains: RevealChain[]): Reveal => ({ truth: null, chains, believers: null, told: null, spoke: null, tellings: null, saidOfMe: null, extra: {} });

test.describe("the storyteller and the false story", () => {
  test("is for the hidden ending that the core names, and no other", () => {
    expect(hasStoryteller({ hidden: [{ id: HIDDEN_LEGEND, label: null }] })).toBe(true);
    expect(hasStoryteller({ hidden: [] })).toBe(false);
    expect(hasStoryteller({ hidden: [{ id: "hidden_something_else", label: null }] })).toBe(false);
    const ending: EndingView = readEnding({ kind: "ending", tick: 6000, ending: "ending_full", hidden: [{ id: HIDDEN_LEGEND, label: { zh: "谎话成了传说", en: "The lie became a legend" } }] });
    expect(hasStoryteller(ending)).toBe(true);
  });

  test("is the version of the story that is not true and that most people hold at the end", () => {
    expect(falseStory(reveal([chain()]))).toEqual({ zh: "李家故意毁桥。", en: "The Li family wrecked the bridge." });
  });

  test("goes by what was told more, then what was told last, where as many hold two false versions", () => {
    const two = chain({
      texts: { p1: { zh: "真", en: "true" }, p3: { zh: "甲", en: "A" }, p4: { zh: "乙", en: "B" } },
      trueVersions: ["p1"],
      held: { p3: 4, p4: 4 },
      told: [
        { id: "c1", from: "a", to: "b", prop: "p3", op: "", tick: 10 },
        { id: "c2", from: "a", to: "c", prop: "p4", op: "", tick: 11 },
        { id: "c3", from: "b", to: "c", prop: "p4", op: "", tick: 12 },
      ],
    });
    expect(falseStory(reveal([two]))).toEqual({ zh: "乙", en: "B" });
    const later = chain({ ...two, told: [...two.told, { id: "c4", from: "d", to: "e", prop: "p3", op: "", tick: 20 }, { id: "c5", from: "e", to: "f", prop: "p3", op: "", tick: 21 }] });
    expect(falseStory(reveal([later]))).toEqual({ zh: "甲", en: "A" });
  });

  test("is none where the reveal is not there, where no version is called true, or where no false version was told or held", () => {
    expect(falseStory(null)).toBeNull();
    expect(falseStory(reveal([]))).toBeNull();
    expect(falseStory(reveal([chain({ trueVersions: [] })]))).toBeNull();
    expect(falseStory(reveal([chain({ held: {}, told: [{ id: "c1", from: "li_er", to: "laotai", prop: "p1", op: "", tick: 18 }] })]))).toBeNull();
  });

  test("is read from the held list of a chain as the core writes it, a count for each version someone holds", () => {
    const event = readEnding({
      kind: "ending",
      tick: 1,
      reveal: {
        truth: null,
        chains: [{ id: "ch", label: "x", texts: { p3: { zh: "甲", en: "A" } }, true: ["p1"], told: [["c3", "a", "b", "p3", "", 4]], held: [["p1", []], ["p3", [["a", 70, "b", 2], ["b", 60, "a", 1]]]], reached: [] }],
        believers: { false: [], true: [], none: [] },
      },
    });
    expect(event.reveal?.chains[0]?.held).toEqual({ p3: 2 });
    expect(falseStory(event.reveal)).toEqual({ zh: "甲", en: "A" });
  });
});
