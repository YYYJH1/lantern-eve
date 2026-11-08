import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { HostClient } from "../../src/page/client.ts";
import { beforeRecap, type DayFrame, type DayState, OVER, primeDay, RECAP_HOUR, REST_WORDS, restOf, stepDay, WATCHING } from "../../src/page/firstday.ts";
import { translate } from "../../src/i18n/index.ts";
import { STALL_TICKS } from "../../src/page/hints.ts";
import { Play } from "../../src/page/play.ts";
import type { Tasks } from "../../src/page/slice.ts";
import type { HostToPage } from "../../src/shared/protocol.ts";
import * as fake from "../support/slice.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// --- The rule of when the card is due ---------------------------------------------------------------------------------

const at = (day: number, hour: number, minute = 0): DayFrame["time"] => ({ day, hour, minute });
const frame = (bamboo: DayFrame["bamboo"], time: DayFrame["time"], covered = false): DayFrame => ({ bamboo, time, covered });

/** Gives the rule the frames one after the other, and says in which of them the card came up. */
function run(frames: DayFrame[], from: DayState = WATCHING): { shown: number[]; state: DayState } {
  let state = from;
  const shown: number[] = [];
  frames.forEach((one, index) => {
    const step = stepDay(state, one);
    state = step.state;
    if (step.show) shown.push(index);
  });
  return { shown, state };
}

test.describe("the card that says the first day is done", () => {
  test("comes in the frame where the task of the bamboo turns done, and only once", () => {
    const seen = run([frame("blocked", at(1, 9)), frame("open", at(1, 11)), frame("done", at(1, 13)), frame("done", at(1, 14)), frame("done", at(1, 15))]);
    expect(seen.shown).toEqual([2]);
    expect(seen.state.phase).toBe("up");
    // Put away, it is over for the game, whatever the frames say after it.
    expect(run([frame("done", at(2, 9)), frame("open", at(2, 10)), frame("done", at(2, 11))], OVER)).toEqual({ shown: [], state: OVER });
  });

  test("does not come while the task is open, or blocked, or has lapsed, or is not in the frame", () => {
    for (const bamboo of ["open", "blocked", "stale", null] as const) {
      expect(run([frame(bamboo, at(1, 9)), frame(bamboo, at(2, 9))]).shown, String(bamboo)).toEqual([]);
    }
  });

  test("follows the recap of the morning: the bamboo of an evening promise lands before seven, and the card waits for the recap", () => {
    // It lands at half past six on the second day. The recap is made at seven, and its card is up until the player puts it away.
    const seen = run([
      frame("open", at(1, 21)),
      frame("done", at(2, 6, 30)),
      frame("done", at(2, 6, 59)),
      // A frame shows the clock after its tick, so one reads seven before the recap is made: the card does not come yet.
      frame("done", at(2, 7, 0)),
      // The recap is in the next frame, which reads seven too: another card is up.
      frame("done", at(2, 7, 0), true),
      frame("done", at(2, 7, 20), true),
      // And the frame after the recap is put away.
      frame("done", at(2, 7, 21)),
      frame("done", at(2, 7, 22)),
    ]);
    expect(seen.shown).toEqual([6]);
    // A morning with no recap (it had no lines): the card comes when the clock has passed seven.
    expect(run([frame("open", at(1, 21)), frame("done", at(2, 6, 30)), frame("done", at(2, 6, 59)), frame("done", at(2, 7, 0)), frame("done", at(2, 7, 0)), frame("done", at(2, 7, 1))]).shown).toEqual([5]);
  });

  test("comes at once for a bamboo that lands after seven: a promise made in the day falls due two hours later", () => {
    expect(run([frame("open", at(1, 11)), frame("done", at(1, 13, 5))]).shown).toEqual([1]);
    expect(run([frame("open", at(2, 8)), frame("done", at(2, 10, 5))]).shown).toEqual([1]);
    // Even on the morning of a day, if the hour of the recap has gone by already.
    expect(run([frame("open", at(2, 7, 4)), frame("done", at(2, 7, 5))]).shown).toEqual([1]);
    // And at night, whose hours belong to the day that went before.
    expect(run([frame("open", at(1, 21, 30)), frame("done", at(1, 22, 0))]).shown).toEqual([1]);
  });

  test("waits behind any other card of the page, and comes when the last of them is put away", () => {
    const seen = run([frame("open", at(1, 11)), frame("done", at(1, 13), true), frame("done", at(1, 13, 1), true), frame("done", at(1, 13, 2), true), frame("done", at(1, 13, 3))]);
    expect(seen.shown).toEqual([4]);
    // The wait does not make it come twice, nor does the bamboo being done again.
    expect(run([frame("open", at(1, 11)), frame("done", at(1, 13), true), frame("done", at(1, 13, 1)), frame("done", at(1, 13, 2), true), frame("done", at(1, 13, 3))]).shown).toEqual([2]);
  });

  test("does not come for a game that began with the bamboo at the bridge, whether it was loaded or the page was opened late", () => {
    expect(primeDay({ bamboo: "done" })).toBe(OVER);
    for (const bamboo of ["open", "blocked", "stale", null] as const) expect(primeDay({ bamboo }), String(bamboo)).toBe(WATCHING);
    const seen = run([frame("done", at(2, 9)), frame("done", at(2, 10)), frame("done", at(2, 11))], primeDay({ bamboo: "done" }));
    expect(seen.shown).toEqual([]);
    // What turns done after the first frame is news.
    expect(run([frame("open", at(2, 9)), frame("done", at(2, 10))], primeDay({ bamboo: "open" })).shown).toEqual([1]);
  });

  test("counts the clock from the dawn, as the core does, so the small hours come after the evening and not before the morning", () => {
    expect(beforeRecap(at(2, 6, 0), 2)).toBe(true);
    expect(beforeRecap(at(2, 6, 59), 2)).toBe(true);
    // The two frames that read seven are the one before the recap and the one that has it.
    expect(beforeRecap(at(2, 7, 0), 2)).toBe(true);
    expect(beforeRecap(at(2, 7, 1), 2)).toBe(false);
    expect(beforeRecap(at(2, 23, 0), 2)).toBe(false);
    // The night after the first day is still the first day, and its small hours are past seven of that day.
    expect(beforeRecap(at(1, 3, 0), 1)).toBe(false);
    // A later day than the one the task was done on is past it.
    expect(beforeRecap(at(3, 6, 30), 2)).toBe(false);
  });

  test("has the hour of the recap that the script gives", () => {
    const script = JSON.parse(readFileSync(path.join(REPO, "content/compiled/broken_bridge.json"), "utf8")) as { commitments: { recap_hour: number } };
    expect(RECAP_HOUR).toBe(script.commitments.recap_hour);
  });
});

// --- Nothing left to follow ----------------------------------------------------------------------------------------------

const DONE_ALL = { t_bamboo_first: "done", t_source: "done", t_evening: "done", t_promise: "done" };

/** The tasks of the fake frame, read as the page reads them. */
const tasksOf = (states: Record<string, string>, tracked: string | null = null): Tasks => {
  const frameOfTasks = fake.tasksWhere(states, tracked);
  return {
    tracked,
    list: (frameOfTasks.tasks as Array<Record<string, unknown>>).map((raw) => ({
      id: String(raw.id),
      kind: String(raw.kind),
      job: null,
      text: raw.text as { zh: string; en: string },
      why: null,
      next: null,
      state: raw.state as Tasks["list"][number]["state"],
      blocker: null,
      action: null,
      window: null,
      expected: null,
    })),
  };
};

test.describe("what the page says when no task is open", () => {
  test("is that nothing is open now, or that the festival is over, and nothing where there is something to follow", () => {
    // Nothing open is idle, whether or not the first bamboo is done, and over once the festival has come.
    expect(restOf(tasksOf(DONE_ALL), false)).toBe("idle");
    expect(restOf(tasksOf({ ...DONE_ALL, t_bamboo_first: "stale" }), false)).toBe("idle");
    expect(restOf({ tracked: null, list: [] }, false)).toBe("idle");
    expect(restOf(tasksOf(DONE_ALL), true)).toBe("over");
    // A task that is open or blocked is something to follow, and a frame with no list says nothing.
    expect(restOf(tasksOf({ ...DONE_ALL, t_evening: "blocked" }), false)).toBeNull();
    expect(restOf(tasksOf({ ...DONE_ALL, t_promise: "open" }), false)).toBeNull();
    expect(restOf(tasksOf({ ...DONE_ALL, t_evening: "open" }), true)).toBeNull();
    expect(restOf(null, false)).toBeNull();
  });

  test("has its own words for the bar and the card, and a line of the elder for each of the three", () => {
    const words = (lang: "zh" | "en", rest: keyof typeof REST_WORDS) => [translate(lang, REST_WORDS[rest].bar), translate(lang, REST_WORDS[rest].card)];
    expect(words("zh", "idle")).toEqual(["眼下没有要追的事", "事项都办完了，可以四处走走，等第五天晚上的灯会。"]);
    expect(words("en", "idle")).toEqual(["Nothing to follow right now", "Everything on the list is done. Look around if you like, and wait for the festival on the night of the fifth day."]);
    expect(words("zh", "over")).toEqual(["灯会已过", "灯会办完了。"]);
    expect(words("zh", "pick")).toEqual(["挑一件事来追", "还没有追哪一件。从下面挑一件。"]);
    for (const rest of ["idle", "over"] as const) {
      expect(REST_WORDS[rest].elder1, rest).not.toBeNull();
      expect(REST_WORDS[rest].elder3, rest).not.toBeNull();
    }
    expect(REST_WORDS.pick.elder1).toBeNull();
  });
});

// --- The guide, against a stand-in client -----------------------------------------------------------------------------

/** The part of the host client that the player's side uses, with a record of what the page asked of the world. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null, paused: false, stats: null as { reasons: string[] } | null };
  /** `pause:page` and `resume:page`, in order. */
  readonly asked: string[] = [];
  pageNotes: unknown = null;
  private readonly taps: Array<(message: HostToPage) => void> = [];

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {}
  pause(reason?: string): void {
    this.asked.push(`pause:${reason ?? ""}`);
    this.state.paused = true;
  }
  resume(reason?: string): void {
    this.asked.push(`resume:${reason ?? ""}`);
    this.state.paused = false;
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

const TIME = { day: 1, hour: 10, minute: 0, phase: "day" };

/** A page with the help on, and a way to give it frames at ticks of the test's own. */
function page(help = true) {
  const client = new FakeClient();
  const play = new Play(client as unknown as HostClient);
  play.guide.enabled = help;
  const feed = (tick: number, time: Partial<typeof TIME>, extras: Record<string, unknown> = {}, events: unknown[] = []): void => {
    const frame = { npcs: [], time: { ...TIME, ...time }, weather: "clear", bubbles: [], dots: [], lanterns: [], notebook: [], hud: { verbs: ["move", "talk", "track"] }, ...extras };
    client.feed({ type: "frame", tick, advanced: true, frame, events, clock: { paused: false, rate: [1, 1] } } as unknown as HostToPage);
  };
  return { client, play, feed };
}

const OPEN = fake.tasksWhere({ t_bamboo_first: "open" });
const DONE = fake.tasksWhere(DONE_ALL, null);

test.describe("the card on a page of the game", () => {
  test("comes after the recap card is put away, holds the world while it is up and lets it go when it is closed", () => {
    const { client, play, feed } = page();
    feed(1, { day: 1, hour: 21 }, OPEN);
    // It lands at half past six: the card waits for the recap, which comes with the frame of seven.
    feed(2, { day: 2, hour: 6, minute: 30 }, DONE);
    feed(3, { day: 2, hour: 6, minute: 59 }, DONE);
    expect(play.guide.endUp).toBe(false);
    // The frame before the recap's reads seven already: the clock in a frame is the one after its tick.
    feed(4, { day: 2, hour: 7, minute: 0 }, DONE);
    expect(play.guide.endUp).toBe(false);
    feed(5, { day: 2, hour: 7, minute: 0 }, { ...DONE, ...fake.recap() }, [{ kind: "recap", tick: 5, lines: 3 }]);
    expect(play.flows.state.recap).not.toBeNull();
    feed(6, { day: 2, hour: 7, minute: 1 }, { ...DONE, recap: null });
    feed(7, { day: 2, hour: 7, minute: 2 }, { ...DONE, recap: null });
    expect(play.guide.endUp).toBe(false);
    expect(client.asked).toEqual([]);
    // The recap is put away, and the card comes at once, without another frame, and the world waits for it.
    play.flows.dismissRecap();
    expect(play.guide.endUp).toBe(true);
    expect(play.guide.cardUp).toBe(true);
    expect(play.hold.active).toBe(true);
    expect(client.asked).toEqual(["pause:page"]);
    // The frames that come meanwhile do not bring it twice or take it away.
    feed(8, { day: 2, hour: 7, minute: 3 }, { ...DONE, recap: null });
    expect(play.guide.endUp).toBe(true);
    // Closed, it lets the world go and does not come again.
    play.guide.closeEnd();
    expect(play.guide.endUp).toBe(false);
    expect(play.hold.active).toBe(false);
    expect(client.asked).toEqual(["pause:page", "resume:page"]);
    feed(9, { day: 2, hour: 7, minute: 4 }, DONE);
    feed(10, { day: 2, hour: 9, minute: 0 }, OPEN);
    feed(11, { day: 2, hour: 9, minute: 30 }, DONE);
    expect(play.guide.endUp).toBe(false);
    expect(client.asked).toEqual(["pause:page", "resume:page"]);
  });

  test("comes at once for a bamboo that lands after seven, and not twice", () => {
    const { client, play, feed } = page();
    feed(1, { day: 1, hour: 11 }, OPEN);
    feed(2, { day: 1, hour: 13, minute: 5 }, DONE);
    expect(play.guide.endUp).toBe(true);
    expect(client.asked).toEqual(["pause:page"]);
    play.guide.closeEnd();
    feed(3, { day: 1, hour: 13, minute: 6 }, DONE);
    expect(play.guide.endUp).toBe(false);
  });

  test("comes whether the hints of the world are on or off: it says the first day is done, and is no hint", () => {
    const { play, feed } = page();
    play.guide.setHintsOn(false);
    feed(1, { day: 1, hour: 11 }, OPEN);
    feed(2, { day: 1, hour: 13, minute: 5 }, DONE);
    expect(play.guide.endUp).toBe(true);
    play.guide.setHintsOn(true);
  });

  test("does not come for a game that is loaded with the bamboo at the bridge, nor on a page without the help, and comes in the next game", () => {
    const loaded = page();
    loaded.feed(1, { day: 2, hour: 9 }, DONE);
    loaded.feed(2, { day: 2, hour: 10 }, DONE);
    expect(loaded.play.guide.endUp).toBe(false);
    expect(loaded.client.asked).toEqual([]);
    // The page of a test of something else has no help.
    const bare = page(false);
    bare.feed(1, { day: 1, hour: 11 }, OPEN);
    bare.feed(2, { day: 1, hour: 13 }, DONE);
    expect(bare.play.guide.endUp).toBe(false);
    // A load is a new game for the page (the host sends `reset`, then the first frame), and a game with the bamboo to bring still has it to show.
    const again = page();
    again.feed(1, { day: 2, hour: 9 }, DONE);
    again.client.feed({ type: "reset", seed: 1, scenario: "bridge" } as unknown as HostToPage);
    again.feed(1, { day: 1, hour: 10 }, OPEN);
    again.feed(2, { day: 1, hour: 13 }, DONE);
    expect(again.play.guide.endUp).toBe(true);
  });

  test("waits behind the clan elder, and does not let him in while it is up", () => {
    const { play, feed } = page();
    feed(1, { day: 1, hour: 11 }, OPEN);
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(true);
    feed(2, { day: 1, hour: 13 }, DONE);
    expect(play.guide.endUp).toBe(false);
    play.guide.closeElder();
    expect(play.guide.endUp).toBe(true);
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(false);
  });

  test("waits behind what the people said, and behind the ending", () => {
    const { play, feed } = page();
    feed(1, { day: 1, hour: 11 }, OPEN);
    feed(2, { day: 1, hour: 13 }, { ...DONE }, [{ ...fake.clarified(), tick: 2 }]);
    expect(play.flows.state.clarified).not.toBeNull();
    expect(play.guide.endUp).toBe(false);
    play.flows.dismissClarified();
    expect(play.guide.endUp).toBe(true);
    // The game is over: the card has nothing to say.
    const over = page();
    over.feed(1, { day: 1, hour: 11 }, OPEN);
    over.feed(2, { day: 1, hour: 13 }, DONE, [{ kind: "ending", tick: 2, ending: "e_x", label: { zh: "", en: "" } }]);
    expect(over.play.state.ending).not.toBeNull();
    over.feed(3, { day: 1, hour: 14 }, DONE);
    expect(over.play.guide.endUp).toBe(false);
  });
});

test.describe("the clan elder on a page with nothing left to follow", () => {
  /** Frames every `gap` ticks from `from`, as the game sends them, with the tasks as given. */
  const wait = (feed: ReturnType<typeof page>["feed"], from: number, to: number, tasks: Record<string, unknown>, gap = 100): void => {
    for (let tick = from; tick <= to; tick += gap) feed(tick, { day: 2, hour: 9, minute: 0 }, tasks);
  };

  test("does not come by however long the story stands still, and comes by when a task is left", () => {
    const done = page();
    done.feed(1, { day: 1, hour: 11 }, OPEN);
    done.feed(2, { day: 2, hour: 9 }, DONE);
    done.play.guide.closeEnd();
    expect(done.play.guide.elder.open).toBe(false);
    wait(done.feed, 100, 100 + STALL_TICKS * 6, DONE);
    expect(done.play.guide.elder.open).toBe(false);
    expect(done.client.asked).toEqual(["pause:page", "resume:page"]);
    // The same page, with something to do that the player has not done.
    const live = page();
    live.feed(1, { day: 1, hour: 11 }, OPEN);
    wait(live.feed, 100, 100 + STALL_TICKS - 100, OPEN);
    expect(live.play.guide.elder.open).toBe(false);
    wait(live.feed, 100 + STALL_TICKS, 100 + STALL_TICKS, OPEN);
    expect(live.play.guide.elder.open).toBe(true);
    expect(live.play.guide.elder.visit).toBe(true);
  });

  test("still answers when asked", () => {
    const { play, feed } = page();
    feed(1, { day: 1, hour: 11 }, OPEN);
    feed(2, { day: 2, hour: 9 }, DONE);
    play.guide.closeEnd();
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(true);
    expect(play.guide.elder.visit).toBe(false);
  });
});
