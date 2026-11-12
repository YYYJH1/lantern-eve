import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage } from "./fixtures.ts";
import * as fake from "./slice.ts";
import { steady } from "./steady.ts";

// What the tests of the festival night share: the cases of the night (each way it can go), the ending and the last frame of the game for each, a page held
// at the last night with the shows on a clock that the test moves by hand, the ways a game comes to its ending (played, loaded, taken to its end), and ways to
// look at what the show has drawn.

/** The town of the other specs, with the show controller and the festival night on, and the shows on a clock that waits for the test. */
export const TOWN = `${fake.TOWN}&director=on&festival=on&showclock=manual`;
/** Where the pictures go, when a folder is named. */
export const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";
/** The tick of the first night of day 5 (21:00), which the ending is made at. */
export const ENDING_TICK = 10080;

const HEADS = ["li_laotai", "zhou_zhanggui"];
export const BEARERS = { p_li_house: 34, p_zhou_house: 30, p_accountant_home: 8, p_carpenter_home: 6, p_xiaoman_home: 4, p_he_home: 12 };
/** The most people the picture draws: 120. */
export const CROWD = { p_li_house: 44, p_zhou_house: 36, p_accountant_home: 12, p_carpenter_home: 8, p_xiaoman_home: 6, p_he_home: 14 };
const NAMED = [
  { npc: "li_laotai", place: "p_li_house" },
  { npc: "li_da", place: "p_workshop" },
  { npc: "li_er", place: "p_market" },
  { npc: "shitou", place: "p_li_house" },
  { npc: "li_xiaomei", place: "p_li_house" },
  { npc: "zhou_zhanggui", place: "p_zhou_house" },
  { npc: "zhou_niangzi", place: "p_zhou_house" },
  { npc: "zhou_dalang", place: "p_tavern" },
  { npc: "zhou_erlang", place: "p_zhou_house" },
  { npc: "zhou_huoji", place: "p_teahouse" },
  { npc: "cha_laoban", place: "p_teahouse" },
  { npc: "sishu_xiansheng", place: "p_school" },
  { npc: "old_he", place: "p_he_home" },
  { npc: "zuzhang", place: "p_clan_hall" },
  { npc: "zhangfang", place: "p_accountant_home" },
  { npc: "miaozhu", place: "p_temple" },
  { npc: "xiao_man", place: "p_xiaoman_home" },
  { npc: "gengfu", place: "p_watch_post" },
  { npc: "mujiang", place: "p_carpenter_home" },
  { npc: "zhadeng_shifu", place: "p_workshop" },
];

/** One way the night can go: the route of the parade, whether the families are together, who lights the main lantern, how the ending is called, and the hidden ending. */
export interface Case {
  name: string;
  route: "bridge" | "lane" | "none";
  together: boolean;
  lighter: string[];
  ending: "ending_full" | "ending_barely" | "ending_split";
  hidden: boolean;
  /** What the closing line is, in English. */
  closing: string;
}

/**
 * The rows of the design's table of the night (the route, whether the families are together, who lights the lantern, the ending) and its three crossed cases
 * (peace and the bridge with the truth not told; peace and only the lane; no peace and the bridge mended).
 */
export const CASES: Case[] = [
  { name: "full", route: "bridge", together: true, lighter: HEADS, ending: "ending_full", hidden: false, closing: "The bridge was mended. The two families walked side by side, and the heads of both families lit the main lantern together." },
  { name: "peace-not-cleared", route: "bridge", together: true, lighter: HEADS, ending: "ending_barely", hidden: false, closing: "The bridge was open and the two families walked together. Nobody had yet told the truth about the bridge in public." },
  { name: "peace-only-the-lane", route: "lane", together: true, lighter: HEADS, ending: "ending_barely", hidden: false, closing: "The bridge stayed broken, so the crowd went round by the lane. The two families still walked together." },
  { name: "no-peace-bridge-mended", route: "bridge", together: false, lighter: ["zuzhang"], ending: "ending_barely", hidden: false, closing: "The bridge was open and everyone crossed it. The two families kept apart, and the clan elder lit the main lantern alone." },
  { name: "no-peace-lane", route: "lane", together: false, lighter: ["zuzhang"], ending: "ending_barely", hidden: false, closing: "The bridge stayed broken, so the crowd went round by the lane. The two families kept apart, and the clan elder lit the main lantern alone." },
  { name: "split-apart", route: "none", together: false, lighter: [], ending: "ending_split", hidden: false, closing: "There was no way across, by the bridge or by the lane, so there was no parade. The two families stayed apart, and each lit lanterns at its own door." },
  { name: "split-together", route: "none", together: true, lighter: [], ending: "ending_split", hidden: false, closing: "There was no way across, by the bridge or by the lane, so there was no parade. The two families had made peace, and each lit lanterns at its own door." },
  { name: "hidden", route: "bridge", together: true, lighter: HEADS, ending: "ending_full", hidden: true, closing: "The bridge was mended. The two families walked side by side, and the heads of both families lit the main lantern together." },
  { name: "hidden-no-parade", route: "none", together: false, lighter: [], ending: "ending_split", hidden: true, closing: "There was no way across, by the bridge or by the lane, so there was no parade. The two families stayed apart, and each lit lanterns at its own door." },
];

const LABELS = { ending_full: { zh: "圆满", en: "A perfect night" }, ending_barely: { zh: "勉强", en: "Just enough" }, ending_split: { zh: "两家各点各的灯", en: "Each family lit its own lanterns" } } as const;

/** The people of the picture by district, as many as the ending of a case has: a full night 120, a night that is just enough fewer, a scattered one a handful. */
function bearersOf(c: Case): Record<string, number> {
  if (c.ending === "ending_split") return { p_li_house: 5, p_zhou_house: 4, p_he_home: 1 };
  if (c.ending === "ending_barely") return { p_li_house: 22, p_zhou_house: 20, p_accountant_home: 5, p_he_home: 8 };
  return BEARERS;
}

/** The whole reveal of a game in which a false story about the bridge spread: the Li family wrecked it. */
export const REVEAL = {
  truth: { variant: "v_drunk", label: { zh: "周家大郎醉酒踢的。", en: "Dalang of the Zhou family kicked it, drunk." }, props: ["p2"] },
  chains: [
    {
      id: "ch",
      label: { zh: "从「李二在桥边找灯笼」传成「李家故意毁桥」", en: "From “Li Er was looking for his lantern by the bridge” to “the Li family wrecked the bridge”" },
      texts: {
        p1: { zh: "李二在桥边找灯笼。", en: "Li Er was looking for his lantern by the bridge." },
        p2: { zh: "周家大郎醉酒踢坏了桥。", en: "Dalang of the Zhou family kicked the bridge, drunk." },
        p3: { zh: "李家故意毁桥，不想让周家出风头。", en: "The Li family wrecked the bridge on purpose, to spoil the Zhou family's night." },
        p4: { zh: "李家故意毁桥，不想让周家出风头，还嫁祸给醉汉。", en: "The Li family wrecked the bridge on purpose, to spoil the Zhou family's night, and blamed a drunk." },
      },
      planted: [["p1", "li_er", "li_laotai"]],
      true: ["p1", "p2"],
      told: [
        ["c1", "li_er", "li_laotai", "p1", "", 18],
        ["c2", "zhou_huoji", "zhou_zhanggui", "p2", "", 27],
        ["c3", "zhou_zhanggui", "zhou_niangzi", "p3", "assimilate", 43],
        ["c4", "li_laotai", "li_xiaomei", "p1", "", 60],
        ["c6", "zhou_niangzi", "zhou_huoji", "p3", "sharpen", 80],
        ["c7", "zhou_huoji", "cha_laoban", "p4", "fill", 95],
      ],
      held: [
        ["p1", [["li_laotai", 80, "li_er", 1]]],
        ["p3", [["zhou_niangzi", 70, "zhou_zhanggui", 2], ["zhou_zhanggui", 50, "", 1]]],
        ["p4", [["cha_laoban", 60, "zhou_huoji", 4], ["zhou_huoji", 60, "zhou_niangzi", 3], ["zhou_dalang", 55, "cha_laoban", 5]]],
      ],
      reached: ["li_laotai", "zhou_zhanggui", "zhou_niangzi", "li_xiaomei", "zhou_huoji", "cha_laoban"],
    },
  ],
  believers: { false: ["zhou_zhanggui", "zhou_niangzi", "zhou_huoji", "cha_laoban"], true: ["li_laotai"], none: [] },
  told: { total: 12, mutated: 3 },
};

/** The ending event for a case, as the core writes it: with the whole reveal, or compact, as the frames after it carry it. */
export function endingOf(c: Case, options: { tick?: number; compact?: boolean; bearers?: Record<string, number> } = {}): Record<string, unknown> {
  const whole = {
    kind: "ending",
    tick: options.tick ?? ENDING_TICK,
    ending: c.ending,
    label: LABELS[c.ending],
    hidden: c.hidden ? [{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }] : [],
    inputs: { bridge_fixed: c.route === "bridge", detour_done: c.route === "lane", reconciled: c.together, truth_told: c.ending === "ending_full" },
    passage: c.route === "bridge" ? "mended" : c.route === "lane" ? "detour" : "none",
    promised: 6,
    turnout: c.ending === "ending_full" ? 2400 : c.ending === "ending_barely" ? 900 : 120,
    festival: { route: c.route, together: c.together, lighter: c.lighter, bearers: options.bearers ?? bearersOf(c), named: NAMED },
    reveal: REVEAL,
    epilogue: [],
  };
  if (options.compact !== true) return whole;
  const { reveal: _reveal, epilogue: _epilogue, ...compact } = whole;
  return compact;
}

/** The lanterns at the doors of the households that promised. */
const DOORS = [
  { household: "h_li", place: "p_li_house", x: 7, y: 5 },
  { household: "h_zhou", place: "p_zhou_house", x: 36, y: 5 },
  { household: "h_accountant", place: "p_accountant_home", x: 18, y: 12 },
  { household: "h_he", place: "p_he_home", x: 34, y: 30 },
  { household: "h_carpenter", place: "p_carpenter_home", x: 3, y: 28 },
];

/** Three moments of the game as the core lists them, which the ending page shows a small picture of each. */
export const MOMENTS = [
  { kind: "echo", tick: 812, place: "p_zhou_house", x: 44, y: 6, prop: "p3", from: "zhou_zhanggui" },
  { kind: "both_banks", tick: 3200, place: "p_bridge", x: 27, y: 15 },
  { kind: "together_work", tick: 4490, place: "p_bridge", x: 27, y: 15, round: 3 },
];

/** The frame of the last night: 21:00 of the fifth day, the door lanterns lit, the bridge mended or not. */
export const nightFrame = (c: Case, extras: Record<string, unknown> = {}): Record<string, unknown> => ({
  time: { day: 5, hour: 21, minute: 0, phase: "night" },
  weather: "clear",
  lanterns: DOORS,
  hud: { bridge: { state: c.route === "bridge" ? "mended" : "broken" } },
  notebook: [],
  commitments: [],
  moments: [],
  moment_hold: [],
  ...extras,
});

export const camera = (page: Page) => page.evaluate(() => ({ ...window.__lantern.view.camera.pose(), width: window.__lantern.view.camera.size.width, height: window.__lantern.view.camera.size.height }));
/** Runs the clock of the shows forward, in milliseconds. */
export const advance = (page: Page, ms: number) => page.evaluate((n) => window.__lantern.showClock?.advance(n), ms);
export const reasons = (page: Page): Promise<string[]> => page.evaluate(() => [...(window.__lantern.client.state.stats?.reasons ?? [])]);
/** Waits for a few animation frames, so that the map has drawn what the show put on it. */
export const frames = (page: Page, n = 3) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let left = count;
        const next = (): void => {
          if (--left <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    n,
  );

/** What the festival night has made and drawn: the plan, the timeline, what the stage has on the map and how long the show took to update it. */
export const festival = (page: Page) =>
  page.evaluate(() => {
    const s = window.__lantern.festival.stats();
    return JSON.parse(JSON.stringify({ plan: s.plan, timeline: { ...s.timeline, beats: undefined }, stage: s.stage, frames: s.frames, mean: s.mean, p95: s.p95, max: s.max }));
  });

/**
 * Presses a line of the tree of the ending page where a player would, on the line itself a few pixels before it reaches the one who was told. The middle of
 * the box of the line is not on it: a line that turns is not a line through its middle, and the lines of one person who told several share a stretch.
 */
export async function pressTelling(page: Page, id: string): Promise<void> {
  const edge = page.locator(`[data-testid="tree-edge"][data-id="${id}"]`);
  await edge.scrollIntoViewIfNeeded();
  const at = await edge.locator(".tree-edge-hit").evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(Math.max(0, path.getTotalLength() - 6));
    const m = path.getScreenCTM() as DOMMatrix;
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f };
  });
  await page.mouse.click(at.x, at.y);
}

/** The text of the words over the map, or null if there are none. */
export const words = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('[data-testid="director-caption"]')?.textContent ?? null);

/** One line of the words over the map as the browser has set it: what is on it, and how wide it runs. */
export interface WordsLine {
  text: string;
  width: number;
}

/** The lines the words over the map are set in, from the first to the last, read from where the browser put each character. */
export const wordsLines = (page: Page): Promise<WordsLine[]> =>
  page.evaluate(() => {
    const caption = document.querySelector('[data-testid="director-caption"]');
    if (caption === null) return [];
    const lines: Array<{ text: string; top: number; left: number; right: number }> = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
      for (let at = 0; at < node.length; at++) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        // a space where a line is broken takes no room, and has no box
        const box = Array.from(range.getClientRects()).find((r) => r.width > 0.5);
        if (box === undefined) continue;
        // the characters of one line stand at one height, give or take what a face of another script adds
        const line = lines.find((l) => Math.abs(l.top - box.top) < 10);
        if (line === undefined) lines.push({ text: node.data.charAt(at), top: box.top, left: box.left, right: box.right });
        else {
          line.text += node.data.charAt(at);
          line.left = Math.min(line.left, box.left);
          line.right = Math.max(line.right, box.right);
        }
      }
    }
    return lines.sort((a, b) => a.top - b.top).map((l) => ({ text: l.text, width: l.right - l.left }));
  });

/**
 * What is wrong with the way some words are set, or null where nothing is: the last line is left with fewer than three letters or characters (the stops and the
 * spaces do not count: a word and its stop alone on a line are one character alone), or is less than a quarter as wide as the widest line of the words.
 */
export function leftAlone(lines: readonly WordsLine[]): string | null {
  const last = lines[lines.length - 1];
  if (last === undefined || lines.length < 2) return null;
  const letters = Array.from(last.text).filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
  if (letters < 3) return `the last line has ${letters} character${letters === 1 ? "" : "s"} alone: 「${last.text}」`;
  const widest = Math.max(...lines.map((line) => line.width));
  if (last.width < widest / 4) return `the last line is ${Math.round(last.width)} px of ${Math.round(widest)}: 「${last.text}」`;
  return null;
}

/** Puts the animations and the transitions of the page's own style sheets out, for a picture: the words fade in with them, and the manual clock of the show does not move them. */
export async function still(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("*, *::before, *::after { animation: none !important; transition: none !important; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

/** Opens the page at the last night of a case, in a language and a theme, the way a game is when it comes to its end: the festival night begins, on a clock that waits for the test. */
export async function openNight(
  lantern: LanternPage,
  c: Case,
  lang: "zh" | "en",
  theme: "light" | "dark",
  options: { moments?: boolean; bearers?: Record<string, number>; query?: string; size?: { width: number; height: number } } = {},
): Promise<Awaited<ReturnType<typeof camera>>> {
  const page = lantern.page;
  await page.setViewportSize(options.size ?? { width: 1280, height: 760 });
  const moments = options.moments === true ? { moments: MOMENTS } : {};
  await fake.openFirstDay(lantern, nightFrame(c, moments), options.query ?? TOWN);
  await lantern.setLang(lang);
  await lantern.setTheme(theme);
  await page.waitForFunction(() => window.__lantern.play.director.port !== null);
  await fake.recordSent(page);
  if (SHOTS !== "") await still(page);
  // where the camera of the player is when the night begins, which it is given back to
  const before = await camera(page);
  const ending = endingOf(c, { bearers: options.bearers });
  await fake.feedFrame(page, nightFrame(c, { ending, ...moments }), [ending]);
  await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
  return before;
}

/**
 * The host sends a game that is loaded from a save that was made at its end, as it does (`runtime.ts`): the page is reset, the whole ending comes, then the
 * last frame of the game with the ending in it, and then the load is done. `notes` is what the save kept for the page.
 */
export function loadFinished(page: Page, c: Case, extras: Record<string, unknown> = {}, notes?: Record<string, unknown>): Promise<void> {
  const ending = endingOf(c);
  const compact = endingOf(c, { compact: true });
  return page.evaluate(
    ([e, k, frameExtras, saved]) => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const state = window.__lantern.client.state;
      const base = state.frame as Record<string, unknown>;
      const more = frameExtras as Record<string, unknown>;
      const frame = { ...base, ...more, ending: k, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "reset", seed: state.seed ?? 7, scenario: state.scenario ?? "bridge" });
      client.onMessage({ type: "ending", ending: e });
      client.onMessage({ type: "frame", tick: 10080, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
      client.onMessage({ type: "loaded", info: { id: 1, name: "ending", tick: 10080, hash: "h", savedHash: "h", match: true, hashesChecked: 1, reissued: 0, cancelledOpen: 0, ...(saved === undefined ? {} : { page: saved }) } });
    },
    [ending, compact, nightFrame(c, extras), notes] as const,
  );
}

/**
 * A recording is taken to its end, as the host of a recording does it (`shared/player.ts`): the page is reset, the scene and the whole ending come, and then the
 * frame of that tick with no events.
 */
export function seekToEnd(page: Page, c: Case, extras: Record<string, unknown> = {}): Promise<void> {
  const whole = endingOf(c);
  const compact = endingOf(c, { compact: true });
  return page.evaluate(
    ([e, k, frameExtras]) => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const state = window.__lantern.client.state;
      const base = state.frame as Record<string, unknown>;
      const more = frameExtras as Record<string, unknown>;
      const frame = { ...base, ...more, ending: k, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "reset", seed: state.seed ?? 7, scenario: state.scenario ?? "bridge" });
      client.onMessage({ type: "ending", ending: e });
      client.onMessage({ type: "frame", tick: 10080, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
    },
    [whole, compact, nightFrame(c, extras)] as const,
  );
}

/**
 * A page meets a game that is over in a frame, as a page does that comes back to one: the frame has the compact ending, and the page asks its host for the
 * whole one, which comes a moment later.
 */
export async function meetFinished(page: Page, c: Case, extras: Record<string, unknown> = {}): Promise<void> {
  const whole = endingOf(c);
  const compact = endingOf(c, { compact: true });
  await page.evaluate(
    ([e, k, frameExtras]) => {
      const handle = window.__lantern.client;
      const client = handle as unknown as { onMessage(message: unknown): void };
      const original = handle.call.bind(handle);
      handle.call = ((call: { op: string }) => (call.op === "ending" ? Promise.resolve(e) : original(call as never))) as typeof handle.call;
      const state = handle.state;
      const base = state.frame as Record<string, unknown>;
      const more = frameExtras as Record<string, unknown>;
      const frame = { ...base, ...more, ending: k, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "reset", seed: state.seed ?? 7, scenario: state.scenario ?? "bridge" });
      client.onMessage({ type: "frame", tick: 10080, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
    },
    [whole, compact, nightFrame(c, extras)] as const,
  );
}

/** A picture of the page. */
export async function shoot(page: Page, name: string): Promise<void> {
  await frames(page, 4);
  await steady(page);
  await page.screenshot({ path: path.join(SHOTS, name) });
}
