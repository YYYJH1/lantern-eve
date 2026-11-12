import { expect, test } from "@playwright/test";
import { festival } from "../../src/page/audio/festival.ts";
import { SILENCE } from "../../src/page/audio/plan.ts";
import { SoundPrefs } from "../../src/page/audio/settings.ts";
import { REFRESH_MS, Soundscape } from "../../src/page/audio/soundscape.ts";
import { frameAt } from "../support/fake-client.ts";
import { element, FakeEngine, FakeHost, FakePage, withStorage } from "../support/sound.ts";

// The controller: nothing starts before the first press of Start or Continue, the switch and the volumes are followed, the sound goes
// quiet when the page is hidden or the world is paused, and what the game says is heard.

interface Rig {
  host: FakeHost;
  engine: FakeEngine;
  page: FakePage;
  prefs: SoundPrefs;
  sound: Soundscape;
  timers: Array<() => void>;
  clock: { now: number };
  /** Lets `ms` of the wall clock pass, with a look at the game every REFRESH_MS. */
  wait(ms: number): void;
  restore: () => void;
}

function rig(over: { on?: boolean } = {}): Rig {
  const { restore } = withStorage();
  const host = new FakeHost();
  const engine = new FakeEngine();
  const page = new FakePage();
  const prefs = new SoundPrefs({ on: over.on ?? true, ambience: 0.6, music: 0.5, effects: 0.4 });
  const timers: Array<() => void> = [];
  const clock = { now: 0 };
  const sound = new Soundscape({
    host: host.host,
    engine,
    prefs,
    page,
    clock: () => clock.now,
    listener: () => ({ x: 24.5, y: 15.5, reach: 10 }),
    every: (_ms, run) => {
      timers.push(run);
      return () => timers.splice(timers.indexOf(run), 1);
    },
  });
  const wait = (ms: number): void => {
    for (let spent = 0; spent < ms; spent += REFRESH_MS) {
      clock.now += REFRESH_MS;
      for (const run of [...timers]) run();
    }
  };
  return { host, engine, page, prefs, sound, timers, clock, wait, restore };
}

function withRig(run: (r: Rig) => void, over: { on?: boolean } = {}): void {
  const r = rig(over);
  try {
    run(r);
  } finally {
    r.sound.dispose();
    r.restore();
  }
}

test.describe("before the first press", () => {
  test("nothing starts: no engine, no timer, whatever the game sends and the viewer chooses", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.host.frame(12, 0, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.prefs.setOn(false);
      r.prefs.setOn(true);
      r.prefs.setVolume("music", 0.9);
      r.page.hide();
      r.page.show();
      r.page.dispatch("click", { target: element([".ink-act"]) });
      r.wait(2000);
      expect(r.engine.starts).toBe(0);
      expect(r.engine.started).toBe(false);
      expect(r.engine.cues).toEqual([]);
      expect(r.engine.volumeCalls).toEqual([]);
      expect(r.engine.mixes).toEqual([]);
      expect(r.timers.length).toBe(0);
    });
  });

  test("the festival's hook does nothing either, and its start is kept for the first press", () => {
    withRig((r) => {
      festival.start();
      festival.setDistance(10, -1);
      r.wait(1000);
      expect(r.engine.festival).toEqual([]);
      expect(r.engine.starts).toBe(0);
      r.sound.begin();
      expect(r.engine.starts).toBe(1);
      expect(r.engine.festival).toEqual(["start"]);
      expect(r.engine.festivalAt[0]).toEqual([10, -1]);
    });
  });

  test("the first press makes the engine once, inside the press, and a second press does not make another", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      expect(r.engine.starts).toBe(1);
      expect(r.timers.length).toBe(1);
      r.sound.begin();
      expect(r.engine.starts).toBe(1);
      expect(r.timers.length).toBe(1);
    });
  });

  test("with the sound switched off the press makes no engine, and switching on afterwards makes one", () => {
    withRig(
      (r) => {
        r.host.frame(7, 0);
        r.sound.begin();
        r.wait(1000);
        expect(r.engine.starts).toBe(0);
        r.prefs.setOn(true);
        expect(r.engine.starts).toBe(1);
        expect(r.engine.volumes?.master).toBe(1);
      },
      { on: false },
    );
  });
});

test.describe("after the press", () => {
  test("the volumes the viewer chose are the volumes of the buses, by the curve, and the ambience follows the mix of the hour", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      expect(r.engine.volumes?.master).toBe(1);
      expect(r.engine.volumes?.ambience).toBeCloseTo(0.36, 9);
      expect(r.engine.volumes?.music).toBeCloseTo(0.25, 9);
      expect(r.engine.volumes?.effects).toBeCloseTo(0.16, 9);
      const mix = r.engine.lastMix;
      expect(mix?.birds.level).toBeGreaterThan(0.9);
      expect(mix?.insects.level).toBe(0);
      // The camera is at the river and no scene is loaded, so the town has no river or market to hear yet.
      expect(mix?.river.level).toBe(0);
    });
  });

  test("a volume that is moved takes hold at once", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.prefs.setVolume("ambience", 1);
      r.prefs.setVolume("effects", 0);
      expect(r.engine.volumes).toMatchObject({ ambience: 1, effects: 0, music: 0.25 });
    });
  });

  test("the switch turned off takes the master to nothing, the context is stopped a moment later, and turned on it wakes again", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.prefs.setOn(false);
      expect(r.engine.volumes).toEqual({ master: 0, ambience: 0, music: 0, effects: 0 });
      expect(r.engine.suspends).toBe(0);
      r.wait(2200);
      expect(r.engine.suspends).toBe(1);
      r.prefs.setOn(true);
      expect(r.engine.resumes).toBe(1);
      expect(r.engine.volumes?.master).toBe(1);
      expect(r.engine.starts).toBe(1);
    });
  });

  test("a hidden page fades out and the context stops, and a page that shows again fades in", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.page.hide();
      expect(r.engine.volumes?.master).toBe(0);
      r.wait(2200);
      expect(r.engine.suspends).toBe(1);
      const calls = r.engine.volumeCalls.length;
      // While it sleeps nothing more is asked of the engine.
      r.wait(5000);
      expect(r.engine.volumeCalls.length).toBe(calls);
      r.page.show();
      expect(r.engine.resumes).toBe(1);
      expect(r.engine.volumes?.master).toBe(1);
    });
  });

  test("no cue and no click is heard while the page is hidden", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.page.hide();
      r.host.frame(8, 0, {}, [{ kind: "flag", flag: "truth_told" }]);
      r.page.dispatch("click", { target: element([".ink-act"]) });
      expect(r.engine.cues).toEqual([]);
    });
  });
});

test.describe("which session it follows", () => {
  /** Another session of the page, such as a recording, with its own host and its own ear. */
  const session = (host: FakeHost, x = 24.5) => ({ host: host.host, listener: () => ({ x, y: 15.5, reach: 10 }) });

  test("hears the frames and the events of the session it was pointed at and no longer those of the one before", () => {
    withRig((r) => {
      const recording = new FakeHost();
      r.host.frame(7, 0);
      r.sound.begin();
      expect(r.engine.lastMix?.birds.level).toBeGreaterThan(0.9);
      r.sound.follow(session(recording));
      expect(r.host.listening).toBe(0);
      expect(recording.listening).toBe(1);
      // The recording is at night, the game is at seven: the town sounds as the recording says, and what the game says is not heard.
      recording.frame(22, 0, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.host.frame(7, 5, {}, [{ kind: "flag", flag: "truth_told" }]);
      r.wait(REFRESH_MS);
      expect(r.engine.lastMix?.insects.level).toBeGreaterThan(0);
      expect(r.engine.lastMix?.birds.level).toBe(0);
      expect(r.engine.cues).toEqual(["job.bridge"]);
      // And back: the game is heard again, from its next frame on.
      r.sound.follow(session(r.host));
      expect(recording.listening).toBe(0);
      r.host.frame(7, 10);
      r.wait(REFRESH_MS);
      expect(r.engine.lastMix?.birds.level).toBeGreaterThan(0.9);
    });
  });

  test("takes the world as the session holds it: the recording that is paused has no ambience, whatever the game behind it is doing", () => {
    withRig((r) => {
      const recording = new FakeHost();
      r.host.frame(7, 0);
      r.sound.begin();
      r.sound.follow(session(recording));
      recording.frame(7, 0);
      recording.stop(["user"]);
      r.wait(REFRESH_MS);
      expect(r.engine.volumes?.ambience).toBe(0);
      recording.stop(null);
      r.wait(REFRESH_MS);
      expect(r.engine.volumes?.ambience).toBeGreaterThan(0);
    });
  });

  test("is begun by the press that opens a session and made once, and is ended when the viewer is back where the sound is not begun", () => {
    withRig((r) => {
      const recording = new FakeHost();
      r.sound.follow(session(recording));
      expect(r.engine.starts).toBe(0);
      r.sound.begin();
      expect(r.engine.starts).toBe(1);
      recording.frame(10, 0);
      r.wait(REFRESH_MS);
      expect(r.engine.volumes?.master).toBe(1);
      expect(r.timers.length).toBe(1);
      r.sound.follow(session(r.host));
      r.sound.end();
      expect(r.engine.volumes).toEqual({ master: 0, ambience: 0, music: 0, effects: 0 });
      r.host.frame(8, 0, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.page.dispatch("click", { target: element([".ink-act"]) });
      expect(r.engine.cues).toEqual([]);
      // The press of Start begins it again, with the engine that is there.
      r.sound.begin();
      expect(r.engine.starts).toBe(1);
      expect(r.timers.length).toBe(1);
      r.wait(REFRESH_MS);
      expect(r.engine.volumes?.master).toBe(1);
    });
  });

  test("takes the frame that the session has already, when it is pointed at one that is under way", () => {
    withRig((r) => {
      const recording = new FakeHost();
      recording.state.frame = frameAt(1, 22, 0, {}, "night");
      r.sound.begin();
      r.sound.follow(session(recording));
      r.wait(REFRESH_MS);
      expect(r.engine.lastMix?.birds.level).toBe(0);
      expect(r.engine.lastMix?.insects.level).toBeGreaterThan(0);
    });
  });
});

test.describe("the ambience when the world is held", () => {
  const ambience = (r: Rig): number => r.engine.volumes?.ambience ?? -1;

  test("is half in a talk, and whole again when the talk ends", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      expect(ambience(r)).toBeCloseTo(0.36, 6);
      r.host.frame(7, 5, { player: { x: 1, y: 1, activity: "talk", talk: { npc: "li_da" }, look: [] } });
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.18, 6);
      r.host.frame(7, 10);
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.36, 6);
    });
  });

  test("is half in a talk that the core holds the world for, with nobody having paused it", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.host.stop([]);
      r.host.frame(7, 5, { player: { x: 1, y: 1, activity: "talk", talk: { npc: "li_da" }, look: [] } });
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.18, 6);
    });
  });

  test("is out when the player has paused, and the layers are let go", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.host.stop(["user"]);
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBe(0);
      expect(r.engine.lastMix).toEqual(SILENCE);
      // The music and the effects are not the world's, and stay.
      expect(r.engine.volumes?.music).toBeCloseTo(0.25, 6);
      r.host.stop(null);
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.36, 6);
      expect(r.engine.lastMix?.birds.level).toBeGreaterThan(0.9);
    });
  });

  test("is a third while a sheet of the page holds the world, and is whole while the festival's show holds it", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.host.stop(["page"]);
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.36 * 0.35, 6);
      r.host.stop(["show"]);
      r.wait(REFRESH_MS);
      expect(ambience(r)).toBeCloseTo(0.36, 6);
    });
  });
});

test.describe("what the game says", () => {
  test("the paper of the morning has its bell once, and a job done its phrase once for the game", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.host.frame(7, 1, { gazette: { day: 2 } });
      r.host.frame(7, 2, { gazette: { day: 2 } });
      r.host.frame(7, 3);
      r.host.frame(7, 4, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.host.frame(7, 5, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.host.frame(7, 6, {}, [{ kind: "flag", flag: "truth_told" }, { kind: "moment" }]);
      r.host.frame(7, 7, {}, [{ kind: "delivered" }]);
      expect(r.engine.cues).toEqual(["paper", "job.bridge", "job.truth", "moment", "ui.seal"]);
    });
  });

  test("another game has its jobs to be done again", () => {
    withRig((r) => {
      r.host.frame(7, 0);
      r.sound.begin();
      r.host.frame(7, 1, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      r.host.feed({ type: "reset", seed: 1, scenario: "bridge" });
      r.host.frame(7, 0);
      r.host.frame(7, 1, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
      expect(r.engine.cues).toEqual(["job.bridge", "job.bridge"]);
    });
  });

  test("a cue before the press, or with the sound off, is not heard late", () => {
    withRig(
      (r) => {
        r.host.frame(7, 0, {}, [{ kind: "flag", flag: "bridge_fixed" }]);
        r.sound.begin();
        r.host.frame(7, 1, { gazette: { day: 2 } });
        expect(r.engine.cues).toEqual([]);
        r.prefs.setOn(true);
        r.host.frame(7, 2);
        expect(r.engine.cues).toEqual([]);
      },
      { on: false },
    );
  });

  test("a click on a word of ink, on a bookmark or on the notebook has its small sound, and a click that comes twice at once is heard once", () => {
    withRig((r) => {
      r.sound.begin();
      r.page.dispatch("click", { target: element([".ink-act"]) });
      r.page.dispatch("click", { target: element([".ink-act"]) });
      r.wait(400);
      r.page.dispatch("click", { target: element(["nav.marks button"]) });
      r.page.dispatch("click", { target: element([".btn"]) });
      r.page.dispatch("click", { target: element([".ink-act"]) });
      expect(r.engine.cues).toEqual(["ui.ink", "ui.page", "ui.ink"]);
    });
  });

  test("the town is read from the scene: with a river and a market in it the layers have a place", () => {
    withRig((r) => {
      // A town of 30 cells by 18 with a river at the camera's place and a market beside it.
      const rows = Array.from({ length: 18 }, () => Array.from({ length: 30 }, (_, x) => (x >= 24 && x <= 25 ? "~" : ".")).join(""));
      r.host.state.scene = {
        scenario: "bridge",
        width: 30,
        height: 18,
        layers: { terrain: { rows, legend: [{ char: "~", id: "river" }, { char: ".", id: "grass" }] } },
        places: [{ id: "p_market", kind: "market", rect: [20, 16, 4, 2] }],
      };
      r.host.state.sceneVersion = 1;
      r.host.frame(12, 0);
      r.sound.begin();
      const mix = r.engine.lastMix;
      expect(mix?.river.level).toBeGreaterThan(0.3);
      expect(mix?.market.level).toBeGreaterThan(0);
    });
  });
});

test.describe("the festival's hook", () => {
  test("starts the music after the press, and sets how far off it is, and stops it", () => {
    withRig((r) => {
      r.sound.begin();
      festival.start();
      expect(r.engine.festival).toEqual(["start"]);
      festival.setDistance(30, 1);
      expect(r.engine.festivalAt[r.engine.festivalAt.length - 1]).toEqual([30, 1]);
      festival.setDistance(2);
      expect(r.engine.festivalAt[r.engine.festivalAt.length - 1]).toEqual([2, 0]);
      festival.stop();
      expect(r.engine.festival).toEqual(["start", "stop"]);
    });
  });

  test("goes on while the player has paused the world, and while the page is hidden it is quiet, and starts again when it shows", () => {
    withRig((r) => {
      r.host.frame(21, 0);
      r.sound.begin();
      festival.start();
      r.host.stop(["user"]);
      r.wait(REFRESH_MS);
      expect(r.engine.volumes?.music).toBeCloseTo(0.25, 6);
      expect(r.engine.festival).toEqual(["start"]);
      r.page.hide();
      expect(r.engine.volumes?.master).toBe(0);
      r.page.show();
      expect(r.engine.volumes?.master).toBe(1);
      expect(r.engine.festival).toEqual(["start"]);
    });
  });

  test("is let go of when the soundscape is: the hook is not left pointing at it", () => {
    const r = rig();
    r.sound.begin();
    r.sound.dispose();
    festival.start();
    expect(r.engine.festival).toEqual([]);
    expect(r.engine.disposed).toBe(true);
    expect(r.host.listening).toBe(0);
    expect(r.page.count("click")).toBe(0);
    expect(r.page.count("visibilitychange")).toBe(0);
    r.restore();
  });
});

test.describe("what it lets the tests see", () => {
  test("a snapshot says what was pressed, what is heard and how much", () => {
    withRig((r) => {
      r.host.frame(23, 0);
      expect(r.sound.snapshot()).toMatchObject({ begun: false, on: true, hidden: false });
      r.sound.begin();
      r.host.frame(23, 1, {}, [{ kind: "flag", flag: "reconciled" }]);
      r.wait(REFRESH_MS);
      const snapshot = r.sound.snapshot();
      expect(snapshot).toMatchObject({ begun: true, on: true, stillness: "running", duck: 1, heard: ["peace"], input: { hour: 23, minute: 1, weather: "clear" } });
      expect(snapshot.mix.insects.level).toBe(1);
      expect(snapshot.engine.started).toBe(true);
    });
  });
});
