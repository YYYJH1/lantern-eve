import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { GLOW_FADE_MS } from "../../src/page/guide.ts";
import { Play } from "../../src/page/play.ts";
import { jobOf, JOB_FLAGS, jobsDone, JOBS, Shows } from "../../src/page/shows.ts";
import type { CoreEvent } from "../../src/shared/protocol.ts";
import { FakeClient, feedFrame, frameAt, resetTicks } from "../support/fake-client.ts";

// The show when a job is done: which flag is which job, what a frame says is done already, and the cards: each job once in a game, one at a time, behind any
// other card, and never for what was done when the page began to look.

const flag = (name: string): CoreEvent => ({ kind: "flag", tick: 1, flag: name });

test.describe("which flag is which job", () => {
  test("the bridge mended, the truth told and the families at peace, and no other flag", () => {
    expect(JOBS).toEqual(["bridge", "truth", "peace"]);
    expect(JOB_FLAGS).toEqual({ bridge_fixed: "bridge", truth_told: "truth", reconciled: "peace" });
    expect(jobOf(flag("bridge_fixed"))).toBe("bridge");
    expect(jobOf(flag("truth_told"))).toBe("truth");
    expect(jobOf(flag("reconciled"))).toBe("peace");
    for (const other of ["bamboo_delivered", "timber_delivered", "lane_opened", "lamps_hung", "detour_done", "reconcile_seen", "elder_accepts", "constructor", "__proto__", "toString"]) {
      expect(jobOf(flag(other)), other).toBeNull();
    }
    expect(jobOf({ kind: "goal", goal: "g_repair" })).toBeNull();
    expect(jobOf({ kind: "flag" })).toBeNull();
    expect(jobOf({ kind: "flag", flag: 3 })).toBeNull();
  });

  test("a frame says a job is done by the state of the bridge and of the board: a detour is not a mended bridge", () => {
    expect(jobsDone({}, null)).toEqual([]);
    expect(jobsDone({ bridge: { state: "broken" } }, null)).toEqual([]);
    expect(jobsDone({ bridge: { state: "repairing" } }, null)).toEqual([]);
    expect(jobsDone({ bridge: { state: "detour" } }, null)).toEqual([]);
    expect(jobsDone({ bridge: { state: "mended" } }, null)).toEqual(["bridge"]);
    const open = { truth: { state: "open" as const, last: null }, peace: { state: "open" as const, grudge: 60, acts: [], witnessed: false } };
    expect(jobsDone({}, open)).toEqual([]);
    expect(jobsDone({}, { ...open, truth: { state: "done", last: null } })).toEqual(["truth"]);
    expect(jobsDone({ bridge: { state: "mended" } }, { truth: { state: "done", last: null }, peace: { state: "done", grudge: 10, acts: [], witnessed: true } })).toEqual(["bridge", "truth", "peace"]);
  });
});

test.describe("the cards", () => {
  test("come one at a time in the order the jobs were done, each once", () => {
    const shows = new Shows();
    shows.prime([]);
    shows.note("truth");
    shows.note("peace");
    shows.note("truth");
    expect(shows.up).toBeNull();
    expect(shows.step(false, false)).toBe(true);
    expect(shows.up).toBe("truth");
    // One is up: the next waits, however often it is asked.
    expect(shows.step(false, false)).toBe(false);
    expect(shows.up).toBe("truth");
    expect(shows.close()).toBe("truth");
    expect(shows.up).toBeNull();
    expect(shows.step(false, false)).toBe(true);
    expect(shows.up).toBe("peace");
    expect(shows.close()).toBe("peace");
    expect(shows.step(false, false)).toBe(false);
    // A job that was told of is not told again, even when the core says so again.
    shows.note("truth");
    shows.note("peace");
    expect(shows.step(false, false)).toBe(false);
    expect(shows.close()).toBeNull();
  });

  test("wait behind another card that is up, and come when it is put away", () => {
    const shows = new Shows();
    shows.prime([]);
    shows.note("bridge");
    expect(shows.step(true, false)).toBe(false);
    expect(shows.step(true, false)).toBe(false);
    expect(shows.up).toBeNull();
    expect(shows.step(false, false)).toBe(true);
    expect(shows.up).toBe("bridge");
  });

  test("are not for what was done when the page began to look, but are for what is told of in the first frame and not done in it", () => {
    const shows = new Shows();
    shows.note("bridge");
    shows.note("peace");
    shows.prime(["bridge"]);
    expect(shows.step(false, false)).toBe(true);
    expect(shows.up).toBe("peace");
    shows.close();
    shows.note("bridge");
    expect(shows.step(false, false)).toBe(false);
    const fresh = new Shows();
    fresh.prime(["truth"]);
    fresh.note("truth");
    expect(fresh.step(false, false)).toBe(false);
  });

  test("are let go once the ending is there, and a new game has all of them again", () => {
    const shows = new Shows();
    shows.prime([]);
    shows.note("bridge");
    shows.note("truth");
    expect(shows.step(false, true)).toBe(false);
    expect(shows.step(false, false)).toBe(false);
    shows.note("truth");
    expect(shows.step(false, false)).toBe(false); // told of already: the ending page said it
    shows.reset();
    shows.prime([]);
    shows.note("truth");
    expect(shows.step(false, false)).toBe(true);
    expect(shows.up).toBe("truth");
    shows.reset();
    expect(shows.up).toBeNull();
  });
});

const setup = (enabled = true) => {
  resetTicks();
  setLang("en");
  const client = new FakeClient();
  const play = new Play(client.host);
  play.guide.enabled = enabled;
  return { client, play };
};

const time = (day: number, hour: number, minute = 0) => frameAt(day, hour, minute);

/** The first frame of the game, which the help takes as what was true from the start. */
const begin = (client: FakeClient): void => feedFrame(client, time(2, 10));

test.describe("on a page that plays", () => {
  test("a card comes with the flag, holds the world while it is up, lights the map, and lets go when it is put away", () => {
    const { client, play } = setup();
    begin(client);
    expect(play.guide.showUp).toBe(false);
    expect(client.holds).toEqual([]);
    feedFrame(client, time(2, 11), [flag("bridge_fixed")]);
    expect(play.guide.shows.up).toBe("bridge");
    expect(play.guide.showUp).toBe(true);
    expect(play.guide.cardUp).toBe(true);
    expect(play.guide.glow).toEqual({ job: "bridge", fading: false });
    expect(client.holds).toEqual(["pause:page"]);
    play.guide.closeShow();
    expect(play.guide.showUp).toBe(false);
    expect(play.guide.cardUp).toBe(false);
    expect(client.holds).toEqual(["pause:page", "resume:page"]);
    // The light stays for a moment after, and then goes.
    expect(play.guide.glow).toEqual({ job: "bridge", fading: true });
  });

  test("the light goes out a moment after the card is put away", async () => {
    const { client, play } = setup();
    begin(client);
    feedFrame(client, time(2, 11), [flag("truth_told")]);
    play.guide.closeShow();
    expect(play.guide.glow?.fading).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, GLOW_FADE_MS + 100));
    expect(play.guide.glow).toBeNull();
  });

  test("tells each job once: the same flag again changes nothing, and the next job waits for the card that is up", () => {
    const { client, play } = setup();
    begin(client);
    feedFrame(client, time(2, 11), [flag("truth_told"), flag("reconciled")]);
    expect(play.guide.shows.up).toBe("truth");
    feedFrame(client, time(2, 12), [flag("truth_told")]);
    expect(play.guide.shows.up).toBe("truth");
    play.guide.closeShow();
    expect(play.guide.shows.up).toBe("peace");
    expect(client.holds).toEqual(["pause:page"]); // held all the while, and not let go between the two cards
    play.guide.closeShow();
    expect(play.guide.shows.up).toBeNull();
    expect(client.holds).toEqual(["pause:page", "resume:page"]);
    feedFrame(client, time(2, 13), [flag("reconciled"), flag("truth_told")]);
    expect(play.guide.shows.up).toBeNull();
  });

  test("none for what was done when the page began to look: a game that was loaded with the bridge mended", () => {
    const { client, play } = setup();
    const mended = { hud: { verbs: ["move"], bridge: { state: "mended" } } };
    feedFrame(client, frameAt(4, 10, 0, mended));
    feedFrame(client, frameAt(4, 11, 0, mended), [flag("bridge_fixed")]);
    expect(play.guide.showUp).toBe(false);
    // The truth is another job, and is told of.
    feedFrame(client, frameAt(4, 12, 0, mended), [flag("truth_told")]);
    expect(play.guide.shows.up).toBe("truth");
  });

  test("the elder is not asked for, and does not come by, while it is up", () => {
    const { client, play } = setup();
    begin(client);
    feedFrame(client, time(2, 11), [flag("bridge_fixed")]);
    expect(play.guide.showUp).toBe(true);
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(false);
    play.guide.closeShow();
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(true);
  });

  test("waits behind the result of the full statement and behind the summary of the night, and comes when they are put away", () => {
    const { client, play } = setup();
    begin(client);
    // The statement told the truth in this frame: the people who were there are the first thing the player sees, and the card of the truth comes after.
    const heard = { key: "statement:1", venue: "p_teahouse", claim: null, basis: [], accepted: 7, audience: [] };
    play.flows.state.stated = { key: "statement:1", last: null, heard };
    feedFrame(client, time(4, 18), [flag("truth_told")]);
    expect(play.flows.state.stated).not.toBeNull();
    expect(play.guide.showUp).toBe(false);
    expect(play.guide.cardUp).toBe(false);
    play.flows.dismissStated();
    expect(play.flows.state.stated).toBeNull();
    expect(play.guide.shows.up).toBe("truth");
    expect(play.guide.cardUp).toBe(true);
    play.guide.closeShow();
    // The summary of the night comes at dusk, and a job done in that frame waits for it.
    play.flows.state.night = { key: "night:4", tick: 1, night: { day: 4, changed: { kind: "quiet", text: { zh: "今天没有大事。", en: "Nothing much happened." } }, blocked: null, step: null } };
    feedFrame(client, time(4, 21), [flag("reconciled")]);
    expect(play.guide.showUp).toBe(false);
    play.flows.dismissNight();
    expect(play.guide.shows.up).toBe("peace");
  });

  test("waits behind the recap of the morning and behind the elder, and comes when they are put away", () => {
    const { client, play } = setup();
    begin(client);
    const lines = [{ text: { zh: "李大答应的四根竹料，已经送到石桥。", en: "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge." }, events: [16] }];
    feedFrame(client, frameAt(3, 7, 0, { recap: lines }), [{ kind: "recap", tick: 1, lines: 1 }, flag("bridge_fixed")]);
    expect(play.flows.state.recap).not.toBeNull();
    expect(play.guide.showUp).toBe(false);
    play.flows.dismissRecap();
    expect(play.guide.shows.up).toBe("bridge");
    play.guide.closeShow();
    // The elder is up: the card of a second job waits for him.
    play.guide.askElder();
    expect(play.guide.elder.open).toBe(true);
    feedFrame(client, time(3, 12), [flag("truth_told")]);
    expect(play.guide.showUp).toBe(false);
    play.guide.closeElder();
    expect(play.guide.shows.up).toBe("truth");
  });

  test("none once the ending is there, and none on a page without the help or on the page of a recording", () => {
    const { client, play } = setup();
    begin(client);
    const ending: CoreEvent = { kind: "ending", tick: 9, ending: "ending_full", label: { zh: "圆满", en: "Fulfilled" }, hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100, reveal: null };
    feedFrame(client, time(5, 21), [flag("reconciled"), ending]);
    expect(play.guide.showUp).toBe(false);
    const bare = setup(false);
    begin(bare.client);
    feedFrame(bare.client, time(2, 11), [flag("bridge_fixed")]);
    expect(bare.play.guide.showUp).toBe(false);
    expect(bare.client.holds).toEqual([]);
    resetTicks();
    const recording = new FakeClient();
    const replayed = new Play(recording.host, true);
    replayed.guide.enabled = true;
    feedFrame(recording, time(2, 10));
    feedFrame(recording, time(2, 11), [flag("bridge_fixed")]);
    expect(replayed.guide.showUp).toBe(false);
  });

  test("a new game tells them all again", () => {
    const { client, play } = setup();
    begin(client);
    feedFrame(client, time(2, 11), [flag("bridge_fixed")]);
    play.guide.closeShow();
    client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    expect(play.guide.showUp).toBe(false);
    expect(play.guide.glow).toBeNull();
    begin(client);
    feedFrame(client, time(2, 11), [flag("bridge_fixed")]);
    expect(play.guide.shows.up).toBe("bridge");
  });
});
