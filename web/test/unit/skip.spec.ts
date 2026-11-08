import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { setLang, translate } from "../../src/i18n/index.ts";
import type { HostClient } from "../../src/page/client.ts";
import { Play } from "../../src/page/play.ts";
import { LEAD_HOURS, nextStop, SKIP_PACE, type SkipView, skipOffer } from "../../src/page/skip.ts";
import { readSlice } from "../../src/page/slice.ts";
import { momentText, skipLabel, skipShort } from "../../src/page/ui/skip-text.ts";
import type { HostToPage } from "../../src/shared/protocol.ts";

// The button that skips to the next thing: when it is offered, the time it says, and the run it begins, on frames made by hand in the
// shape of the real ones (the follower's game: the work done on the morning of the third day, nothing to follow until the festival).

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const BRIDGE = "p_bridge";
const TEAHOUSE = "p_teahouse";

interface RawTask {
  id: string;
  kind?: string;
  state?: string;
  action?: Record<string, unknown> | null;
  window?: { day: number; from: number; to: number; place: string } | null;
}

const task = (t: RawTask): Record<string, unknown> => ({
  id: t.id,
  kind: t.kind ?? "need",
  job: "bridge",
  text: { zh: t.id, en: t.id },
  why: null,
  next: null,
  state: t.state ?? "open",
  blocker: null,
  action: t.action ?? null,
  window: t.window ?? null,
});

const FESTIVAL_RAW: RawTask = { id: "t_festival_night", kind: "venue", window: { day: 5, from: 18, to: 21, place: BRIDGE } };
const FESTIVAL = task(FESTIVAL_RAW);
const WORK_3 = task({ id: "t_work_3", window: { day: 3, from: 8, to: 12, place: BRIDGE } });
const TELL_TOWN = task({ id: "t_tell_town", window: { day: 2, from: 17, to: 19, place: TEAHOUSE } });
const MAKE_PEACE = task({ id: "t_make_peace", window: { day: 2, from: 17, to: 19, place: TEAHOUSE } });
/** An open task that waits for goods promised for seven in the morning of the second day. */
const WAITS_FOR_BAMBOO = task({ id: "t_bamboo_rest", window: { day: 2, from: 6, to: 7, place: BRIDGE } });
const PROMISED = { id: "c1", by: "li_da", what: { zh: "把四根竹料送到石桥", en: "Bring 4 poles of bamboo to the Stone Bridge" }, item: "bamboo", amount: 4, due: { day: 2, hour: 7 }, state: "promised", reason: null };

const BOARD = { helpers: [], need: 5, both: true, hours: { done: 10, need: 10 }, window: null, stop: null, deadline: { day: 4, hour: 18 }, statement: null, truth: { state: "done", last: null }, peace: { state: "done", grudge: 20, acts: [], witnessed: true } };

const at = (day: number, hour: number, minute = 0) => ({ day, hour, minute });

/** What the offer reads, for frames with these tasks at this time: a game of the days after, in a world that does not stand still. */
function view(tasks: Array<Record<string, unknown>>, now: ReturnType<typeof at>, over: Partial<SkipView> & { commitments?: unknown[]; board?: unknown } = {}): SkipView {
  const { commitments, board, ...rest } = over;
  const slice = readSlice({ tasks, tracked: null, commitments: commitments ?? [], board: board === undefined ? BOARD : board });
  return { slice, time: now, ended: false, talking: false, paced: true, readOnly: false, ...rest };
}

test.describe("when the button is offered", () => {
  test("is when every task that is open or blocked only waits: no action now, and its window is ahead", () => {
    const offer = skipOffer(view([FESTIVAL], at(5, 6, 10)));
    expect(offer).not.toBeNull();
    // A task that is blocked and has no action waits as well, and one that is done or has lapsed is not there to wait.
    expect(skipOffer(view([FESTIVAL, task({ id: "t_blocked", state: "blocked" }), task({ id: "t_done", state: "done" }), task({ id: "t_stale", state: "stale", action: { verb: "move", place: BRIDGE } })], at(5, 6, 10)))).not.toBeNull();
  });

  test("is not while a task that is open or blocked has an action now, whatever else waits", () => {
    expect(skipOffer(view([FESTIVAL, task({ id: "t_timber", action: { verb: "entrust", npc: "zhou_zhanggui", request: "material" } })], at(2, 9)))).toBeNull();
    expect(skipOffer(view([task({ id: "t_blocked", state: "blocked", action: { verb: "promise", npc: "li_da" } })], at(2, 9)))).toBeNull();
    // The festival's own button comes an hour before its window, and then the offer is gone.
    expect(skipOffer(view([task({ ...FESTIVAL_RAW, action: { verb: "move", place: BRIDGE } })], at(5, 17, 0)))).toBeNull();
  });

  test("is when no task is open or blocked and the festival has not come, with no time to say", () => {
    const offer = skipOffer(view([task({ id: "t_work_3", state: "done" }), task({ id: "t_tell_town", state: "done" })], at(3, 9, 0)));
    expect(offer).toEqual({ until: null });
    expect(skipOffer(view([], at(4, 12)))).toEqual({ until: null });
  });

  test("is not after the ending, in a talk, on the page of a recording, nor with a host that keeps its own pace", () => {
    const waiting = [FESTIVAL];
    expect(skipOffer(view(waiting, at(5, 9)))).not.toBeNull();
    expect(skipOffer(view(waiting, at(5, 9), { ended: true }))).toBeNull();
    expect(skipOffer(view([], at(5, 21), { ended: true }))).toBeNull();
    expect(skipOffer(view(waiting, at(5, 9), { talking: true }))).toBeNull();
    expect(skipOffer(view(waiting, at(5, 9), { readOnly: true }))).toBeNull();
    expect(skipOffer(view(waiting, at(5, 9), { paced: false }))).toBeNull();
  });

  test("is not for a frame that does not say what it takes to say: no tasks, no board of the days after, no clock", () => {
    expect(skipOffer({ ...view([FESTIVAL], at(5, 9)), slice: readSlice({ board: BOARD }) })).toBeNull();
    expect(skipOffer(view([FESTIVAL], at(5, 9), { board: null }))).toBeNull();
    expect(skipOffer(view([FESTIVAL], at(5, 9), { time: null }))).toBeNull();
  });
});

test.describe("the time the button says", () => {
  const tasksOf = (list: Array<Record<string, unknown>>) => readSlice({ tasks: list, tracked: null }).tasks?.list ?? [];

  test("is an hour before the window of the festival, which is when the button that goes to the bridge comes", () => {
    expect(LEAD_HOURS).toBe(1);
    expect(nextStop(tasksOf([FESTIVAL]), [], at(5, 6, 0))).toEqual({ day: 5, hour: 17, minute: 0 });
    expect(nextStop(tasksOf([WORK_3]), [], at(2, 18, 2))).toEqual({ day: 3, hour: 7, minute: 0 });
    expect(nextStop(tasksOf([TELL_TOWN]), [], at(2, 12, 0))).toEqual({ day: 2, hour: 16, minute: 0 });
  });

  test("has the lead that the script gives: the step to go to the place of an occasion is an hour before its window", () => {
    interface Term {
      kind: string;
      from?: number;
    }
    interface Option {
      verb: string;
      when: Term[];
    }
    const script = JSON.parse(readFileSync(path.join(REPO, "content/compiled/broken_bridge.json"), "utf8")) as { tasks: Array<{ id: string; window: { from: number } | null; action: Option[] }> };
    const gaps = new Map<string, number>();
    for (const found of script.tasks) {
      if (found.window === null) continue;
      for (const option of found.action) {
        const hours = option.when.find((term) => term.kind === "window" || term.kind === "hours");
        if (option.verb === "move" && hours?.from !== undefined) gaps.set(found.id, found.window.from - hours.from);
      }
    }
    // Every occasion that has a window of its own sends the manager there an hour early, and the page counts on it.
    expect([...gaps.keys()].sort()).toEqual(["t_clear_rumour", "t_festival_night", "t_make_peace", "t_tea_tonight", "t_tell_town", "t_work_3", "t_work_4"]);
    expect([...new Set(gaps.values())]).toEqual([LEAD_HOURS]);
  });

  test("is the first of the windows that are ahead, whichever task they belong to", () => {
    expect(nextStop(tasksOf([FESTIVAL, WORK_3, TELL_TOWN, MAKE_PEACE]), [], at(2, 14, 33))).toEqual({ day: 2, hour: 16, minute: 0 });
    expect(nextStop(tasksOf([FESTIVAL, WORK_3, TELL_TOWN]), [], at(2, 18, 2))).toEqual({ day: 3, hour: 7, minute: 0 });
    // The task that is blocked has its window too.
    expect(nextStop(tasksOf([task({ ...FESTIVAL_RAW, state: "blocked" })]), [], at(5, 6, 0))).toEqual({ day: 5, hour: 17, minute: 0 });
  });

  test("is the hour a window opens for a task that waits on a promise, where the goods are due and nobody has to do anything", () => {
    const tasks = tasksOf([WAITS_FOR_BAMBOO, TELL_TOWN, MAKE_PEACE]);
    const promises = readSlice({ commitments: [PROMISED] }).commitments ?? [];
    expect(nextStop(tasks, promises, at(1, 19, 46))).toEqual({ day: 2, hour: 6, minute: 0 });
    // The same window, with no promise behind it, is a window like any: the step comes an hour before it, which is in the night, so at dawn.
    expect(nextStop(tasksOf([WAITS_FOR_BAMBOO]), [], at(1, 19, 46))).toEqual({ day: 2, hour: 6, minute: 0 });
    // A window at seven asks for its step at six, and for a promise it is still seven.
    const seven = task({ id: "t_seven", window: { day: 2, from: 7, to: 9, place: BRIDGE } });
    expect(nextStop(tasksOf([seven]), [], at(1, 20, 0))).toEqual({ day: 2, hour: 6, minute: 0 });
    const kept = { ...PROMISED, due: { day: 2, hour: 9 } };
    expect(nextStop(tasksOf([seven]), readSlice({ commitments: [kept] }).commitments ?? [], at(1, 20, 0))).toEqual({ day: 2, hour: 7, minute: 0 });
    // A promise that has been kept is no promise: the window is the task's own.
    const delivered = { ...kept, state: "delivered" };
    expect(nextStop(tasksOf([seven]), readSlice({ commitments: [delivered] }).commitments ?? [], at(1, 20, 0))).toEqual({ day: 2, hour: 6, minute: 0 });
  });

  test("leaves out a window that is open or past, and one that has no window, and has none to say where nothing is ahead", () => {
    expect(nextStop(tasksOf([task({ id: "t_open", window: { day: 3, from: 8, to: 12, place: BRIDGE } })]), [], at(3, 9, 0))).toBeNull();
    expect(nextStop(tasksOf([task({ id: "t_past", window: { day: 2, from: 8, to: 12, place: BRIDGE } })]), [], at(3, 9, 0))).toBeNull();
    expect(nextStop(tasksOf([task({ id: "t_none" })]), [], at(3, 9, 0))).toBeNull();
    expect(nextStop([], [], at(3, 9, 0))).toBeNull();
    // Without a window ahead the offer has no time.
    expect(skipOffer(view([task({ id: "t_none" }), task({ id: "t_past", window: { day: 2, from: 8, to: 12, place: BRIDGE } })], at(3, 9, 0)))).toEqual({ until: null });
  });

  test("is the hour the window opens when the hour before it has begun and the card has no step yet (a task that waits on the weather)", () => {
    expect(nextStop(tasksOf([FESTIVAL]), [], at(5, 17, 30))).toEqual({ day: 5, hour: 18, minute: 0 });
    expect(nextStop(tasksOf([FESTIVAL]), [], at(5, 17, 0))).toEqual({ day: 5, hour: 18, minute: 0 });
    expect(nextStop(tasksOf([FESTIVAL]), [], at(5, 16, 59))).toEqual({ day: 5, hour: 17, minute: 0 });
  });

  test("says the offer's time in both languages, as the window of the card says a time", () => {
    const offer = skipOffer(view([FESTIVAL], at(5, 6, 10)));
    expect(offer?.until).toEqual({ day: 5, hour: 17, minute: 0 });
    const state = { offer, running: false };
    setLang("en");
    expect(momentText("en", { day: 5, hour: 17, minute: 0 })).toBe("Day 5, 17:00");
    expect(skipLabel("en", state)).toBe("Skip to Day 5, 17:00");
    expect(skipLabel("en", { offer: { until: null }, running: false })).toBe("Skip to the next thing");
    expect(skipLabel("en", { offer, running: true })).toBe("Stop skipping");
    expect(skipShort({ running: false })).toBe("Skip");
    expect(skipShort({ running: true })).toBe("Stop");
    setLang("zh");
    expect(momentText("zh", { day: 5, hour: 17, minute: 0 })).toBe("第五日 17:00");
    expect(skipLabel("zh", state)).toBe("快进到第五日 17:00");
    expect(skipLabel("zh", { offer: { until: null }, running: false })).toBe("快进到下一件事");
    expect(skipLabel("zh", { offer, running: true })).toBe("停止快进");
    expect(skipShort({ running: false })).toBe("快进");
    expect(translate("zh", "skip.stop.short")).toBe("停止");
    setLang("en");
  });
});

// --- The run, against a stand-in client ----------------------------------------------------------------------------------

/** The part of the host client that the player's side and the skip use, with a record of what the page asked of the world. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null, phase: "ready" as "boot" | "ready" | "failed", paused: false, stats: null as { reasons: string[] } | null };
  paced = true;
  /** The paces the page asked for, in order. */
  readonly paces: number[] = [];
  /** For each of them, whether it was asked as the pace of a skip (the host takes a higher one for that). */
  readonly skips: boolean[] = [];
  /** `pause:user`, `resume:user` and the rest, in order. */
  readonly asked: string[] = [];
  pageNotes: unknown = null;
  private readonly taps: Array<(message: HostToPage) => void> = [];

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {}
  pause(reason = "user"): void {
    this.asked.push(`pause:${reason}`);
    this.state.paused = true;
    this.state.stats = { reasons: [reason] };
  }
  resume(reason = "user"): void {
    this.asked.push(`resume:${reason}`);
    this.state.paused = false;
    this.state.stats = { reasons: [] };
  }
  setPace(speed: number, skip = false): void {
    this.paces.push(speed);
    this.skips.push(skip);
  }
  player(body: Record<string, unknown>): string {
    return typeof body.action_id === "string" ? body.action_id : "a1";
  }
  call<T>(): Promise<T> {
    return Promise.resolve(null as T);
  }
  feed(message: HostToPage): void {
    for (const tap of this.taps) tap(message);
  }
}

interface Moment {
  time: ReturnType<typeof at>;
  tasks: Array<Record<string, unknown>>;
  tracked?: string | null;
  talk?: boolean;
  recap?: unknown;
  events?: unknown[];
}

/** A page of the game, held at the third morning's end, and a way to give it frames. */
function page(options: { readOnly?: boolean; paced?: boolean } = {}) {
  const client = new FakeClient();
  client.paced = options.paced ?? true;
  const play = new Play(client as unknown as HostClient, options.readOnly ?? false);
  let tick = 0;
  /** Gives the page a frame, `gap` ticks of the game after the one before. */
  const feed = (m: Moment, gap = 1): void => {
    tick += gap;
    const frame = {
      npcs: [],
      time: { ...m.time, phase: "day" },
      weather: "clear",
      bubbles: [],
      dots: [],
      lanterns: [],
      notebook: [],
      hud: { verbs: ["move", "talk", "track"] },
      player: { x: 10, y: 10, activity: "rest", talk: m.talk === true ? { npc: "li_da", costs: null, leaves_at: null } : null, look: [], offers: {}, topics: [] },
      tasks: m.tasks,
      tracked: m.tracked === undefined ? (m.tasks.find((x) => x.state === "open" || x.state === "blocked")?.id ?? null) : m.tracked,
      commitments: [],
      board: BOARD,
      recap: m.recap ?? null,
      ending: null,
    };
    client.feed({ type: "frame", tick, advanced: true, frame, events: m.events ?? [], clock: { paused: client.state.paused, rate: [1, 1] } } as unknown as HostToPage);
  };
  return { client, play, feed };
}

/** A frame in which the only task that is open is the festival, which waits for its hour: the follower's game from the end of the work. */
const idle = (time: ReturnType<typeof at>): Moment => ({ time, tasks: [task({ id: "t_work_3", state: "done" }), FESTIVAL], tracked: "t_festival_night" });
const FESTIVAL_NOW = task({ ...FESTIVAL_RAW, action: { verb: "move", place: BRIDGE } });

test.describe("a run that skips to the next thing", () => {
  test("asks the host for the highest pace it takes, and gives the pace the player chose back when it is pressed again", () => {
    const { client, play, feed } = page();
    feed(idle(at(3, 12, 30)));
    play.skip.choose(0.75);
    expect(client.paces).toEqual([0.75]);
    expect(play.skip.state).toMatchObject({ running: false, enabled: true });
    expect(play.skip.state.offer?.until).toEqual({ day: 5, hour: 17, minute: 0 });
    play.skip.press();
    expect(play.skip.running).toBe(true);
    expect(client.paces).toEqual([0.75, SKIP_PACE]);
    expect(client.skips).toEqual([false, true]); // the pace of the run says it is a skip's; the player's does not
    expect(SKIP_PACE).toBe(12);
    // Frames in which nothing has happened go on with it, and the player's choice meanwhile is kept for the end, not sent.
    feed(idle(at(3, 12, 31)));
    feed(idle(at(3, 13, 0)));
    play.skip.choose(1);
    expect(play.skip.running).toBe(true);
    expect(client.paces).toEqual([0.75, SKIP_PACE]);
    play.skip.press();
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("pressed");
    expect(client.paces).toEqual([0.75, SKIP_PACE, 1]);
    // Pressed once more it begins again, and a press on a button that is not offered does nothing.
    play.skip.press();
    expect(play.skip.running).toBe(true);
    feed({ time: at(5, 17, 0), tasks: [FESTIVAL_NOW], tracked: "t_festival_night" });
    expect(play.skip.running).toBe(false);
    play.skip.press();
    expect(play.skip.running).toBe(false);
    expect(client.paces).toEqual([0.75, SKIP_PACE, 1, SKIP_PACE, 1]);
  });

  test("ends when a task has something to do now, and the pace is the player's again at once", () => {
    const { client, play, feed } = page();
    feed(idle(at(5, 6, 0)));
    play.skip.press();
    feed(idle(at(5, 16, 59)));
    expect(play.skip.running).toBe(true);
    feed({ time: at(5, 17, 0), tasks: [FESTIVAL_NOW], tracked: "t_festival_night" });
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("ready");
    expect(client.paces).toEqual([SKIP_PACE, 1]);
    expect(play.skip.state.offer).toBeNull();
  });

  test("ends when the task that is followed is not the one it was, a task appearing included", () => {
    const { play, feed } = page();
    feed({ time: at(3, 10, 0), tasks: [task({ id: "t_work_3", state: "done" })], tracked: null });
    expect(play.skip.state.offer).toEqual({ until: null });
    play.skip.press();
    feed({ time: at(4, 12, 0), tasks: [task({ id: "t_work_3", state: "done" })], tracked: null });
    expect(play.skip.running).toBe(true);
    // The festival appears on the morning of the fifth day, and it only waits: the core follows it.
    feed({ time: at(5, 6, 0), tasks: [task({ id: "t_work_3", state: "done" }), FESTIVAL], tracked: "t_festival_night" });
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("task");
  });

  test("ends when a person comes to talk to the manager", () => {
    const { client, play, feed } = page();
    feed(idle(at(5, 8, 0)));
    play.skip.press();
    feed({ ...idle(at(5, 8, 1)), talk: true });
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("talk");
    expect(client.paces).toEqual([SKIP_PACE, 1]);
    // And it is not offered, nor can it begin, inside a talk.
    expect(play.skip.state.offer).toBeNull();
    play.skip.press();
    expect(play.skip.running).toBe(false);
  });

  test("ends when the world is held or paused: by the player, by a hidden tab, by a card of the help, by the core", () => {
    for (const [reasons, ended] of [
      [["user"], "paused"],
      [["hidden"], "held"],
      [["page"], "held"],
      [[], "held"],
    ] as const) {
      const { client, play, feed } = page();
      feed(idle(at(5, 8, 0)));
      play.skip.press();
      feed(idle(at(5, 8, 1)));
      expect(play.skip.running).toBe(true);
      client.state.paused = true;
      client.state.stats = { reasons: [...reasons] };
      feed(idle(at(5, 8, 2)));
      expect(play.skip.running, reasons.join()).toBe(false);
      expect(play.skip.ended, reasons.join()).toBe(ended);
      expect(client.paces.at(-1)).toBe(1);
    }
  });

  test("ends when a card or a sheet of the page comes up: the recap of the morning, the elder, the end of the first day", () => {
    const { play, feed } = page();
    feed(idle(at(3, 12, 30)));
    play.skip.press();
    feed({ ...idle(at(4, 7, 0)), recap: [{ text: { zh: "李大答应的四根竹料，已经送到石桥。", en: "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge." }, events: [1] }], events: [{ kind: "recap", tick: 3, lines: 1 }] });
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("held");
    // While the sheet is up the button can be seen and cannot be pressed.
    expect(play.skip.state).toMatchObject({ running: false, enabled: false });
    expect(play.skip.state.offer).not.toBeNull();
    play.skip.press();
    expect(play.skip.running).toBe(false);
    play.flows.dismissRecap();
    expect(play.skip.state.enabled).toBe(true);
  });

  test("ends with the ending, and the ending is not offered a skip", () => {
    const { client, play, feed } = page();
    feed(idle(at(5, 20, 0)));
    play.skip.press();
    feed({ ...idle(at(5, 21, 0)), events: [{ kind: "ending", tick: 9, ending: "full", label: { zh: "圆满", en: "Full" }, hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100, reveal: null }] });
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("ending");
    expect(play.skip.state.offer).toBeNull();
    expect(client.paces.at(-1)).toBe(1);
  });

  test("lets a world the player paused go, and does not take the pause of the frames before it for a new pause", () => {
    const { client, play, feed } = page();
    feed(idle(at(3, 12, 30)));
    client.pause();
    feed(idle(at(3, 12, 30)));
    expect(play.skip.state).toMatchObject({ running: false, enabled: true });
    play.skip.press();
    expect(client.asked).toEqual(["pause:user", "resume:user"]);
    expect(play.skip.running).toBe(true);
    // A frame of the paused world that was still on its way does not end it.
    client.state.paused = true;
    feed(idle(at(3, 12, 30)));
    expect(play.skip.running).toBe(true);
    client.state.paused = false;
    feed(idle(at(3, 12, 31)));
    expect(play.skip.running).toBe(true);
    // And the player's pause now does.
    client.pause();
    feed(idle(at(3, 12, 32)));
    expect(play.skip.running).toBe(false);
    expect(play.skip.ended).toBe("paused");
  });

  test("cannot begin while the world is held by the page, by the core or by a hidden tab, nor before the host is up", () => {
    for (const reasons of [["page"], ["hidden"], []]) {
      const { client, play, feed } = page();
      feed(idle(at(3, 12, 30)));
      client.state.paused = true;
      client.state.stats = { reasons };
      expect(play.skip.state.enabled, reasons.join()).toBe(false);
      play.skip.press();
      expect(play.skip.running).toBe(false);
      expect(client.paces).toEqual([]);
    }
    const booting = page();
    booting.feed(idle(at(3, 12, 30)));
    booting.client.state.phase = "boot";
    expect(booting.play.skip.state.enabled).toBe(false);
  });

  test("is not offered on the page of a recording, with the server host, nor where the frames have no days after the first", () => {
    const watching = page({ readOnly: true });
    watching.feed(idle(at(3, 12, 30)));
    expect(watching.play.skip.state.offer).toBeNull();
    watching.play.skip.press();
    expect(watching.client.paces).toEqual([]);
    const served = page({ paced: false });
    served.feed(idle(at(3, 12, 30)));
    expect(served.play.skip.state.offer).toBeNull();
    served.play.skip.press();
    expect(served.client.paces).toEqual([]);
  });

  test("is over with a new game or a loaded one, and the host has the pace the player chose", () => {
    for (const message of [{ type: "reset", seed: 1, scenario: "bridge" }, { type: "loaded", info: { match: true, hash: "h", savedHash: "h", tick: 1, hashesChecked: 1, reissued: 0, cancelledOpen: 0 } }]) {
      const { client, play, feed } = page();
      feed(idle(at(3, 12, 30)));
      play.skip.choose(0.75);
      play.skip.press();
      expect(client.paces).toEqual([0.75, SKIP_PACE]);
      client.feed(message as unknown as HostToPage);
      expect(play.skip.running).toBe(false);
      expect(play.skip.ended).toBe("reset");
      expect(client.paces).toEqual([0.75, SKIP_PACE, 0.75]);
    }
  });

  test("keeps the elder from coming by in the middle of it: the ticks of a skip are not a story that stands still", () => {
    // The festival waits for its hour and the player does nothing: after STALL_TICKS ticks of the day the elder comes by, with the world held.
    const waiting = page();
    waiting.play.guide.enabled = true;
    waiting.feed(idle(at(5, 6, 0)), 100);
    for (let hour = 7; hour <= 14; hour++) waiting.feed(idle(at(5, hour, 0)), 100);
    expect(waiting.play.guide.elder.open).toBe(true);
    // The same hours in a skip: the elder has not come, and the run goes on.
    const skipping = page();
    skipping.play.guide.enabled = true;
    skipping.feed(idle(at(5, 6, 0)), 100);
    skipping.play.skip.press();
    expect(skipping.play.skip.running).toBe(true);
    for (let hour = 7; hour <= 14; hour++) skipping.feed(idle(at(5, hour, 0)), 100);
    expect(skipping.play.guide.elder.open).toBe(false);
    expect(skipping.play.skip.running).toBe(true);
    expect(skipping.client.paces.at(-1)).toBe(SKIP_PACE);
    // Once it ends the wait begins from nothing: the ticks that went by in the run are not counted afterwards.
    skipping.play.skip.press();
    for (let hour = 15; hour <= 16; hour++) skipping.feed(idle(at(5, hour, 0)), 100);
    expect(skipping.play.guide.elder.open).toBe(false);
  });
});
