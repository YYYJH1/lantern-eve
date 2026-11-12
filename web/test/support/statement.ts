/**
 * Fake frames for the statement card. They follow the key `statement` of the frame as the core sends it (the tables in the
 * docstring of `lantern_core.world.bridge` list its fields): the three parts with their options, the counts of the notes for and against each, the entries behind them, the option
 * chosen, whether a full statement can be made and why not, whether today's is made, and the one made last. The notes are the
 * four lines of `notebook()` in slice.ts, so the notes behind a count are lines the notebook of the same page has.
 */
import type { CoreEvent } from "../../src/shared/protocol.ts";
import type { Name } from "./slice.ts";

const n = (zh: string, en: string): Name => ({ zh, en });

export type PartId = "cause" | "course" | "rumour";
export const PART_IDS: readonly PartId[] = ["cause", "course", "rumour"];

export interface FakeOption {
  id: string;
  text: Name;
  support: number;
  against: number;
  entries: string[];
}

const option = (id: string, text: Name, support: number, against: number, entries: string[]): FakeOption => ({ id, text, support, against, entries });

export const TITLES: Record<PartId, Name> = {
  cause: n("桥是怎么坏的", "How the bridge broke"),
  course: n("那晚的经过", "What happened that night"),
  rumour: n("大家为什么会误会", "Why people got it wrong"),
};

/** What can be said in each part. The lists are the same in every game; the counts are what the manager holds. */
export const OPTIONS: Record<PartId, FakeOption[]> = {
  cause: [
    option("c_boat", n("船夫老何夜里撑船，船头撞断了栏杆", "Boatman He's boat struck the railing in the night"), 2, 0, ["n_scrape", "n_boat"]),
    option("c_flood", n("秋汛的水头冲松了旧榫，栏杆自己断了", "The flood water loosened the old joints and the railing gave way by itself"), 0, 1, ["n_scrape"]),
    option("c_li_er", n("李二下手弄断了栏杆", "Li Er broke the railing"), 1, 1, ["n_clerk", "n_scrape"]),
    option("c_dalang", n("周家大郎喝醉了酒，一脚踢断了栏杆", "Zhou Dalang, drunk, kicked the railing down"), 0, 0, []),
  ],
  course: [
    option("r_night_boat", n("船夫老何夜里撑船从桥下过，船头撞上了栏杆。事后老何悄悄把船修好了", "Boatman He poled under the bridge in the night and the bow struck the railing. Afterwards the boatman quietly mended the boat"), 1, 0, ["n_boat"]),
    option("r_old_joints", n("夜里水头打上桥，把旧榫冲松了。栏杆是自己断的，桥上桥下都没有人", "The flood water hit the bridge in the night and loosened the old joints. The railing gave way by itself, with nobody on the bridge or under it"), 0, 0, []),
    option("r_kicked_in", n("周家大郎夜里在酒肆喝醉了。晃到桥上，一脚踢断了栏杆", "Zhou Dalang got drunk at the tavern in the night, staggered onto the bridge and kicked the railing down"), 0, 0, []),
  ],
  rumour: [
    option("u_clerk_saw", n("周家伙计只看见李二在桥边找灯笼。周掌柜记着旧怨，猜是李二弄坏的。话越传越重，又添上了「故意」「眼红」", "Zhou's Clerk only saw Li Er at the bridge looking for a lantern. Shopkeeper Zhou, holding an old grudge, guessed that Li Er broke the railing. The story grew as it went round and picked up “on purpose” and “envy”"), 2, 0, ["n_clerk", "n_broke"]),
    option("u_made_up", n("周家伙计编了瞎话，李二那晚根本不在桥边", "Zhou's Clerk made it up, and Li Er was not at the bridge that night"), 0, 1, ["n_clerk"]),
    option("u_spread", n("周家故意把话传出去，想坏了李家的名声", "The Zhou family spread it on purpose to ruin the name of the Li family"), 0, 0, []),
  ],
};

/** Why a full statement cannot be made yet, in the core's words. */
export const WHY_NOT = n("要等第四天傍晚，才能照讲稿当众说", "The statement has to wait for the evening of the fourth day");
export const WHY_USED = n("今天已经照讲稿说过一回", "A statement has been made today already");

/** The parts of the card, with a choice made in those named. A part named in `gaps` has nothing held behind any option. */
export function partsOf(chosen: Partial<Record<PartId, string>> = {}, gaps: readonly PartId[] = []): Array<Record<string, unknown>> {
  return PART_IDS.map((part) => {
    const gap = gaps.includes(part);
    return {
      part,
      title: TITLES[part],
      options: OPTIONS[part].map((o) => (gap ? { ...o, support: 0, against: 0, entries: [] } : o)),
      chosen: chosen[part] ?? null,
      gap,
    };
  });
}

/** The `statement` key of a frame, at the start: nothing chosen, and a full statement not yet possible. `over` is laid on it. */
export function statementKey(chosen: Partial<Record<PartId, string>> = {}, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { parts: partsOf(chosen), can_state: false, why_not: WHY_NOT, used_today: false, last: null, ...over };
}

/** A choice in every part: the card is ready, and the town lets the manager speak. */
export const READY = { cause: "c_boat", course: "r_night_boat", rumour: "u_clerk_saw" } as const;

/** The card of a manager who is at the teahouse in the evening with a choice in every part. */
export function readyKey(over: Record<string, unknown> = {}): Record<string, unknown> {
  return statementKey({ ...READY }, { can_state: true, why_not: null, ...over });
}

/** The statement made last that fell short: the cause did not hold, though six of the seven there took it in. */
export const LAST_WRONG = {
  day: 4,
  hour: 18,
  venue: "p_teahouse",
  named: 7,
  accepted: 6,
  percent: 86,
  elder: "accepted",
  told: false,
  wrong: ["cause"],
  why: n("「桥是怎么坏的」这一条，和船夫老何亲眼看见的不一样。", "The part “How the bridge broke” goes against what Boatman He saw with their own eyes."),
};

/** The statement made last that told the truth. */
export const LAST_TOLD = { day: 5, hour: 18, venue: "p_teahouse", named: 8, accepted: 7, percent: 88, elder: "accepted", told: true, wrong: [], why: null };

/** Who was there and what they made of it: the stands of an audience, as the panel of a clarification shows them. */
export const AUDIENCE = [
  { npc: "zhou_huoji", before: "against", after: "for", reason: n("我只看见他在桥边，没看见他碰桥。", "I only saw him by the bridge. I did not see him touch it.") },
  { npc: "li_laotai", before: "unsure", after: "for", reason: n("原来只是有人在桥边看见他，我撤回阻拦。", "So he was only seen near the bridge. I withdraw my objection.") },
  { npc: "cha_laoban", before: "unsure", after: "unsure", reason: n("我也只是听来的，说不出是谁看见的。", "I only heard it too, and cannot say who saw it.") },
  { npc: "zhou_zhanggui", before: "against", after: "against", reason: n("我听到的可不是这样。", "That is not what I have heard.") },
];

/** The event of a full statement, with the audience. */
export function spokeEvent(last: Record<string, unknown> = LAST_WRONG, audience: unknown[] = AUDIENCE, tick = 900): CoreEvent {
  return { kind: "spoke", tick, venue: last.venue, named: last.named, accepted: last.accepted, percent: last.percent, elder: last.elder === "accepted" ? 2 : 0, complete: true, cleared: last.told === true, audience };
}
