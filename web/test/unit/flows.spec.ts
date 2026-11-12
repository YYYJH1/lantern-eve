import { expect, test } from "@playwright/test";
import { pick, translate } from "../../src/i18n/index.ts";
import type { HostClient } from "../../src/page/client.ts";
import { keepOffer, recapKey, requestOffer, speechOffers } from "../../src/page/flows.ts";
import type { Offer } from "../../src/page/frame.ts";
import { Play } from "../../src/page/play.ts";
import type { CoreEvent, Frame, HostToPage } from "../../src/shared/protocol.ts";
import * as fake from "../support/slice.ts";

/** The part of the host client that the flows of the slice use, with a record of what it was asked to do. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null };
  readonly sent: Array<Record<string, unknown>> = [];
  readonly asked: Array<Record<string, unknown>> = [];
  /** What the host says to `preview`: the preview of a request to Li Da unless a test sets it. `Error` is a host that refuses. */
  previewAnswer: unknown = fake.PREVIEW;
  private ids = 0;
  touched = 0;
  private readonly taps: Array<(message: HostToPage) => void> = [];

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {
    this.touched++;
  }
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
    if (this.previewAnswer instanceof Error) return Promise.reject(this.previewAnswer);
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
  places: [
    { id: "p_teahouse", kind: "teahouse", indoor: true, rect: [30, 5, 4, 3], door: [31, 8], stands: [], cells: [], zh: "茶馆", en: "Teahouse" },
    { id: "p_bridge", kind: "bridge", indoor: false, rect: [10, 5, 4, 3], door: [11, 8], stands: [], cells: [], zh: "石桥", en: "Stone Bridge" },
  ],
  cast: [
    { id: "li_laotai", zh: "李老太", en: "Granny Li", role: { zh: "李家老太太", en: "Matriarch" }, token: { zh: "李", en: "L" }, family: "fam_li", home: null, work: null },
    { id: "li_da", zh: "李大", en: "Li Da", role: { zh: "管竹料", en: "Keeper of the bamboo" }, token: { zh: "李", en: "L" }, family: "fam_li", home: null, work: null },
    { id: "zhou_huoji", zh: "周家伙计", en: "Zhou's Clerk", role: { zh: "伙计", en: "Clerk" }, token: { zh: "周", en: "Z" }, family: "fam_zhou", home: null, work: null },
  ],
  items: [{ id: "bamboo", zh: "竹料", en: "Bamboo" }],
  player: { id: "player", zh: "总管", en: "Festival Manager", role: { zh: "灯会总管", en: "Manager" }, token: { zh: "总", en: "M" }, start: [10, 10], things: [] },
};

const REQUEST = { id: "ask_bamboo", name: { zh: "请李大把竹料送到桥边", en: "Ask Li Da to bring the bamboo to the bridge" }, body: { kind: "material" } };
const PROMISE = { id: "give_lamp", name: { zh: "让李家点主灯", en: "Let the Li family light the main lantern" }, body: { op: "make", what: "role", item: "t_honor_light", due: 3 } };

interface Moment {
  talk?: { npc: string } | null;
  extras?: Record<string, unknown>;
  hud?: Record<string, unknown>;
  bubbles?: unknown[];
}

const frameOf = (m: Moment): Frame =>
  ({
    npcs: [
      { id: "li_laotai", x: 11, y: 10, activity: "work", carrying: null },
      { id: "li_da", x: 20, y: 10, activity: "work", carrying: null },
    ],
    time: { day: 1, hour: 8, minute: 0, phase: "day" },
    weather: "clear",
    bubbles: m.bubbles ?? [],
    dots: [],
    lanterns: [],
    hud: m.hud ?? { verbs: ["move", "leave", "ask", "entrust", "promise"] },
    player: { x: 10, y: 10, activity: "rest", talk: m.talk === undefined || m.talk === null ? null : { npc: m.talk.npc, costs: fake.COSTS, leaves_at: { hour: 15, minute: 30 } }, look: [], offers: { entrust: [REQUEST], promise: [PROMISE] }, topics: [] },
    notebook: fake.notebook(),
    ending: null,
    ...(m.extras ?? {}),
  }) as unknown as Frame;

let tickNo = 0;
const step = (client: FakeClient, m: Moment, events: CoreEvent[] = []): void => {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameOf(m), events, clock: { paused: false, rate: [1, 1] } });
};
const ack = (id: unknown, result: "applied" | "rejected", reason: string | null = null): CoreEvent => ({ kind: "action_ack", tick: tickNo, action_id: String(id), result, reason });
const settle = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const setup = (m: Moment = { talk: { npc: "li_da" } }, scene: Record<string, unknown> = SCENE) => {
  tickNo = 0;
  const client = new FakeClient();
  client.state.scene = scene;
  const play = new Play(client as unknown as HostClient);
  step(client, m, [{ kind: "talk_start", tick: 0, npc: "li_da", leaves_at: { hour: 15, minute: 30 } }]);
  return { client, play };
};

test.describe("a request with a preview", () => {
  test("is looked up first, in the core, and sent only when the player confirms, with the version and the id of the preview", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    expect(play.flows.state.request?.phase).toBe("loading");
    await settle();
    const preview = play.flows.state.request;
    if (preview?.phase !== "preview") throw new Error(`phase ${String(preview?.phase)}`);
    expect(preview.preview).toMatchObject({ cost: 20, version: 42, odds: "mid", gives: null });
    expect(client.asked).toEqual([{ op: "preview", action: { verb: "entrust", npc: "li_da", kind: "material" } }]);
    // The preview changed nothing: no action went out.
    expect(client.sent).toEqual([]);

    play.flows.confirm();
    expect(client.last).toMatchObject({ type: "entrust", kind: "material", action_id: preview.actionId, version: 42 });
    expect(client.last).not.toHaveProperty("offer");
    expect(play.flows.state.request?.phase).toBe("sending");
    // A second press while it is on its way sends nothing more.
    play.flows.confirm();
    expect(client.sent).toHaveLength(1);
  });

  test("asks the core for a promise with the fields of the promise, and sends it with the version of its preview", async () => {
    const { client, play } = setup();
    client.previewAnswer = fake.PROMISE_PREVIEW;
    play.flows.begin("promise", "li_da", PROMISE);
    await settle();
    expect(client.asked).toEqual([{ op: "preview", action: { verb: "promise", npc: "li_da", op: "make", what: "role", item: "t_honor_light", due: 3 } }]);
    play.flows.confirm();
    expect(client.last).toMatchObject({ type: "promise", op: "make", what: "role", item: "t_honor_light", due: 3, version: 43 });
  });

  test("has no preview of its own when the host cannot give one: it says so, and sends nothing until the host does", async () => {
    for (const answer of [null, undefined, { nope: true }, new Error("bad_action")]) {
      const { client, play } = setup();
      client.previewAnswer = answer;
      play.flows.begin("entrust", "li_da", REQUEST);
      await settle();
      expect(play.flows.state.request).toMatchObject({ phase: "failed", verb: "entrust", npc: "li_da" });
      // Nothing to confirm: a press sends nothing.
      play.flows.confirm();
      expect(client.sent).toEqual([]);
      // Asking again, with a host that answers, gives the core's preview.
      client.previewAnswer = fake.PREVIEW;
      play.flows.retry();
      expect(play.flows.state.request?.phase).toBe("loading");
      await settle();
      expect(play.flows.state.request).toMatchObject({ phase: "preview", preview: { version: 42 } });
    }
  });

  test("shows the result where the preview was, with what the person said and what the core did", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    const reply = { npc: "li_da", until: 99_999, text: { zh: "答应了，明早送到桥边。", en: "Agreed. It will be at the bridge by morning." } };
    step(client, { talk: { npc: "li_da" }, bubbles: [reply] }, [
      { kind: "entrusted", tick: tickNo, npc: "li_da", request: "material", result: "agreed", pending: true },
      ack(client.last.action_id, "applied"),
    ]);
    const result = play.flows.state.request;
    if (result?.phase !== "result") throw new Error(`phase ${String(result?.phase)}`);
    expect(result).toMatchObject({ ok: true, reason: null, cost: 20, reply: reply.text });
    expect(result.facts.map((f) => f.key)).toEqual(["note.entrust.pending"]);
    // The talk shows the line of the request too.
    expect(play.state.talk?.lines.map((l) => l.who)).toEqual(["you", "them"]);
  });

  test("shows a refusal as the result, with the reason, and not as a note over the map", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "needs_nod")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, reason: "needs_nod" });
    expect(play.state.notes).toEqual([]);
  });

  test("goes back to a new preview when the state has moved on (the reason stale), and says so", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    client.previewAnswer = { ...fake.PREVIEW, version: 51 };
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "stale")]);
    expect(play.flows.state.request?.phase).toBe("loading");
    await settle();
    const again = play.flows.state.request;
    expect(again).toMatchObject({ phase: "preview", stale: true, preview: { version: 51 } });
    expect(client.asked).toHaveLength(2);
    // A new preview has a new id, so the new request is settled as itself.
    expect(again?.phase === "preview" && again.actionId).not.toBe(client.last.action_id);
    // And it goes out with the new version.
    play.flows.confirm();
    expect(client.last).toMatchObject({ type: "entrust", version: 51 });
  });

  test("does not take any other reason for a state that moved on", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "changed")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, reason: "changed" });
    expect(client.asked).toHaveLength(1);
  });

  test("keeps its answer when the person had to go as it was said, until the player puts it away or talks to somebody else", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "hard")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, reason: "hard" });
    // The minutes were paid for and the person went: the talk is over, and the answer is still there.
    step(client, { talk: null }, [{ kind: "talk_end", tick: tickNo, npc: "li_da", reason: "timeout" }]);
    expect(play.state.talk).toBeNull();
    expect(play.flows.state.request).toMatchObject({ phase: "result", npc: "li_da" });
    // It is put away with its button.
    play.flows.cancel();
    expect(play.flows.state.request).toBeNull();
    // Or a talk with somebody else is what it is not about.
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "hard")]);
    step(client, { talk: null }, [{ kind: "talk_end", tick: tickNo, npc: "li_da", reason: "timeout" }]);
    expect(play.flows.state.request?.phase).toBe("result");
    step(client, { talk: { npc: "li_laotai" } }, [{ kind: "talk_start", tick: tickNo, npc: "li_laotai", leaves_at: { hour: 15, minute: 30 } }]);
    expect(play.flows.state.request).toBeNull();
    // A preview, on the other hand, does not outlive its talk (above).
  });

  test("shows the minutes that a no took when the person answered it, and none when nobody did", async () => {
    const { client, play } = setup();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [{ kind: "replied", tick: tickNo, npc: "li_da" }, ack(client.last.action_id, "rejected", "refused")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, cost: 20 });
    play.flows.cancel();
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    play.flows.confirm();
    step(client, { talk: { npc: "li_da" } }, [ack(client.last.action_id, "rejected", "not_talking")]);
    expect(play.flows.state.request).toMatchObject({ phase: "result", ok: false, cost: null });
  });

  test("is put away with a cancel, and does not outlive the talk", async () => {
    const { client, play } = setup();
    client.previewAnswer = fake.PROMISE_PREVIEW;
    play.flows.begin("promise", "li_da", PROMISE);
    await settle();
    expect(play.flows.state.request?.phase).toBe("preview");
    play.flows.cancel();
    expect(play.flows.state.request).toBeNull();
    // A preview that comes in after the cancel is dropped.
    play.flows.begin("promise", "li_da", PROMISE);
    play.flows.cancel();
    await settle();
    expect(play.flows.state.request).toBeNull();
    play.flows.begin("promise", "li_da", PROMISE);
    await settle();
    step(client, { talk: null }, [{ kind: "talk_end", tick: tickNo, npc: "li_da", reason: "left" }]);
    expect(play.flows.state.request).toBeNull();
  });
});

test.describe("pairing two lines of the notebook", () => {
  test("takes the claim first and then a line shown against it, puts a line back, and a new claim keeps the line shown", () => {
    const { play } = setup();
    // The pair is [shown, claim].
    const pair = () => [play.flows.state.pair.a, play.flows.state.pair.b];
    // Nothing is shown before there is a claim.
    play.flows.present("n_clerk");
    expect(pair()).toEqual([null, null]);
    play.flows.claim("n_broke");
    expect(pair()).toEqual([null, "n_broke"]);
    play.flows.present("n_clerk");
    expect(pair()).toEqual(["n_clerk", "n_broke"]);
    // A line is not shown against itself, and another line takes the place of the one shown.
    play.flows.present("n_broke");
    expect(pair()).toEqual(["n_clerk", "n_broke"]);
    play.flows.present("n_boat");
    expect(pair()).toEqual(["n_boat", "n_broke"]);
    play.flows.present("n_boat");
    expect(pair()).toEqual([null, "n_broke"]);
    play.flows.present("n_clerk");
    play.flows.claim("n_boat");
    expect(pair()).toEqual(["n_clerk", "n_boat"]);
    // The line shown that becomes the claim leaves the place it was shown in.
    play.flows.claim("n_clerk");
    expect(pair()).toEqual([null, "n_clerk"]);
    play.flows.claim("n_clerk");
    expect(pair()).toEqual([null, null]);
  });

  test("sends the judgement as soon as an answer is given for a claim and a line shown, which are b and a, and shows what the core made of it", () => {
    const { client, play } = setup();
    play.flows.answer("unsupported");
    expect(client.sent).toEqual([]);
    play.flows.claim("n_broke");
    play.flows.answer("unsupported");
    expect(client.sent).toEqual([]);
    play.flows.present("n_clerk");
    play.flows.answer("unsupported");
    expect(client.last).toMatchObject({ type: "judge", a: "n_clerk", b: "n_broke", relation: "unsupported" });
    expect(play.flows.state.pair.waiting).toBe(client.last.action_id);
    // It is not sent twice while it waits.
    play.flows.answer("contradicts");
    expect(client.sent).toHaveLength(1);
    step(client, {}, [ack(client.last.action_id, "applied")]);
    expect(play.flows.state.pair).toMatchObject({ waiting: null, outcome: { a: "n_clerk", b: "n_broke", relation: "unsupported", ok: true, reason: null } });
  });

  test("hears that two lines alone do not show it (not_shown), in no note, and forgets the answer when the pair changes", () => {
    const { client, play } = setup();
    play.flows.claim("n_boat");
    play.flows.present("n_clerk");
    play.flows.answer("contradicts");
    step(client, {}, [ack(client.last.action_id, "rejected", "not_shown")]);
    expect(play.flows.state.pair.outcome).toMatchObject({ ok: false, relation: "contradicts", reason: "not_shown" });
    expect(play.state.notes).toEqual([]);
    // The same pair can be answered again, and nothing was written down.
    expect(play.flows.state.pair.waiting).toBeNull();
    play.flows.present("n_broke");
    expect(play.flows.state.pair).toMatchObject({ a: "n_broke", b: "n_boat", relation: null, outcome: null });
    // "Look at another pair" sends nothing.
    const sent = client.sent.length;
    play.flows.clear();
    expect(client.sent).toHaveLength(sent);
    expect(play.flows.state.pair).toEqual({ a: null, b: null, relation: null, waiting: null, outcome: null });
  });

  test("is told that a note is not in the notebook (unknown_note) in the same place", () => {
    const { client, play } = setup();
    play.flows.claim("n_gone");
    play.flows.present("n_clerk");
    play.flows.answer("unsupported");
    step(client, { extras: { notebook: fake.notebook().concat([{ id: "n_gone", text: { zh: "甲", en: "A" }, source: { kind: "seen" }, marks: [], chain: [] }]) } }, [ack(client.last.action_id, "rejected", "unknown_note")]);
    expect(play.flows.state.pair.outcome).toMatchObject({ ok: false, reason: "unknown_note" });
  });

  test("drops a line that the notebook no longer has", () => {
    const { client, play } = setup();
    play.flows.claim("n_broke");
    play.flows.present("n_clerk");
    step(client, { extras: { notebook: fake.notebook().filter((e) => e.id !== "n_broke") } });
    expect(play.flows.state.pair).toMatchObject({ a: null, b: null });
  });

  test("asks for a hint, which the core answers by lighting a pair or by lighting none, and says in the notebook what it lit only once it has answered", () => {
    const { client, play } = setup();
    play.flows.hint();
    expect(client.last).toMatchObject({ type: "hint" });
    // Until the core answers there is nothing to say: not even that it has nothing to light.
    expect(play.flows.state.hintWaiting).toBe(client.last.action_id);
    expect(play.flows.state.hintNone).toBe(false);
    step(client, {}, [ack(client.last.action_id, "applied")]);
    expect(play.flows.state).toMatchObject({ hintWaiting: null, hintNone: true });
    // A pair that is lit is not "nothing".
    play.flows.hint();
    step(client, { extras: { hint: { a: "n_clerk", b: "n_broke" } } }, [ack(client.last.action_id, "applied")]);
    expect(play.flows.state.hintNone).toBe(false);
    // The pair the core lit can be set side by side as it is: the line shown and the claim. The answer is the player's, even once the core has said it.
    play.flows.useHint();
    expect(play.flows.state.pair).toMatchObject({ a: "n_clerk", b: "n_broke", relation: null });
    step(client, { extras: { hint: { a: "n_clerk", b: "n_broke", relation: "unsupported" } } });
    play.flows.useHint();
    expect(play.flows.state.pair).toMatchObject({ a: "n_clerk", b: "n_broke", relation: null });
    expect(client.sent.filter((m) => m.type === "judge")).toEqual([]);
    // Taking a claim starts the pair over, and the hint with it.
    play.flows.claim("n_boat");
    expect(play.flows.state.hintNone).toBe(false);
  });

  test("sends the clarification with its claim, its basis and the judgement, waits for the core, and keeps what it said", () => {
    const { client, play } = setup();
    play.flows.clarify("n_broke", ["n_clerk"], "unsupported");
    expect(client.last).toMatchObject({ type: "speak", kind: "clarify", claim: "n_broke", basis: ["n_clerk"], judgment: "unsupported" });
    expect(play.flows.state.clarify).toMatchObject({ claim: "n_broke", basis: ["n_clerk"], waiting: client.last.action_id, ok: null });
    step(client, {}, [ack(client.last.action_id, "rejected", "overclaim")]);
    expect(play.flows.state.clarify).toMatchObject({ waiting: null, ok: false, reason: "overclaim" });
    // The rejection is shown with the speech, and in no note over the map.
    expect(play.state.notes).toEqual([]);
    play.flows.clarify("n_broke", ["n_clerk"], null);
    expect(client.last).not.toHaveProperty("judgment");
    step(client, {}, [ack(client.last.action_id, "applied")]);
    expect(play.flows.state.clarify).toMatchObject({ waiting: null, ok: true, reason: null });
  });
});

test.describe("what the core says of the slice", () => {
  test("a clarification opens its view until the player puts it away", () => {
    const { client, play } = setup({ talk: null });
    step(client, {}, [fake.clarified() as CoreEvent]);
    expect(play.flows.state.clarified?.audience).toHaveLength(4);
    expect(play.flows.state.clarified).toMatchObject({ claim: "n_broke", basis: ["n_clerk"], venue: "p_teahouse", accepted: 3 });
    expect(play.flows.state.clarified?.audience.map((h) => [h.npc, h.before, h.after])).toEqual([
      ["zhou_huoji", "against", "for"],
      ["li_laotai", "unsure", "for"],
      ["cha_laoban", "unsure", "for"],
      ["zhou_zhanggui", "against", "against"],
    ]);
    play.flows.dismissClarified();
    expect(play.flows.state.clarified).toBeNull();
  });

  test("the recap of the morning is kept from the one frame that has it until the player puts it away, and is not taken again for the same lines", () => {
    const { client, play } = setup({ talk: null });
    expect(play.flows.state.recap).toBeNull();
    step(client, { extras: fake.recap() }, [{ kind: "recap", tick: tickNo, lines: 3 }]);
    const key = recapKey(play.slice);
    expect(key).not.toBeNull();
    expect(play.flows.state.recap).toMatchObject({ key, lines: [{ events: [16, 26] }, { events: [12] }, { events: [16] }] });
    // The core sends it in one frame: the next ones have none, and the page still has it.
    step(client, {});
    step(client, {});
    expect(play.slice.recap).toBeNull();
    expect(play.flows.state.recap?.key).toBe(key);
    expect(play.flows.state.recap?.lines).toHaveLength(3);
    play.flows.dismissRecap();
    expect(play.flows.state.recap).toBeNull();
    expect(play.flows.state.recapSeen).toBe(key);
    // The same lines again are not shown again. The core saying it once more brings them back.
    step(client, { extras: fake.recap() });
    expect(play.flows.state.recap).toBeNull();
    step(client, { extras: fake.recap() }, [{ kind: "recap", tick: tickNo }]);
    expect(play.flows.state.recap?.key).toBe(key);
    // Other lines take the place of the ones on show.
    step(client, { extras: { recap: [{ text: { zh: "第三天的小结。", en: "The summary of the third day." }, events: [] }] } });
    expect(play.flows.state.recap?.lines.map((line) => line.text.en)).toEqual(["The summary of the third day."]);
  });

  test("a recording that is taken back to before the morning loses the recap, and one that goes on keeps it", () => {
    const { client, play } = setup({ talk: null });
    tickNo = 100;
    step(client, { extras: fake.recap() }, [{ kind: "recap", tick: tickNo }]);
    const at = tickNo;
    step(client, {});
    expect(play.flows.state.recap?.tick).toBe(at);
    // Taken back before the tick of the frame that had it: the morning has not come yet.
    client.feed({ type: "frame", tick: at - 40, advanced: false, frame: frameOf({}), events: [], clock: { paused: true, rate: [1, 1] } });
    expect(play.flows.state.recap).toBeNull();
  });

  test("the recap is kept with a save and comes back when the save is loaded, and a recap that was put away does not", () => {
    const { client, play } = setup({ talk: null });
    expect(play.flows.keep()).toBeNull();
    step(client, { extras: fake.recap() }, [{ kind: "recap", tick: tickNo }]);
    step(client, {});
    const notes = play.flows.keep();
    expect(notes).toMatchObject({ recap: { key: play.flows.state.recap?.key, lines: [{ events: [16, 26] }, { events: [12] }, { events: [16] }] } });
    // The notes go through the host as JSON.
    const stored = JSON.parse(JSON.stringify(notes)) as Record<string, unknown>;
    // A save is loaded: the game is new to the page, and then the notes come back.
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    expect(play.flows.state.recap).toBeNull();
    step(client, {});
    client.feed({ type: "loaded", info: { id: 1, name: "", tick: tickNo, hash: "h", savedHash: "h", match: true, hashesChecked: 0, reissued: 0, cancelledOpen: 0, page: stored } });
    expect(play.flows.state.recap?.lines.map((line) => line.text.en)).toEqual(fake.recapLines().map((line) => line.text.en));
    expect(play.flows.state.recap?.tick).toBe(tickNo);
    // The player puts it away, and what is kept with the next save is nothing.
    play.flows.dismissRecap();
    expect(play.flows.keep()).toBeNull();
    // Notes that are not a recap, or a recap with no lines, take nothing back.
    for (const page of [undefined, {}, { recap: null }, { recap: { key: "k", lines: [] } }, { recap: { lines: [{ text: { zh: "甲", en: "A" }, events: [] }] } }, { recap: [1] }]) {
      client.feed({ type: "reset", seed: 5, scenario: "bridge" });
      client.feed({ type: "loaded", info: { id: 1, name: "", tick: 0, hash: "h", savedHash: "h", match: true, hashesChecked: 0, reissued: 0, cancelledOpen: 0, page } as never });
      expect(play.flows.state.recap).toBeNull();
    }
    // The client asks the player's side what to keep with a save.
    play.flows.restore(stored);
    expect((client as unknown as { pageNotes: () => unknown }).pageNotes()).toMatchObject({ recap: { lines: [{}, {}, {}] } });
  });

  test("a task that changed, a promise, a delivery and an objection that was withdrawn are told in a note each", () => {
    const { client, play } = setup({ talk: null });
    // The notes over the map are at most four at a time, so the five events come in two frames.
    step(client, { extras: { ...fake.tasks("t_source"), ...fake.commitments("delivered") } }, [
      { kind: "task_changed", tick: 5, from: "t_bamboo_first", to: "t_source", reason: { zh: "李老太撤回了阻拦", en: "Granny Li dropped her objection" } },
      { kind: "commitment", tick: 5, id: "c_li_da_bamboo", state: "promised" },
      { kind: "commitment", tick: 5, id: "c_li_da_bamboo", state: "broken" },
    ]);
    step(client, { extras: { ...fake.tasks("t_source"), ...fake.commitments("delivered") } }, [
      { kind: "delivered", tick: 6, id: "c_li_da_bamboo", npc: "li_da", item: "bamboo", amount: 4, qty: 4, place: "p_bridge", task: 1 },
      { kind: "objection_withdrawn", tick: 6, npc: "li_laotai", what: "bamboo" },
    ]);
    expect(play.state.notes.map((n) => n.key)).toEqual(["note.commitment.promised", "note.commitment.broken", "note.delivered", "note.objectionWithdrawn"]);
    expect(play.state.notes[1]?.kind).toBe("bad");
    expect(play.state.notes[2]?.values).toMatchObject({ what: { zh: "四根竹料", en: "4 poles of bamboo" }, place: { en: "Stone Bridge" } });
    // `what` is the id of the thing she no longer stands in the way of, and the scene names it: in the middle of a sentence, so in lower case.
    expect(play.state.notes[3]?.values).toMatchObject({ name: { en: "Granny Li" }, what: { zh: "竹料", en: "bamboo" } });
  });

  test("a delivery is told in plain words: poles of bamboo and of timber in English, and the Chinese with the count in numerals", () => {
    const scene = { ...SCENE, items: [...SCENE.items, { id: "timber", zh: "木料", en: "Timber" }, { id: "tools", zh: "工具", en: "Tools" }] };
    const { client, play } = setup({ talk: null }, scene);
    step(client, {}, [
      { kind: "delivered", tick: 6, id: "m1", npc: "li_da", item: "bamboo", amount: 4, qty: 4, place: "p_bridge", task: 1 },
      { kind: "delivered", tick: 6, id: "m2", npc: "zhou_zhanggui", item: "timber", amount: 8, qty: 8, place: "p_bridge", task: 2 },
      // An event that says `qty` only, and an item with no way of its own, is counted as it is.
      { kind: "delivered", tick: 6, npc: "li_da", item: "tools", qty: 3, place: "p_bridge", task: 3 },
    ]);
    const said = (lang: "zh" | "en"): string[] =>
      play.state.notes.map((n) => translate(lang, n.key, Object.fromEntries(Object.entries(n.values).map(([key, value]) => [key, typeof value === "object" ? pick(value, lang) : value]))));
    expect(said("en")).toEqual(["4 poles of bamboo came to the Stone Bridge.", "8 poles of timber came to the Stone Bridge.", "3 tools came to the Stone Bridge."]);
    expect(said("zh")).toEqual(["四根竹料送到了石桥。", "八根木料送到了石桥。", "工具三份送到了石桥。"]);
  });

  test("an objection that was withdrawn is told by the name the core gives in both languages, where it gives one", () => {
    const { client, play } = setup({ talk: null });
    step(client, {}, [{ kind: "objection_withdrawn", tick: 6, npc: "li_laotai", what: { zh: "毁桥的指控", en: "the charge about the bridge" } }]);
    expect(play.state.notes.map((n) => n.key)).toEqual(["note.objectionWithdrawn"]);
    expect(play.state.notes[0]?.values).toMatchObject({ name: { en: "Granny Li" }, what: { zh: "毁桥的指控", en: "the charge about the bridge" } });
  });

  test("a task that changed is told in the reason the core gave, and by its name where the core gave none", () => {
    const { client, play } = setup({ talk: null });
    step(client, { extras: fake.tasks("t_source") }, [{ kind: "task_changed", tick: 5, from: "t_bamboo_first", to: "t_source", cause: "done", reason: { zh: "李老太撤回了阻拦", en: "Granny Li dropped her objection" } }]);
    expect(play.state.notes.map((n) => n.key)).toEqual(["note.taskChanged.reason"]);
    expect(play.state.notes[0]?.values).toMatchObject({ reason: { en: "Granny Li dropped her objection" } });
    expect(play.flows.state.change).toEqual({ from: "t_bamboo_first", to: "t_source", reason: { zh: "李老太撤回了阻拦", en: "Granny Li dropped her objection" }, cause: "done", tick: 5 });
    // A task the frame does not list is named by its id when there is no reason to give.
    step(client, { extras: fake.tasks("t_source") }, [{ kind: "task_changed", tick: 6, from: "t_source", to: "t_unlisted" }]);
    expect(play.state.notes[1]?.key).toBe("note.taskChanged");
    expect(play.state.notes[1]?.values).toMatchObject({ task: { en: "t_unlisted" } });
    expect(play.flows.state.change).toMatchObject({ to: "t_unlisted", cause: "", reason: { zh: "", en: "" } });
    // A new game forgets it.
    play.flows.reset();
    expect(play.flows.state.change).toBeNull();
  });
});

test.describe("a lead", () => {
  test("is a person a reply sent the player to, kept once, brought into view and ringed, and gone when the player talks to them", () => {
    const { client, play } = setup({ talk: { npc: "li_laotai" } });
    const focused: string[] = [];
    play.onFocus = (id) => focused.push(id);
    play.pointTo("zhou_huoji", "li_laotai");
    play.pointTo("zhou_huoji", "li_laotai");
    expect(play.flows.state.leads).toEqual([{ npc: "zhou_huoji", from: "li_laotai" }]);
    expect(focused).toEqual(["zhou_huoji", "zhou_huoji"]);
    expect(play.state.ping).toMatchObject({ id: "zhou_huoji", kind: "person" });
    // Nobody is a lead of their own words.
    play.pointTo("li_laotai", "li_laotai");
    expect(play.flows.state.leads).toHaveLength(1);
    // Talking to them is following the lead.
    step(client, { talk: { npc: "zhou_huoji" } }, [{ kind: "talk_start", tick: tickNo, npc: "zhou_huoji", leaves_at: { hour: 15, minute: 30 } }]);
    expect(play.flows.state.leads).toEqual([]);
    // A page that plays a recording makes no lead.
    const watching = new Play(new FakeClient() as unknown as HostClient, true);
    watching.pointTo("zhou_huoji", "li_laotai");
    expect(watching.flows.state.leads).toEqual([]);
  });

  test("is the person the event of the answer names (`pointer`), and the words of the line are never read for a name", () => {
    const { client, play } = setup({ talk: { npc: "li_laotai" } });
    const text = { zh: "这事我不清楚，不过听周家伙计说起过，你去问问。", en: "I don't know, but I heard Zhou's Clerk speak of it. Go and ask." };
    const asked = (extra: Record<string, unknown> = {}, npc = "li_laotai"): CoreEvent => ({ kind: "asked", tick: tickNo, npc, topic: "li_er", answer: "ignorant", path: "", prop: null, source: null, entry: null, new: false, ...extra });
    const answer = (extra: CoreEvent[], line: { zh: string; en: string } = text) => {
      play.ask("li_er", { zh: "李二", en: "Li Er" });
      step(client, { talk: { npc: "li_laotai" }, bubbles: [{ npc: "li_laotai", until: 99_999, text: line }] }, [...extra, ack(client.last.action_id, "applied")]);
      return play.state.talk?.lines.at(-1);
    };
    // The answer points the way, and says whom by id.
    expect(answer([asked({ pointer: "zhou_huoji" })])).toEqual({ who: "them", text, points: ["zhou_huoji"] });
    // The same words after an answer that has no pointer name nobody: a name in a line is only a name.
    expect(answer([asked()])).toEqual({ who: "them", text });
    expect(answer([asked({ answer: "claim", prop: "pr_liner_looking" })])).toEqual({ who: "them", text });
    expect(answer([asked({ answer: "evasive" })])).toEqual({ who: "them", text });
    expect(answer([])).toEqual({ who: "them", text });
    // The question of somebody else is not this answer's.
    expect(answer([asked({ pointer: "zhou_huoji" }, "li_da")])).toEqual({ who: "them", text });
    // The id is what counts: a line that says another name still points to the one the core named.
    const other = { zh: "这事我不清楚，你去问问周家伙计吧。", en: "I know nothing of it. Ask the clerk." };
    expect(answer([asked({ pointer: "zhou_huoji" })], other)).toEqual({ who: "them", text: other, points: ["zhou_huoji"] });
    // A pointer that is not an id points nowhere.
    expect(answer([asked({ pointer: "" })])).toEqual({ who: "them", text });
    expect(answer([asked({ pointer: 7 })])).toEqual({ who: "them", text });
  });

  test("is not found in a bubble: the frame carries no list of the people a line sends the player to", () => {
    const { client, play } = setup({ talk: { npc: "li_laotai" } });
    const text = { zh: "去问问周家伙计。", en: "Ask Zhou's Clerk." };
    play.ask("li_er", { zh: "李二", en: "Li Er" });
    step(client, { talk: { npc: "li_laotai" }, bubbles: [{ npc: "li_laotai", until: 99_999, text, points: ["li_da"] }] }, [{ kind: "asked", tick: tickNo, npc: "li_laotai", answer: "ignorant", pointer: "zhou_huoji" }, ack(client.last.action_id, "applied")]);
    expect(play.state.talk?.lines.at(-1)).toEqual({ who: "them", text, points: ["zhou_huoji"] });
    expect(play.view?.bubbles[0]).toEqual({ npc: "li_laotai", until: 99_999, text });
  });

  test("keeps the five newest, and a new game forgets them", () => {
    const { play } = setup({ talk: { npc: "li_laotai" } });
    for (const npc of ["a", "b", "c", "d", "e", "f"]) play.pointTo(npc, "li_laotai");
    expect(play.flows.state.leads.map((l) => l.npc)).toEqual(["b", "c", "d", "e", "f"]);
    play.flows.dropLead("c");
    expect(play.flows.state.leads.map((l) => l.npc)).toEqual(["b", "d", "e", "f"]);
    play.flows.dropLead("nobody");
    play.flows.reset();
    expect(play.flows.state.leads).toEqual([]);
  });
});

test.describe("a task's button", () => {
  const task = (verb: string, extra: Record<string, unknown> = {}) => ({ id: "t", kind: "lead", job: null, text: { zh: "甲", en: "A" }, why: null, next: null, state: "open" as const, blocker: null, action: { verb, npc: null, place: null, item: null, ...extra }, window: null, expected: null });

  test("talks to the person it names, walks to the place it names, and looks, listens and rallies", () => {
    const { client, play } = setup({ talk: null });
    play.flows.run(task("talk", { npc: "li_laotai" }));
    expect(client.last).toMatchObject({ type: "talk", npc: "li_laotai" });
    play.flows.run(task("move", { place: "p_teahouse" }));
    expect(client.last).toMatchObject({ type: "move", place: "p_teahouse" });
    play.flows.run(task("look", { item: "t_rail" }));
    expect(client.last).toMatchObject({ type: "look", at: "t_rail" });
    play.flows.run(task("listen"));
    expect(client.last).toMatchObject({ type: "listen" });
    play.flows.run(task("rally"));
    expect(client.last).toMatchObject({ type: "rally" });
    const sent = client.sent.length;
    play.flows.run({ ...task("talk"), action: null });
    play.flows.run(task("dance"));
    expect(client.sent).toHaveLength(sent);
  });

  test("walks to the place a look names while the thing lies out of reach, and looks once it is near", () => {
    const { client, play } = setup({ talk: null });
    const rail = task("look", { item: "t_rail", place: "p_bridge" });
    play.flows.run(rail);
    expect(client.last).toMatchObject({ type: "move", place: "p_bridge" });
    const near = { player: { x: 11, y: 9, activity: "rest", talk: null, look: ["t_rail"], offers: { entrust: [], promise: [] }, topics: [] } };
    step(client, { talk: null, extras: near });
    play.flows.run(rail);
    expect(client.last).toMatchObject({ type: "look", at: "t_rail" });
    // A place that is itself looked at is walked to in the same way, and a thing with no place named is looked at where the player stands.
    step(client, { talk: null });
    play.flows.run(task("look", { place: "p_bridge" }));
    expect(client.last).toMatchObject({ type: "move", place: "p_bridge" });
    play.flows.run(task("look", { item: "t_rail" }));
    expect(client.last).toMatchObject({ type: "look", at: "t_rail" });
  });

  test("opens the notebook for a card that asks for the lines to be judged", () => {
    const { client, play } = setup({ talk: null });
    const opened: boolean[] = [];
    play.guide.onNotebook = (open) => void opened.push(open);
    const sent = client.sent.length;
    play.flows.run(task("judge"));
    expect(opened).toEqual([true]);
    expect(client.sent).toHaveLength(sent);
  });

  test("starts the talk first for a verb of a talk and leaves the list for the talk area to open, once", () => {
    const { client, play } = setup({ talk: null });
    play.flows.run(task("ask_source", { npc: "li_laotai" }));
    expect(client.last).toMatchObject({ type: "talk", npc: "li_laotai" });
    expect(play.flows.takeSuggestion("li_da")).toBeNull();
    expect(play.flows.takeSuggestion("li_laotai")).toBe("ask_source");
    expect(play.flows.takeSuggestion("li_laotai")).toBeNull();
    // Already talking to them: no second talk.
    step(client, { talk: { npc: "li_laotai" } }, [{ kind: "talk_start", tick: tickNo, npc: "li_laotai", leaves_at: { hour: 15, minute: 30 } }]);
    const sent = client.sent.length;
    play.flows.run(task("entrust", { npc: "li_laotai" }));
    expect(client.sent).toHaveLength(sent);
    expect(play.flows.takeSuggestion("li_laotai")).toBe("entrust");
    play.flows.run(task("speak"));
    expect(play.flows.takeSuggestion(null)).toBe("speak");
  });

  test("lets the wish for a list go when the player talks to somebody else or the walk comes to nothing", () => {
    const { client, play } = setup({ talk: null });
    play.flows.run(task("ask_source", { npc: "li_laotai" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "ask_source", npc: "li_laotai" });
    // A talk with Li Da is not the talk it asked for.
    step(client, { talk: { npc: "li_da" } }, [{ kind: "talk_start", tick: tickNo, npc: "li_da", leaves_at: { hour: 15, minute: 30 } }]);
    expect(play.flows.state.suggest).toBeNull();
    step(client, { talk: null }, [{ kind: "talk_end", tick: tickNo, npc: "li_da", reason: "left" }]);
    // A walk that never gets there lets it go after a minute of the common pace.
    play.flows.run(task("ask_source", { npc: "li_laotai" }));
    for (let i = 0; i < 61; i++) tickNo += 10;
    step(client, { talk: null });
    expect(play.flows.state.suggest).toBeNull();
    // And the wish of speaking up, which has no person, is kept while the player is not in a talk.
    play.flows.run(task("speak"));
    step(client, { talk: null });
    expect(play.flows.state.suggest).toMatchObject({ verb: "speak", npc: "" });
  });

  test("follows a task with the action track", () => {
    const { client, play } = setup({ talk: null });
    play.flows.track("t_source");
    expect(client.last).toMatchObject({ type: "track", task: "t_source" });
  });

  test("keeps the request it asks of the person, and the person to talk round, for the talk area to have ready", () => {
    const { client, play } = setup({ talk: null });
    play.flows.run(task("entrust", { npc: "li_laotai", item: "bamboo", request: "lend" }));
    expect(client.last).toMatchObject({ type: "talk", npc: "li_laotai" });
    expect(play.flows.state.suggest).toMatchObject({ verb: "entrust", npc: "li_laotai", request: "lend", target: null });
    expect(play.flows.takeSuggestion("li_laotai")).toBe("entrust");
    expect(play.flows.state.suggest).toBeNull();
    play.flows.run(task("entrust", { npc: "li_xiaomei", request: "persuade", target: "zhou_erlang" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "entrust", npc: "li_xiaomei", request: "persuade", target: "zhou_erlang" });
    // A request that names only the thing, as the bamboo of the first day does, asks for no request in particular.
    play.flows.run(task("entrust", { npc: "li_laotai", item: "bamboo" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "entrust", npc: "li_laotai", request: null, target: null });
  });

  test("keeps the promise it keeps, for the talk area to have the offer that keeps it ready", () => {
    const { client, play } = setup({ talk: null });
    play.flows.run(task("promise", { npc: "li_laotai", item: "k1", kind: "keep" }));
    expect(client.last).toMatchObject({ type: "talk", npc: "li_laotai" });
    expect(play.flows.state.suggest).toMatchObject({ verb: "promise", npc: "li_laotai", kind: "keep", item: "k1" });
    expect(play.flows.takeSuggestion("li_laotai")).toBe("promise");
    // A promise that is only made asks for no promise in particular.
    play.flows.run(task("promise", { npc: "li_laotai" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "promise", npc: "li_laotai", kind: null, item: null });
  });

  test("opens the notebook to clear a claim up, and asks for the list of what to say for the other kinds of speech", () => {
    const { play } = setup({ talk: null });
    const opened: boolean[] = [];
    play.guide.onNotebook = (open) => void opened.push(open);
    play.flows.run(task("speak", { kind: "clarify" }));
    expect(opened).toEqual([true]);
    expect(play.flows.state.suggest).toBeNull();
    play.flows.run(task("speak", { kind: "evidence" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "speak", npc: "", kind: "evidence" });
    play.flows.run(task("speak", { kind: "meal" }));
    expect(play.flows.state.suggest).toMatchObject({ verb: "speak", kind: "meal" });
    play.flows.run(task("speak"));
    expect(play.flows.state.suggest).toMatchObject({ verb: "speak", kind: null });
    expect(opened).toEqual([true]);
  });
});

test.describe("the request a task names", () => {
  /** The offers the town puts forward to `npc`, as the page reads them. */
  const offers = (npc: string): Offer[] => fake.entrustOffers(npc).map((raw) => ({ id: String(raw.id), name: raw.label as { zh: string; en: string }, body: raw.body as Record<string, unknown> }));

  test("is found among the offers of the person by its kind, and for persuasion by the person to talk round", () => {
    expect(requestOffer(offers("li_da"), "material", null)?.id).toBe("material");
    expect(requestOffer(offers("zhou_zhanggui"), "material", null)?.name.en).toBe("Ask Shopkeeper Zhou to bring the timber to the bridge");
    expect(requestOffer(offers("miaozhu"), "lane", null)?.id).toBe("lane");
    expect(requestOffer(offers("li_laotai"), "lend", null)?.id).toBe("lend");
    expect(requestOffer(offers("gengfu"), "testify", null)?.id).toBe("testify");
    expect(requestOffer(offers("zhou_dalang"), "join", null)?.id).toBe("join");
    expect(requestOffer(offers("zuzhang"), "convene", null)?.id).toBe("convene");
    expect(requestOffer(offers("li_xiaomei"), "persuade", "zhou_erlang")?.id).toBe("persuade:zhou_erlang");
    expect(requestOffer(offers("li_xiaomei"), "persuade", "zhou_dalang")?.id).toBe("persuade:zhou_dalang");
  });

  test("is none when the person cannot be asked that now, or the person to talk round is not one they can be asked about", () => {
    expect(requestOffer(offers("li_da"), "lane", null)).toBeNull();
    expect(requestOffer(offers("li_da"), "persuade", "zhou_erlang")).toBeNull();
    expect(requestOffer(offers("li_xiaomei"), "persuade", "li_er")).toBeNull();
    expect(requestOffer(offers("li_xiaomei"), "persuade", null)).toBeNull();
    expect(requestOffer([], "material", null)).toBeNull();
    // An offer with no body is no request.
    expect(requestOffer([{ id: "x", name: { zh: "x", en: "x" }, body: null }], "material", null)).toBeNull();
  });
});

test.describe("the promise a task keeps", () => {
  const words = { zh: "x", en: "x" };
  const offers: Offer[] = [
    { id: "wage:10", name: words, body: { what: "wage", amount: 10 } },
    { id: "keep:k1", name: { zh: "兑现许诺 k1", en: "Keep promise k1" }, body: { op: "keep", id: "k1" } },
    { id: "keep:k12", name: { zh: "兑现许诺 k12", en: "Keep promise k12" }, body: { op: "keep", id: "k12" } },
  ];

  test("is the offer that keeps it among the offers of a promise, found by the number the task names", () => {
    expect(keepOffer(offers, "k1")?.body).toEqual({ op: "keep", id: "k1" });
    expect(keepOffer(offers, "k12")?.id).toBe("keep:k12");
  });

  test("is none when that promise is not open with this person now", () => {
    expect(keepOffer(offers, "k2")).toBeNull();
    expect(keepOffer([], "k1")).toBeNull();
  });
});

test.describe("the kind of speech a task names", () => {
  const offers = fake.SPEAK_OFFERS.map((raw) => ({ id: raw.id, body: raw.body as Record<string, unknown> }));

  test("cuts the list of what to say down to the evidence or to the table, and leaves it whole for any other kind", () => {
    expect(speechOffers(offers, "evidence").map((o) => o.id)).toEqual(["all", "item:e_scrape"]);
    expect(speechOffers(offers, "meal").map((o) => o.id)).toEqual(["meal"]);
    expect(speechOffers(offers, null).map((o) => o.id)).toEqual(["all", "item:e_scrape", "meal"]);
    // A kind the town does not put forward now (nothing is held to show) leaves nothing, and does not offer the table in its place.
    expect(speechOffers(offers.filter((o) => o.body.kind === "meal"), "evidence")).toEqual([]);
    expect(speechOffers(offers, "dance").map((o) => o.id)).toEqual(["all", "item:e_scrape", "meal"]);
    expect(speechOffers([], "meal")).toEqual([]);
  });
});

test.describe("a new game", () => {
  test("clears what the flows kept", async () => {
    const { client, play } = setup();
    play.flows.claim("n_clerk");
    play.flows.begin("entrust", "li_da", REQUEST);
    await settle();
    client.feed({ type: "reset", seed: 5, scenario: "bridge" });
    expect(play.flows.state.pair.b).toBeNull();
    expect(play.flows.state.request).toBeNull();
    expect(play.flows.state.recapSeen).toBeNull();
  });
});
