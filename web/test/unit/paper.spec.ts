import { expect, test } from "@playwright/test";
import type { HostClient } from "../../src/page/client.ts";
import { nightKey, paperKey } from "../../src/page/flows.ts";
import type { Frame, HostToPage } from "../../src/shared/protocol.ts";
import { Play } from "../../src/page/play.ts";
import { readGazette, readNight, readSlice } from "../../src/page/slice.ts";
import * as fake from "../support/slice.ts";

// The paper of the morning and the summary of the night, on the player's side of the page: what is read of a frame, what is kept from the one
// frame that has it, what the player puts away, what a save keeps, and which of these hold the world.

class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null };
  private readonly taps: Array<(message: HostToPage) => void> = [];
  pageNotes: (() => unknown) | null = null;
  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {}
  pause(): void {}
  newActionId(): string {
    return "n1";
  }
  player(): string {
    return "n1";
  }
  feed(message: HostToPage): void {
    for (const tap of this.taps) tap(message);
  }
}

const frameOf = (extras: Record<string, unknown>): Frame =>
  ({
    npcs: [],
    time: { day: 2, hour: 7, minute: 0, phase: "day" },
    weather: "clear",
    bubbles: [],
    dots: [],
    lanterns: [],
    hud: { verbs: ["move", "leave", "ask"] },
    player: { x: 10, y: 10, activity: "rest", talk: null, look: [], offers: {}, topics: [] },
    notebook: [],
    ending: null,
    ...extras,
  }) as unknown as Frame;

let tickNo = 0;
const step = (client: FakeClient, extras: Record<string, unknown> = {}): void => {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameOf(extras), events: [], clock: { paused: false, rate: [1, 1] } });
};

const setup = () => {
  tickNo = 0;
  const client = new FakeClient();
  const play = new Play(client as unknown as HostClient);
  step(client);
  return { client, play };
};

test.describe("reading the frame", () => {
  test("a frame with neither key has no paper and no night, and the page reads null", () => {
    expect(readSlice(frameOf({}) as unknown as Record<string, unknown>)).toMatchObject({ gazette: null, night: null });
    expect(readGazette({})).toBeNull();
    expect(readNight({})).toBeNull();
    expect(readSlice(null)).toMatchObject({ gazette: null, night: null });
  });

  test("the paper is read as the core sends it, in both languages, and nothing the page does not know is made up", () => {
    const paper = readGazette(fake.gazette());
    expect(paper).toMatchObject({
      day: 2,
      head: { kind: "delivery", text: { zh: "李大答应的四根竹料，已经送到石桥。" } },
      today: { id: "t_bamboo_rest", state: "open", window: { day: 2, from: 6, to: 9, place: "p_bridge" } },
    });
    expect(paper?.news.map((item) => item.kind)).toEqual(["stance", "promise"]);
    expect(paper?.more.map((task) => task.id)).toEqual(["t_tell_town"]);
    expect(paper?.more[0]?.next).toBeNull();
    expect(paper?.talk.map((item) => item.kind)).toEqual(["festival_warm", "split"]);
    for (const item of [paper?.head, ...(paper?.news ?? []), ...(paper?.talk ?? [])]) {
      expect(item?.text.zh).not.toBe("");
      expect(item?.text.en).not.toBe("");
    }
  });

  test("a paper with nothing to recommend, no short items and no street talk is still a paper", () => {
    const paper = readGazette(fake.gazette({ news: [], today: null, more: [], talk: [] }));
    expect(paper).toMatchObject({ today: null, news: [], more: [], talk: [] });
    expect(paper?.head.kind).toBe("delivery");
  });

  test("a paper without a headline or a day is read as none, and at most two short items, chances and lines are taken", () => {
    expect(readGazette(fake.gazette({ head: null }))).toBeNull();
    expect(readGazette(fake.gazette({ head: { kind: "x", text: { zh: "", en: "" } } }))).toBeNull();
    expect(readGazette(fake.gazette({ day: "two" }))).toBeNull();
    const item = (n: number) => ({ kind: "stance", text: { zh: `第${n}条`, en: `No. ${n}` } });
    const many = readGazette(fake.gazette({ news: [item(1), item(2), item(3)], talk: [item(1), item(2), item(3)] }));
    expect(many?.news).toHaveLength(2);
    expect(many?.talk).toHaveLength(2);
  });

  test("the summary of the night is read with its three parts, and a part the core has none of is null", () => {
    const night = readNight(fake.night());
    expect(night).toMatchObject({
      day: 1,
      changed: { kind: "promise" },
      blocked: { id: "t_timber", blocker: { zh: "周掌柜还没松口" } },
      step: { id: "t_bamboo_first", window: { day: 2, from: 6, to: 7, place: "p_bridge" } },
    });
    expect(readNight(fake.night({ blocked: null, step: null }))).toMatchObject({ blocked: null, step: null });
    expect(readNight(fake.night({ step: { id: "t_a", text: { zh: "甲", en: "A" }, window: null } }))?.step).toMatchObject({ id: "t_a", window: null });
    expect(readNight(fake.night({ blocked: { id: "t_b", text: { zh: "乙", en: "B" }, blocker: null } }))?.blocked?.blocker).toBeNull();
    expect(readNight(fake.night({ changed: null }))).toBeNull();
    expect(readNight(fake.night({ day: null }))).toBeNull();
  });
});

test.describe("the paper of the morning", () => {
  test("is kept from the one frame that has it until the player puts it away, and is not taken again", () => {
    const { client, play } = setup();
    expect(play.flows.state.recap).toBeNull();
    step(client, fake.gazette());
    const key = paperKey(play.slice);
    expect(key).toMatch(/^gazette:2:/);
    expect(play.flows.state.recap).toMatchObject({ key, gazette: { day: 2 }, lines: [{}, {}, {}] });
    // the next frames have none, and the page still does
    step(client);
    step(client);
    expect(play.slice.gazette).toBeNull();
    expect(play.flows.state.recap?.key).toBe(key);
    play.flows.dismissRecap();
    expect(play.flows.state.recap).toBeNull();
    expect(play.flows.state.recapSeen).toBe(key);
    // the same paper again is not shown again, and the paper of another day is
    step(client, fake.gazette());
    expect(play.flows.state.recap).toBeNull();
    step(client, fake.gazette({ day: 3 }));
    expect(play.flows.state.recap?.key).toMatch(/^gazette:3:/);
  });

  test("on a quiet morning the paper comes with no line of the recap, and is kept all the same", () => {
    const { client, play } = setup();
    step(client, { gazette: fake.gazetteBody({ head: { kind: "quiet", text: { zh: "昨天镇上没有什么大事。", en: "Nothing much happened in town yesterday." } }, news: [] }), recap: null });
    expect(play.flows.state.recap).toMatchObject({ lines: [], gazette: { head: { kind: "quiet" } } });
    expect(play.flows.paperUp).toBe(true);
  });

  test("a recap with no paper is the recap of before: kept as it was, and it does not hold the world", () => {
    const { client, play } = setup();
    step(client, fake.recap());
    expect(play.flows.state.recap).toMatchObject({ gazette: null, lines: [{}, {}, {}] });
    expect(paperKey(play.slice)).toBe(JSON.stringify(fake.recapLines().map((line) => line.text)));
    expect(play.flows.paperUp).toBe(false);
    expect(play.guide.cardUp).toBe(false);
  });

  test("holds the world while it is up, as the guide's cards do, and lets it go when it is put away", () => {
    const { client, play } = setup();
    expect(play.guide.cardUp).toBe(false);
    step(client, fake.gazette());
    expect(play.flows.paperUp).toBe(true);
    expect(play.guide.cardUp).toBe(true);
    play.flows.dismissRecap();
    expect(play.flows.paperUp).toBe(false);
    expect(play.guide.cardUp).toBe(false);
  });

  test("a recording taken back to before the morning loses the paper, and one that goes on keeps it", () => {
    const { client, play } = setup();
    tickNo = 100;
    step(client, fake.gazette());
    const at = tickNo;
    step(client);
    expect(play.flows.state.recap?.tick).toBe(at);
    client.feed({ type: "frame", tick: at - 40, advanced: false, frame: frameOf({}), events: [], clock: { paused: true, rate: [1, 1] } });
    expect(play.flows.state.recap).toBeNull();
  });
});

test.describe("the summary of the night", () => {
  test("is kept from the one frame that has it until the player puts it away, and the same night is not taken again", () => {
    const { client, play } = setup();
    expect(play.flows.state.night).toBeNull();
    step(client, fake.night());
    const key = nightKey(play.slice);
    expect(key).toMatch(/^night:1:/);
    expect(play.flows.state.night).toMatchObject({ key, night: { day: 1 } });
    step(client);
    expect(play.slice.night).toBeNull();
    expect(play.flows.state.night?.key).toBe(key);
    expect(play.flows.paperUp).toBe(true);
    play.flows.dismissNight();
    expect(play.flows.state.night).toBeNull();
    expect(play.flows.state.nightSeen).toBe(key);
    expect(play.flows.paperUp).toBe(false);
    step(client, fake.night());
    expect(play.flows.state.night).toBeNull();
    step(client, fake.night({ day: 2 }));
    expect(play.flows.state.night?.night.day).toBe(2);
  });

  test("is not kept while the viewer has it turned off, and turning it off puts away the one that is up", () => {
    const { client, play } = setup();
    expect(play.flows.nightOn).toBe(true);
    play.flows.setNightOn(false);
    step(client, fake.night());
    expect(play.flows.state.night).toBeNull();
    expect(play.flows.paperUp).toBe(false);
    play.flows.setNightOn(true);
    step(client, fake.night({ day: 2 }));
    expect(play.flows.state.night).not.toBeNull();
    play.flows.setNightOn(false);
    expect(play.flows.state.night).toBeNull();
    expect(play.flows.state.nightSeen).not.toBeNull();
  });

  test("waits behind the paper of the morning in the order the page shows its sheets, and each holds the world", () => {
    const { client, play } = setup();
    step(client, fake.gazette());
    step(client, fake.night());
    expect(play.flows.state.recap).not.toBeNull();
    expect(play.flows.state.night).not.toBeNull();
    play.flows.dismissRecap();
    expect(play.flows.paperUp).toBe(true); // the night is still up
    play.flows.dismissNight();
    expect(play.flows.paperUp).toBe(false);
  });
});

test.describe("what a save keeps", () => {
  test("the paper and the night are kept with a save and come back when it is loaded, and what was put away does not", () => {
    const { client, play } = setup();
    expect(play.flows.keep()).toBeNull();
    step(client, fake.gazette());
    step(client, fake.night());
    step(client);
    const notes = play.flows.keep();
    expect(notes).toMatchObject({ recap: { key: play.flows.state.recap?.key, gazette: { day: 2 } }, night: { key: play.flows.state.night?.key, night: { day: 1 } } });
    const stored = JSON.parse(JSON.stringify(notes)) as Record<string, unknown>; // through the host as JSON
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    expect(play.flows.state.recap).toBeNull();
    expect(play.flows.state.night).toBeNull();
    step(client);
    client.feed({ type: "loaded", info: { id: 1, name: "", tick: tickNo, hash: "h", savedHash: "h", match: true, hashesChecked: 0, reissued: 0, cancelledOpen: 0, page: stored } });
    expect(play.flows.state.recap?.gazette?.head.text.en).toBe("The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.");
    expect(play.flows.state.recap?.gazette?.today?.window).toEqual({ day: 2, from: 6, to: 9, place: "p_bridge" });
    expect(play.flows.state.night?.night.step?.id).toBe("t_bamboo_first");
    play.flows.dismissRecap();
    play.flows.dismissNight();
    expect(play.flows.keep()).toBeNull();
  });

  test("a quiet paper with no line of the recap is kept and comes back, and a recap kept with lines and no paper still does", () => {
    const { client, play } = setup();
    step(client, { gazette: fake.gazetteBody({ news: [] }), recap: null });
    const stored = JSON.parse(JSON.stringify(play.flows.keep())) as Record<string, unknown>;
    expect((stored.recap as Record<string, unknown>).lines).toEqual([]);
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    play.flows.restore(stored);
    expect(play.flows.state.recap).toMatchObject({ lines: [], gazette: { day: 2 } });
    // a recap with lines and no paper
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    play.flows.restore({ recap: { key: "k", lines: fake.recapLines() } });
    expect(play.flows.state.recap).toMatchObject({ key: "k", gazette: null, lines: [{}, {}, {}] });
  });

  test("notes that are not a paper or a night take nothing back", () => {
    const { client, play } = setup();
    for (const page of [undefined, {}, { recap: null }, { recap: { key: "k" } }, { recap: { key: "k", gazette: { day: 2 } } }, { recap: [1] }, { night: null }, { night: { key: "k" } }, { night: { key: "k", night: { day: 1 } } }, { night: [1] }]) {
      client.feed({ type: "reset", seed: 5, scenario: "bridge" });
      play.flows.restore(page as never);
      expect(play.flows.state.recap).toBeNull();
      expect(play.flows.state.night).toBeNull();
    }
  });
});
