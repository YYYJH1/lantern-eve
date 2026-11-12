import { expect, test } from "@playwright/test";
import { setLang, translate } from "../../src/i18n/index.ts";
import { readEnding, readFestival } from "../../src/page/ending.ts";
import {
  type Caption,
  Director,
  type DirectorEnv,
  ease,
  ENDING_GRACE_MS,
  endingShowCount,
  eyeAt,
  lengthOf,
  MOMENT_HOLD_MS,
  MOMENT_TRAVEL_MS,
  MOMENT_ZOOM,
  momentCaption,
  momentShow,
  plan,
  readHold,
  readMoments,
  registerEndingShow,
  type Show,
  type StopAt,
  worldOfCell,
} from "../../src/page/director.ts";
import { Camera, type CameraPort, type CameraPose, type Eye } from "../../src/page/map/camera.ts";
import type { MapView } from "../../src/page/map/map-view.ts";
import { CELL, CELL_DEPTH } from "../../src/page/map/geometry.ts";
import { StageCamera } from "../../src/page/map/stage-camera.ts";
import { Play } from "../../src/page/play.ts";
import type { CoreEvent, Frame } from "../../src/shared/protocol.ts";
import { stoppedBy } from "../../src/page/world-state.ts";
import { FakeClient, frameAt, resetTicks } from "../support/fake-client.ts";

// The show controller: the script of camera stops, the pause reason of its own, the moments of the festival that hold the world until the page lets it go,
// and the show that plays before the ending page. A clock and a camera made by hand stand in for the browser and the map.

const SCENE = {
  scenario: "bridge",
  name: { zh: "澄溪镇", en: "Chengxi Town" },
  width: 56,
  height: 34,
  layers: { terrain: { rows: [], legend: [] }, buildings: [], barriers: [] },
  places: [
    { id: "p_bridge", kind: "bridge", indoor: false, rect: [24, 15, 6, 2], door: [27, 15], stands: [], cells: [], zh: "石桥", en: "Stone Bridge" },
    { id: "p_temple", kind: "temple", indoor: true, rect: [47, 17, 8, 6], door: [50, 18], stands: [], cells: [], zh: "庙", en: "Temple" },
    { id: "p_pond", kind: "water", indoor: false, rect: [1, 1, 3, 3], door: null, stands: [], cells: [], zh: "池塘", en: "Pond" },
  ],
  cast: [],
  player: { id: "player", zh: "总管", en: "Festival Manager", role: { zh: "灯会总管", en: "Manager" }, token: { zh: "总", en: "M" }, start: [27, 15], things: [] },
};

/** The clock and the timers of the page, moved by hand: `advance` runs the animation frames and the timers that fall due on the way. */
class Clock {
  now = 1000;
  private frames: Array<() => void> = [];
  private timers: Array<{ at: number; fn: () => void }> = [];
  private readonly keys = new Set<(key: string) => boolean>();
  /** Whether the player asked for less motion. */
  quiet = false;
  readonly env: DirectorEnv = {
    calm: () => this.quiet,
    now: () => this.now,
    later: (fn) => {
      this.frames.push(fn);
      return () => {
        this.frames = this.frames.filter((f) => f !== fn);
      };
    },
    after: (ms, fn) => {
      const timer = { at: this.now + ms, fn };
      this.timers.push(timer);
      return () => {
        this.timers = this.timers.filter((t) => t !== timer);
      };
    },
    keys: (fn) => {
      this.keys.add(fn);
      return () => this.keys.delete(fn);
    },
  };

  advance(ms: number, step = 16): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + step);
      const due = this.timers.filter((t) => t.at <= this.now);
      this.timers = this.timers.filter((t) => t.at > this.now);
      for (const timer of due) timer.fn();
      const frames = this.frames;
      this.frames = [];
      for (const frame of frames) frame();
    }
  }

  /** A key goes to the listeners that are on, as the page's would: the first that takes it ends it. */
  press(key: string): boolean {
    for (const listener of [...this.keys]) if (listener(key)) return true;
    return false;
  }

  get listening(): number {
    return this.keys.size;
  }
}

/** A map by hand: it keeps where the camera was put, and what it was asked. */
class Stage implements CameraPort {
  isReady = true;
  at: CameraPose = { x: 120, y: 80, zoom: 0.9, moved: true };
  looking: Eye = { x: 600, y: 300, zoom: 1.3 };
  readonly looks: Eye[] = [];
  readonly restored: CameraPose[] = [];
  ready(): boolean {
    return this.isReady;
  }
  pose(): CameraPose {
    return { ...this.at };
  }
  restore(pose: CameraPose): void {
    this.restored.push(pose);
    this.at = pose;
  }
  eye(): Eye {
    return { ...this.looking };
  }
  town(): Eye {
    return { x: 880, y: 430, zoom: 1 };
  }
  look(eye: Eye): void {
    this.looks.push(eye);
    this.looking = eye;
  }
}

interface Rig {
  client: FakeClient;
  clock: Clock;
  stage: Stage;
  play: Play;
  director: Director;
}

function rig(options: { readOnly?: boolean; map?: boolean; scene?: boolean; enabled?: boolean } = {}): Rig {
  resetTicks();
  setLang("en");
  const client = new FakeClient();
  if (options.scene !== false) client.state.scene = SCENE as unknown as Record<string, unknown>;
  const clock = new Clock();
  const play = new Play(client.host, options.readOnly === true, clock.env);
  play.director.enabled = options.enabled !== false;
  const stage = new Stage();
  if (options.map !== false) play.director.port = stage;
  return { client, clock, stage, play, director: play.director };
}

let tickNo = 0;
/** The host sends a frame of a game with the player on the map, and these keys and events. */
function frame(r: Rig, extras: Record<string, unknown> = {}, events: CoreEvent[] = []): void {
  tickNo++;
  r.client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameAt(1, 8, 0, extras), events, clock: { paused: false, rate: [1, 1] } });
}

const echo = (over: Record<string, unknown> = {}) => ({ kind: "echo", tick: 812, place: "p_zhou_house", x: 44, y: 6, prop: "pr_boat_scratched", from: "zhou_zhanggui", ...over });
const together = { kind: "together_work", tick: 4490, place: "p_bridge", x: 27, y: 15, round: 3 };
const banks = { kind: "both_banks", tick: 900, place: "p_bridge", x: 27, y: 15 };

/** Only the holds the controller made. */
const showHolds = (r: Rig): string[] => r.client.holds.filter((hold) => hold.endsWith(":show"));
const releases = (r: Rig): Array<Record<string, unknown>> => r.client.sent.filter((body) => body.type === "moment" && body.op === "release");

test.describe("the script of stops", () => {
  const stops = [
    { at: { cell: [10, 4] as const }, zoom: 2, travel: 1000, hold: 500 },
    { at: { place: "p_bridge" }, zoom: 4, travel: 500, hold: 500 },
    { at: { place: "p_nowhere" }, zoom: 3, travel: 100, hold: 100 },
    { at: "town" as const, zoom: 1, travel: 0, hold: 200 },
  ];
  const where = (at: StopAt, zoom: number): Eye | null => {
    if (at === "town") return { x: 880, y: 430, zoom };
    if ("cell" in at) return { ...worldOfCell(at.cell[0], at.cell[1]), zoom };
    return at.place === "p_bridge" ? { ...worldOfCell(27, 15), zoom } : null;
  };

  test("is worked out stop by stop: a stop the town cannot place is left out, and each begins when the one before it is over", () => {
    const legs = plan(stops, where);
    expect(legs.map((leg) => [leg.start, leg.travel, leg.hold])).toEqual([
      [0, 1000, 500],
      [1500, 500, 500],
      [2500, 0, 200],
    ]);
    expect(lengthOf(legs)).toBe(2700);
    expect(lengthOf([])).toBe(0);
    expect(legs[0]?.to).toEqual({ x: 10.5 * CELL, y: 4.5 * CELL_DEPTH, zoom: 2 });
  });

  test("moves the eye from where it was to the first stop with a pace that is slow at both ends, and stays there for the hold", () => {
    const legs = plan(stops, where);
    const from: Eye = { x: 0, y: 0, zoom: 1 };
    expect(eyeAt(from, legs, 0)).toMatchObject({ eye: from, stop: 0, over: false });
    const half = eyeAt(from, legs, 500).eye;
    const target = legs[0]?.to as Eye;
    expect(half.x).toBeCloseTo(target.x / 2, 6);
    expect(half.y).toBeCloseTo(target.y / 2, 6);
    // the zoom moves in its logarithm: halfway between 1 and 2 is the square root of 2
    expect(half.zoom).toBeCloseTo(Math.SQRT2, 6);
    const early = eyeAt(from, legs, 100).eye;
    const late = eyeAt(from, legs, 900).eye;
    expect(early.x / target.x).toBeLessThan(0.1);
    expect(late.x / target.x).toBeGreaterThan(0.9);
    expect(eyeAt(from, legs, 1000)).toMatchObject({ eye: target, stop: 0, over: false });
    expect(eyeAt(from, legs, 1499)).toMatchObject({ eye: target, stop: 0 });
  });

  test("goes from stop to stop, tells which one is on, and is over after the last hold", () => {
    const legs = plan(stops, where);
    const from: Eye = { x: 0, y: 0, zoom: 1 };
    expect(eyeAt(from, legs, 1600).stop).toBe(1);
    expect(eyeAt(from, legs, 2100)).toMatchObject({ eye: legs[1]?.to, stop: 1, over: false });
    // a stop with no travel is there at once
    expect(eyeAt(from, legs, 2500)).toMatchObject({ eye: legs[2]?.to, stop: 2, over: false });
    expect(eyeAt(from, legs, 2699).over).toBe(false);
    expect(eyeAt(from, legs, 2700)).toMatchObject({ eye: legs[2]?.to, stop: 2, over: true });
    expect(eyeAt(from, [], 5)).toMatchObject({ eye: from, over: true });
  });

  test("eases from 0 to 1, slowly at the ends and as far in the first half as it is short of the end in the second", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 12);
    for (let i = 1; i <= 20; i++) expect(ease(i / 20)).toBeGreaterThan(ease((i - 1) / 20));
  });
});

test.describe("the moments of a frame", () => {
  test("are read as the core lists them, with the fields each kind has, and null where the frame has no such key", () => {
    expect(readMoments(undefined)).toBeNull();
    expect(readMoments(null)).toBeNull();
    expect(readMoments({})).toBeNull();
    expect(readMoments([])).toEqual([]);
    expect(readMoments([echo(), together, banks])).toEqual([
      { kind: "echo", tick: 812, place: "p_zhou_house", x: 44, y: 6, prop: "pr_boat_scratched", from: "zhou_zhanggui", round: null },
      { kind: "together_work", tick: 4490, place: "p_bridge", x: 27, y: 15, prop: null, from: null, round: 3 },
      { kind: "both_banks", tick: 900, place: "p_bridge", x: 27, y: 15, prop: null, from: null, round: null },
    ]);
  });

  test("keep no count of hands: a `hops` the core might still send is not read", () => {
    const [moment] = readMoments([echo({ hops: 3 })]) ?? [];
    expect(moment).toBeDefined();
    expect(Object.keys(moment ?? {}).sort()).toEqual(["from", "kind", "place", "prop", "round", "tick", "x", "y"]);
  });

  test("leave out what the page cannot place: a kind it does not know, a row with no cell, a row that is not one", () => {
    expect(readMoments([{ kind: "parade", x: 1, y: 2 }, { kind: "echo", x: "1", y: 2 }, { kind: "echo", x: 1 }, "echo", 3, null, banks])).toEqual([
      { kind: "both_banks", tick: 900, place: "p_bridge", x: 27, y: 15, prop: null, from: null, round: null },
    ]);
  });

  test("are held in the order the core lists them, and a hold is a list of known kinds", () => {
    expect(readHold(undefined)).toEqual([]);
    expect(readHold("echo")).toEqual([]);
    expect(readHold(["both_banks", "echo", "dance", 4, null])).toEqual(["both_banks", "echo"]);
  });

  test("have a show of about three seconds that takes the camera to the cell where they happened, with their words", () => {
    expect(MOMENT_TRAVEL_MS + MOMENT_HOLD_MS).toBe(3000);
    for (const kind of ["echo", "together_work", "both_banks"] as const) {
      const moment = readMoments([{ kind, tick: 1, place: "p_bridge", x: 27, y: 15 }])?.[0];
      if (moment === undefined) throw new Error("no moment");
      const show = momentShow(moment);
      expect(show).toMatchObject({ id: kind, skippable: false });
      // an echo that does not know who brought it back says only that it came back
      const key = kind === "echo" ? "moment.echoPlain" : `moment.${kind}`;
      expect(show.stops).toEqual([{ at: { cell: [27, 15] }, zoom: MOMENT_ZOOM[kind], travel: MOMENT_TRAVEL_MS, hold: MOMENT_HOLD_MS, caption: { key } }]);
      expect(momentCaption(kind)).toBe(`moment.${kind}`);
    }
    expect(MOMENT_ZOOM.both_banks).toBeLessThan(MOMENT_ZOOM.echo);
  });

  test("have an echo that names who brought the story back, in the language of the page, and never a count of hands", () => {
    const [moment] = readMoments([echo()]) ?? [];
    if (moment === undefined) throw new Error("no moment");
    const names: Record<string, { zh: string; en: string }> = { zhou_zhanggui: { zh: "周掌柜", en: "Shopkeeper Zhou" } };
    const show = momentShow(moment, (id) => names[id] ?? null);
    const caption = show.stops[0]?.caption;
    expect(caption).toEqual({ key: "moment.echo", names: { from: names.zhou_zhanggui } });
    expect(translate("zh", "moment.echo", { from: "周掌柜" })).not.toMatch(/手/);
    expect(translate("en", "moment.echo", { from: "Shopkeeper Zhou" })).not.toMatch(/hand/);
    // a person the page has no name for is named by the id it has, so that no brace is left in the words
    expect(momentShow(moment).stops[0]?.caption).toEqual({ key: "moment.echo", names: { from: { zh: "zhou_zhanggui", en: "zhou_zhanggui" } } });
  });

  test("say what they say in both languages", () => {
    expect(translate("zh", "moment.echo", { from: "周掌柜" })).toBe("你说过的话，又从周掌柜那里传回来了。");
    expect(translate("en", "moment.echo", { from: "Zhou the shopkeeper" })).toBe("What you said came back to you from Zhou the shopkeeper.");
    expect(translate("zh", "moment.echoPlain")).toBe("你说过的话，又传回来了。");
    expect(translate("zh", "moment.together_work")).toBe("李家和周家的人，第一次一起搬料。");
    expect(translate("zh", "moment.both_banks")).toBe("两岸都挂起了灯。");
    expect(translate("en", "moment.both_banks")).toBe("Lanterns hang on both banks.");
    expect(translate("zh", "director.skip")).toBe("跳过");
    expect(translate("en", "director.skip")).toBe("Skip");
  });
});

test.describe("a moment of the festival", () => {
  test("is shown when a frame carries one the page has not seen: the camera goes there, the words are on, and the world is held with a reason of its own", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    expect(r.director.current).toBeNull();
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    expect(showHolds(r)).toEqual(["pause:show"]);
    expect(r.director.current).toMatchObject({ show: { id: "echo" }, stop: 0, caption: { key: "moment.echo" } });
    expect(r.director.active && r.director.busy).toBe(true);
    // the camera starts from where it stood and is on its way to the cell
    r.clock.advance(1);
    expect(r.stage.looks.length).toBeGreaterThan(0);
    r.clock.advance(MOMENT_TRAVEL_MS);
    expect(r.stage.looking).toEqual({ ...worldOfCell(44, 6), zoom: MOMENT_ZOOM.echo });
    // nothing is let go before the three seconds are over
    r.clock.advance(MOMENT_HOLD_MS - 100);
    expect(r.director.current).not.toBeNull();
    expect(releases(r)).toEqual([]);
    expect(showHolds(r)).toEqual(["pause:show"]);
  });

  test("is over after about three seconds: the camera is given back as it was, the reason is let go, and the core is told to go on", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    const before = r.stage.pose();
    frame(r, { moments: [together], moment_hold: ["together_work"] });
    r.clock.advance(MOMENT_TRAVEL_MS + MOMENT_HOLD_MS + 50);
    expect(r.director.current).toBeNull();
    expect(r.director.busy).toBe(false);
    expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    expect(releases(r)).toHaveLength(1);
    expect(releases(r)[0]).toMatchObject({ type: "moment", op: "release", kind: "together_work" });
    expect(r.stage.restored).toEqual([before]);
    expect(r.clock.listening).toBe(0);
  });

  test("goes to its stop at once for a player who asked the system for less motion, and stays there as long", () => {
    const r = rig();
    r.clock.quiet = true;
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    expect(r.stage.looks).toEqual([{ ...worldOfCell(44, 6), zoom: MOMENT_ZOOM.echo }]);
    r.clock.advance(MOMENT_HOLD_MS - 100);
    expect(r.director.current).not.toBeNull();
    r.clock.advance(200);
    expect(r.director.current).toBeNull();
    expect(releases(r).map((body) => body.kind)).toEqual(["echo"]);
  });

  test("ends at a click and at Esc, as soon as they come, and lets the core go on", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { moments: [banks], moment_hold: ["both_banks"] });
    r.clock.advance(400);
    r.director.skip();
    expect(r.director.current).toBeNull();
    expect(releases(r).map((body) => body.kind)).toEqual(["both_banks"]);
    expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    // Esc is taken while a show is on, and is left to the page when none is
    expect(r.clock.press("Escape")).toBe(false);
    frame(r, { moments: [banks, echo()], moment_hold: ["echo"] });
    r.clock.advance(100);
    expect(r.clock.press("Enter")).toBe(false);
    expect(r.director.current).not.toBeNull();
    expect(r.clock.press("Escape")).toBe(true);
    expect(r.director.current).toBeNull();
    expect(releases(r).map((body) => body.kind)).toEqual(["both_banks", "echo"]);
  });

  test("never touches the player's pause: a world the player paused is still paused when the show is over", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    r.client.pause();
    r.client.holds.length = 0;
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    r.clock.advance(4000);
    expect(r.client.holds).toEqual(["pause:show", "resume:show"]);
    expect(stoppedBy({ paused: true, stats: { reasons: ["user", "show"] } })).toBe("player");
    expect(stoppedBy({ paused: true, stats: { reasons: ["show"] } })).toBe("page");
    expect(stoppedBy({ paused: true, stats: { reasons: [] } })).toBe("core");
  });

  test("is not shown again for what the first frame of the game has: a new game, a game that was loaded, a recording taken to a position", () => {
    const r = rig();
    frame(r, { moments: [banks, together], moment_hold: [] });
    expect(r.director.current).toBeNull();
    expect(showHolds(r)).toEqual([]);
    expect(releases(r)).toEqual([]);
    // and the same list again is no news either
    frame(r, { moments: [banks, together], moment_hold: [] });
    expect(r.director.current).toBeNull();
    // a new game, a load or a seek is a reset, and the first frame after it is the first again
    r.client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    frame(r, { moments: [banks], moment_hold: [] });
    expect(r.director.current).toBeNull();
    frame(r, { moments: [banks, echo()], moment_hold: ["echo"] });
    expect(r.director.current).toMatchObject({ show: { id: "echo" } });
  });

  test("a world the core holds for a moment when the page begins to look is let go at once, without a show", () => {
    const r = rig();
    frame(r, { moments: [banks, echo()], moment_hold: ["echo"] });
    expect(r.director.current).toBeNull();
    expect(showHolds(r)).toEqual([]);
    expect(releases(r).map((body) => body.kind)).toEqual(["echo"]);
  });

  test("two moments of one frame play one after the other under one hold, and each is let go when its own show is over", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { moments: [together, banks], moment_hold: ["together_work", "both_banks"] });
    expect(r.director.current?.show.id).toBe("together_work");
    r.clock.advance(MOMENT_TRAVEL_MS + MOMENT_HOLD_MS + 50);
    expect(r.director.current?.show.id).toBe("both_banks");
    expect(releases(r).map((body) => body.kind)).toEqual(["together_work"]);
    expect(showHolds(r)).toEqual(["pause:show"]);
    r.clock.advance(MOMENT_TRAVEL_MS + MOMENT_HOLD_MS + 50);
    expect(r.director.current).toBeNull();
    expect(releases(r).map((body) => body.kind)).toEqual(["together_work", "both_banks"]);
    expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    expect(r.stage.restored).toHaveLength(1);
  });

  test("one that comes while another is on waits for it", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { moments: [banks], moment_hold: ["both_banks"] });
    r.clock.advance(1000);
    frame(r, { moments: [banks, echo()], moment_hold: ["both_banks", "echo"] });
    expect(r.director.current?.show.id).toBe("both_banks");
    r.clock.advance(2100);
    expect(r.director.current?.show.id).toBe("echo");
  });

  test("is let go of without a show where there is no map to play it on, and the world is not held for one", () => {
    const mapless = rig({ map: false });
    const dark = rig();
    dark.stage.isReady = false;
    for (const r of [mapless, dark]) {
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { moments: [echo()], moment_hold: ["echo"] });
      expect(r.director.current).toBeNull();
      expect(showHolds(r)).toEqual([]);
      expect(releases(r).map((body) => body.kind)).toEqual(["echo"]);
    }
  });

  test("ends when a new game begins, with no release for a game that is gone, the camera back and the reason let go", () => {
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    const before = r.stage.pose();
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    r.clock.advance(500);
    r.client.feed({ type: "reset", seed: 2, scenario: "bridge" });
    expect(r.director.current).toBeNull();
    expect(releases(r)).toEqual([]);
    expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    expect(r.stage.restored).toEqual([before]);
    r.clock.advance(5000);
    expect(releases(r)).toEqual([]);
  });

  test("on the page of a recording plays all the same, and sends nothing: the release is in the recording", () => {
    const r = rig({ readOnly: true });
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    expect(showHolds(r)).toEqual(["pause:show"]);
    r.clock.advance(4000);
    expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    expect(r.client.sent).toEqual([]);
  });
});

test.describe("a page that is not enabled", () => {
  test("says nothing, shows nothing, and does not hold the ending page back", () => {
    const unregister = registerEndingShow(() => ({ id: "festival", skippable: true, stops: [{ at: "town", zoom: 1, travel: 100, hold: 100 }] }));
    try {
      const r = rig({ enabled: false });
      expect(r.director.enabled).toBe(false);
      frame(r);
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { moments: [echo()], moment_hold: [] });
      expect(r.director.current).toBeNull();
      expect(r.client.sent).toEqual([]);
      expect(r.client.holds).toEqual([]);
      const ending = { kind: "ending", tick: 6000, ending: "ending_full", festival: { route: "bridge", together: true, lighter: [], bearers: {}, named: [] } };
      frame(r, { ending }, [ending as unknown as CoreEvent]);
      expect(r.play.state.endingOpen).toBe(true);
      expect(r.director.busy).toBe(false);
    } finally {
      unregister();
    }
  });

  test("lets go of a world that the core holds for a moment, once, which only a game that another page watched can have", () => {
    const r = rig({ enabled: false });
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    expect(releases(r).map((body) => body.kind)).toEqual(["echo"]);
    expect(showHolds(r)).toEqual([]);
    const recording = rig({ enabled: false, readOnly: true });
    frame(recording, { moments: [echo()], moment_hold: ["echo"] });
    expect(recording.client.sent).toEqual([]);
  });
});

test.describe("what the core says of the page's own actions", () => {
  test("is not said to the player: a release the core turns down, or a watch it has already, makes no note", () => {
    const r = rig();
    frame(r);
    frame(r, { moments: [], moment_hold: [] });
    const watch = r.client.sent[0];
    r.client.feed({ type: "frame", tick: 99, advanced: true, frame: frameAt(1, 8, 0, { moments: [], moment_hold: [] }), events: [{ kind: "action_ack", tick: 99, action_id: String(watch?.action_id), result: "rejected", reason: "watching" }], clock: { paused: false, rate: [1, 1] } });
    expect(r.play.state.notes).toEqual([]);
    frame(r, { moments: [echo()], moment_hold: ["echo"] });
    r.director.skip();
    const release = releases(r)[0];
    r.client.feed({ type: "frame", tick: 100, advanced: true, frame: frameAt(1, 8, 0, { moments: [echo()], moment_hold: [] }), events: [{ kind: "action_ack", tick: 100, action_id: String(release?.action_id), result: "rejected", reason: "not_held" }], clock: { paused: false, rate: [1, 1] } });
    expect(r.play.state.notes).toEqual([]);
  });
});

test.describe("watching", () => {
  test("is said once, in the first frame of a game whose frames have no moments, and not again", () => {
    const r = rig();
    frame(r);
    expect(r.client.sent).toEqual([{ type: "moment", op: "watch", action_id: "a1" }]);
    frame(r);
    frame(r);
    expect(r.client.sent).toHaveLength(1);
    // the core answers with the key, and the page has nothing more to say
    frame(r, { moments: [], moment_hold: [] });
    expect(r.client.sent).toHaveLength(1);
    // another game is said again
    r.client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    frame(r);
    expect(r.client.sent.filter((body) => body.op === "watch")).toHaveLength(2);
  });

  test("is not said for a game that has the key, for the page of a recording, or for a world with no manager", () => {
    const watched = rig();
    frame(watched, { moments: [], moment_hold: [] });
    expect(watched.client.sent).toEqual([]);
    const recording = rig({ readOnly: true });
    frame(recording);
    expect(recording.client.sent).toEqual([]);
    const demo = rig();
    tickNo++;
    demo.client.feed({ type: "frame", tick: tickNo, advanced: true, frame: { npcs: [], time: { day: 1, hour: 6, minute: 0, phase: "day" } } as unknown as Frame, events: [], clock: { paused: false, rate: [1, 1] } });
    expect(demo.client.sent).toEqual([]);
  });
});

test.describe("the show before the ending page", () => {
  /** Long enough for the controller, which looks again at the map every so often while the ending waits for it, to have looked. */
  const WAKE_MS = 300;
  const FESTIVAL = { route: "bridge", together: true, lighter: ["li_laotai", "zhou_zhanggui"], bearers: { p_li_house: 60, p_zhou_house: 60 }, named: [{ npc: "li_laotai", place: "p_li_house" }] };
  const ENDING = { kind: "ending", tick: 6000, ending: "ending_full", label: { zh: "圆满", en: "A perfect night" }, hidden: [], inputs: {}, passage: "mended", promised: 5, turnout: 900, festival: FESTIVAL, reveal: { truth: null, chains: [] }, epilogue: [] };

  /** A show of a second and a half, for the tests. */
  function night(log: string[]): Show {
    return {
      id: "festival",
      skippable: true,
      stops: [
        { at: { place: "p_bridge" }, zoom: 3, travel: 500, hold: 500, caption: { key: "moment.both_banks" } as Caption },
        { at: "town", zoom: 1, travel: 500, hold: 0 },
      ],
      frame: (elapsed, stop) => {
        if (log.length === 0 || log[log.length - 1] !== `stop ${stop}`) log.push(`stop ${stop}`);
        void elapsed;
      },
      end: (reason) => log.push(`end ${reason}`),
    };
  }

  test("is left out when no show is registered: the ending page opens at once, as it always did", () => {
    expect(endingShowCount()).toBe(0);
    const r = rig();
    frame(r, { moments: [], moment_hold: [] });
    frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
    expect(r.play.state.endingOpen).toBe(true);
    expect(r.director.busy).toBe(false);
    expect(showHolds(r)).toEqual([]);
  });

  test("plays before the ending page, which waits, and opens it when the show is over", () => {
    const log: string[] = [];
    const unregister = registerEndingShow((context) => {
      log.push(`made ${context.festival.route} ${context.ending.id} ${Object.keys(context.festival.bearers).length}`);
      return night(log);
    });
    try {
      const r = rig();
      frame(r, { moments: [], moment_hold: [] });
      const before = r.stage.pose();
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(r.play.state.ending?.festival?.route).toBe("bridge");
      expect(r.play.state.endingOpen).toBe(false);
      expect(r.director.current?.show.id).toBe("festival");
      expect(r.director.busy).toBe(true);
      expect(showHolds(r)).toEqual(["pause:show"]);
      expect(r.client.holds).toContain("pause:user"); // the page pauses the world at the ending, as it did
      r.clock.advance(700);
      expect(r.play.state.endingOpen).toBe(false);
      expect(r.director.current).toMatchObject({ stop: 0, caption: { key: "moment.both_banks" } });
      r.clock.advance(400);
      expect(r.director.current?.stop).toBe(1);
      r.clock.advance(600);
      expect(r.director.current).toBeNull();
      expect(r.play.state.endingOpen).toBe(true);
      expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
      expect(r.stage.restored).toEqual([before]);
      expect(log).toEqual(["made bridge ending_full 2", "stop 0", "stop 1", "end done"]);
      expect(releases(r)).toEqual([]);
    } finally {
      unregister();
    }
  });

  test("is skipped by the button in the corner and by Esc, and the ending page opens", () => {
    const log: string[] = [];
    const unregister = registerEndingShow(() => night(log));
    try {
      for (const how of ["button", "escape"]) {
        const r = rig();
        frame(r, { moments: [], moment_hold: [] });
        frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
        r.clock.advance(300);
        expect(r.play.state.endingOpen).toBe(false);
        if (how === "button") r.director.skip();
        else expect(r.clock.press("Escape")).toBe(true);
        expect(r.director.current).toBeNull();
        expect(r.play.state.endingOpen).toBe(true);
        expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
        expect(r.stage.restored).toHaveLength(1);
        r.clock.advance(3000);
        expect(r.play.state.endingOpen).toBe(true);
      }
      expect(log.filter((line) => line.startsWith("end"))).toEqual(["end skip", "end skip"]);
    } finally {
      unregister();
    }
  });

  test("is played for a game that was loaded at its end and for a recording taken to its end: the ending comes from the host, before the frame", () => {
    const unregister = registerEndingShow(() => night([]));
    try {
      const r = rig();
      r.client.feed({ type: "reset", seed: 1, scenario: "bridge" });
      r.client.feed({ type: "ending", ending: ENDING });
      expect(r.play.state.endingOpen).toBe(false);
      // the show waits for the first frame of the game, which it draws on
      expect(r.director.current).toBeNull();
      frame(r, { moments: [banks], moment_hold: [], ending: { ...ENDING, reveal: undefined, epilogue: undefined } });
      expect(r.director.current?.show.id).toBe("festival");
      // the moments that frame has are not shown
      r.clock.advance(5000);
      expect(r.play.state.endingOpen).toBe(true);
      expect(releases(r)).toEqual([]);
      // the whole ending that follows the compact one is not a second show
      r.client.feed({ type: "ending", ending: ENDING });
      frame(r, { moments: [banks], moment_hold: [] });
      expect(r.director.current).toBeNull();
    } finally {
      unregister();
    }
  });

  test("is played once for a game, and again for the next one", () => {
    let made = 0;
    const unregister = registerEndingShow(() => {
      made++;
      return night([]);
    });
    try {
      const r = rig();
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      r.clock.advance(5000);
      frame(r, { ending: { ...ENDING, reveal: undefined } });
      r.clock.advance(5000);
      expect(made).toBe(1);
      r.client.feed({ type: "reset", seed: 3, scenario: "bridge" });
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(made).toBe(2);
    } finally {
      unregister();
    }
  });

  test("opens the ending page at once where it cannot be staged: no festival in the ending, no map, no show for it, or a map that never comes up", () => {
    const unregister = registerEndingShow((context) => (context.ending.turnout === 1 ? null : night([])));
    try {
      const plain = rig();
      frame(plain, { moments: [], moment_hold: [] });
      frame(plain, { ending: { ...ENDING, festival: undefined } }, [{ ...ENDING, festival: undefined } as unknown as CoreEvent]);
      expect(plain.play.state.endingOpen).toBe(true);
      const mapless = rig({ map: false });
      frame(mapless, { moments: [], moment_hold: [] });
      frame(mapless, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(mapless.play.state.endingOpen).toBe(true);
      expect(showHolds(mapless)).toEqual([]);
      const none = rig();
      frame(none, { moments: [], moment_hold: [] });
      frame(none, { ending: { ...ENDING, turnout: 1 } }, [{ ...ENDING, turnout: 1 } as unknown as CoreEvent]);
      expect(none.play.state.endingOpen).toBe(true);
      expect(none.director.busy).toBe(false);
      // a map that is there and never has the town on it: the page waits a little and opens the ending
      const late = rig();
      late.stage.isReady = false;
      frame(late, { moments: [], moment_hold: [] });
      frame(late, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(late.play.state.endingOpen).toBe(false);
      late.clock.advance(ENDING_GRACE_MS - 100);
      expect(late.play.state.endingOpen).toBe(false);
      late.clock.advance(200);
      expect(late.play.state.endingOpen).toBe(true);
      expect(late.director.busy).toBe(false);
    } finally {
      unregister();
    }
  });

  test("starts when the map comes up after all, without a frame of the game to wake it, and a new game before then drops it", () => {
    const unregister = registerEndingShow(() => night([]));
    try {
      const r = rig();
      r.stage.isReady = false;
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(r.director.current).toBeNull();
      // The map has the town on it a moment later, and no frame of the game follows (a recording that is at its end sends none).
      r.clock.advance(ENDING_GRACE_MS - 1000);
      expect(r.director.current).toBeNull();
      r.stage.isReady = true;
      r.clock.advance(WAKE_MS);
      expect(r.director.current?.show.id).toBe("festival");
      expect(r.play.state.endingOpen).toBe(false);
      r.client.feed({ type: "reset", seed: 4, scenario: "bridge" });
      expect(r.director.current).toBeNull();
      expect(r.play.state.endingOpen).toBe(false);
      expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    } finally {
      unregister();
    }
  });

  test("waits for a map that is on its way when the ending comes first, and starts when it comes up with the town on it", () => {
    const unregister = registerEndingShow(() => night([]));
    try {
      const r = rig({ map: false });
      r.director.expectMap();
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(r.play.state.endingOpen).toBe(false);
      expect(r.director.busy).toBe(true);
      r.clock.advance(1500);
      expect(r.director.current).toBeNull();
      // The map is there, but the town is not on it yet.
      r.stage.isReady = false;
      r.director.attach({ stageCamera: () => r.stage } as unknown as MapView);
      expect(r.director.current).toBeNull();
      expect(r.play.state.endingOpen).toBe(false);
      r.stage.isReady = true;
      r.clock.advance(WAKE_MS);
      expect(r.director.current?.show.id).toBe("festival");
      r.clock.advance(5000);
      expect(r.director.current).toBeNull();
      expect(r.play.state.endingOpen).toBe(true);
      expect(showHolds(r)).toEqual(["pause:show", "resume:show"]);
    } finally {
      unregister();
    }
  });

  test("starts at once when the map was there before the ending, as it did", () => {
    const unregister = registerEndingShow(() => night([]));
    try {
      const r = rig({ map: false });
      r.director.expectMap();
      r.director.attach({ stageCamera: () => r.stage } as unknown as MapView);
      frame(r, { moments: [], moment_hold: [] });
      frame(r, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(r.director.current?.show.id).toBe("festival");
    } finally {
      unregister();
    }
  });

  test("opens the ending page at once when the map that was on its way cannot come up, and when it does not come in time", () => {
    const unregister = registerEndingShow(() => night([]));
    try {
      const failed = rig({ map: false });
      failed.director.expectMap();
      frame(failed, { moments: [], moment_hold: [] });
      frame(failed, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(failed.play.state.endingOpen).toBe(false);
      failed.director.mapFailed();
      expect(failed.play.state.endingOpen).toBe(true);
      expect(failed.director.busy).toBe(false);
      // A map that fails before the ending comes leaves the ending page to open at once, as a page with no map does.
      const before = rig({ map: false });
      before.director.expectMap();
      before.director.mapFailed();
      frame(before, { moments: [], moment_hold: [] });
      frame(before, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      expect(before.play.state.endingOpen).toBe(true);
      // And one that is late is given the time that a map that is there but has no town gets, and no more.
      const late = rig({ map: false });
      late.director.expectMap();
      frame(late, { moments: [], moment_hold: [] });
      frame(late, { ending: ENDING }, [ENDING as unknown as CoreEvent]);
      late.clock.advance(ENDING_GRACE_MS - 100);
      expect(late.play.state.endingOpen).toBe(false);
      late.clock.advance(200);
      expect(late.play.state.endingOpen).toBe(true);
      late.director.attach({ stageCamera: () => late.stage } as unknown as MapView);
      late.clock.advance(1000);
      expect(late.director.current).toBeNull();
      expect(late.play.state.endingOpen).toBe(true);
    } finally {
      unregister();
    }
  });

  test("reads the festival of an ending, and nothing from what it cannot stage", () => {
    expect(readFestival(FESTIVAL)).toEqual(FESTIVAL);
    expect(readEnding(ENDING).festival).toEqual(FESTIVAL);
    expect(readEnding({ ...ENDING, festival: undefined }).festival).toBeNull();
    expect(readFestival({ ...FESTIVAL, route: "river" })).toBeNull();
    expect(readFestival("bridge")).toBeNull();
    expect(readFestival({ route: "none" })).toEqual({ route: "none", together: false, lighter: [], bearers: {}, named: [] });
    expect(readFestival({ ...FESTIVAL, bearers: { a: 3, b: 0, c: "x", d: 1.9 }, named: [{ npc: "a", place: "b" }, { npc: 1 }, "a"] })).toMatchObject({ bearers: { a: 3, d: 1 }, named: [{ npc: "a", place: "b" }] });
  });
});

test.describe("the camera of the map", () => {
  function camera(): Camera {
    const c = new Camera();
    c.setWorld(1792, 858);
    c.setView(1000, 600);
    return c;
  }

  test("looks at a world point at a zoom: the point is in the middle of the view, and the camera stays where it is put", () => {
    const c = camera();
    expect(c.moved).toBe(false);
    c.lookAt(1200, 400, c.fitScale * 2);
    expect(c.moved).toBe(true);
    expect(c.zoom).toBeCloseTo(c.fitScale * 2, 9);
    const middle = c.project(1200, 400);
    expect(middle.x).toBeCloseTo(500, 6);
    expect(middle.y).toBeCloseTo(300, 6);
    expect(c.centre.x).toBeCloseTo(1200, 6);
    expect(c.centre.y).toBeCloseTo(400, 6);
  });

  test("zooms no closer than it allows and no farther than it allows", () => {
    const c = camera();
    c.lookAt(900, 400, 100);
    expect(c.zoom).toBeCloseTo(Camera.MAX_ZOOM, 9);
    c.lookAt(900, 400, 0.0001);
    expect(c.zoom).toBeCloseTo(c.minZoom, 9);
  });

  test("shows the town at the middle of the world when it is fitted, and a multiple of 1 is a multiple of that", () => {
    const c = camera();
    c.fit();
    const fitted = c.pose();
    expect(c.centre.x).toBeCloseTo(c.townCentre.x, 6);
    expect(c.centre.y).toBeCloseTo(c.townCentre.y, 6);
    expect(fitted.zoom).toBeCloseTo(c.fitScale, 9);
  });

  test("is given back as it was: a camera the player had moved where it stood, one that followed the window going on to follow it", () => {
    const c = camera();
    c.panBy(40, -25);
    c.zoomAt(300, 200, 1.5);
    const mine = c.pose();
    c.lookAt(1500, 700, c.fitScale * 2.5);
    c.restore(mine);
    expect(c.pose()).toEqual(mine);
    const fitted = camera();
    const pose = fitted.pose();
    expect(pose.moved).toBe(false);
    fitted.lookAt(1500, 700, fitted.fitScale * 2.5);
    fitted.setView(1200, 700); // the window changed meanwhile
    fitted.restore(pose);
    expect(fitted.moved).toBe(false);
    expect(fitted.zoom).toBeCloseTo(fitted.fitScale, 9);
  });

  test("is the port of a show: where it looks, in multiples of the fit, and where the town is whole", () => {
    const c = camera();
    let drawn = 0;
    const port = new StageCamera({ camera: c, staged: true, redraw: () => drawn++ });
    expect(port.ready()).toBe(true);
    expect(new StageCamera({ camera: c, staged: false, redraw: () => undefined }).ready()).toBe(false);
    expect(port.town()).toEqual({ ...c.townCentre, zoom: 1 });
    expect(port.eye().zoom).toBeCloseTo(1, 9);
    port.look({ x: 1000, y: 380, zoom: 2.4 });
    expect(drawn).toBe(1);
    const eye = port.eye();
    expect(eye.x).toBeCloseTo(1000, 6);
    expect(eye.y).toBeCloseTo(380, 6);
    expect(eye.zoom).toBeCloseTo(2.4, 9);
    const home = c.pose();
    port.restore({ ...home, moved: false });
    expect(drawn).toBe(2);
    expect(c.moved).toBe(false);
  });
});

test("a cell is at the middle of itself in the world of the map", () => {
  expect(worldOfCell(0, 0)).toEqual({ x: CELL / 2, y: CELL_DEPTH / 2 });
  expect(worldOfCell(27, 15)).toEqual({ x: 27.5 * CELL, y: 15.5 * CELL_DEPTH });
});

test("a director made on its own is idle and has nothing to put away", () => {
  const r = rig();
  const alone = new Director(r.play, r.clock.env);
  expect(alone.current).toBeNull();
  expect(alone.busy).toBe(false);
  alone.skip();
  alone.reset();
  alone.detach();
  expect(r.client.holds).toEqual([]);
});
