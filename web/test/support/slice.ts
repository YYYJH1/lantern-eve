/**
 * Fake frames for the first day and for the days after it. They follow the tables of the frame in the docstring of
 * `lantern_core.world.bridge` (the keys `tasks`, `tracked`, `judgments`, `hint`, `commitments`, `site`, `recap`, `board`, and `player.talk` with `costs`
 * and `leaves_at`, the events `clarified`, `task_changed`, `delivered` and the rest), with the people and places of the
 * bridge town, so that the page can be shown the five days without a core that plays them.
 *
 * The first day has no `board`: a frame without it is the frame of a game that has no days after the first, and the page
 * says so. A frame is fed over the one the real core sent, which carries the board of today's core, so `openFirstDay` begins
 * with `board: null`, and with `statement: null` for the statement card, so that the real one does not show through (a test that wants the days after
 * feeds a board of its own, and a test that wants the card feeds one). `moment("day2")`
 * and the others put the board, the promises, the pile and the tasks of a later day in a frame.
 */
import type { Page } from "@playwright/test";

export interface Name {
  zh: string;
  en: string;
}

const n = (zh: string, en: string): Name => ({ zh, en });

// --- The first evening --------------------------------------------------------------------------

/** The tasks of the first day, the second of them followed. */
export function tasks(tracked: string | null = "t_bamboo_first", done: string[] = []): Record<string, unknown> {
  const marked = (list: Array<Record<string, unknown>>): Array<Record<string, unknown>> => list.map((task) => (done.includes(String(task.id)) ? { ...task, state: "done", blocker: null } : task));
  return {
    tracked,
    tasks: marked([
      {
        id: "t_bamboo_first",
        kind: "obstacle",
        job: "bridge",
        text: n("李家不肯给竹料", "The Li family will not give bamboo"),
        why: n("他们认为总管没有制止毁桥的说法", "They think the manager did nothing about the talk that Li Er broke the bridge"),
        next: n("问清这话的来源", "Find out where that talk came from"),
        state: "blocked",
        blocker: n("镇上说李二毁了桥，李老太不肯借竹料", "The town says Li Er broke the bridge, so Granny Li will not lend bamboo"),
        action: { verb: "talk", npc: "li_laotai" },
        window: { day: 1, from: 8, to: 17, place: "p_li_house" },
      },
      {
        id: "t_source",
        kind: "lead",
        job: "truth",
        text: n("李二那晚为什么在桥边？", "Why was Li Er by the bridge that night?"),
        why: n("周家伙计说他看见了李二", "Zhou's Clerk says he saw Li Er there"),
        next: n("问周家伙计是怎么看见的", "Ask Zhou's Clerk how he saw it"),
        state: "open",
        blocker: null,
        action: { verb: "ask_source", npc: "zhou_huoji" },
        window: { day: 1, from: 9, to: 20, place: "p_teahouse" },
      },
      {
        id: "t_evening",
        kind: "venue",
        job: "truth",
        text: n("傍晚茶馆：当众澄清", "The teahouse this evening: clear it up in public"),
        why: null,
        next: n("傍晚去茶馆，在场的人都会听见", "Go to the teahouse in the evening, where everyone there will hear"),
        state: "open",
        blocker: null,
        action: { verb: "move", place: "p_teahouse" },
        window: { day: 1, from: 17, to: 20, place: "p_teahouse" },
        expected: [
          { id: "cha_laoban", from: 1020, to: 1140 },
          { id: "zhou_huoji", from: 1116, to: 1140 },
          { id: "li_laotai", from: 1050, to: 1140 },
        ],
      },
      {
        id: "t_promise",
        kind: "promise",
        job: "bridge",
        text: n("李大：第一批竹料", "Li Da: the first bamboo"),
        why: null,
        next: n("等李老太撤回阻拦，再请李大送料", "Once Granny Li lets go, ask Li Da to bring it"),
        state: "open",
        blocker: null,
        action: { verb: "talk", npc: "li_da" },
        window: null,
      },
    ]),
  };
}

/** The notebook of the first evening: four lines, two heard and one seen. */
export function notebook(): Array<Record<string, unknown>> {
  return [
    { id: "n_scrape", text: n("桥墩上有新的刮痕。", "There are fresh scrapes on the bridge pier."), source: { kind: "seen" }, marks: [], chain: [] },
    {
      id: "n_clerk",
      text: n("周家伙计说他看见李二那晚在桥边。", "Zhou's Clerk says he saw Li Er by the bridge that night."),
      source: { kind: "heard", who: n("周家伙计", "Zhou's Clerk"), hand: 1 },
      marks: [],
      chain: [n("周家伙计", "Zhou's Clerk")],
    },
    {
      id: "n_broke",
      text: n("李二弄坏了桥。", "Li Er broke the bridge."),
      source: { kind: "heard", who: n("茶馆老板娘", "Teahouse Keeper"), hand: 3 },
      marks: [],
      chain: [n("茶馆老板娘", "Teahouse Keeper"), n("周掌柜", "Shopkeeper Zhou"), null],
    },
    {
      id: "n_boat",
      text: n("老何那晚在桥下撑船。", "Old He was poling his boat under the bridge that night."),
      source: { kind: "heard", who: n("茶馆老板娘", "Teahouse Keeper"), hand: 2 },
      marks: [],
      chain: [n("茶馆老板娘", "Teahouse Keeper"), null],
    },
  ];
}

export const COSTS = { ask: 10, ask_source: 10, tell: 15, entrust: 20, promise: 20 } as const;
/** `player.costs` of every frame: the five acts of a talk, and speaking in public, which has no talk to show its cost in. */
export const ALL_COSTS = { ...COSTS, speak: 30 } as const;

const REQUEST = {
  id: "ask_bamboo",
  label: n("请对方把竹料送到桥边", "Ask them to bring the bamboo to the bridge"),
  body: { kind: "material" },
};
const GIVE = {
  id: "give_lamp",
  label: n("许对方点主灯的体面", "Promise the honour of lighting the main lantern"),
  body: { op: "make", what: "role", item: "t_honor_light", due: 3 },
};

/** What the manager can tell, with the other ways of telling the notebook line about Li Er. */
const TELL = [
  { id: "n_clerk:as_seen", label: n("说成亲眼所见：周家伙计说他看见李二那晚在桥边。", "As if you saw it yourself: Zhou's Clerk says he saw Li Er by the bridge that night."), body: { entry: "n_clerk", how: "as_seen" } },
  { id: "n_clerk:hide_source", label: n("不说来源：周家伙计说他看见李二那晚在桥边。", "Without the source: Zhou's Clerk says he saw Li Er by the bridge that night."), body: { entry: "n_clerk", how: "hide_source" } },
  { id: "n_broke:sharpen", label: n("添油加醋：李二弄坏了桥。", "Heavier: Li Er broke the bridge."), body: { entry: "n_broke", how: "sharpen" } },
  { id: "made_up", label: n("编一条：老何的船撞了桥。", "Make one up: Old He's boat hit the bridge."), body: { how: "fabricate", pred: "hit", subject: "old_he", object: "t_rail", source: "self_seen" } },
];

/** The player's part of a frame in a talk with `npc`, over the `player` the live frame has. `entrust` is what the town puts forward to ask this person (the one request of the bamboo unless a test says). */
export function playerInTalk(
  base: Record<string, unknown> | null,
  npc: string,
  leaves: { hour: number; minute: number } | null = { hour: 15, minute: 30 },
  entrust: unknown[] = [REQUEST],
  promise: unknown[] = [GIVE],
): Record<string, unknown> {
  return {
    ...(base ?? {}),
    costs: ALL_COSTS,
    talk: { npc, costs: COSTS, leaves_at: leaves },
    offers: { entrust, promise, tell: TELL, speak: [] },
    topics: [
      { id: "n_clerk", kind: "entry", label: n("周家伙计说他看见李二那晚在桥边。", "Zhou's Clerk says he saw Li Er by the bridge that night.") },
      { id: "t_rail", kind: "thing", label: n("桥栏杆", "The bridge rail") },
      { id: "li_er", kind: "person", label: n("李二", "Li Er") },
    ],
  };
}

/** The verbs the world offers in a talk, with those of the slice. */
export const TALK_VERBS = ["leave", "ask", "ask_source", "tell", "entrust", "promise", "judge", "hint", "track"];
/** And outside one. */
export const FREE_VERBS = ["move", "talk", "listen", "look", "rally", "judge", "hint", "track"];

/** What Li Da promised in the evening, as the core sends it: the first batch of four poles, for seven the next morning. */
export function commitments(state: "promised" | "delivered" = "promised"): Record<string, unknown> {
  return {
    commitments: [
      {
        id: "c_li_da_bamboo",
        by: "li_da",
        to: "player",
        what: n("把四根竹料送到石桥", "Bring 4 poles of bamboo to the Stone Bridge"),
        item: "bamboo",
        amount: 4,
        due: { day: 2, hour: 7 },
        state,
        reason: null,
      },
    ],
    site: { bamboo: state === "delivered" ? 4 : 0, timber: 0 },
  };
}

/** The reasons the script gives for a promise that was not kept or was taken back. */
export const REASONS = {
  rain: n("下大雨，货运不出来", "The heavy rain kept the goods off the road"),
  failed: n("路上出了岔子，货没能送到", "Something went wrong and the goods did not get there"),
  late: n("没能赶在期限前送到", "It did not arrive in time"),
  taken_back: n("应承被收了回去", "They took the promise back"),
} as const;

/** The promise of `commitments()` in another state, with the reason the core gives for it. */
export function commitmentEnded(state: "broken" | "withdrawn", reason: keyof typeof REASONS | null): Record<string, unknown> {
  const [promise] = commitments().commitments as Array<Record<string, unknown>>;
  return { commitments: [{ ...promise, state, reason: reason === null ? null : REASONS[reason] }] };
}

export const JUDGMENT = { a: "n_clerk", b: "n_broke", relation: "unsupported", made: 412 };

/** The other account that Granny Li gave with her stance, as the core sends it (the key is there only then). */
export const RIVAL = {
  text: n("船夫老何昨夜弄坏了石桥栏杆。", "Boatman He damaged the Stone Bridge Railing last night."),
  who: { ...n("周掌柜", "Shopkeeper Zhou"), id: "zhou_zhanggui" },
};

/** The cards of the people, as the core sends them. */
export function cards(): Record<string, unknown> {
  return {
    cards: [
      {
        id: "li_laotai",
        name: n("李老太", "Granny Li"),
        role: n("李家老太太", "Matriarch of the Li family"),
        family: "fam_li",
        met: true,
        find: [
          { from: 360, place: "p_li_house", act: "rest", now: true },
          { from: 720, place: "p_teahouse", act: "tea" },
          { from: 360, place: "p_li_house", act: "rest", tomorrow: true },
        ],
        wants: [{ id: "w_li_laotai_public", text: n("有人出来把「李二毁桥」这话当众说清", "Someone to set the talk that Li Er wrecked the bridge straight in public") }],
        favours: 0,
        stance: {
          text: n("李二弄坏了栏杆。", "Li Er broke the rail."),
          tick: 480,
          at: { day: 1, hour: 8, minute: 0 },
          how: n("亲口告诉你的", "They told you themselves"),
          kind: "told",
          entry: "n_broke",
        },
        agreed: [],
      },
      { id: "li_da", name: n("李大", "Li Da"), role: n("李家长子", "Eldest son of the Li family"), family: "fam_li", met: false, find: null, wants: [], favours: 1, stance: null, agreed: ["c_li_da_bamboo"] },
    ],
  };
}

/** The three lines of a recap of the morning after, in the words of the script: the delivery, a stand that changed, the promise. */
export function recapLines(): Array<{ text: Name; events: number[] }> {
  return [
    { text: n("李大答应的四根竹料，已经送到石桥。", "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge."), events: [16, 26] },
    { text: n("你当众指出那句话说过了头，周家伙计和李老太听后改了口。", "You said in public that the claim went too far, and Zhou's Clerk and Granny Li changed their minds."), events: [12] },
    { text: n("李大答应送来四根竹料。", "Li Da promised to bring 4 poles of bamboo."), events: [16] },
  ];
}

/** The `recap` of the frame of the call that made it. */
export function recap(): Record<string, unknown> {
  return { recap: recapLines() };
}

/** The `clarified` event of the evening at the teahouse, as the core sends it: the stands are `against`, `unsure` and `for`. */
export function clarified(): Record<string, unknown> {
  return {
    kind: "clarified",
    tick: 700,
    venue: "p_teahouse",
    claim: "n_broke",
    basis: ["n_clerk"],
    accepted: 3,
    prop: "pr_liner_damaged_jealous",
    audience: [
      { npc: "zhou_huoji", before: "against", after: "for", reason: n("我只看见他在桥边，没看见他碰桥。", "I only saw him by the bridge. I did not see him touch it.") },
      { npc: "li_laotai", before: "unsure", after: "for", reason: n("原来只是有人在桥边看见他，我撤回阻拦。", "So he was only seen near the bridge. I withdraw my objection.") },
      { npc: "cha_laoban", before: "unsure", after: "for", reason: n("我也只是听来的，说不出是谁看见的。", "I only heard it too, and cannot say who saw it.") },
      { npc: "zhou_zhanggui", before: "against", after: "against", reason: n("我听到的可不是这样。", "That is not what I have heard.") },
    ],
  };
}

// --- The days after the first ----------------------------------------------------------------------------

/** The acts that move the peace, in the order a player would do them (`board.peace.acts`). */
export const PEACE_ACTS = [
  { id: "stop_blaming", text: n("一家不再公开指控", "One family stops accusing in public") },
  { id: "work_together", text: n("两家的人一起干活", "People of both families work together") },
  { id: "witnessed_meal", text: n("摆一顿有人见证的和解饭", "A reconciliation meal that people witness") },
];

/** The acts of the peace, those with these ids done. */
export const peaceActs = (done: string[] = []): Array<Record<string, unknown>> => PEACE_ACTS.map((act) => ({ ...act, done: done.includes(act.id) }));

/** The `board` of a frame as a core of the days after the first sends it, at the start of the second day, with `over` laid on it. */
export function boardKey(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    helpers: [],
    need: 5,
    both: false,
    hours: { done: 0, need: 10 },
    window: { day: 3, from: 8, to: 12, place: "p_bridge" },
    stop: null,
    deadline: { day: 4, hour: 18 },
    statement: null,
    truth: { state: "open", last: null },
    peace: { state: "open", grudge: 70, acts: peaceActs(), witnessed: false },
    ...over,
  };
}

/** A promise of goods to the bridge, as the core sends it: the words are the script's template filled in. */
export function promiseOf(id: string, by: string, item: "bamboo" | "timber", amount: number, due: { day: number; hour: number }, state: "promised" | "delivered" | "broken", reason: keyof typeof REASONS | null = null): Record<string, unknown> {
  const noun = item === "bamboo" ? n("竹料", "bamboo") : n("木料", "timber");
  return {
    id,
    by,
    to: "player",
    what: n(`把${amount}根${noun.zh}送到石桥`, `Bring ${amount} poles of ${noun.en} to the Stone Bridge`),
    item,
    amount,
    due,
    state,
    reason: reason === null ? null : REASONS[reason],
  };
}

/** The reason the last work time did nothing, in the words of the core. */
export const RAIN_STOP = n("昨天下大雨，没有人上工", "Heavy rain the day before kept everyone off the bridge");
/** Why the last public statement fell short: fewer than five named people were there, and the elder did not come. */
export const SHORT_WHY = n("在场有名有姓的人不足五个，族长也没来", "Fewer than five named people were there, and the elder did not come");

/** The last public statement, which fell short. */
export const FELL_SHORT = { day: 3, hour: 18, venue: "p_teahouse", named: 4, accepted: 2, percent: 50, elder: "absent", why: SHORT_WHY };
/** The last public statement, which counted. */
export const CLEARED = { day: 4, hour: 18, venue: "p_teahouse", named: 7, accepted: 6, percent: 86, elder: "accepted", why: null };

export type Moment = "day2" | "day3" | "day4" | "day5";

/**
 * A moment of the five days as the extras of a frame: the clock, the promises and the pile at the bridge, the `board` and the
 * `hud.bridge` that goes with it. The second day has the first batch of bamboo in, the third the first helpers, the fourth the work
 * under way after a rain, a promise still to come and a statement that fell short, and the fifth everything done.
 */
export function moment(name: Moment): Record<string, unknown> {
  const bamboo1 = promiseOf("c_bamboo_1", "li_da", "bamboo", 4, { day: 2, hour: 7 }, "delivered");
  switch (name) {
    case "day2":
      return {
        time: { day: 2, hour: 7, minute: 10, phase: "day" },
        commitments: [bamboo1],
        site: { bamboo: 4, timber: 0 },
        board: boardKey({ helpers: [{ family: "fam_li", count: 1 }] }),
        hud: { bridge: { done: 1, need: 5, percent: 0, hours: 0, hours_need: 10, state: "broken", lacking: "bamboo" } },
      };
    case "day3":
      return {
        time: { day: 3, hour: 9, minute: 30, phase: "day" },
        commitments: [bamboo1, promiseOf("c_bamboo_2", "li_da", "bamboo", 4, { day: 3, hour: 7 }, "delivered"), promiseOf("c_timber_1", "zhou_zhanggui", "timber", 8, { day: 3, hour: 7 }, "delivered")],
        site: { bamboo: 8, timber: 8 },
        board: boardKey({
          helpers: [
            { family: "fam_li", count: 2 },
            { family: "fam_zhou", count: 1 },
          ],
          both: true,
          hours: { done: 2, need: 10 },
          window: { day: 4, from: 8, to: 12, place: "p_bridge" },
          peace: { state: "open", grudge: 64, acts: peaceActs(["stop_blaming"]), witnessed: false },
        }),
        hud: { bridge: { done: 3, need: 5, percent: 20, hours: 2, hours_need: 10, state: "repairing", lacking: "bamboo" } },
      };
    case "day4":
      return {
        time: { day: 4, hour: 9, minute: 20, phase: "day" },
        commitments: [
          bamboo1,
          promiseOf("c_bamboo_2", "li_da", "bamboo", 4, { day: 3, hour: 7 }, "delivered"),
          promiseOf("c_bamboo_3", "li_da", "bamboo", 2, { day: 4, hour: 13 }, "promised"),
          promiseOf("c_timber_1", "zhou_zhanggui", "timber", 8, { day: 3, hour: 7 }, "delivered"),
        ],
        site: { bamboo: 8, timber: 8 },
        board: boardKey({
          helpers: [
            { family: "fam_li", count: 3 },
            { family: "fam_zhou", count: 2 },
          ],
          both: true,
          hours: { done: 4, need: 10 },
          window: { day: 4, from: 13, to: 17, place: "p_bridge" },
          stop: RAIN_STOP,
          truth: { state: "open", last: FELL_SHORT },
          peace: { state: "open", grudge: 55, acts: peaceActs(["stop_blaming", "work_together"]), witnessed: false },
        }),
        hud: { bridge: { done: 5, need: 5, percent: 40, hours: 4, hours_need: 10, state: "repairing", lacking: "bamboo" } },
      };
    case "day5":
      return {
        time: { day: 5, hour: 19, minute: 0, phase: "day" },
        commitments: [
          bamboo1,
          promiseOf("c_bamboo_2", "li_da", "bamboo", 4, { day: 3, hour: 7 }, "delivered"),
          promiseOf("c_bamboo_3", "li_da", "bamboo", 2, { day: 4, hour: 13 }, "delivered"),
          promiseOf("c_timber_1", "zhou_zhanggui", "timber", 8, { day: 3, hour: 7 }, "delivered"),
        ],
        site: { bamboo: 10, timber: 8 },
        board: boardKey({
          helpers: [
            { family: "fam_li", count: 3 },
            { family: "fam_zhou", count: 3 },
          ],
          both: true,
          hours: { done: 10, need: 10 },
          window: null,
          truth: { state: "done", last: CLEARED },
          peace: { state: "done", grudge: 18, acts: peaceActs(PEACE_ACTS.map((a) => a.id)), witnessed: true },
        }),
        hud: { bridge: { done: 6, need: 5, percent: 100, hours: 10, hours_need: 10, state: "mended" } },
      };
  }
}

/** One task of the days after the first, as the core sends it. */
function laterTask(id: string, job: "bridge" | "truth" | "peace", text: Name, action: Record<string, unknown> | null, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, kind: "need", job, text, why: null, next: null, state: "open", blocker: null, action, window: null, ...over };
}

/**
 * The tasks of the days after the first, one for each kind of request and each way of speaking in public the page offers a button for.
 * `states` says which of them are not open; `tracked` is the one followed.
 */
export function laterTasks(tracked: string | null = "t_bamboo_more", states: Record<string, string> = {}): Record<string, unknown> {
  const list = [
    laterTask("t_bamboo_more", "bridge", n("再请李大送一批竹料", "Ask Li Da for another batch of bamboo"), { verb: "entrust", npc: "li_da", item: "bamboo", request: "material" }, {
      why: n("桥还差六根竹料", "The bridge still lacks 6 poles of bamboo"),
      next: n("请李大再送一批竹料", "Ask Li Da to bring the next batch"),
      window: { day: 2, from: 8, to: 17, place: "p_li_house" },
    }),
    laterTask("t_timber", "bridge", n("请周掌柜送木料", "Ask Shopkeeper Zhou for the timber"), { verb: "entrust", npc: "zhou_zhanggui", item: "timber", request: "material" }),
    laterTask("t_lend", "bridge", n("请李老太借出竹料", "Ask Granny Li to lend the bamboo"), { verb: "entrust", npc: "li_laotai", item: "bamboo", request: "lend" }),
    laterTask("t_helper_zhou", "bridge", n("请周家大郎来帮工", "Ask Zhou Dalang to help"), { verb: "entrust", npc: "zhou_dalang", request: "join" }),
    laterTask("t_helper_chain", "bridge", n("请李小妹去劝周家二郎", "Ask Li Xiaomei to talk Zhou Erlang round"), { verb: "entrust", npc: "li_xiaomei", request: "persuade", target: "zhou_erlang" }),
    laterTask("t_lane", "bridge", n("请庙祝开夹道", "Ask the temple keeper to open the lane"), { verb: "entrust", npc: "miaozhu", request: "lane" }),
    laterTask("t_witness", "truth", n("请更夫说说那晚的事", "Ask the watchman about that night"), { verb: "entrust", npc: "gengfu", request: "testify" }),
    laterTask("t_convene", "truth", n("请族长召集族人", "Ask the elder to call the clan"), { verb: "entrust", npc: "zuzhang", request: "convene" }),
    laterTask("t_statement", "truth", n("傍晚在茶馆当众说清", "Set the record straight at the teahouse tonight"), { verb: "speak", kind: "evidence" }, {
      kind: "venue",
      window: { day: 4, from: 17, to: 21, place: "p_teahouse" },
    }),
    laterTask("t_clarify", "truth", n("把判对的两句当众讲出来", "Say the two lines you judged in public"), { verb: "speak", kind: "clarify" }),
    laterTask("t_meal", "peace", n("摆一桌两家和解的饭", "Lay a table for the two families"), { verb: "speak", kind: "meal" }),
  ];
  return { tracked, tasks: list.map((task) => (states[String(task.id)] === undefined ? task : { ...task, state: states[String(task.id)] })) };
}

/** The task that keeps a promise of the manager to Li Da (the first of the promises made), as the core sends it on the day it falls due. */
export function keepTask(): Record<string, unknown> {
  return laterTask("t_keep_1", "bridge", n("兑现对李大的许诺", "Keep the promise to Li Da"), { verb: "promise", npc: "li_da", item: "k1", kind: "keep" }, { kind: "promise" });
}

/** The offers of `promise` in a talk with a person the manager made a promise to (`offers.py`): the new ones, and the one that keeps the open promise. */
export function promiseOffers(): Array<Record<string, unknown>> {
  return [GIVE as Record<string, unknown>, { id: "keep:k1", label: n("兑现许诺 k1", "Keep promise k1"), body: { op: "keep", id: "k1" } }];
}

/** The entry of the talk with `npc` that the town offers to ask them for each request it takes (`offers.py`): the labels are the core's. */
export function entrustOffers(npc: string): Array<Record<string, unknown>> {
  const offer = (id: string, zh: string, en: string, body: Record<string, unknown>): Record<string, unknown> => ({ id, label: n(zh, en), body });
  const out: Array<Record<string, unknown>> = [];
  if (npc === "li_da") out.push(offer("material", "请对方把竹料送到桥边", "Ask them to bring the bamboo to the bridge", { kind: "material" }));
  if (npc === "zhou_zhanggui") out.push(offer("material", "请对方把木料送到桥边", "Ask them to bring the timber to the bridge", { kind: "material" }));
  if (npc === "miaozhu") out.push(offer("lane", "请她打开庙后的夹道", "Ask her to open the lane behind the temple", { kind: "lane" }));
  if (npc === "li_laotai") out.push(offer("lend", "请她把竹料借给灯会", "Ask her to lend the bamboo for the bridge", { kind: "lend" }));
  if (npc === "gengfu") out.push(offer("testify", "请对方说说亲眼所见", "Ask them to tell what they saw", { kind: "testify" }));
  if (["zhou_dalang", "zhou_erlang", "li_xiaomei", "li_er"].includes(npc)) out.push(offer("join", "请对方加入帮工", "Ask them to join the helpers", { kind: "join" }));
  if (npc === "li_xiaomei") {
    out.push(offer("persuade:zhou_dalang", "请对方去劝周家大郎", "Ask them to talk Zhou Dalang round", { kind: "persuade", target: "zhou_dalang" }));
    out.push(offer("persuade:zhou_erlang", "请对方去劝周家二郎", "Ask them to talk Zhou Erlang round", { kind: "persuade", target: "zhou_erlang" }));
  }
  if (npc === "zuzhang") out.push(offer("convene", "请族长召集族里的人到祠堂", "Ask the elder to call the clan to the hall", { kind: "convene" }));
  return out;
}

/** What the town puts forward to speak in public where the manager may: all the evidence, one item of it, and a table for the two families (`offers.py`). */
export const SPEAK_OFFERS = [
  { id: "all", label: n("把手里的证据都拿出来", "Show everything you hold"), body: { kind: "evidence" } },
  { id: "item:e_scrape", label: n("出示：桥墩上新的刮痕", "Show: fresh scrapes on the bridge pier"), body: { kind: "evidence", evidence: ["e_scrape"] } },
  { id: "meal", label: n("摆一桌和解饭", "Lay a table for peace"), body: { kind: "meal" } },
];

/** The part of a frame where the manager may speak in public: the offers of `speak`, and the verb. */
export function speakingFrame(base: Record<string, unknown> | null): Record<string, unknown> {
  const player = (base ?? {}) as Record<string, unknown>;
  return { player: { ...player, offers: { entrust: [], promise: [], tell: [], speak: SPEAK_OFFERS } }, hud: { verbs: [...FREE_VERBS, "speak"] } };
}

// --- Driving the page ----------------------------------------------------------------------------

/**
 * Gives the page a frame as the host would: the frame on screen with `extras` merged in (the keys of `hud` and
 * `player` merged one level down), and these events. The player's side of the page reads it as it reads a frame
 * of the core.
 */
export function feedFrame(page: Page, extras: Record<string, unknown> = {}, events: unknown[] = [], clock: { paused: boolean; rate: [number, number] } = { paused: true, rate: [1, 1] }): Promise<void> {
  return page.evaluate(
    ([x, e, c]) => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const base = window.__lantern.client.state.frame as Record<string, unknown>;
      const more = x as Record<string, unknown>;
      const frame = { ...base, ...more, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick + 1, advanced: false, frame, events: e, clock: c });
    },
    [extras, events, clock] as const,
  );
}

/** The clock of a world that runs fast to pay for an act of a talk: the core's `[20, 1]`, not held. */
export const PAYING: { paused: boolean; rate: [number, number] } = { paused: false, rate: [20, 1] };

/** What the page sends is recorded here and not passed on, so that a test can answer it as it likes. */
export function recordSent(page: Page): Promise<void> {
  return page.evaluate(() => {
    const sent: Array<Record<string, unknown>> = [];
    (window as unknown as { __sent: typeof sent }).__sent = sent;
    window.__lantern.client.player = (body) => {
      const id = typeof body.action_id === "string" ? body.action_id : `t${sent.length}`;
      sent.push({ ...body, action_id: id });
      return id;
    };
  });
}

export const sentSoFar = (page: Page): Promise<Array<Record<string, unknown>>> => page.evaluate(() => (window as unknown as { __sent: Array<Record<string, unknown>> }).__sent);

/**
 * Stands in for a host that answers `preview` with this, or that cannot: `none` is a host with no previews (the answer is null),
 * `error` one that refuses the call, `silent` one that never answers.
 */
export function answerPreview(page: Page, answer: Record<string, unknown> | "none" | "error" | "silent"): Promise<void> {
  return page.evaluate((a) => {
    const client = window.__lantern.client;
    const original = client.call.bind(client);
    (window as unknown as { __previews: unknown[] }).__previews = [];
    client.call = ((call: { op: string; action?: unknown }) => {
      if (call.op !== "preview") return original(call as never);
      (window as unknown as { __previews: unknown[] }).__previews.push(call.action);
      if (a === "none") return Promise.resolve(null);
      if (a === "error") return Promise.reject(new Error("bad_action"));
      if (a === "silent") return new Promise(() => undefined);
      return Promise.resolve(a);
    }) as typeof client.call;
  }, answer);
}

export const previewsAsked = (page: Page): Promise<unknown[]> => page.evaluate(() => (window as unknown as { __previews: unknown[] }).__previews);

/** The preview the core would send for the request to Li Da. A request gives nothing: a promise is an act of its own. */
export const PREVIEW = {
  version: 42,
  cost: 20,
  asks: n("请李大把第一批竹料送到桥边", "Ask Li Da to bring the first bamboo to the bridge"),
  gives: null,
  blockers: [n("李老太还没撤回阻拦", "Granny Li has not dropped her objection")],
  odds: "mid",
  reasons: [
    { sign: 1, text: n("李大欠你人情", "Li Da owes you a favour") },
    { sign: -1, text: n("李大对你还不太熟", "Li Da hardly knows you yet") },
  ],
};

/** The preview of a promise: the words of the promise are what it asks and what it gives. */
export const PROMISE_PREVIEW = {
  version: 43,
  cost: 20,
  asks: n("许下：让李家点主灯", "Promise: the Li family lights the main lantern"),
  gives: n("许下：让李家点主灯", "Promise: the Li family lights the main lantern"),
  blockers: [],
  odds: null,
  reasons: [{ sign: 1, text: n("许下的事，李老太会更信你一些", "a promise made earns Granny Li's trust") }],
};

// --- Looking at the page ---------------------------------------------------------------------------------

/** The bridge town of seed 7, held at tick 300 (08:30 on the first day). */
export const TOWN = "scenario=bridge&seed=7&pace=60&until=300";

/**
 * Opens the town held on the morning of the first day, and gives the page the whole of the slice as the core
 * would send it: the tasks, the notebook, a promise, the board and what is known of the people.
 */
export async function openFirstDay(
  lantern: { page: Page; open(query?: string, options?: { menu?: boolean; map?: boolean }): Promise<void>; waitForTick(tick: number): Promise<void> },
  extras: Record<string, unknown> = {},
  query = TOWN,
): Promise<void> {
  await lantern.open(query, { menu: false });
  await lantern.waitForTick(300);
  await feedFrame(lantern.page, { board: null, statement: null, ...tasks(), notebook: notebook(), ...commitments(), ...cards(), weather: "clear", hud: { verbs: FREE_VERBS }, ...extras });
}

/** The player's part of the frame on screen. */
export const playerOf = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => window.__lantern.client.state.frame?.player as Record<string, unknown>);

/** Puts the player in a talk with `npc`, with the acts of a talk on offer. */
export async function startTalk(page: Page, npc: string, extras: Record<string, unknown> = {}, verbs: string[] = TALK_VERBS, entrust?: unknown[], promise?: unknown[]): Promise<void> {
  const base = await playerOf(page);
  const leaves = { hour: 15, minute: 30 };
  await feedFrame(page, { player: playerInTalk(base, npc, leaves, entrust, promise), ...extras, hud: { verbs } }, [{ kind: "talk_start", tick: 1, npc, leaves_at: leaves }]);
}

/** The contrast ratio of the text of an element against what is behind it, as the browser draws them (WCAG 2). */
export function contrast(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`no element ${sel}`);
    const numbers = (color: string): number[] => {
      const found = (color.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      return color.startsWith("color(") ? found.map((v, i) => (i < 3 ? v * 255 : v)) : found;
    };
    const channel = (v: number): number => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c: number[]): number => 0.2126 * channel(c[0] ?? 0) + 0.7152 * channel(c[1] ?? 0) + 0.0722 * channel(c[2] ?? 0);
    // What is behind the text: the background colours of the element and of what holds it, laid over each other.
    const layers: number[][] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const color = numbers(getComputedStyle(node).backgroundColor);
      const alpha = color.length > 3 ? (color[3] ?? 1) : 1;
      if (color.length >= 3 && alpha > 0) layers.push(color);
      if (color.length >= 3 && alpha >= 1) break;
    }
    let back = [255, 255, 255];
    for (const layer of layers.reverse()) {
      const alpha = layer.length > 3 ? (layer[3] ?? 1) : 1;
      back = back.map((v, i) => (layer[i] ?? 0) * alpha + v * (1 - alpha));
    }
    const ink = numbers(getComputedStyle(el).color);
    const inkAlpha = ink.length > 3 ? (ink[3] ?? 1) : 1;
    const text = [0, 1, 2].map((i) => (ink[i] ?? 0) * inkAlpha + (back[i] ?? 0) * (1 - inkAlpha));
    const a = luminance(text);
    const b = luminance(back);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
}

/** Whether the page has no sideways scroll. */
export const fitsWidth = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Whether an element's text is cut off: it is wider than the box it sits in. */
export const overflows = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    return el === null ? false : el.scrollWidth > el.clientWidth + 1;
  }, selector);

// --- The help: tutorial, hints, the elder -----------------------------------------------------------------------------

/** The first day as a page with the help on and the world held at tick 300 (08:30), where the frames of a test stay as fed. */
export const GUIDED = "scenario=bridge&seed=7&pace=60&until=300&guide=on";

/** The tasks of the first day, with the state of some of them said. */
export function tasksWhere(states: Record<string, string>, tracked: string | null = "t_bamboo_first"): Record<string, unknown> {
  const base = tasks(tracked).tasks as Array<Record<string, unknown>>;
  return { tracked, tasks: base.map((task) => (states[String(task.id)] === undefined ? task : { ...task, state: states[String(task.id)] })) };
}

/**
 * Begins the tutorial the way the page does when Start is pressed, except that the world is not asked to wait: a page whose
 * world is held already (`until=`) stays as the test fed it, which a world that is let go would not.
 */
export const beginTutorial = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__lantern.play.guide.tutorial.begin();
    window.__lantern.play.touch();
  });

/**
 * Lets the help take the frame on screen as what was true from the start, so that only what is fed after it is news (the page does
 * the same with the first frame it sees). A page of the test build has been fed the first day by hand, which is news to it.
 */
export async function primeHelp(page: Page): Promise<void> {
  await page.evaluate(() => window.__lantern.play.guide.reset());
  await feedFrame(page, {});
}

/** Feeds a frame at a tick of the test's own, for what counts the ticks of the game. */
export function feedAt(page: Page, tick: number, extras: Record<string, unknown> = {}, events: unknown[] = []): Promise<void> {
  return page.evaluate(
    ([at, x, e]) => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const base = window.__lantern.client.state.frame as Record<string, unknown>;
      const more = x as Record<string, unknown>;
      const frame = { ...base, ...more, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "frame", tick: at as number, advanced: false, frame, events: e, clock: { paused: true, rate: [1, 1] } });
    },
    [tick, extras, events] as const,
  );
}

// --- The paper of the morning and the summary of the night ---------------------------------------------------

/** The window of the task of the bamboo's second batch on the second day, at the bridge. */
const PAPER_WINDOW = { day: 2, from: 6, to: 9, place: "p_bridge" };

/**
 * The paper of the second morning as the core sends it in the frame of the call that made it: the delivery as the headline, the other two
 * lines of the recap as short items, the task that is followed with its time and place, one other chance today, and two lines of street talk.
 */
export function gazetteBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: 2,
    head: { kind: "delivery", text: n("李大答应的四根竹料，已经送到石桥。", "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.") },
    news: [
      { kind: "stance", text: n("李老太撤回了阻拦。", "Granny Li no longer stands in the way.") },
      { kind: "promise", text: n("李大答应送来四根竹料。", "Li Da promised to bring 4 poles of bamboo.") },
    ],
    today: {
      id: "t_bamboo_rest",
      text: n("凑齐竹料", "The rest of the bamboo"),
      state: "open",
      window: PAPER_WINDOW,
      next: n("按约好的时间去桥边，看竹料送到没有。", "Be at the bridge at the agreed time and see the bamboo arrive."),
    },
    more: [
      {
        id: "t_tell_town",
        text: n("当众把桥的事说清楚", "Tell the town how the bridge broke"),
        state: "open",
        window: { day: 2, from: 17, to: 19, place: "p_teahouse" },
        next: null,
      },
    ],
    talk: [
      { kind: "festival_warm", text: n("街上都在说灯会，哪家挂几盏灯，已经有人在数了。", "The street talks of little else than the festival, and people are already counting the lanterns at each door.") },
      { kind: "split", text: n("街上分成了两拨，一拨向着李家，一拨向着周家，谁也说不服谁。", "The street has split into two camps, one for the Li family and one for the Zhou family, and neither can win the other over.") },
    ],
    ...over,
  };
}

/** The `gazette` of the frame of the call that made it (and the recap with it, as the core still sends both). */
export function gazette(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { gazette: gazetteBody(over), recap: recapLines() };
}

/** The summary of the first night as the core sends it in the frame of the call that made it. */
export function nightBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    day: 1,
    changed: { kind: "promise", text: n("李大答应送来四根竹料。", "Li Da promised to bring 4 poles of bamboo.") },
    blocked: { id: "t_timber", text: n("取得周家的木料", "Get the timber from the Zhou family"), blocker: n("周掌柜还没松口", "Shopkeeper Zhou has not agreed yet") },
    step: { id: "t_bamboo_first", text: n("取得李家的第一批竹料", "Get the first bamboo from the Li family"), window: { day: 2, from: 6, to: 7, place: "p_bridge" } },
    ...over,
  };
}

/** The `night` of the frame of the call that made it. */
export function night(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { night: nightBody(over) };
}
