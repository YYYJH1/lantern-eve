import { expect, test } from "@playwright/test";
import type { HostClient } from "../../src/page/client.ts";
import { hasMessage, type MessageKey } from "../../src/i18n/index.ts";
import { Play, TALK_RANGE, THINKING_MS } from "../../src/page/play.ts";
import type { CoreEvent, Frame, HostToPage } from "../../src/shared/protocol.ts";

/** The part of the host client that the player's side uses, with a record of what it was asked to do. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null };
  readonly sent: Array<Record<string, unknown>> = [];
  /** The calls the page made of the host, which the test answers or fails. */
  readonly asked: Array<Record<string, unknown>> = [];
  private readonly waiting: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
  paused = 0;
  touched = 0;
  private readonly taps: Array<(message: HostToPage) => void> = [];

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {
    this.touched++;
  }
  pause(): void {
    this.paused++;
  }
  player(body: Record<string, unknown>): string {
    const id = typeof body.action_id === "string" ? body.action_id : `a${this.sent.length + 1}`;
    this.sent.push({ ...body, action_id: id });
    return id;
  }
  call<T>(call: Record<string, unknown>): Promise<T> {
    this.asked.push(call);
    return new Promise<T>((resolve, reject) => this.waiting.push({ resolve: resolve as (value: unknown) => void, reject }));
  }
  /** The host answers the call that was made last, and the page gets to read the answer. */
  async answer(value: unknown): Promise<void> {
    this.waiting[this.waiting.length - 1]?.resolve(value);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  async fail(): Promise<void> {
    this.waiting[this.waiting.length - 1]?.reject(new Error("unsupported"));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  feed(message: HostToPage): void {
    for (const tap of this.taps) tap(message);
  }
  get last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1] ?? {};
  }
}

const SCENE = {
  scenario: "bridge",
  name: { zh: "澄溪镇", en: "Chengxi Town" },
  width: 40,
  height: 20,
  layers: { terrain: { rows: [], legend: [] }, buildings: [], barriers: [] },
  places: [
    { id: "p_tea", kind: "teahouse", indoor: true, rect: [30, 5, 4, 3], door: [31, 8], stands: [], cells: [], zh: "茶馆", en: "Teahouse" },
    { id: "p_hall", kind: "hall", indoor: true, rect: [10, 5, 4, 3], door: [11, 8], stands: [], cells: [], zh: "祠堂", en: "Ancestral Hall" },
    { id: "p_pond", kind: "water", indoor: false, rect: [1, 1, 3, 3], door: null, stands: [], cells: [], zh: "池塘", en: "Pond" },
  ],
  cast: [
    { id: "cha", zh: "茶馆老板娘", en: "Teahouse Keeper", role: { zh: "老板娘", en: "Keeper" }, token: { zh: "茶", en: "T" }, family: null, home: "p_tea", work: "p_tea" },
    { id: "he", zh: "老何", en: "Boatman He", role: { zh: "船夫", en: "Boatman" }, token: { zh: "何", en: "H" }, family: null, home: null, work: null },
  ],
  player: { id: "player", zh: "总管", en: "Festival Manager", role: { zh: "灯会总管", en: "Manager" }, token: { zh: "总", en: "M" }, start: [10, 10], things: [{ id: "t_boat", zh: "老何的船", en: "Boatman He's Boat" }] },
};

interface Scene {
  me?: { x: number; y: number; activity?: string; talk?: { npc: string; leaves_at?: { hour: number; minute: number } } | null };
  people?: Array<{ id: string; x: number; y: number }>;
  bubbles?: unknown[];
  notebook?: unknown[];
  hud?: Record<string, unknown>;
  ending?: unknown;
}

const frameOf = (s: Scene): Frame =>
  ({
    npcs: (s.people ?? [{ id: "cha", x: 31, y: 9 }, { id: "he", x: 3, y: 3 }]).map((p) => ({ ...p, activity: "work", carrying: null })),
    time: { day: 1, hour: 8, minute: 0, phase: "day" },
    weather: "clear",
    bubbles: s.bubbles ?? [],
    dots: [],
    lanterns: [],
    hud: s.hud ?? { verbs: ["move"] },
    player: s.me === undefined ? undefined : { x: s.me.x, y: s.me.y, activity: s.me.activity ?? "rest", talk: s.me.talk ?? null, look: [] },
    notebook: s.notebook ?? [],
    ending: s.ending ?? null,
  }) as unknown as Frame;

let tickNo = 0;
const step = (client: FakeClient, scene: Scene, events: CoreEvent[] = []): void => {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameOf(scene), events, clock: { paused: false, rate: [1, 1] } });
};
const ack = (id: string, result: "applied" | "rejected", reason: string | null = null): CoreEvent => ({ kind: "action_ack", tick: tickNo, action_id: id, result, reason });
const setup = (scene: Scene = { me: { x: 10, y: 10 } }) => {
  tickNo = 0;
  const client = new FakeClient();
  client.state.scene = SCENE;
  const play = new Play(client as unknown as HostClient);
  step(client, scene);
  return { client, play };
};

test.describe("walking", () => {
  test("a click on the ground sends a move to the cell, marks it, and takes the mark away when the player gets there", () => {
    const { client, play } = setup();
    play.goTo({ x: 14, y: 10, place: null });
    expect(client.last).toMatchObject({ type: "move", x: 14, y: 10 });
    expect(play.state.destination).toEqual({ x: 14, y: 10, place: null, walking: false });
    step(client, { me: { x: 11, y: 10, activity: "walk" } }, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.destination?.walking).toBe(true);
    step(client, { me: { x: 13, y: 10, activity: "walk" } });
    expect(play.state.destination).not.toBeNull();
    step(client, { me: { x: 14, y: 10 } }, [{ kind: "arrived", tick: tickNo, x: 14, y: 10, place: "" }]);
    expect(play.state.destination).toBeNull();
    expect(play.state.notes).toEqual([]);
  });

  test("a click on a place sends the place and marks its door", () => {
    const { client, play } = setup();
    play.goTo({ x: 31, y: 5, place: "p_tea" });
    expect(client.last).toMatchObject({ type: "move", place: "p_tea" });
    expect(client.last.x).toBeUndefined();
    expect(play.state.destination).toMatchObject({ x: 31, y: 8, place: "p_tea" });
    // A place with no door is still asked about, and the core says why not.
    play.goTo({ x: 2, y: 2, place: "p_pond" });
    expect(client.last).toMatchObject({ type: "move", place: "p_pond" });
    expect(play.state.destination).toBeNull();
  });

  test("a refused move takes the mark away and says why, in a note that goes by itself", () => {
    const { client, play } = setup();
    play.goTo({ x: 5, y: 5, place: null });
    step(client, { me: { x: 10, y: 10 } }, [ack(String(client.last.action_id), "rejected", "blocked")]);
    expect(play.state.destination).toBeNull();
    expect(play.state.notes).toHaveLength(1);
    expect(play.state.notes[0]).toMatchObject({ kind: "refused", key: "ack.move.blocked", reason: "blocked" });
    // The same reason in another word of the core falls back to the general text, and one the page does not know to the last.
    play.goTo({ x: 6, y: 5, place: null });
    step(client, { me: { x: 10, y: 10 } }, [ack(String(client.last.action_id), "rejected", "talking")]);
    expect(play.state.notes[1]).toMatchObject({ key: "ack.talking" });
    play.goTo({ x: 7, y: 5, place: null });
    step(client, { me: { x: 10, y: 10 } }, [ack(String(client.last.action_id), "rejected", "gremlins")]);
    expect(play.state.notes[2]).toMatchObject({ key: "ack.other", values: { reason: "gremlins" } });
  });

  test("a note can be dismissed by hand, and the host is told the page changed", () => {
    const { client, play } = setup();
    play.goTo({ x: 5, y: 5, place: null });
    step(client, { me: { x: 10, y: 10 } }, [ack(String(client.last.action_id), "rejected", "outside")]);
    const id = play.state.notes[0]?.id ?? 0;
    const before = client.touched;
    play.dismissNote(id);
    expect(play.state.notes).toEqual([]);
    expect(client.touched).toBe(before + 1);
  });

  test("a game without a player (the demo world) sends nothing", () => {
    tickNo = 0;
    const client = new FakeClient();
    client.state.scene = { ...SCENE, player: undefined };
    const play = new Play(client as unknown as HostClient);
    step(client, {});
    expect(play.playing).toBe(false);
    play.goTo({ x: 1, y: 1, place: null });
    play.talkOrWalk("cha");
    expect(client.sent).toEqual([]);
  });
});

test.describe("talking", () => {
  test("within reach the player talks at once, and the talk begins with the event that says so", () => {
    const { client, play } = setup({ me: { x: 31, y: 10 } });
    expect(TALK_RANGE).toBe(2);
    play.talkOrWalk("cha");
    expect(client.last).toMatchObject({ type: "talk", npc: "cha" });
    expect(play.state.approach).toBeNull();
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } }, [
      { kind: "talk_start", tick: 30, npc: "cha", leaves_at: { hour: 9, minute: 30 } },
      ack(String(client.last.action_id), "applied"),
    ]);
    expect(play.state.talk).toEqual({ npc: "cha", lines: [], leavesAt: { hour: 9, minute: 30 } });
    expect(play.state.talk?.opening).toBeUndefined();
  });

  test("the words the person has on show as the talk opens are the opening of the talk, and nobody else's words and no gone words are", () => {
    const greeting = { zh: "你就是新来的总管？", en: "So you are the new Manager?" };
    const open = (bubbles: unknown[]) => {
      const { client, play } = setup({ me: { x: 31, y: 10 } });
      play.talkOrWalk("cha");
      step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } }, bubbles }, [
        { kind: "talk_start", tick: 30, npc: "cha", leaves_at: { hour: 9, minute: 30 } },
        ack(String(client.last.action_id), "applied"),
      ]);
      return { client, play };
    };
    const { client, play } = open([{ npc: "he", until: 330, text: { zh: "路过。", en: "Passing by." } }, { npc: "cha", until: 330, text: greeting }]);
    expect(play.state.talk).toEqual({ npc: "cha", lines: [], leavesAt: { hour: 9, minute: 30 }, opening: greeting });
    // It stays the opening when the person answers something, and the answer is a line of the log after it.
    play.ask("t_boat", { zh: "老何的船", en: "Boatman He's Boat" });
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } }, bubbles: [{ npc: "cha", until: 330, text: { zh: "我亲眼看见。", en: "I saw it myself." } }] }, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.talk?.opening).toEqual(greeting);
    expect(play.state.talk?.lines).toHaveLength(2);
    // Somebody else's words are not the opening, and words that are gone are not either.
    expect(open([{ npc: "he", until: 330, text: { zh: "路过。", en: "Passing by." } }]).play.state.talk?.opening).toBeUndefined();
    expect(open([{ npc: "cha", until: 1, text: greeting }]).play.state.talk?.opening).toBeUndefined();
    // A talk that the frame says is on, with no event of its start in this page, has no opening to show.
    const loaded = setup({ me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } }, bubbles: [{ npc: "cha", until: 330, text: greeting }] });
    expect(loaded.play.state.talk?.opening).toBeUndefined();
  });

  test("an answer that says two accounts is one line of the log after the greeting that opened the talk, and neither takes the other's place", () => {
    // The words of Granny Li as the core makes them: her greeting, then the answer of a torn person asked about the boat.
    const greeting = { zh: "你就是族长请来的总管？老婆子先看看你。", en: "So you are the Manager the elder sent for? This old woman will look you over first." };
    const both = {
      zh: "更夫告诉过我：船夫老何昨夜弄坏了石桥栏杆，是不小心的。老婆子也听周掌柜提过另一种：李二昨夜弄坏了石桥栏杆。",
      en: "The Night Watchman said to this old woman that Boatman He damaged the Stone Bridge Railing last night, by accident. This old woman also heard another account from Shopkeeper Zhou: Li Er damaged the Stone Bridge Railing last night.",
    };
    const me = { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } };
    const { client, play } = setup({ me: { x: 31, y: 10 } });
    play.talkOrWalk("cha");
    step(client, { me, bubbles: [{ npc: "cha", until: 330, text: greeting }] }, [
      { kind: "talk_start", tick: 30, npc: "cha", leaves_at: { hour: 9, minute: 30 } },
      ack(String(client.last.action_id), "applied"),
    ]);
    play.ask("t_boat", { zh: "老何的船", en: "Boatman He's Boat" });
    step(client, { me, bubbles: [{ npc: "cha", until: 330, text: both }] }, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.talk?.opening).toEqual(greeting);
    expect(play.state.talk?.lines).toHaveLength(2);
    expect(play.state.talk?.lines[0]).toMatchObject({ who: "you" });
    expect(play.state.talk?.lines[1]).toEqual({ who: "them", text: both });
  });

  test("the hour at which the person has to go is the frame's to say, in each frame", () => {
    const { client, play } = setup({ me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } });
    expect(play.state.talk?.leavesAt).toEqual({ hour: 9, minute: 30 });
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 11, minute: 5 } } } }, []);
    expect(play.state.talk?.leavesAt).toEqual({ hour: 11, minute: 5 });
    // A frame that does not say takes the hour away, and it is still the same talk.
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha" } } }, []);
    expect(play.state.talk).toEqual({ npc: "cha", lines: [], leavesAt: null });
  });

  test("a question and the answer to it are two lines of the talk", () => {
    const { client, play } = setup({ me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } });
    expect(play.state.talk?.npc).toBe("cha");
    play.ask("t_boat", { zh: "老何的船", en: "Boatman He's Boat" });
    expect(client.last).toMatchObject({ type: "ask", topic: "t_boat" });
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } }, bubbles: [{ npc: "cha", until: 330, text: { zh: "船是老何的。", en: "The boat is Boatman He's." } }] }, [
      { kind: "asked", tick: tickNo, npc: "cha", topic: "t_boat", answer: "claim" },
      ack(String(client.last.action_id), "applied"),
    ]);
    expect(play.state.talk?.lines).toEqual([
      { who: "you", how: "ask", subject: { zh: "老何的船", en: "Boatman He's Boat" } },
      { who: "them", text: { zh: "船是老何的。", en: "The boat is Boatman He's." } },
    ]);
    play.askSource("n1", { zh: "船是老何的。", en: "The boat is Boatman He's." });
    expect(client.last).toMatchObject({ type: "ask_source", entry: "n1" });
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } }, bubbles: [{ npc: "cha", until: 330, text: { zh: "我亲眼看见。", en: "I saw it myself." } }] }, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.talk?.lines.map((l) => l.who)).toEqual(["you", "them", "you", "them"]);
  });

  test("what the town offers to tell, entrust or promise is a line of the talk too, and goes as the fields it came with", () => {
    const { client, play } = setup({ me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } });
    const talking = { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } } as const;
    play.other("tell", { entry: "n1", how: "as_seen" }, { zh: "说成亲眼所见：船是老何的。", en: "As if you saw it yourself: the boat is Boatman He's." });
    expect(client.last).toMatchObject({ type: "tell", entry: "n1", how: "as_seen" });
    step(client, { ...talking, bubbles: [{ npc: "cha", until: 330, text: { zh: "原来如此。", en: "Is that so." } }] }, [ack(String(client.last.action_id), "applied")]);
    play.other("promise", { op: "make", what: "stall", item: "front", due: 3 }, { zh: "许李老太一个前排摊位", en: "Promise Granny Li a front-row stall" });
    expect(client.last).toMatchObject({ type: "promise", op: "make", what: "stall" });
    step(client, talking, [ack(String(client.last.action_id), "applied")]);
    play.other("speak", { kind: "meal" });
    expect(client.last).toMatchObject({ type: "speak", kind: "meal" });
    step(client, talking, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.talk?.lines.map((l) => (l.who === "you" ? l.how : "them"))).toEqual(["tell", "them", "promise"]);
  });

  test("a question that is refused leaves no line, and the end of the talk clears it", () => {
    const { client, play } = setup({ me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } });
    play.ask("shitou", { zh: "石头", en: "Shitou" });
    step(client, { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } }, [ack(String(client.last.action_id), "rejected", "unknown_topic")]);
    expect(play.state.talk?.lines).toEqual([]);
    expect(play.state.notes[0]).toMatchObject({ key: "ack.ask.unknown_topic" });
    step(client, { me: { x: 31, y: 10 } }, [{ kind: "talk_end", tick: tickNo, npc: "cha", reason: "timeout" }]);
    expect(play.state.talk).toBeNull();
    expect(play.state.notes[1]).toMatchObject({ key: "note.talkTimeout", values: { name: { zh: "茶馆老板娘", en: "Teahouse Keeper" } } });
  });

  test("a person who will not talk is one note, not two", () => {
    const { client, play } = setup({ me: { x: 31, y: 10 } });
    play.talk("cha");
    step(client, { me: { x: 31, y: 10 } }, [{ kind: "declined", tick: tickNo, npc: "cha", reason: "asleep" }, ack(String(client.last.action_id), "rejected", "asleep")]);
    expect(play.state.notes).toHaveLength(1);
    expect(play.state.notes[0]).toMatchObject({ key: "ack.talk.asleep", reason: "asleep" });
    expect(play.state.talk).toBeNull();
  });

  test("far away, the player walks up to the person and talks when they are close enough", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 } });
    play.talkOrWalk("cha");
    expect(client.last).toMatchObject({ type: "move", x: 31, y: 9 });
    expect(play.state.approach).toMatchObject({ npc: "cha", orders: 1 });
    step(client, { me: { x: 20, y: 10, activity: "walk" } }, [ack(String(client.last.action_id), "applied")]);
    expect(play.state.approach).not.toBeNull();
    expect(client.sent.filter((s) => s.type === "talk")).toHaveLength(0);
    step(client, { me: { x: 29, y: 10, activity: "walk" } });
    expect(client.last).toMatchObject({ type: "talk", npc: "cha" });
    expect(play.state.approach).toBeNull();
    // The frames that follow before the answer do not send it twice.
    step(client, { me: { x: 30, y: 10, activity: "walk" } });
    expect(client.sent.filter((s) => s.type === "talk")).toHaveLength(1);
  });

  test("goes after a person who moved away, and gives up after a few tries or when the walk is refused", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 } });
    play.walkUpTo("cha");
    const orders = (): number => client.sent.filter((s) => s.type === "move").length;
    expect(orders()).toBe(1);
    // The player stops short, the person is somewhere else now, and ten ticks have gone.
    for (let i = 0; i < 80; i++) step(client, { me: { x: 12, y: 10 }, people: [{ id: "cha", x: 20 + (i % 3), y: 9 }, { id: "he", x: 3, y: 3 }] });
    expect(orders()).toBeGreaterThan(2);
    expect(orders()).toBeLessThanOrEqual(7);
    expect(play.state.approach).toBeNull();

    const second = setup({ me: { x: 10, y: 10 } });
    second.play.walkUpTo("cha");
    step(second.client, { me: { x: 10, y: 10 } }, [ack(String(second.client.last.action_id), "rejected", "unreachable")]);
    expect(second.play.state.approach).toBeNull();
    expect(second.play.state.notes[0]).toMatchObject({ key: "ack.move.unreachable" });
  });

  test("a click elsewhere ends the approach", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 } });
    play.walkUpTo("cha");
    play.goTo({ x: 3, y: 3, place: null });
    expect(play.state.approach).toBeNull();
    expect(client.last).toMatchObject({ type: "move", x: 3, y: 3 });
  });
});

test.describe("the notebook", () => {
  const entry = (id: string) => ({ id, text: { zh: "甲", en: "A" }, source: { kind: "seen" }, marks: [], chain: [] });

  test("an entry that was added since the last frame is new until the player has looked", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 }, notebook: [entry("n1")] });
    // What was there at the start is not new.
    expect(play.state.fresh).toEqual([]);
    step(client, { me: { x: 10, y: 10 }, notebook: [entry("n1"), entry("n2")] });
    expect(play.state.fresh).toEqual(["n2"]);
    step(client, { me: { x: 10, y: 10 }, notebook: [entry("n1"), entry("n2"), entry("n3")] });
    expect(play.state.fresh).toEqual(["n2", "n3"]);
    play.markSeen();
    expect(play.state.fresh).toEqual([]);
    step(client, { me: { x: 10, y: 10 }, notebook: [entry("n1"), entry("n2"), entry("n3")] });
    expect(play.state.fresh).toEqual([]);
  });
});

test.describe("the festival", () => {
  test("those who join in one frame are one note", () => {
    const { client, play } = setup();
    play.rally();
    step(client, { me: { x: 10, y: 10 } }, [
      { kind: "rally", tick: tickNo },
      { kind: "joined", tick: tickNo, npc: "cha", round: 1, how: "call" },
      { kind: "joined", tick: tickNo, npc: "he", round: 1, how: "call" },
      { kind: "joined", tick: tickNo, npc: "he", round: 1, how: "call" },
      ack(String(client.last.action_id), "applied"),
    ]);
    expect(play.state.notes.map((n) => n.key)).toEqual(["note.rally", "note.joinedMore"]);
    expect(play.state.notes[1]?.values).toMatchObject({ names: { zh: "茶馆老板娘、老何", en: "Teahouse Keeper, Boatman He" }, n: { zh: "一", en: "1" } });
  });

  test("the ending event opens the ending page and pauses the world; a new game takes it away", () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], ending: "ending_split", promised: 2, turnout: 700 } }, [
      { kind: "ending", tick: tickNo, ending: "ending_split", label: { zh: "散场", en: "Scattered" }, hidden: [], inputs: {}, passage: "none", promised: 2, turnout: 700, reveal: { truth: null, chains: [] } },
    ]);
    expect(play.state.ending).toMatchObject({ id: "ending_split", label: { zh: "散场", en: "Scattered" }, turnout: 700 });
    expect(play.state.ending?.reveal).not.toBeNull();
    expect(play.state.endingOpen).toBe(true);
    expect(client.paused).toBe(1);
    play.showEnding(false);
    expect(play.state.endingOpen).toBe(false);
    // The frames that follow do not open it again.
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], ending: "ending_split", promised: 2, turnout: 700 } });
    expect(play.state.endingOpen).toBe(false);
    expect(client.paused).toBe(1);
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    expect(play.state.ending).toBeNull();
    expect(play.state.notes).toEqual([]);
  });

  test("a game that is already over when the page comes to it shows the ending from the numbers", () => {
    const { play } = setup({ me: { x: 10, y: 10 }, hud: { verbs: [], ending: "ending_full", promised: 9, turnout: 1500 } });
    expect(play.state.ending).toMatchObject({ id: "ending_full", promised: 9, turnout: 1500, reveal: null });
    expect(play.state.endingOpen).toBe(true);
  });
});

/** The ending as the core writes it now: every label in both languages. */
const ENDING = {
  kind: "ending",
  tick: 1800,
  ending: "ending_barely",
  label: { zh: "勉强", en: "Just enough" },
  hidden: [{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }],
  inputs: { bridge_fixed: true, detour_done: false, reconciled: false, truth_told: false },
  passage: "mended",
  promised: 9,
  turnout: 1500,
  reveal: { truth: { variant: "v_boat", label: { zh: "老何撞的。", en: "Boatman He rammed it." }, props: [] }, chains: [], believers: { false: [], true: [], none: [] }, told: { total: 0, mutated: 0 } },
};
const OVER = { verbs: [], ending: "ending_barely", promised: 9, turnout: 1500 };

test.describe("the ending in the frame", () => {
  test("a frame that carries the ending opens it with no event, as after loading a save or coming back to a game that is over", () => {
    const { play } = setup({ me: { x: 10, y: 10 }, hud: OVER, ending: ENDING });
    expect(play.state.endingOpen).toBe(true);
    expect(play.state.ending).toMatchObject({ id: "ending_barely", label: { zh: "勉强", en: "Just enough" }, promised: 9, turnout: 1500, passage: "mended" });
    // The labels and the reveal are the core's, not a page that knows the id alone.
    expect(play.state.ending?.hidden).toEqual([{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }]);
    expect(play.state.ending?.reveal?.truth?.label).toEqual({ zh: "老何撞的。", en: "Boatman He rammed it." });
  });

  test("is read once when the event and the frame come together, and once put away it stays away with the frames that follow", () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: ENDING }, [{ ...ENDING }]);
    const first = play.state.ending;
    expect(first?.reveal).not.toBeNull();
    expect(client.paused).toBe(1);
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: ENDING });
    expect(play.state.ending).toBe(first);
    play.showEnding(false);
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: ENDING });
    expect(play.state.endingOpen).toBe(false);
    // The frame alone does not hold the world: a game that was loaded is held by the host until the player resumes it.
    const again = setup({ me: { x: 10, y: 10 }, hud: OVER, ending: ENDING });
    expect(again.client.paused).toBe(0);
  });

  test("a frame that carries no ending has the id and the numbers, and no reveal; the ending of the frame is preferred when both are there", () => {
    const old = setup({ me: { x: 10, y: 10 }, hud: OVER });
    expect(old.play.state.ending).toMatchObject({ id: "ending_barely", label: null, reveal: null, promised: 9 });
    const now = setup({ me: { x: 10, y: 10 }, hud: { ...OVER, ending: "something_else" }, ending: ENDING });
    expect(now.play.state.ending?.id).toBe("ending_barely");
    expect(now.play.state.ending?.reveal).not.toBeNull();
    // An ending with no id in it is not an ending, and the numbers decide.
    const odd = setup({ me: { x: 10, y: 10 }, hud: OVER, ending: { kind: "ending" } });
    expect(odd.play.state.ending?.reveal).toBeNull();
  });

  test("a game of the demo world, or one that has not ended, has none", () => {
    const { play } = setup({ me: { x: 10, y: 10 }, hud: { verbs: ["move"], ending: "" } });
    expect(play.state.ending).toBeNull();
    expect(play.state.endingOpen).toBe(false);
  });
});

/** The ending as the frames after the call that made it carry it: the same, and no reveal. */
const { reveal: _reveal, ...COMPACT } = ENDING;

test.describe("the whole ending and the compact one", () => {
  test("the whole ending that a host sends is shown and kept, and the compact frames after it change nothing and ask for nothing", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 }, hud: OVER });
    client.feed({ type: "ending", ending: ENDING });
    expect(play.state.ending).toMatchObject({ id: "ending_barely", turnout: 1500 });
    expect(play.state.ending?.reveal?.truth?.label).toEqual({ zh: "老何撞的。", en: "Boatman He rammed it." });
    expect(play.state.endingOpen).toBe(true);
    const whole = play.state.ending;
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    expect(play.state.ending).toBe(whole);
    expect(client.asked).toEqual([]);
    // The host sends it for a game that was loaded and the world is held by the host, so the page does not hold it.
    expect(client.paused).toBe(0);
  });

  test("a compact ending in the frame arrives before the whole one from the host, and then the whole replaces it", async () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    expect(play.state.ending).toMatchObject({ id: "ending_barely", label: { zh: "勉强", en: "Just enough" }, promised: 9, turnout: 1500, reveal: null });
    expect(play.state.ending?.hidden).toEqual([{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }]);
    expect(play.state.endingOpen).toBe(true);
    // The host is asked for the rest, once, however many frames come before it answers.
    expect(client.asked).toEqual([{ op: "ending" }]);
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    expect(client.asked).toHaveLength(1);
    // The player puts the page away meanwhile, and the answer does not bring it back.
    play.showEnding(false);
    await client.answer(ENDING);
    expect(play.state.ending?.reveal?.truth?.variant).toBe("v_boat");
    expect(play.state.endingOpen).toBe(false);
    expect(play.state.ending?.label).toEqual({ zh: "勉强", en: "Just enough" });
  });

  test("a host that cannot say, or that has no whole ending, leaves the compact one as it is, and is not asked again", async () => {
    const failing = setup();
    step(failing.client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    await failing.client.fail();
    expect(failing.play.state.ending).toMatchObject({ id: "ending_barely", reveal: null });
    step(failing.client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    expect(failing.client.asked).toHaveLength(1);

    const empty = setup();
    step(empty.client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    await empty.client.answer(null);
    expect(empty.play.state.ending).toMatchObject({ id: "ending_barely", reveal: null });
    await empty.client.answer("not an ending");
    expect(empty.play.state.ending?.reveal).toBeNull();
  });

  test("the answer about a game that is over does not belong to the game that follows it", async () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    client.feed({ type: "reset", seed: 8, scenario: "bridge" });
    expect(play.state.ending).toBeNull();
    await client.answer(ENDING);
    expect(play.state.ending).toBeNull();
    expect(play.state.endingOpen).toBe(false);
    // And the game that follows is asked on its own account.
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: COMPACT });
    expect(client.asked).toHaveLength(2);
  });

  test("the first whole ending is the one the page keeps, an ending with no id is none, and null is nothing", () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: ENDING }, [{ ...ENDING }]);
    const first = play.state.ending;
    client.feed({ type: "ending", ending: { ...ENDING, label: { zh: "别的", en: "Another" } } });
    client.feed({ type: "ending", ending: COMPACT });
    client.feed({ type: "ending", ending: null });
    expect(play.state.ending).toBe(first);

    const bare = setup();
    bare.client.feed({ type: "ending", ending: { kind: "ending" } });
    bare.client.feed({ type: "ending", ending: null });
    expect(bare.play.state.ending).toBeNull();
    expect(bare.play.state.endingOpen).toBe(false);
  });

  test("the ending event still opens the page and holds the world, and asks the host for nothing", () => {
    const { client, play } = setup();
    step(client, { me: { x: 10, y: 10 }, hud: OVER, ending: ENDING }, [{ ...ENDING }]);
    expect(play.state.ending?.reveal).not.toBeNull();
    expect(play.state.endingOpen).toBe(true);
    expect(client.paused).toBe(1);
    expect(client.asked).toEqual([]);
  });
});

test.describe("what the town says to the dealings of the manager", () => {
  const talking = { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } } as const;

  /** A refusal of an action of the manager, as the core sends it. */
  const refuse = (type: string, fields: Record<string, unknown>, reason: string) => {
    const { client, play } = setup(talking);
    play.other(type, fields);
    step(client, talking, [ack(String(client.last.action_id), "rejected", reason)]);
    return play.state.notes[0];
  };

  test("each reason that the core gives has a text of the action's own or a general one, and an unknown one the general one", () => {
    const cases: Array<[string, Record<string, unknown>, string, MessageKey]> = [
      ["tell", { entry: "n9" }, "no_sharpen", "ack.tell.no_sharpen"],
      ["tell", { how: "fabricate", pred: "nope" }, "bad_claim", "ack.tell.bad_claim"],
      ["tell", { entry: "n9" }, "no_entry", "ack.no_entry"],
      ["entrust", { kind: "lane" }, "cannot", "ack.entrust.cannot"],
      ["entrust", { kind: "lane" }, "said_already", "ack.entrust.said_already"],
      ["entrust", { kind: "lend" }, "hard", "ack.entrust.hard"],
      ["entrust", { kind: "material" }, "needs_nod", "ack.entrust.needs_nod"],
      ["promise", { op: "make", what: "stall", item: "front", due: 3 }, "empty", "ack.promise.empty"],
      ["promise", { op: "keep", id: "k4" }, "kept_already", "ack.promise.kept_already"],
      ["promise", { op: "keep", id: "k4" }, "not_talking", "ack.not_talking"],
      ["speak", { kind: "meal" }, "heads_absent", "ack.speak.heads_absent"],
      ["speak", { kind: "evidence" }, "said_already", "ack.speak.said_already"],
      ["speak", { kind: "evidence" }, "not_evening", "ack.speak.not_evening"],
      ["speak", { kind: "evidence" }, "talking", "ack.talking"],
      ["speak", { kind: "evidence" }, "gremlins", "ack.other"],
    ];
    for (const [type, fields, reason, key] of cases) {
      const note = refuse(type, fields, reason);
      expect(note, `${type}/${reason}`).toMatchObject({ kind: "refused", key, reason });
      expect(hasMessage(key)).toBe(true);
    }
  });

  test("what came of a telling, a promise and a lie that was found out are notes, the bad news marked as such", () => {
    const { client, play } = setup(talking);
    step(client, talking, [
      { kind: "told", tick: tickNo, speaker: "player", listener: "cha", outcome: "took" },
      { kind: "told", tick: tickNo, speaker: "cha", listener: "he", outcome: "took" },
      { kind: "pledged", tick: tickNo, npc: "cha", pledge: "k1", what: "wage", item: "", amount: 20, due: 3 },
      { kind: "lie_caught", tick: tickNo, npc: "he", prop: "p", trust: 3 },
    ]);
    expect(play.state.notes.map((n) => [n.kind, n.key])).toEqual([
      ["info", "note.told.took"],
      ["info", "note.pledged"],
      ["bad", "note.lieCaught"],
    ]);
    expect(play.state.notes[0]?.values).toMatchObject({ name: { zh: "茶馆老板娘", en: "Teahouse Keeper" } });
    // The coins of a wage are in the event.
    expect(play.state.notes[1]?.values).toMatchObject({ what: { zh: "二十文工钱", en: "20 coins in wages" }, due: { zh: "三", en: "3" } });
    expect(play.state.notes[2]?.values).toMatchObject({ name: { zh: "老何", en: "Boatman He" } });
  });

  test("a speech and a table name the place, and an entrusting that is refused is one note, not two", () => {
    const { client, play } = setup(talking);
    play.other("entrust", { kind: "lane" });
    step(client, talking, [
      { kind: "entrusted", tick: tickNo, npc: "cha", request: "lane", detail: "", result: "refused", total: 10, need: 30, way: "", pending: false },
      ack(String(client.last.action_id), "rejected", "refused"),
      { kind: "spoke", tick: tickNo, venue: "p_hall", named: 9, accepted: 8, percent: 88, elder: 2, complete: true, cleared: true },
      { kind: "feast", tick: tickNo, venue: "p_tea", named: 6 },
    ]);
    expect(play.state.notes.map((n) => n.key)).toEqual(["ack.entrust.refused", "note.spoke.cleared", "note.feast"]);
    expect(play.state.notes[1]?.values).toMatchObject({ where: { zh: "祠堂", en: "ancestral hall" }, named: { zh: "九", en: "9" }, accepted: { zh: "八", en: "8" } });
  });

  test("an event of the town that the page has no words for makes no note", () => {
    const { client, play } = setup(talking);
    step(client, talking, [{ kind: "dawn", tick: tickNo, day: 2 }, { kind: "weather", tick: tickNo }, { kind: "flag", tick: tickNo, flag: "x" }, { kind: "something_new", tick: tickNo }]);
    expect(play.state.notes).toEqual([]);
  });
});

test.describe("a player's side that only watches", () => {
  test("sends nothing, plays no game, and still reads the frames and the events", () => {
    tickNo = 0;
    const client = new FakeClient();
    client.state.scene = SCENE;
    const play = new Play(client as unknown as HostClient, true);
    step(client, { me: { x: 10, y: 10 } });
    expect(play.playing).toBe(false);
    play.goTo({ x: 14, y: 10, place: null });
    play.goTo({ x: 31, y: 5, place: "p_tea" });
    play.talkOrWalk("cha");
    play.talk("cha");
    play.walkUpTo("cha");
    play.leave();
    play.ask("t_boat", { zh: "船", en: "boat" });
    play.askSource("e1", { zh: "x", en: "x" });
    play.listen();
    play.look("t_boat");
    play.rally();
    play.other("tell", { entry: "e1" });
    expect(client.sent).toEqual([]);
    expect(play.state.destination).toBeNull();
    expect(play.state.approach).toBeNull();
    // What the town does is still read, so that a recording shows the notes, the talk and the ending.
    step(client, { me: { x: 10, y: 10, talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } }, [{ kind: "talk_start", tick: tickNo, npc: "cha", leaves_at: { hour: 9, minute: 30 } }, { kind: "rally", tick: tickNo }]);
    expect(play.state.talk?.npc).toBe("cha");
    expect(play.state.notes.map((n) => n.key)).toEqual(["note.rally"]);
    step(client, { me: { x: 10, y: 10 } }, [{ kind: "ending", tick: tickNo, ending: "ending_full", label: { zh: "圆满", en: "Perfect" }, hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100, reveal: { chains: [] } }]);
    expect(play.state.ending?.id).toBe("ending_full");
    expect(play.state.endingOpen).toBe(true);
  });
});

test.describe("the budget in the notes", () => {
  test("a limit crossed, up or down, is one note that says what the models do now, and bad news is marked", () => {
    const { client, play } = setup();
    const crossed = (stage: number, previous: number): CoreEvent => ({ kind: "budget_stage", tick: tickNo, stage, previous, spent: 1, held: 0, cap: 5 });
    step(client, { me: { x: 10, y: 10 } }, [crossed(1, 0)]);
    step(client, { me: { x: 10, y: 10 } }, [crossed(2, 1)]);
    step(client, { me: { x: 10, y: 10 } }, [crossed(0, 2)]);
    expect(play.state.notes.map((n) => [n.kind, n.key])).toEqual([
      ["bad", "note.budget.1"],
      ["bad", "note.budget.2"],
      ["info", "note.budget.0"],
    ]);
    // A stage the page does not know is not a note.
    step(client, { me: { x: 10, y: 10 } }, [crossed(7, 2)]);
    expect(play.state.notes).toHaveLength(3);
    for (const key of ["note.budget.0", "note.budget.1", "note.budget.2", "note.cloudDown", "note.cloudUp"]) expect(hasMessage(key)).toBe(true);
  });

  test("the host saying that the cloud cannot be reached, and that it can again, is a note each; the first word is no change", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: true } });
    expect(play.state.notes).toEqual([]);
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: true } });
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: false } });
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: false } });
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: true } });
    expect(play.state.notes.map((n) => [n.kind, n.key])).toEqual([
      ["bad", "note.cloudDown"],
      ["info", "note.cloudUp"],
    ]);
    // A frame that does not say changes nothing, and a new game starts over.
    step(client, { me: { x: 10, y: 10 } });
    client.feed({ type: "reset", seed: 2, scenario: "bridge" });
    step(client, { me: { x: 10, y: 10 }, hud: { verbs: ["move"], cloud: false } });
    expect(play.state.notes).toEqual([]);
  });
});

test.describe("a reply that is slow to come", () => {
  const talking = { me: { x: 31, y: 10, activity: "chat", talk: { npc: "cha", leaves_at: { hour: 9, minute: 30 } } } } as const;
  const notice = (): HostToPage => ({ type: "notice", code: "thinking", message: "a reply is taking a while (r3)" });
  const said = (text: string) => ({ npc: "cha", until: 330, text: { zh: text, en: text } });

  test("is noted from the host's notice while a talk is on, with whose it is", () => {
    const { client, play } = setup(talking);
    expect(play.state.thinking).toBeNull();
    client.feed(notice());
    expect(play.state.thinking).toEqual({ npc: "cha", shown: "" });
    expect(client.touched).toBeGreaterThan(0);
  });

  test("is not noted when nobody is talking, and other notices of the host are not it", () => {
    const { client, play } = setup({ me: { x: 10, y: 10 } });
    client.feed(notice());
    expect(play.state.thinking).toBeNull();
    const talk = setup(talking);
    talk.client.feed({ type: "notice", code: "input_refused", message: "x" });
    expect(talk.play.state.thinking).toBeNull();
  });

  test("ends when the person speaks again, and not before: the line that was on show when the notice came does not end it", () => {
    const { client, play } = setup({ ...talking, bubbles: [said("Is that so.")] });
    client.feed(notice());
    step(client, { ...talking, bubbles: [said("Is that so.")] });
    expect(play.state.thinking).not.toBeNull();
    step(client, { ...talking, bubbles: [said("I see. I will remember that.")] });
    expect(play.state.thinking).toBeNull();
  });

  test("ends when the core says the person has replied, even if what they said is what they said before", () => {
    const { client, play } = setup({ ...talking, bubbles: [said("I cannot do that.")] });
    client.feed(notice());
    // The same refusal again is not a new line, and so the line alone would leave the page waiting.
    step(client, { ...talking, bubbles: [said("I cannot do that.")] });
    expect(play.state.thinking).not.toBeNull();
    step(client, { ...talking, bubbles: [said("I cannot do that.")] }, [{ kind: "replied", tick: tickNo, npc: "cha" }]);
    expect(play.state.thinking).toBeNull();
  });

  test("is not ended by the reply of somebody else", () => {
    const { client, play } = setup(talking);
    client.feed(notice());
    step(client, talking, [{ kind: "replied", tick: tickNo, npc: "he" }]);
    expect(play.state.thinking).toEqual({ npc: "cha", shown: "" });
    // A reply with nobody waiting for it changes nothing.
    const idle = setup(talking);
    step(idle.client, talking, [{ kind: "replied", tick: tickNo, npc: "cha" }]);
    expect(idle.play.state.thinking).toBeNull();
    expect(idle.play.state.notes).toEqual([]);
  });

  test("ends with the talk, with a new game and with the ending", () => {
    const left = setup(talking);
    left.client.feed(notice());
    step(left.client, { me: { x: 31, y: 10 } }, [{ kind: "talk_end", tick: tickNo, npc: "cha", reason: "leave" }]);
    expect(left.play.state.thinking).toBeNull();

    const fresh = setup(talking);
    fresh.client.feed(notice());
    fresh.client.feed({ type: "reset", seed: 2, scenario: "bridge" });
    expect(fresh.play.state.thinking).toBeNull();

    const over = setup(talking);
    over.client.feed(notice());
    step(over.client, { ...talking, hud: OVER, ending: ENDING }, [{ ...ENDING }]);
    expect(over.play.state.thinking).toBeNull();
  });

  test("goes by itself after a few seconds if nothing else ended it", () => {
    const timers: Array<{ run: () => void; ms: number }> = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((run: () => void, ms: number) => {
      timers.push({ run, ms });
      return 0;
    }) as unknown as typeof setTimeout;
    try {
      const { client, play } = setup(talking);
      client.feed(notice());
      const timer = timers.find((t) => t.ms === THINKING_MS);
      expect(timer).toBeDefined();
      expect(play.state.thinking).not.toBeNull();
      timer?.run();
      expect(play.state.thinking).toBeNull();
      // A notice that came after another one is not ended by the first one's timer.
      client.feed(notice());
      const first = timers.filter((t) => t.ms === THINKING_MS)[1];
      client.feed(notice());
      first?.run();
      expect(play.state.thinking).not.toBeNull();
    } finally {
      globalThis.setTimeout = real;
    }
  });
});
