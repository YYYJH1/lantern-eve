import { expect, test } from "@playwright/test";
import { readFrame, runsPastLeaving } from "../../src/page/frame.ts";
import {
  buttonTasks,
  commitmentsOf,
  daysLeft,
  readBoard,
  changed,
  readClarified,
  readCommitments,
  readHint,
  readJudgments,
  readCards,
  readRecap,
  readSite,
  readSlice,
  readTasks,
  tasksAbout,
  stanceOf,
  trackedTask,
  windowOf,
} from "../../src/page/slice.ts";
import type { Frame } from "../../src/shared/protocol.ts";
import * as fake from "../support/slice.ts";

const frameOf = (extras: Record<string, unknown>): Record<string, unknown> => ({ npcs: [], time: { day: 1, hour: 8, minute: 0, phase: "day" }, weather: "clear", hud: {}, ...extras });

test.describe("the tasks of the frame", () => {
  test("are read with their text, reason, next step, state, action and window, and the tracked one is found", () => {
    const tasks = readTasks(frameOf(fake.tasks("t_source")));
    expect(tasks?.list.map((t) => t.id)).toEqual(["t_bamboo_first", "t_source", "t_evening", "t_promise"]);
    const first = tasks?.list[0];
    expect(first).toMatchObject({ kind: "obstacle", job: "bridge", state: "blocked", action: { verb: "talk", npc: "li_laotai", place: null, item: null }, window: { day: 1, from: 8, to: 17, place: "p_li_house" } });
    expect(first?.why?.en).toContain("manager did nothing");
    expect(first?.next).toEqual({ zh: "问清这话的来源", en: "Find out where that talk came from" });
    expect(trackedTask(tasks)?.id).toBe("t_source");
    expect(tasks?.list[3]?.window).toBeNull();
  });

  test("name the request, the kind of speech and the person to talk round, where the action has them", () => {
    const action = (over: Record<string, unknown>): Record<string, unknown> => ({ id: "t", text: { zh: "甲", en: "A" }, action: { verb: "entrust", npc: "li_da", ...over } });
    const read = (over: Record<string, unknown>) => readTasks(frameOf({ tasks: [action(over)] }))?.list[0]?.action;
    expect(read({})).toEqual({ verb: "entrust", npc: "li_da", place: null, item: null, request: null, kind: null, target: null });
    expect(read({ item: "bamboo", request: "material" })).toMatchObject({ item: "bamboo", request: "material", kind: null, target: null });
    expect(read({ request: "persuade", target: "zhou_erlang" })).toMatchObject({ request: "persuade", target: "zhou_erlang" });
    expect(readTasks(frameOf({ tasks: [{ id: "t", text: { zh: "甲", en: "A" }, action: { verb: "speak", kind: "meal" } }] }))?.list[0]?.action).toMatchObject({ verb: "speak", kind: "meal", request: null });
    // A kind the page does not know is kept as it came, and what is not words is none.
    expect(read({ request: "swap", kind: 7, target: "" })).toMatchObject({ request: "swap", kind: null, target: null });
    // The whole set the fake days carry reads, each with what it asks.
    const later = readTasks(frameOf(fake.laterTasks()));
    expect(later?.list.map((task) => task.action?.request ?? task.action?.kind)).toEqual(["material", "material", "lend", "join", "persuade", "lane", "testify", "convene", "evidence", "clarify", "meal"]);
  });

  test("are null where the frame has no list, and a bad entry is left out without taking the others with it", () => {
    expect(readTasks(frameOf({}))).toBeNull();
    expect(trackedTask(null)).toBeNull();
    const tasks = readTasks(frameOf({ tracked: "gone", tasks: [{ id: "a" }, { id: "b", text: { zh: "乙", en: "B" }, state: "weird", job: "nonsense", action: { verb: "" }, window: { day: "x" } }, "no", { text: { zh: "丙", en: "C" } }] }));
    expect(tasks?.list.map((t) => t.id)).toEqual(["b"]);
    expect(tasks?.list[0]).toMatchObject({ state: "open", job: null, action: null, window: null, why: null, blocker: null });
    // A tracked id that the list does not have is kept, and finds no task.
    expect(tasks?.tracked).toBe("gone");
    expect(trackedTask(tasks)).toBeNull();
  });

  test("tell which of them are about a person, and when to find that person", () => {
    const slice = readSlice(frameOf(fake.tasks()));
    expect(tasksAbout(slice, "li_laotai").map((t) => t.id)).toEqual(["t_bamboo_first"]);
    expect(windowOf(slice, "li_laotai")).toEqual({ day: 1, from: 8, to: 17, place: "p_li_house" });
    expect(windowOf(slice, "li_da")).toBeNull();
    expect(windowOf(slice, "nobody")).toBeNull();
  });

  test("give a person's card one button for each thing to do, even when two tasks ask for the same of the same person", () => {
    // After Granny Li says no, the first bamboo and the talk that blames Li Er both end in asking her.
    const ask = { verb: "ask", npc: "li_laotai" };
    const task = (id: string, action: Record<string, unknown>): Record<string, unknown> => ({ id, text: { zh: id, en: id }, state: "open", action });
    const slice = readSlice(
      frameOf({
        tasks: [
          task("t_bamboo_first", ask),
          task("t_who_said", ask),
          task("t_source", { verb: "ask_source", npc: "li_laotai" }),
          task("t_look", { verb: "look", npc: "li_laotai", item: "t_rail" }),
          task("t_look_again", { verb: "look", npc: "li_laotai", item: "t_rail" }),
          task("t_other_person", { verb: "ask", npc: "li_da" }),
        ],
      }),
    );
    expect(tasksAbout(slice, "li_laotai").map((t) => t.id)).toEqual(["t_bamboo_first", "t_who_said", "t_source", "t_look", "t_look_again"]);
    // The first task of each action keeps its button, and a different verb, thing or person is a button of its own.
    expect(buttonTasks(tasksAbout(slice, "li_laotai")).map((t) => t.id)).toEqual(["t_bamboo_first", "t_source", "t_look"]);
    expect(buttonTasks(tasksAbout(slice, "li_da")).map((t) => t.id)).toEqual(["t_other_person"]);
    expect(buttonTasks([])).toEqual([]);
  });

  test("give a person's card a button for each request that is asked of them, and for each way of speaking in public", () => {
    const entrust = (id: string, request: string | null, over: Record<string, unknown> = {}): Record<string, unknown> => ({ id, text: { zh: id, en: id }, state: "open", action: { verb: "entrust", npc: "li_da", item: "bamboo", request, ...over } });
    const slice = readSlice(
      frameOf({
        tasks: [
          entrust("t_a", "material"),
          entrust("t_b", "material"),
          entrust("t_c", "join"),
          entrust("t_d", "persuade", { target: "zhou_erlang" }),
          entrust("t_e", "persuade", { target: "zhou_dalang" }),
          { id: "t_f", text: { zh: "f", en: "f" }, state: "open", action: { verb: "speak", kind: "evidence" } },
          { id: "t_g", text: { zh: "g", en: "g" }, state: "open", action: { verb: "speak", kind: "meal" } },
          { id: "t_h", text: { zh: "h", en: "h" }, state: "open", action: { verb: "speak", kind: "meal" } },
        ],
      }),
    );
    expect(buttonTasks(slice.tasks?.list ?? []).map((t) => t.id)).toEqual(["t_a", "t_c", "t_d", "t_e", "t_f", "t_g"]);
  });
});

test.describe("what the notebook adds", () => {
  test("is the judgments, and a hint with or without the relation", () => {
    expect(readJudgments(frameOf({ judgments: [fake.JUDGMENT, { a: "x", b: "y", relation: "bogus" }, { a: "x" }] }))).toEqual([fake.JUDGMENT]);
    expect(readJudgments(frameOf({}))).toBeNull();
    expect(readHint(frameOf({ hint: { a: "n_clerk", b: "n_broke" } }))).toEqual({ a: "n_clerk", b: "n_broke", relation: null });
    expect(readHint(frameOf({ hint: { a: "n_clerk", b: "n_broke", relation: "unsupported" } }))?.relation).toBe("unsupported");
    expect(readHint(frameOf({ hint: null }))).toBeNull();
    expect(readHint(frameOf({ hint: { a: "n_clerk" } }))).toBeNull();
  });
});

test.describe("the commitments and the pile at the bridge", () => {
  test("keep promised and delivered as two states, and read the site as numbers", () => {
    const promised = readCommitments(frameOf(fake.commitments("promised")));
    const delivered = readCommitments(frameOf(fake.commitments("delivered")));
    expect(promised?.[0]).toMatchObject({ id: "c_li_da_bamboo", by: "li_da", item: "bamboo", amount: 4, due: { day: 2, hour: 7 }, state: "promised", reason: null });
    expect(promised?.[0]?.what).toEqual({ zh: "把四根竹料送到石桥", en: "Bring 4 poles of bamboo to the Stone Bridge" });
    expect(delivered?.[0]?.state).toBe("delivered");
    expect(readSite(frameOf(fake.commitments("delivered")))).toEqual({ bamboo: 4, timber: 0 });
    expect(readSite(frameOf(fake.commitments("promised")))).toEqual({ bamboo: 0, timber: 0 });
    expect(readCommitments(frameOf({}))).toBeNull();
    expect(readSite(frameOf({}))).toBeNull();
    // A state the page does not know reads as promised, never as delivered.
    expect(readCommitments(frameOf({ commitments: [{ id: "c", by: "x", what: { zh: "甲", en: "A" }, state: "teleported" }] }))?.[0]?.state).toBe("promised");
    const slice = readSlice(frameOf(fake.commitments()));
    expect(commitmentsOf(slice, "li_da")).toHaveLength(1);
    expect(commitmentsOf(slice, "li_er")).toHaveLength(0);
  });

  test("read the reason the core gives for a promise that was not kept or was taken back, and none for any other", () => {
    expect(readCommitments(frameOf(fake.commitmentEnded("broken", "rain")))?.[0]).toMatchObject({ state: "broken", reason: { en: "The heavy rain kept the goods off the road", zh: "下大雨，货运不出来" } });
    expect(readCommitments(frameOf(fake.commitmentEnded("withdrawn", "taken_back")))?.[0]).toMatchObject({ state: "withdrawn", reason: { en: "They took the promise back" } });
    // A broken promise whose reason the frame leaves out, or that is empty, has none. The promise is still broken.
    expect(readCommitments(frameOf(fake.commitmentEnded("broken", null)))?.[0]).toMatchObject({ state: "broken", reason: null });
    expect(readCommitments(frameOf({ commitments: [{ id: "m1", by: "li_da", state: "broken", reason: { zh: "", en: "" } }] }))?.[0]?.reason).toBeNull();
    expect(readCommitments(frameOf({ commitments: [{ id: "m1", by: "li_da", state: "broken", reason: "late" }] }))?.[0]?.reason).toBeNull();
    expect(readCommitments(frameOf(fake.commitments("promised")))?.[0]?.reason).toBeNull();
  });
});

test.describe("the recap", () => {
  test("has at most three lines, each with the events it is about", () => {
    const lines = readRecap(frameOf(fake.recap()));
    expect(lines).toHaveLength(3);
    expect(lines?.[0]?.events).toEqual([16, 26]);
    const four = readRecap(frameOf({ recap: [1, 2, 3, 4].map((i) => ({ text: { zh: `句${i}`, en: `Line ${i}` }, events: [i] })) }));
    expect(four?.map((l) => l.text.en)).toEqual(["Line 1", "Line 2", "Line 3"]);
    expect(readRecap(frameOf({ recap: null }))).toBeNull();
    expect(readRecap(frameOf({ recap: [] }))).toBeNull();
    expect(readRecap(frameOf({ recap: [{ events: [1] }] }))).toBeNull();
  });
});

test.describe("the board of the days after the first", () => {
  test("is read whole: the helpers by family, the hours, the next work time, why work stopped, the deadline, the truth with its last statement and the peace", () => {
    const board = readBoard(frameOf(fake.moment("day4")));
    expect(board?.helpers).toEqual([{ family: "fam_li", count: 3 }, { family: "fam_zhou", count: 2 }]);
    expect(board).toMatchObject({ need: 5, both: true, hours: { done: 4, need: 10 }, window: { day: 4, from: 13, to: 17, place: "p_bridge" }, deadline: { day: 4, hour: 18 }, statement: null, needs: null });
    expect(board?.stop).toEqual(fake.RAIN_STOP);
    expect(board?.truth).toEqual({
      state: "open",
      last: { day: 3, hour: 18, venue: "p_teahouse", named: 4, accepted: 2, percent: 50, elder: "absent", why: fake.SHORT_WHY },
    });
    expect(board?.peace).toEqual({ state: "open", grudge: 55, acts: [
      { id: "stop_blaming", text: fake.PEACE_ACTS[0]?.text, done: true },
      { id: "work_together", text: fake.PEACE_ACTS[1]?.text, done: true },
      { id: "witnessed_meal", text: fake.PEACE_ACTS[2]?.text, done: false },
    ], witnessed: false });
  });

  test("is done when the truth is cleared and the peace made, and the last statement has no missed condition then", () => {
    const board = readBoard(frameOf(fake.moment("day5")));
    expect(board?.truth).toMatchObject({ state: "done", last: { named: 7, accepted: 6, percent: 86, elder: "accepted", why: null } });
    expect(board?.peace).toMatchObject({ state: "done", grudge: 18, witnessed: true });
    expect(board?.peace?.acts.every((act) => act.done)).toBe(true);
    expect(board?.window).toBeNull();
    expect(board?.hours).toEqual({ done: 10, need: 10 });
  });

  test("is null where the frame has no board, and a board of nothing has nothing in it", () => {
    expect(readBoard(frameOf({}))).toBeNull();
    expect(readBoard(frameOf({ board: null }))).toBeNull();
    expect(readBoard(frameOf({ board: "no" }))).toBeNull();
    expect(readBoard(frameOf({ board: {} }))).toEqual({ helpers: null, need: null, both: null, hours: null, window: null, stop: null, deadline: null, needs: null, statement: null, truth: null, peace: null });
  });

  test("keeps what is there when a field is missing or wrong, and drops what it cannot read", () => {
    // A frame of a shorter shape: the helpers, the window and the peace, without the rest of the board.
    const old = readBoard(frameOf({ board: { helpers: [{ family: "fam_li", count: 1 }], need: 5, window: { day: 3, from: 6, to: 11, place: "p_bridge" }, peace: { grudge: 62, acts: [{ id: "a", text: { zh: "甲", en: "A" }, done: false }] } } }));
    expect(old).toMatchObject({ helpers: [{ family: "fam_li", count: 1 }], need: 5, both: null, hours: null, stop: null, deadline: null, truth: null, window: { day: 3 } });
    expect(old?.peace).toEqual({ state: null, grudge: 62, acts: [{ id: "a", text: { zh: "甲", en: "A" }, done: false }], witnessed: null });
    // A grudge past the ends is held to them, and what is not a number is none.
    expect(readBoard(frameOf({ board: { peace: { grudge: 250, acts: [] } } }))?.peace?.grudge).toBe(100);
    expect(readBoard(frameOf({ board: { peace: { grudge: -4, acts: [] } } }))?.peace?.grudge).toBe(0);
    expect(readBoard(frameOf({ board: { peace: { grudge: "high", acts: "none" } } }))?.peace).toEqual({ state: null, grudge: null, acts: [], witnessed: null });
    // A state that is neither open nor done is no state; a truth with none is no truth.
    expect(readBoard(frameOf({ board: { truth: { state: "maybe", last: null }, peace: { state: "fine" } } }))).toMatchObject({ truth: null, peace: { state: null } });
    // Hours and a deadline need both numbers, a stop needs words, and a statement that has no day and hour says nothing of when.
    expect(readBoard(frameOf({ board: { hours: { done: 3 }, deadline: { day: 4 }, stop: "rain" } }))).toMatchObject({ hours: null, deadline: null, stop: null });
    expect(readBoard(frameOf({ board: { stop: { zh: "", en: "" } } }))?.stop).toBeNull();
    expect(readBoard(frameOf({ board: { truth: { state: "open", last: { named: 4 } } } }))?.truth).toEqual({ state: "open", last: null });
    // A count that is not a whole number is none, and one below nothing is nothing.
    expect(readBoard(frameOf({ board: { helpers: [{ family: "fam_li", count: -2 }, { family: 7, count: "x" }, "no"], hours: { done: -1, need: 10 } } }))).toMatchObject({ helpers: [{ family: "fam_li", count: 0 }, { family: null, count: 0 }], hours: { done: 0, need: 10 } });
  });

  test("keeps the three columns of the statement where a later core sends them, and the elder as the core words it", () => {
    const columns = [
      { part: "cause", support: 1, against: 0, gap: true },
      { part: "course", support: 0, against: 0, gap: true },
      { part: "rumour", support: 1, against: 0, gap: false },
      { part: "nonsense", support: 1, against: 1, gap: false },
    ];
    expect(readBoard(frameOf({ board: { statement: columns } }))?.statement?.map((c) => [c.part, c.support, c.gap])).toEqual([["cause", 1, true], ["course", 0, true], ["rumour", 1, false]]);
    const stands = ["absent", "refused", "accepted", "late"].map((elder) => readBoard(frameOf({ board: { truth: { state: "open", last: { day: 2, hour: 18, elder } } } }))?.truth?.last?.elder);
    expect(stands).toEqual(["absent", "refused", "accepted", null]);
  });

  test("reads how much of each item the bridge takes where a core says it, and leaves the board without where none does", () => {
    expect(readBoard(frameOf({ board: { needs: { bamboo: 10, timber: 8, nails: 0, rope: "x" } } }))?.needs).toEqual({ bamboo: 10, timber: 8 });
    expect(readBoard(frameOf({ board: { needs: {} } }))?.needs).toBeNull();
    expect(readBoard(frameOf(fake.moment("day2")))?.needs).toBeNull();
  });
});

test.describe("what the page reads besides the keys of the first day", () => {
  test("is the card of each person the player met or heard of, as the core sends it", () => {
    const cards = readCards(frameOf(fake.cards()));
    expect(cards?.get("li_laotai")).toMatchObject({
      met: true,
      favours: 0,
      family: "fam_li",
      wants: [{ id: "w_li_laotai_public", text: { en: "Someone to set the talk that Li Er wrecked the bridge straight in public" } }],
      stance: { at: { day: 1, hour: 8, minute: 0 }, kind: "told", entry: "n_broke", how: { en: "They told you themselves" } },
    });
    expect(cards?.get("li_laotai")?.find).toEqual([
      { from: 360, place: "p_li_house", act: "rest", now: true, tomorrow: false },
      { from: 720, place: "p_teahouse", act: "tea", now: false, tomorrow: false },
      { from: 360, place: "p_li_house", act: "rest", now: false, tomorrow: true },
    ]);
    // A person who was not met has no routine on the card, and what they agreed is the ids of the commitments.
    expect(cards?.get("li_da")).toMatchObject({ met: false, find: null, wants: [], favours: 1, stance: null, agreed: ["c_li_da_bamboo"] });
    expect(cards?.get("nobody")).toBeUndefined();
    expect(readCards(frameOf({}))).toBeNull();
    // A card with no id is left out, and keys of an old shape (a bare list of strings, a stance with no words) are not taken for more.
    expect(readCards(frameOf({ cards: [{ met: true }, { id: "x", stance: { tick: 3 }, wants: [{ id: "w" }], agreed: [1, "c"] }] }))?.get("x")).toMatchObject({ stance: null, wants: [], agreed: ["c"], find: null });
  });

  test("has the other account a person said with their stance, only if they said one and the words and the one who told them are there", () => {
    const withRival = (rival: unknown): Record<string, unknown> => {
      const [first, ...rest] = (fake.cards().cards as Array<Record<string, unknown>>);
      return { cards: [{ ...first, stance: { ...(first?.stance as Record<string, unknown>), ...(rival === undefined ? {} : { rival }) } }, ...rest] };
    };
    const stanceOfLiLaotai = (extras: Record<string, unknown>) => readCards(frameOf(extras))?.get("li_laotai")?.stance;
    // The plain frame has none: the key is only there when they said it.
    expect(stanceOfLiLaotai(fake.cards())?.rival).toBeNull();
    const got = stanceOfLiLaotai(withRival(fake.RIVAL));
    expect(got?.rival).toEqual({ text: fake.RIVAL.text, who: { zh: "周掌柜", en: "Shopkeeper Zhou" } });
    expect(got?.text.en).toBe("Li Er broke the rail.");
    // A rival with no words, or with no one who told it, or of another shape, is not one.
    for (const bad of [null, "x", 3, [], {}, { text: fake.RIVAL.text }, { who: fake.RIVAL.who }, { text: {}, who: fake.RIVAL.who }, { text: fake.RIVAL.text, who: { zh: "", en: "" } }]) {
      expect(stanceOfLiLaotai(withRival(bad))?.rival, JSON.stringify(bad)).toBeNull();
    }
  });

  test("is the people a task of an occasion expects, as minutes of the day", () => {
    const tasks = readSlice(frameOf(fake.tasks())).tasks;
    expect(tasks?.list.find((t) => t.id === "t_evening")?.expected).toEqual([
      { id: "cha_laoban", from: 1020, to: 1140 },
      { id: "zhou_huoji", from: 1116, to: 1140 },
      { id: "li_laotai", from: 1050, to: 1140 },
    ]);
    expect(tasks?.list.find((t) => t.id === "t_source")?.expected).toBeNull();
    // A row with no id or with times that are not numbers is left out, and an empty list is no list.
    const odd = readSlice(frameOf({ tasks: [{ id: "a", text: { zh: "甲", en: "A" }, expected: [{ from: 1, to: 2 }, { id: "x", from: "1", to: 2 }] }] })).tasks;
    expect(odd?.list[0]?.expected).toBeNull();
  });
});

test.describe("the clarification", () => {
  test("is read as its place, its claim and what it rests on, and its audience one by one with the stands before and after and the reason", () => {
    const event = fake.clarified();
    const seen = readClarified(event, "k");
    expect(seen).toMatchObject({ venue: "p_teahouse", claim: "n_broke", basis: ["n_clerk"], accepted: 3 });
    expect(seen?.audience.map((h) => h.npc)).toEqual(["zhou_huoji", "li_laotai", "cha_laoban", "zhou_zhanggui"]);
    expect(seen?.audience.map((h) => [h.before, h.after])).toEqual([
      ["against", "for"],
      ["unsure", "for"],
      ["unsure", "for"],
      ["against", "against"],
    ]);
    expect(seen?.audience[1]?.reason?.zh).toContain("撤回阻拦");
    expect(readClarified({ kind: "clarified" }, "k")).toBeNull();
    expect(readClarified({ kind: "clarified", audience: [{ npc: "x" }, { nope: 1 }] }, "k")?.audience).toHaveLength(1);
    // A place or a count that is not there is null, and a basis that is not a list is empty.
    expect(readClarified({ kind: "clarified", audience: [], basis: "n_clerk", accepted: "3", venue: "" }, "k")).toMatchObject({ venue: null, basis: [], accepted: null, claim: null });
  });

  test("has three stands, which are the three words of the core and nothing else, and a stand it does not know is read as none", () => {
    expect((["against", "unsure", "for"] as const).map(stanceOf)).toEqual(["against", "unsure", "for"]);
    // No guessing at free words or numbers: the core words the stand, and a word that is not one of the three is none.
    for (const word of ["blames", "accepts", "with", "", -80, 90, null, undefined, "FOR"]) expect(stanceOf(word)).toBeNull();
    const odd = readClarified({ kind: "clarified", audience: [{ npc: "x", before: "blames", after: 50 }] }, "k");
    expect(odd?.audience[0]).toMatchObject({ before: null, after: null });
  });

  test("has a hearer who changed their stand only if both stands are known and differ", () => {
    const mine = (before: string | null, after: string | null) => ({ npc: "x", before: stanceOf(before), after: stanceOf(after), reason: null });
    expect([mine("against", "for"), mine("unsure", "unsure"), mine("for", "for"), mine("against", null), mine(null, "for")].map(changed)).toEqual([true, false, false, false, false]);
  });
});

test.describe("days left", () => {
  test("count down to the last day, which is the festival night, and stop there", () => {
    expect([1, 2, 4, 5, 6].map((day) => daysLeft(day, 5))).toEqual([4, 3, 1, 0, 0]);
  });
});

test.describe("what each act costs in the player's part of a frame", () => {
  test("is the minutes of all six acts, speaking in public included, whether or not there is a talk", () => {
    const view = readFrame({ npcs: [], player: { x: 1, y: 2, activity: "rest", talk: null, costs: fake.ALL_COSTS } } as unknown as Frame);
    expect(view.player?.costs).toEqual({ ask: 10, askSource: 10, tell: 15, entrust: 20, promise: 20, speak: 30 });
    expect(view.player?.talk).toBeNull();
    // A frame from a core that does not send the key has none, and a cost that is not minutes is none.
    expect(readFrame({ npcs: [], player: { x: 1, y: 2, activity: "rest", talk: null } } as unknown as Frame).player?.costs).toBeNull();
    expect(readFrame({ npcs: [], player: { x: 1, y: 2, activity: "rest", talk: null, costs: { speak: "half an hour", ask: -1, tell: 15.5 } } } as unknown as Frame).player?.costs).toEqual({ ask: null, askSource: null, tell: 15, entrust: null, promise: null, speak: null });
  });
});

test.describe("when a person has to go", () => {
  const goes = { hour: 15, minute: 30 };
  test("is reached by an act that takes the clock to that minute or past it, and not by one that stops short", () => {
    expect(runsPastLeaving({ hour: 15, minute: 0 }, goes, 20)).toBe(false);
    expect(runsPastLeaving({ hour: 15, minute: 0 }, goes, 29)).toBe(false);
    expect(runsPastLeaving({ hour: 15, minute: 0 }, goes, 30)).toBe(true);
    expect(runsPastLeaving({ hour: 15, minute: 15 }, goes, 20)).toBe(true);
    expect(runsPastLeaving({ hour: 8, minute: 0 }, goes, 30)).toBe(false);
  });

  test("says nothing where the frame does not say the hour or the minutes, and counts across midnight", () => {
    expect(runsPastLeaving({ hour: 15, minute: 0 }, null, 20)).toBe(false);
    expect(runsPastLeaving({ hour: 15, minute: 0 }, goes, null)).toBe(false);
    // 23:50 and the person goes at 06:00: the hour is the next morning's.
    expect(runsPastLeaving({ hour: 23, minute: 50 }, { hour: 6, minute: 0 }, 20)).toBe(false);
    expect(runsPastLeaving({ hour: 5, minute: 50 }, { hour: 6, minute: 0 }, 20)).toBe(true);
  });
});

test.describe("the extras of the talk in the player's part of a frame", () => {
  test("are the minutes of each act and the hour the person leaves, and null where the frame has none", () => {
    const view = readFrame({ npcs: [], player: { x: 1, y: 2, activity: "chat", talk: { npc: "li_laotai", costs: fake.COSTS, leaves_at: { hour: 15, minute: 30 } } } } as unknown as Frame);
    expect(view.player?.talk).toEqual({ npc: "li_laotai", costs: { ask: 10, askSource: 10, tell: 15, entrust: 20, promise: 20 }, leavesAt: { hour: 15, minute: 30 } });
    const bare = readFrame({ npcs: [], player: { x: 1, y: 2, activity: "chat", talk: { npc: "li_laotai" } } } as unknown as Frame);
    expect(bare.player?.talk).toEqual({ npc: "li_laotai", costs: null, leavesAt: null });
    const odd = readFrame({ npcs: [], player: { x: 1, y: 2, activity: "chat", talk: { npc: "a", costs: { ask: -5, tell: "ten", entrust: 7.9 }, leaves_at: { hour: "late" } } } } as unknown as Frame);
    expect(odd.player?.talk?.costs).toEqual({ ask: null, askSource: null, tell: null, entrust: 7, promise: null });
    expect(odd.player?.talk?.leavesAt).toBeNull();
  });
});
