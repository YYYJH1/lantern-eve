import { expect, test } from "@playwright/test";
import type { HostClient } from "../../src/page/client.ts";
import { contextItems } from "../../src/page/context-items.ts";
import type { Offer } from "../../src/page/frame.ts";
import { Play } from "../../src/page/play.ts";
import { readTalkMore, type Wants } from "../../src/page/talk-frame.ts";
import type { CoreEvent, Frame, HostToPage } from "../../src/shared/protocol.ts";
import * as fake from "../support/slice.ts";

/** The part of the host client that the player's side uses, with a record of what it was asked to do. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null, paused: false, rate: [1, 1] as [number, number] };
  readonly sent: Array<Record<string, unknown>> = [];
  readonly asked: Array<Record<string, unknown>> = [];
  previewAnswer: unknown = fake.PROMISE_PREVIEW;
  private ids = 0;
  private readonly taps: Array<(message: HostToPage) => void> = [];

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {}
  pause(): void {}
  newActionId(): string {
    return `n${++this.ids}`;
  }
  player(body: Record<string, unknown>): string {
    const id = typeof body.action_id === "string" ? body.action_id : this.newActionId();
    this.sent.push({ ...body, action_id: id });
    return id;
  }
  call<T>(call: Record<string, unknown>): Promise<T> {
    this.asked.push(call);
    return Promise.resolve(this.previewAnswer as T);
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
  places: [],
  cast: [
    { id: "zhou_zhanggui", zh: "周掌柜", en: "Shopkeeper Zhou", role: { zh: "周家掌柜", en: "Shopkeeper" }, token: { zh: "周", en: "Z" }, family: "fam_zhou", home: null, work: null },
    { id: "cha_laoban", zh: "茶馆老板娘", en: "Teahouse Keeper", role: { zh: "茶馆老板娘", en: "Teahouse Keeper" }, token: { zh: "茶", en: "T" }, family: null, home: null, work: null },
  ],
  items: [],
  player: { id: "player", zh: "总管", en: "Festival Manager", role: { zh: "灯会总管", en: "Manager" }, token: { zh: "总", en: "M" }, start: [10, 10], things: [] },
};

const REQUEST: Offer = { id: "material", name: { zh: "请周掌柜把木料送到桥边", en: "Ask Shopkeeper Zhou to bring the timber to the bridge" }, body: { kind: "material" } };
const STALL: Offer = { id: "stall:front", name: { zh: "许李老太一个前排摊位", en: "Promise Granny Li a front-row stall" }, body: { op: "make", due: 3, what: "stall", item: "front" } };
const WANTS: Wants = { key: "zhou_zhanggui|material|timber", token: "572e6130", asks: REQUEST.name, request: { ...REQUEST, status: "refused", task: null }, offer: STALL };

let tickNo = 0;
let day = 1;
const frameOf = (talk: boolean, extras: Record<string, unknown> = {}, bubbles: unknown[] = []): Frame =>
  ({
    npcs: [{ id: "zhou_zhanggui", x: 11, y: 10, activity: "work", carrying: null }],
    time: { day, hour: 9, minute: 0, phase: "day" },
    weather: "clear",
    bubbles,
    dots: [],
    lanterns: [],
    hud: { verbs: ["move", "leave", "ask", "entrust", "promise", "tell", "gift"] },
    player: { x: 10, y: 10, activity: "rest", talk: talk ? { npc: "zhou_zhanggui", costs: fake.COSTS, leaves_at: { hour: 15, minute: 30 } } : null, look: [], offers: {}, topics: [] },
    notebook: [],
    ending: null,
    ...extras,
  }) as unknown as Frame;

const step = (client: FakeClient, talk: boolean, events: CoreEvent[] = [], bubbles: unknown[] = [], extras: Record<string, unknown> = {}): void => {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameOf(talk, extras, bubbles), events, clock: { paused: false, rate: [1, 1] } });
};
const ack = (id: unknown, result: "applied" | "rejected", reason: string | null = null): CoreEvent => ({ kind: "action_ack", tick: tickNo, action_id: String(id), result, reason });
const settle = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const setup = () => {
  tickNo = 0;
  day = 1;
  const client = new FakeClient();
  client.state.scene = SCENE;
  const play = new Play(client as unknown as HostClient);
  step(client, true, [{ kind: "talk_start", tick: 0, npc: "zhou_zhanggui", leaves_at: { hour: 15, minute: 30 } }]);
  return { client, play };
};

test.describe("saying yes to what a person asks in return", () => {
  test("makes the promise as the core previewed it, without a second press, and offers the request that was turned down afterwards", async () => {
    const { client, play } = setup();
    play.flows.accept("zhou_zhanggui", WANTS);
    expect(play.flows.state.request).toMatchObject({ phase: "loading", verb: "promise", auto: true });
    await settle();
    // The core was asked for the preview of the promise, which is the person's offer, and the promise went out with the version of that preview.
    expect(client.asked).toEqual([{ op: "preview", action: { verb: "promise", npc: "zhou_zhanggui", op: "make", due: 3, what: "stall", item: "front" } }]);
    expect(client.last).toMatchObject({ type: "promise", op: "make", what: "stall", item: "front", due: 3, version: 43 });
    expect(play.flows.state.request?.phase).toBe("sending");
    step(client, true, [{ kind: "pledged", tick: tickNo, npc: "zhou_zhanggui", pledge: "k1", what: "stall", item: "front", amount: 0, due: 3 }, ack(client.last.action_id, "applied")]);
    const result = play.flows.state.request;
    if (result?.phase !== "result") throw new Error(`phase ${String(result?.phase)}`);
    expect(result).toMatchObject({ ok: true, verb: "promise", follow: { id: "material", body: { kind: "material" } } });

    // The player goes on: the request is looked at again, as a new preview on the state as it is now.
    client.previewAnswer = { ...fake.PREVIEW, version: 60 };
    play.flows.followUp();
    expect(play.flows.state.request).toMatchObject({ phase: "loading", verb: "entrust", npc: "zhou_zhanggui" });
    await settle();
    expect(client.asked.at(-1)).toEqual({ op: "preview", action: { verb: "entrust", npc: "zhou_zhanggui", kind: "material" } });
    expect(play.flows.state.request).toMatchObject({ phase: "preview", verb: "entrust", preview: { version: 60 } });
    // The request is sent only when the player confirms it.
    expect(client.sent).toHaveLength(1);
  });

  test("shows the reason where the promise was refused, and still offers the request", async () => {
    const { client, play } = setup();
    play.flows.accept("zhou_zhanggui", WANTS);
    await settle();
    step(client, true, [ack(client.last.action_id, "rejected", "empty")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, reason: "empty" });
  });

  test("goes back to a new preview when the state moved on, and still makes the promise by itself", async () => {
    const { client, play } = setup();
    play.flows.accept("zhou_zhanggui", WANTS);
    await settle();
    client.previewAnswer = { ...fake.PROMISE_PREVIEW, version: 77 };
    step(client, true, [ack(client.last.action_id, "rejected", "stale")]);
    expect(play.flows.state.request).toMatchObject({ phase: "loading", auto: true });
    await settle();
    expect(client.last).toMatchObject({ type: "promise", version: 77 });
  });

  /** The keys of `player.talk` of a talk in which the person asks `wants`, as the core sends them. */
  const talkOf = (wants: Wants) =>
    readTalkMore({
      npc: "zhou_zhanggui",
      ask_for: null,
      asks_more: [],
      wants: { key: wants.key, token: wants.token, asks: wants.asks, request: { id: "material", label: wants.asks, body: { kind: "material" }, status: "refused" }, offer: { id: STALL.id, label: STALL.name, body: STALL.body } },
      keep: null,
      give: { preferred: { id: STALL.id, label: STALL.name, body: STALL.body }, more: [], ways: [] },
      queue: [{ kind: "answer", key: wants.key, token: wants.token }, { kind: "give" }],
    });
  const shown = (play: Play, wants: Wants): string[] => contextItems(talkOf(wants), play.flows.state.declined).map((item) => item.kind);

  test("sends nothing when the player says no, and does not show the same proposal again", () => {
    const { client, play } = setup();
    expect(shown(play, WANTS)).toEqual(["answer", "give"]);
    play.flows.decline(WANTS);
    expect(client.sent).toEqual([]);
    expect(play.flows.state.declined).toHaveLength(1);
    expect(shown(play, WANTS)).toEqual(["give"]);
    play.flows.decline(WANTS);
    expect(play.flows.state.declined).toHaveLength(1);
    play.flows.decline({ ...WANTS, token: "" });
    expect(play.flows.state.declined).toHaveLength(1);
    play.flows.reset();
    expect(play.flows.state.declined).toEqual([]);
    expect(shown(play, WANTS)).toEqual(["answer", "give"]);
  });

  test("tells a proposal from another by the request it is for and the token together", () => {
    const { play } = setup();
    // Two requests weighed alike have one token, and the proposal put aside is the one the player said no to.
    const join: Wants = { ...WANTS, key: "zhou_zhanggui|join|" };
    play.flows.decline(WANTS);
    expect(shown(play, WANTS)).toEqual(["give"]);
    expect(shown(play, join)).toEqual(["answer", "give"]);
    // The same request with another token is a new question.
    expect(shown(play, { ...WANTS, token: "a3bc0f02" })).toEqual(["answer", "give"]);
    play.flows.decline(join);
    expect(shown(play, join)).toEqual(["give"]);
    expect(shown(play, WANTS)).toEqual(["give"]);
  });
});

test.describe("the topics asked of a person", () => {
  test("are remembered for the person and for the day, by the question the player asked", () => {
    const { client, play } = setup();
    play.ask("li_er", { zh: "李二", en: "Li Er" });
    expect(client.last).toMatchObject({ type: "ask", topic: "li_er" });
    expect([...play.flows.askedOf("zhou_zhanggui")]).toEqual(["li_er"]);
    expect([...play.flows.askedOf("cha_laoban")]).toEqual([]);
    // A new day asks again.
    day = 2;
    step(client, true);
    expect([...play.flows.askedOf("zhou_zhanggui")]).toEqual([]);
  });
});

test.describe("a gift", () => {
  test("is sent with the thing and no minutes, and its line and the person's answer are lines of the talk", () => {
    const { client, play } = setup();
    play.gift("tea", { zh: "茶叶", en: "tea leaves" });
    expect(client.last).toMatchObject({ type: "gift", item: "tea" });
    const reaction = { npc: "zhou_zhanggui", until: 99_999, text: { zh: "茶叶啊，我就爱这个，多谢！", en: "Tea leaves! Just what I like. Thank you!" } };
    step(client, true, [{ kind: "gifted", tick: tickNo, npc: "zhou_zhanggui", item: "tea", like: "like", gain: 8 }, ack(client.last.action_id, "applied")], [reaction]);
    expect(play.state.talk?.lines.map((l) => (l.who === "you" ? `you ${l.how}` : "them"))).toEqual(["you gift", "them"]);
  });

  test("that the town refuses is a note over the map with its reason", () => {
    const { client, play } = setup();
    play.gift("tea", { zh: "茶叶", en: "tea leaves" });
    step(client, true, [ack(client.last.action_id, "rejected", "gift_today")]);
    expect(play.state.notes.map((note) => [note.kind, note.key, note.reason])).toEqual([["refused", "ack.gift.gift_today", "gift_today"]]);
  });
});

test.describe("the hearts", () => {
  test("that move are said on the spot in the talk with the person, with the reason", () => {
    const { client, play } = setup();
    step(client, true, [{ kind: "hearts", tick: tickNo, npc: "zhou_zhanggui", delta: 2, hearts: 4, why: "kept" }]);
    expect(play.state.pops).toMatchObject([{ npc: "zhou_zhanggui", delta: 2, why: "kept" }]);
    expect(play.state.notes).toEqual([]);
  });

  test("that move for somebody else, or outside a talk, are not said: a speech in public moves the hearts of everybody who heard it", () => {
    const { client, play } = setup();
    step(client, true, [{ kind: "hearts", tick: tickNo, npc: "cha_laoban", delta: -1, hearts: 1, why: "hearsay" }]);
    expect(play.state.pops).toEqual([]);
    step(client, false, [{ kind: "hearts", tick: tickNo, npc: "zhou_zhanggui", delta: 1, hearts: 3, why: "kept" }]);
    expect(play.state.pops).toEqual([]);
    expect(play.state.notes).toEqual([]);
  });

  test("open on a card for a person, and the card is put away", () => {
    const { play } = setup();
    play.openHearts("zhou_zhanggui");
    expect(play.state.heartsOpen).toBe("zhou_zhanggui");
    play.closeHearts();
    expect(play.state.heartsOpen).toBeNull();
  });
});

test.describe("an answer", () => {
  test("carries the line of the notebook it wrote, so that the player can ask who told them", () => {
    const { client, play } = setup();
    play.ask("t_rail", { zh: "石桥栏杆", en: "Stone Bridge Railing" });
    const said = { npc: "zhou_zhanggui", until: 99_999, text: { zh: "我听周家伙计说的。", en: "I heard it from the clerk." } };
    step(client, true, [{ kind: "asked", tick: tickNo, npc: "zhou_zhanggui", topic: "t_rail", entry: "n1" }, ack(client.last.action_id, "applied")], [said]);
    expect(play.state.talk?.lines.at(-1)).toMatchObject({ who: "them", entry: "n1" });
  });

  test("has no entry where it wrote none", () => {
    const { client, play } = setup();
    play.ask("t_rail", { zh: "石桥栏杆", en: "Stone Bridge Railing" });
    const said = { npc: "zhou_zhanggui", until: 99_999, text: { zh: "不清楚。", en: "I do not know." } };
    step(client, true, [{ kind: "asked", tick: tickNo, npc: "zhou_zhanggui", topic: "t_rail", entry: null }, ack(client.last.action_id, "applied")], [said]);
    expect(play.state.talk?.lines.at(-1)).not.toHaveProperty("entry");
  });
});
