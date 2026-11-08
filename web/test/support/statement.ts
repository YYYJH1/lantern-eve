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
  cause: n("成因", "Cause"),
  course: n("经过", "Course"),
  rumour: n("误会缘由", "How the rumour began"),
};

/** What can be said in each part. The lists are the same in every game; the counts are what the manager holds. */
export const OPTIONS: Record<PartId, FakeOption[]> = {
  cause: [
    option("c_boat", n("老何的船撞断的", "Old He's boat struck it"), 2, 0, ["n_scrape", "n_boat"]),
    option("c_flood", n("秋汛冲坏的", "The autumn flood broke it"), 0, 1, ["n_scrape"]),
    option("c_li_er", n("李二弄坏的", "Li Er broke it"), 1, 1, ["n_clerk", "n_scrape"]),
    option("c_dalang", n("周家大郎醉酒踢断的", "Zhou Dalang kicked it in, drunk"), 0, 0, []),
  ],
  course: [
    option("r_night_boat", n("夜里，船从河道一侧撞断了栏杆", "At night a boat hit the rail from the river side"), 1, 0, ["n_boat"]),
    option("r_old_joints", n("汛水冲松了旧榫，栏杆自己塌了", "The flood loosened the old joints and the rail fell"), 0, 0, []),
    option("r_kicked_in", n("有人从桥面一侧把栏杆踢断了", "Somebody kicked the rail out from the deck"), 0, 0, []),
  ],
  rumour: [
    option("u_clerk_saw", n("伙计只看见李二在桥边，传话的人添上了后半句", "The clerk only saw Li Er by the bridge, and the telling added the rest"), 2, 0, ["n_clerk", "n_broke"]),
    option("u_made_up", n("有人凭空编出来的", "Somebody made it up from nothing"), 0, 1, ["n_clerk"]),
    option("u_spread", n("有人故意放出风来败坏李家", "Somebody spread it on purpose to hurt the Li family"), 0, 0, []),
  ],
};

/** Why a full statement cannot be made yet, in the core's words. */
export const WHY_NOT = n("要等到第四天傍晚，在茶馆才能完整陈述", "A full statement can only be made at the teahouse from the evening of the fourth day");
export const WHY_USED = n("今天的陈述已经做过了", "Today's statement has been made");

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
  why: n("这和老何亲眼所见对不上", "That does not fit what Old He saw himself"),
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
