/**
 * The people of the frame, for the pages that are fed frames by hand. The game the page runs has its own `people` (twenty rows, none known at
 * the start), and `feedPeople` puts the rows of some of them as the core sends them once the player has talked with them.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { OUT_DIR, REPO_DIR, WEB_DIR } from "./fixtures.ts";
import { feedFrame } from "./slice.ts";

export interface Name {
  zh: string;
  en: string;
}

/** When and where something happened on the first day: `hour` and `minute` of the clock, and `place` an id of the town or null for the street. */
export const stamp = (hour: number, minute: number, place: string | null, day = 1): Record<string, unknown> => ({ tick: (day - 1) * 2070 + (hour - 6) * 120 + minute * 2, day, hour, minute, place });

/** The card of a person who is known, as the core sends it: how far they trust the manager, the favours, the promises and the last changes of the hearts. */
export function card(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trust: "acquainted",
    owes_you: 0,
    you_owe: 0,
    you_promised: [],
    promised_you: [],
    changes: [{ tick: 360, day: 1, hour: 9, minute: 0, delta: 1, why: "talk" }],
    waiting: null,
    joined: false,
    ...over,
  };
}

/** A person the player has talked with, with what the core knows of them to send; `over` lays what a test wants on top. */
export function known(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { known: true, hearts: 1, likes_known: [], gifts: 0, card: card(), met: [], asked: null, ...over };
}

/** The first people the player meets on the first morning, with what they have learned of each. */
export const MORNING: Record<string, Record<string, unknown>> = {
  li_laotai: known({
    hearts: 3,
    met: [stamp(8, 10, "p_li_house")],
    asked: { what: { zh: "灯会上的体面角色：点主灯", en: "the role of honour of lighting the main lantern" }, for: { zh: "请李老太把竹料借给灯会", en: "Ask Granny Li to lend the bamboo for the bridge" }, ...stamp(8, 12, "p_li_house") },
    likes_known: [
      { item: "pastry", like: "like" },
      { item: "wine", like: "dislike" },
    ],
    gifts: 1,
    card: card({ trust: "friendly", changes: [{ ...stamp(8, 10, "p_li_house"), delta: 1, why: "talk" }, { ...stamp(8, 40, "p_li_house"), delta: 2, why: "gift" }] }),
  }),
  zhou_huoji: known({ hearts: 1, met: [stamp(8, 20, "p_teahouse")] }),
  cha_laoban: known({ hearts: 5, met: [stamp(8, 24, "p_teahouse"), stamp(8, 50, null)], likes_known: [{ item: "tea", like: "neutral" }], card: card({ trust: "friendly", owes_you: 1 }) }),
};

/** The `people` of the frame on screen with these people (by id) laid over their own rows. */
export function peopleRows(page: Page, patches: Record<string, Record<string, unknown>> = MORNING): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((patch) => {
    const frame = window.__lantern.client.state.frame as unknown as { people: Array<Record<string, unknown>> };
    return frame.people.map((row) => ({ ...row, ...(patch[String(row.id)] ?? {}) }));
  }, patches);
}

/** Feeds the page a frame in which these people (by id) are the rows of `patches` laid over their own, and `extras` is what else the frame has. */
export async function feedPeople(page: Page, patches: Record<string, Record<string, unknown>> = MORNING, extras: Record<string, unknown> = {}): Promise<void> {
  await feedFrame(page, { people: await peopleRows(page, patches), ...extras });
}

/**
 * The frame at the end of one first morning played under each of the three stories that can be true (`people_frames.py`, under CPython): the manager
 * does the same in each, so the frames differ in what the town does behind their back and in nothing they were told.
 */
export function recordMornings(): Record<string, Record<string, unknown>> {
  const dir = path.join(OUT_DIR, "mornings");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "people-frames.json");
  const run = spawnSync("uv", ["run", "--project", REPO_DIR, "--directory", REPO_DIR, "python", path.join(WEB_DIR, "test/support/people_frames.py"), file], {
    encoding: "utf8",
    timeout: 240_000,
    env: { ...process.env, CUDA_VISIBLE_DEVICES: "" },
  });
  if (run.status !== 0) throw new Error(`no frames from people_frames.py (status ${run.status}): ${run.stderr.slice(-800)}`);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;
}
