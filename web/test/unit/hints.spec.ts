import { expect, test } from "@playwright/test";
import { ELDER_LEVELS, elderAnswer, type HintContext, HINTS, Hints, SIGNAL_MS, Stall, STALL_TICKS, ticksCount, waitingOnPromise } from "../../src/page/hints.ts";
import type { NotebookEntry } from "../../src/page/notebook.ts";
import type { Commitment, Task } from "../../src/page/slice.ts";
import { WorldHold } from "../../src/page/hold.ts";

const name = (en: string) => ({ zh: en, en });
const task = (id: string, state: Task["state"] = "open", over: Partial<Task> = {}): Task => ({ id, kind: "need", job: null, text: name(id), why: null, next: name(`next of ${id}`), state, blocker: null, action: null, window: null, expected: null, ...over });
const entry = (id: string, hand: number | "seen", marks: NotebookEntry["marks"] = []): NotebookEntry => ({ id, text: name(`line ${id}`), source: hand === "seen" ? { kind: "seen" } : { kind: "heard", who: name("x"), hand }, marks, chain: [] });

const idle = (over: Partial<HintContext> = {}): HintContext => ({ tasks: new Map(), tracked: null, entries: [], verbs: new Set(), talking: null, leaves: false, promised: 0, leads: 0, ...over });
const AT = { day: 1, hour: 8, minute: 30 };

test.describe("the hints of the world", () => {
  test("have a rule and a place for each, and each is given once, in order, one lit at a time", () => {
    const ids = HINTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hints = new Hints();
    expect(hints.check(idle(), 0, AT, 0)).toEqual([]);
    expect(hints.lit).toBeNull();
    // A line in the notebook and a second: two hints, the first lit and the second waiting.
    const two = idle({ entries: [entry("n1", 1), entry("n2", 2)] });
    const gave = hints.check(two, 10, AT, 1000);
    expect(gave.map((g) => g.id)).toEqual(["notebook", "compare"]);
    expect(hints.log.map((g) => g.id)).toEqual(["notebook", "compare"]);
    expect(hints.lit).toMatchObject({ id: "notebook", target: "btn-notebook" });
    // Nothing is given twice.
    expect(hints.check(two, 20, AT, 2000)).toEqual([]);
    // The time of the first runs out and the next is lit.
    hints.advance(1000 + SIGNAL_MS - 1);
    expect(hints.lit?.id).toBe("notebook");
    hints.advance(1000 + SIGNAL_MS);
    expect(hints.lit?.id).toBe("compare");
    // Pressing what is lit settles it, and a press elsewhere does not.
    hints.settle("verb-speak");
    expect(hints.lit?.id).toBe("compare");
    hints.settle("btn-notebook");
    expect(hints.lit).toBeNull();
  });

  test("keep a log the player can light again, and forget it with the game", () => {
    const hints = new Hints();
    hints.check(idle({ entries: [entry("n1", 1)] }), 5, AT, 0);
    hints.settle();
    expect(hints.lit).toBeNull();
    expect(hints.log[0]).toMatchObject({ id: "notebook", tick: 5, at: AT, text: "hint.notebook" });
    hints.again("notebook", 500);
    expect(hints.lit).toEqual({ id: "notebook", target: "btn-notebook", until: 500 + SIGNAL_MS });
    hints.again("nothing", 600);
    expect(hints.lit?.id).toBe("notebook");
    hints.reset();
    expect(hints.log).toEqual([]);
    expect(hints.lit).toBeNull();
    expect(hints.check(idle({ entries: [entry("n1", 1)] }), 6, AT, 0)).toHaveLength(1);
  });

  test("do not give a hint for what was true when they began to look", () => {
    const hints = new Hints();
    const ctx = idle({ entries: [entry("n1", 1)], tracked: task("t", "blocked") });
    hints.absorb(ctx);
    expect(hints.check(ctx, 1, AT, 0)).toEqual([]);
    expect(hints.log).toEqual([]);
    // What comes later is news.
    expect(hints.check({ ...ctx, entries: [entry("n1", 1), entry("n2", 1)] }, 2, AT, 0).map((g) => g.id)).toEqual(["compare"]);
  });

  test("point at what is new: a tag for a talk, the badge for the hour, the task that is blocked, the teahouse in the evening", () => {
    const hints = new Hints();
    const talk = idle({ talking: "li_laotai", verbs: new Set(["ask"]), leaves: true });
    expect(hints.check(talk, 1, AT, 0).map((g) => [g.id, g.target])).toEqual([["chips", "topic-chips"], ["leaves", "talk-badge"]]);
    const evening = task("t_tea_tonight", "open", { window: { day: 1, from: 17, to: 19, place: "p_teahouse" } });
    const ctx = idle({ tasks: new Map([[evening.id, evening]]), tracked: task("t", "blocked"), verbs: new Set(["track", "speak"]), leads: 1, promised: 2 });
    const gave = hints.check(ctx, 2, AT, 0);
    expect(gave.map((g) => g.id)).toEqual(["blocked", "track", "lead", "evening", "speak", "promised"]);
    expect(hints.def("evening")?.ping?.(ctx)).toMatchObject({ id: "p_teahouse", kind: "place" });
    expect(hints.def("chips")?.ping).toBeUndefined();
  });
});

test.describe("the hints on the way through the first day", () => {
  const act = (verb: string, over: Partial<NonNullable<Task["action"]>> = {}): Task["action"] => ({ verb, npc: null, place: null, item: null, ...over });
  const tasksOf = (...list: Task[]): ReadonlyMap<string, Task> => new Map(list.map((t) => [t.id, t]));
  const gave = (hints: Hints, ctx: HintContext, tick: number): string[] => hints.check(ctx, tick, AT, 0).map((g) => g.id);

  test("give one hint for each step, in the order the core plays them, and none of them before its step", () => {
    const hints = new Hints();
    const bamboo = task("t_bamboo_first", "open", { action: act("entrust", { npc: "li_laotai" }) });
    // Before anything: nothing to say.
    expect(gave(hints, idle({ tasks: tasksOf(bamboo), tracked: bamboo }), 1)).toEqual([]);
    // 1. Granny Li refuses over the rumour: the task is blocked, and another one is there to follow.
    const blocked = { ...bamboo, state: "blocked" as const };
    const who = task("t_who_said", "open", { action: act("ask_source", { npc: "cha_laoban" }) });
    expect(gave(hints, idle({ tasks: tasksOf(blocked, who), tracked: blocked, verbs: new Set(["track", "judge", "hint"]) }), 2)).toEqual(["blocked", "track"]);
    // 2. The player follows the telling back: the question is the task that is followed, and its button names the person to ask.
    expect(gave(hints, idle({ tasks: tasksOf(blocked, who), tracked: who, verbs: new Set(["track"]), entries: [entry("n1", 2)] }), 3)).toEqual(["notebook", "source"]);
    // The question is done and the words are there to set side by side: the clerk's first hand and a rumour.
    const proof = task("t_what_proves", "open");
    const doneWho = { ...who, state: "done" as const, action: null };
    expect(gave(hints, idle({ tasks: tasksOf(blocked, doneWho, proof), tracked: proof, entries: [entry("n1", 4), entry("n3", 1)] }), 4)).toEqual(["compare"]);
    // 4. The rumour is to be set straight at the teahouse, in the evening.
    const clear = task("t_clear_rumour", "open", { action: act("move", { place: "p_teahouse" }) });
    const evening = task("t_tea_tonight", "open", { window: { day: 1, from: 17, to: 19, place: "p_teahouse" } });
    const ctx = idle({ tasks: tasksOf(blocked, doneWho, proof, clear, evening), tracked: clear, entries: [entry("n1", 4), entry("n3", 1)] });
    expect(gave(hints, ctx, 5)).toEqual(["evening"]);
    expect(gave(hints, { ...ctx, verbs: new Set(["speak"]) }, 6)).toEqual(["speak"]);
    // 5 and 6. Granny Li has let go: the task of the bamboo is open again, and the person to ask is Li Da. Then he promises.
    const opened = task("t_bamboo_first", "open", { action: act("entrust", { npc: "li_da" }) });
    expect(gave(hints, idle({ tasks: tasksOf(opened, clear), tracked: opened }), 7)).toEqual(["opened"]);
    expect(gave(hints, idle({ tasks: tasksOf(opened), tracked: opened, promised: 1 }), 8)).toEqual(["promised"]);
    expect(hints.log.map((g) => g.id)).toEqual(["blocked", "track", "notebook", "source", "compare", "evening", "speak", "opened", "promised"]);
  });

  test("do not say that the bamboo is open while Granny Li is still the one to ask, nor that two lines can be compared when there is nothing to compare", () => {
    const hints = new Hints();
    const still = task("t_bamboo_first", "open", { action: act("entrust", { npc: "li_laotai" }) });
    expect(gave(hints, idle({ tasks: tasksOf(still), tracked: still }), 1)).toEqual([]);
    // Two lines that were both heard at second hand are nothing to set side by side.
    expect(gave(hints, idle({ entries: [entry("n1", 2), entry("n2", 3)] }), 2)).toEqual(["notebook"]);
    // The question about the telling is not the task that is followed, or is not open, or asks nobody: no hint to ask the source.
    const who = task("t_who_said", "open", { action: act("ask", { npc: "li_laotai" }) });
    expect(gave(hints, idle({ tasks: tasksOf(who), tracked: who }), 3)).toEqual([]);
    expect(gave(hints, idle({ tasks: tasksOf({ ...who, state: "done", action: null }), tracked: { ...who, state: "done", action: null } }), 4)).toEqual([]);
  });
});

test.describe("a story that stands still", () => {
  /** Frames every ten ticks from `from` up to and including `to`, as the page takes them. */
  const frames = (stall: Stall, signature: string, from: number, to: number, counts = true): void => {
    for (let tick = from; tick <= to; tick += 10) stall.note(signature, tick, counts);
  };

  test("is told by its signature: the clock starts over whenever it changes, and only game ticks are counted", () => {
    const stall = new Stall();
    expect(stall.note("a", 100)).toBe(true);
    stall.note("a", 100 + STALL_TICKS - 1);
    expect(stall.due()).toBe(false);
    stall.note("a", 100 + STALL_TICKS);
    expect(stall.due()).toBe(true);
    // The same signature is nothing new, and a different one is.
    expect(stall.note("a", 400 + STALL_TICKS)).toBe(false);
    expect(stall.due()).toBe(true);
    expect(stall.note("b", 500 + STALL_TICKS)).toBe(true);
    expect(stall.due()).toBe(false);
    stall.note("b", 500 + STALL_TICKS * 2 - 1);
    expect(stall.due()).toBe(false);
    // A world that is held does not move the tick, however many frames come.
    for (let i = 0; i < 100; i++) stall.note("b", 500 + STALL_TICKS * 2 - 1);
    expect(stall.due()).toBe(false);
    stall.note("b", 500 + STALL_TICKS * 2);
    expect(stall.due()).toBe(true);
  });

  test("does not count the night, nor a wait that is not the player's to shorten, and counts again from the first frame after them", () => {
    const stall = new Stall();
    stall.note("a", 0);
    frames(stall, "a", 10, 580);
    expect(stall.due()).toBe(false);
    // Dusk, a whole night and the dawn: the frames say the ticks do not count, and the ticks between the frames on both sides of them do not either.
    frames(stall, "a", 590, 5000, false);
    expect(stall.due()).toBe(false);
    // The day begins again with 580 ticks counted, and the elder is due 20 ticks later, not at the dawn.
    stall.note("a", 5005);
    expect(stall.due()).toBe(false);
    stall.note("a", 5015);
    expect(stall.due()).toBe(false);
    stall.note("a", 5025);
    expect(stall.due()).toBe(true);
    // The same for a wait in the day: it counts nothing, and what comes after it starts from what had counted before.
    const waiting = new Stall();
    waiting.note("a", 0);
    frames(waiting, "a", 10, 300);
    frames(waiting, "a", 310, 2000, false);
    frames(waiting, "a", 2010, 2300);
    expect(waiting.due()).toBe(false);
    frames(waiting, "a", 2310, 2320);
    expect(waiting.due()).toBe(true);
    // A move of the story in the night starts the clock over all the same.
    const moved = new Stall();
    moved.note("a", 0);
    expect(moved.note("b", 3000, false)).toBe(true);
    frames(moved, "b", 3010, 3000 + STALL_TICKS - 10);
    expect(moved.due()).toBe(false);
    frames(moved, "b", 3000 + STALL_TICKS, 3000 + STALL_TICKS + 20);
    expect(moved.due()).toBe(true);
  });

  test("brings the elder with one level more at each visit, up to the last, and a move of the story brings him back to the first", () => {
    const stall = new Stall();
    stall.note("a", 0);
    expect(stall.level).toBe(1);
    stall.visited();
    expect(stall.level).toBe(2);
    expect(stall.due()).toBe(false);
    stall.visited();
    stall.visited();
    stall.visited();
    expect(stall.level).toBe(ELDER_LEVELS);
    stall.note("b", STALL_TICKS * 4);
    expect(stall.level).toBe(1);
    stall.reset();
    expect(stall.due()).toBe(false);
    // The clock starts again from the first frame of the game that follows.
    stall.note("a", 7000);
    stall.note("a", 7000 + STALL_TICKS);
    expect(stall.due()).toBe(true);
  });
});

test.describe("a story with no task left to follow", () => {
  const DAY = { day: 2, hour: 9, minute: 0, phase: "day" };
  const open = [task("t_a", "open"), task("t_b", "done")];
  const blocked = [task("t_a", "blocked"), task("t_b", "stale")];
  const settled = [task("t_a", "done"), task("t_b", "stale")];
  const frameOf = (tasks: Task[], over: Partial<Parameters<typeof ticksCount>[0]> = {}): Parameters<typeof ticksCount>[0] => ({ time: DAY, tasks, tracked: null, promises: [], ...over });

  test("does not count its ticks: a task that is open or blocked is something to follow, and one that is done or has lapsed is not", () => {
    expect(ticksCount(frameOf(open))).toBe(true);
    expect(ticksCount(frameOf(blocked))).toBe(true);
    expect(ticksCount(frameOf(settled))).toBe(false);
    expect(ticksCount(frameOf([]))).toBe(false);
  });

  test("keeps the reasons it had: the night does not count, nor a wait for goods that are not yet due", () => {
    expect(ticksCount(frameOf(open, { time: { ...DAY, hour: 23, phase: "night" } }))).toBe(false);
    const bamboo = task("t_bamboo_first", "open", { kind: "need" });
    const promised: Commitment = { id: "m1", by: "li_da", what: name("Bring 4 poles of bamboo to the Stone Bridge"), item: "bamboo", amount: 4, due: { day: 3, hour: 7 }, state: "promised", reason: null };
    expect(ticksCount(frameOf([bamboo], { tracked: bamboo, promises: [promised] }))).toBe(false);
    expect(ticksCount(frameOf([bamboo], { tracked: bamboo, promises: [{ ...promised, state: "delivered" }] }))).toBe(true);
  });

  test("never makes the elder due, however many ticks pass with nothing moving, and does when a task is left", () => {
    const quiet = new Stall();
    quiet.note("a", 0, ticksCount(frameOf(settled)));
    for (let tick = 100; tick <= STALL_TICKS * 10; tick += 100) quiet.note("a", tick, ticksCount(frameOf(settled)));
    expect(quiet.due()).toBe(false);
    const waiting = new Stall();
    waiting.note("a", 0, ticksCount(frameOf(open)));
    for (let tick = 100; tick < STALL_TICKS; tick += 100) waiting.note("a", tick, ticksCount(frameOf(open)));
    expect(waiting.due()).toBe(false);
    waiting.note("a", STALL_TICKS, ticksCount(frameOf(open)));
    expect(waiting.due()).toBe(true);
    // The last task is done after a wait that had counted: the story moved, and the ticks that follow count for nothing.
    const done = new Stall();
    done.note("a", 0, true);
    done.note("a", STALL_TICKS - 10, true);
    done.note("b", STALL_TICKS, ticksCount(frameOf(settled)));
    for (let tick = STALL_TICKS + 100; tick <= STALL_TICKS * 10; tick += 100) done.note("b", tick, ticksCount(frameOf(settled)));
    expect(done.due()).toBe(false);
  });
});

test.describe("a wait for goods that somebody promised", () => {
  const promise = (over: Partial<Commitment> = {}): Commitment => ({ id: "m1", by: "li_da", what: name("Bring 4 poles of bamboo to the Stone Bridge"), item: "bamboo", amount: 4, due: { day: 2, hour: 7 }, state: "promised", reason: null, ...over });
  const EVENING = { day: 1, hour: 19, minute: 0 };
  const NIGHT = { day: 1, hour: 23, minute: 30 };
  const SMALL_HOURS = { day: 1, hour: 2, minute: 10 };
  const bamboo = task("t_bamboo_first", "open", { kind: "need" });

  test("is the wait of a thing to get that has nothing to do, from the promise until the hour it is due, the small hours of the night included", () => {
    for (const time of [EVENING, NIGHT, SMALL_HOURS, { day: 2, hour: 6, minute: 59 }]) expect(waitingOnPromise(bamboo, [promise()], time), JSON.stringify(time)).toBe(true);
    // At the hour it is due the goods are late, and the player who is still waiting may well be stuck.
    expect(waitingOnPromise(bamboo, [promise()], { day: 2, hour: 7, minute: 0 })).toBe(false);
    expect(waitingOnPromise(bamboo, [promise()], { day: 2, hour: 9, minute: 0 })).toBe(false);
    // A promise for the same day.
    expect(waitingOnPromise(bamboo, [promise({ due: { day: 1, hour: 13 } })], { day: 1, hour: 12, minute: 59 })).toBe(true);
    expect(waitingOnPromise(bamboo, [promise({ due: { day: 1, hour: 13 } })], { day: 1, hour: 13, minute: 0 })).toBe(false);
    // One that says no hour is not due as far as anybody can tell.
    expect(waitingOnPromise(bamboo, [promise({ due: null })], NIGHT)).toBe(true);
  });

  test("is the wait of the task of the promise too, which has a way to the bridge to go but nothing it needs to be done before the hour", () => {
    const kept = task("t_li_da_promise", "open", { kind: "promise", action: { verb: "move", npc: null, place: "p_bridge", item: null }, window: { day: 2, from: 6, to: 10, place: "p_bridge" } });
    expect(waitingOnPromise(kept, [promise()], NIGHT)).toBe(true);
    expect(waitingOnPromise(kept, [promise()], { day: 2, hour: 7, minute: 0 })).toBe(false);
  });

  test("is not the wait of a task that has a step to take, or is not about goods, or is not open, or of a promise that is over or none", () => {
    const asking = task("t_bamboo_first", "open", { kind: "need", action: { verb: "entrust", npc: "li_da", place: null, item: "bamboo" } });
    expect(waitingOnPromise(asking, [promise()], NIGHT)).toBe(false);
    expect(waitingOnPromise(task("t_what_proves", "open", { kind: "lead" }), [promise()], NIGHT)).toBe(false);
    expect(waitingOnPromise(task("t_tea_tonight", "open", { kind: "venue" }), [promise()], NIGHT)).toBe(false);
    expect(waitingOnPromise({ ...bamboo, state: "blocked" }, [promise()], NIGHT)).toBe(false);
    expect(waitingOnPromise({ ...bamboo, state: "done" }, [promise()], NIGHT)).toBe(false);
    expect(waitingOnPromise(null, [promise()], NIGHT)).toBe(false);
    for (const state of ["delivered", "broken", "withdrawn"] as const) expect(waitingOnPromise(bamboo, [promise({ state })], NIGHT), state).toBe(false);
    expect(waitingOnPromise(bamboo, [], NIGHT)).toBe(false);
    // One promise that is open among others that are over is enough.
    expect(waitingOnPromise(bamboo, [promise({ id: "m1", state: "broken" }), promise({ id: "m2" })], NIGHT)).toBe(true);
  });
});

test.describe("what the elder says", () => {
  const tracked = task("t_bamboo", "blocked", { next: name("Find out where that talk came from") });
  const entries = [entry("n1", 5, ["unconfirmed"]), entry("n2", 1)];

  test("first which way to think: the next of the task that is followed", () => {
    expect(elderAnswer(1, { tracked, entries, hint: null })).toMatchObject({ level: 1, next: { en: "Find out where that talk came from" } });
    expect(elderAnswer(1, { tracked: null, entries, hint: null })).toMatchObject({ level: 1, next: null });
    expect(elderAnswer(0, { tracked, entries, hint: null }).level).toBe(1);
  });

  test("then which two lines to set side by side: the core's pair, or where it has none the notebook's own marks", () => {
    const core = elderAnswer(2, { tracked, entries, hint: { a: "n2", b: "n1", relation: "unsupported" } });
    expect(core).toMatchObject({ level: 2, from: "core", relation: "unsupported" });
    expect(core.level === 2 && core.pair?.a.id).toBe("n2");
    const page = elderAnswer(2, { tracked, entries, hint: null });
    expect(page).toMatchObject({ level: 2, from: "page", relation: null });
    expect(page.level === 2 && [page.pair?.a.id, page.pair?.b.id]).toEqual(["n2", "n1"]);
    // A pair that names lines the notebook does not have is not the core's to give.
    expect(elderAnswer(2, { tracked, entries, hint: { a: "n8", b: "n9", relation: null } })).toMatchObject({ from: "page" });
    expect(elderAnswer(2, { tracked, entries: [], hint: null })).toMatchObject({ level: 2, pair: null });
  });

  test("and last the step spelled out, from the task, and nothing above the last level", () => {
    expect(elderAnswer(3, { tracked, entries, hint: null })).toMatchObject({ level: 3, task: { id: "t_bamboo" }, window: null });
    expect(elderAnswer(9, { tracked, entries, hint: null }).level).toBe(3);
  });

  test("with the hour of the occasion where the task goes: the teahouse is gone to in the evening, and a task with an hour of its own keeps it", () => {
    const evening = task("t_tea_tonight", "open", { kind: "venue", window: { day: 1, from: 17, to: 19, place: "p_teahouse" } });
    // A task that is not an occasion has a window too, the time and place of the person it sends the player to: it is not the hour of the place.
    const lida = task("t_bamboo_first", "open", { action: { verb: "entrust", npc: "li_da", place: null, item: "bamboo" }, window: { day: 1, from: 17, to: 20, place: "p_teahouse" } });
    const clear = task("t_clear_rumour", "open", { action: { verb: "move", npc: null, place: "p_teahouse", item: null } });
    expect(elderAnswer(3, { tracked: clear, entries, hint: null, tasks: [clear, evening] })).toMatchObject({ level: 3, window: { from: 17, to: 19, place: "p_teahouse" } });
    // Another place, a task that is done, or the task itself is not the occasion.
    // Speaking up has no place of its own: it is done at the occasion that is open.
    const speak = task("t_clear_rumour", "open", { action: { verb: "speak", npc: null, place: null, item: null } });
    expect(elderAnswer(3, { tracked: speak, entries, hint: null, tasks: [speak, evening] })).toMatchObject({ level: 3, window: { from: 17, to: 19, place: "p_teahouse" } });
    expect(elderAnswer(3, { tracked: speak, entries, hint: null, tasks: [speak] })).toMatchObject({ window: null });
    // The window of a task that is no occasion is not taken, even where it comes first or is at the same place.
    expect(elderAnswer(3, { tracked: speak, entries, hint: null, tasks: [speak, lida, evening] })).toMatchObject({ window: { from: 17, to: 19 } });
    expect(elderAnswer(3, { tracked: speak, entries, hint: null, tasks: [speak, lida] })).toMatchObject({ window: null });
    expect(elderAnswer(3, { tracked: clear, entries, hint: null, tasks: [clear, lida, evening] })).toMatchObject({ window: { from: 17, to: 19 } });
    // The task that is followed keeps its own: where to find the person it sends the player to.
    expect(elderAnswer(3, { tracked: lida, entries, hint: null, tasks: [lida, evening] })).toMatchObject({ window: { from: 17, to: 20 } });
    const bridge = task("t_li_da_promise", "open", { action: { verb: "move", npc: null, place: "p_bridge", item: null } });
    expect(elderAnswer(3, { tracked: bridge, entries, hint: null, tasks: [bridge, evening] })).toMatchObject({ window: null });
    expect(elderAnswer(3, { tracked: clear, entries, hint: null, tasks: [clear, { ...evening, state: "done" }] })).toMatchObject({ window: null });
    const own = task("t_own", "open", { window: { day: 2, from: 6, to: 10, place: "p_bridge" } });
    expect(elderAnswer(3, { tracked: own, entries, hint: null, tasks: [own, evening] })).toMatchObject({ window: { from: 6, to: 10 } });
  });

  test("and, when the rumour is to be set straight, the pair that was judged, which is what to say in public", () => {
    const clear = task("t_clear_rumour", "open");
    const judged = [{ a: "n3", b: "n1", relation: "unsupported" as const, made: 400 }];
    const lines = [entry("n1", 4), entry("n3", 1)].map((e) => ({ ...e, marks: [] }));
    const said = elderAnswer(2, { tracked: clear, entries: lines, hint: null, judgments: judged });
    expect(said).toMatchObject({ level: 2, from: "judged", relation: "unsupported" });
    expect(said.level === 2 && [said.pair?.a.id, said.pair?.b.id]).toEqual(["n3", "n1"]);
    // What the core lit last does not change it: the lines have been set side by side, and the pair to say is the judged one.
    expect(elderAnswer(2, { tracked: clear, entries: lines, hint: { a: "n1", b: "n3", relation: null }, judgments: judged })).toMatchObject({ from: "judged" });
    // Of several judged pairs it is the first-hand line against the rumour, and not two rumours that do not match.
    const several = [entry("n1", 5), entry("n2", 4), entry("n3", 1)].map((e) => ({ ...e, marks: [] }));
    const both = [
      { a: "n2", b: "n1", relation: "mismatch" as const, made: 300 },
      { a: "n3", b: "n1", relation: "unsupported" as const, made: 400 },
      { a: "n1", b: "n2", relation: "mismatch" as const, made: 500 },
    ];
    const first = elderAnswer(2, { tracked: clear, entries: several, hint: null, judgments: both });
    expect(first.level === 2 && [first.pair?.a.id, first.pair?.b.id, first.relation]).toEqual(["n3", "n1", "unsupported"]);
    // With no first-hand line judged against a rumour, the last pair judged is what there is.
    const rumours = elderAnswer(2, { tracked: clear, entries: several, hint: null, judgments: [both[0] as (typeof both)[number], both[2] as (typeof both)[number]] });
    expect(rumours.level === 2 && [rumours.pair?.a.id, rumours.pair?.b.id]).toEqual(["n1", "n2"]);
    // Nothing judged, any other task, or a judgement of lines the notebook no longer has: the pair to compare, as before.
    expect(elderAnswer(2, { tracked: clear, entries: lines, hint: null, judgments: [] })).toMatchObject({ from: "page" });
    expect(elderAnswer(2, { tracked: task("t_other", "open"), entries: lines, hint: null, judgments: judged })).toMatchObject({ from: "page" });
    expect(elderAnswer(2, { tracked: clear, entries: [], hint: null, judgments: judged })).toMatchObject({ from: "page", pair: null });
  });
});

test.describe("the world held by the page", () => {
  class Host {
    paused = false;
    readonly state = { paused: false };
    readonly sent: string[] = [];
    /** The reasons the hold gave, in order. */
    readonly why: Array<string | undefined> = [];
    pause(reason?: string): void {
      this.sent.push("pause");
      this.why.push(reason);
      this.state.paused = true;
    }
    resume(reason?: string): void {
      this.sent.push("resume");
      this.why.push(reason);
      this.state.paused = false;
    }
  }

  test("is paused by the first reason and let go by the last, and a pause of the player is left alone", () => {
    const host = new Host();
    const hold = new WorldHold(host);
    hold.set("notebook", true);
    hold.set("guide", true);
    expect(host.sent).toEqual(["pause"]);
    expect(hold.active).toBe(true);
    hold.set("notebook", false);
    expect(host.sent).toEqual(["pause"]);
    hold.set("guide", false);
    expect(host.sent).toEqual(["pause", "resume"]);
    expect(hold.active).toBe(false);
    // The world was paused by the player already: the page holds nothing and resumes nothing.
    const paused = new Host();
    paused.state.paused = true;
    const other = new WorldHold(paused);
    other.set("notebook", true);
    other.set("notebook", false);
    expect(paused.sent).toEqual([]);
  });

  test("is taken when the core stopped the clock for a talk, which is not a pause of the player's, and let go of with the last reason", () => {
    // The core holds the world while the player talks: it reports paused, and the host's reasons are none.
    const host = new Host();
    host.state.paused = true;
    (host.state as { stats?: { reasons: string[] } }).stats = { reasons: [] };
    const hold = new WorldHold(host);
    hold.set("guide", true);
    expect(host.sent).toEqual(["pause"]);
    hold.set("guide", false);
    expect(host.sent).toEqual(["pause", "resume"]);
    // The player pressed pause, and the host says so: the page holds nothing and resumes nothing.
    const pressed = new Host();
    pressed.state.paused = true;
    (pressed.state as { stats?: { reasons: string[] } }).stats = { reasons: ["user"] };
    const other = new WorldHold(pressed);
    other.set("guide", true);
    other.set("guide", false);
    expect(pressed.sent).toEqual([]);
    // A hidden tab is not the player's pause, so the hold is taken on top of it.
    const hidden = new Host();
    hidden.state.paused = true;
    (hidden.state as { stats?: { reasons: string[] } }).stats = { reasons: ["hidden"] };
    const third = new WorldHold(hidden);
    third.set("notebook", true);
    expect(hidden.sent).toEqual(["pause"]);
  });

  test("pauses and resumes with a reason of its own, so that the bar can tell it from the player's pause, and the player's resume can let it go", () => {
    const host = new Host();
    const hold = new WorldHold(host);
    hold.set("notebook", true);
    hold.set("notebook", false);
    expect(host.why).toEqual(["page", "page"]);
    // The player lets go of the world while the page holds it: the page gives up its pause, once.
    const other = new Host();
    const held = new WorldHold(other);
    held.set("notebook", true);
    held.letGo();
    held.letGo();
    expect(other.sent).toEqual(["pause", "resume"]);
    expect(other.why).toEqual(["page", "page"]);
    // The notebook that is shut afterwards owes nothing more.
    held.set("notebook", false);
    expect(other.sent).toEqual(["pause", "resume"]);
    // A hold that was never taken has nothing to let go of.
    const idle = new Host();
    new WorldHold(idle).letGo();
    expect(idle.sent).toEqual([]);
  });

  test("can be taken whatever the state of the world, and owes the resume", () => {
    const host = new Host();
    host.state.paused = true; // held by the page being closed to the town, as behind the opening page
    const hold = new WorldHold(host);
    hold.take("guide");
    expect(host.sent).toEqual(["pause"]);
    hold.take("guide");
    expect(host.sent).toEqual(["pause"]);
    hold.set("guide", false);
    expect(host.sent).toEqual(["pause", "resume"]);
  });
});
