import { expect, test } from "@playwright/test";
import { setLang, translate } from "../../src/i18n/index.ts";
import type { HostClient } from "../../src/page/client.ts";
import { POINTED_MS } from "../../src/page/flows.ts";
import { Play } from "../../src/page/play.ts";
import { EMPTY_SLICE, readSlice, readStatement, SPEECHES, type StatementCard, type StatementPartCard, type Task } from "../../src/page/slice.ts";
import { actionLabel } from "../../src/page/ui/actions.ts";
import { chosenCount, chosenOption, marksOf, partName, partNames, partsOf, stateButton, wrongLine } from "../../src/page/ui/statement-text.ts";
import type { CoreEvent, Frame, HostToPage } from "../../src/shared/protocol.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// The statement card without a page: the reader of the `statement` key of a frame, the words and the state of the button as functions
// of it, the labels of the buttons of the tasks that fill it in and make the statement, and what the flows send and keep.

const frameWith = (statement: unknown): Record<string, unknown> => ({ statement });

test.describe("the reader of the statement key", () => {
  test("reads a full card: the three parts in order with their options, the counts, the entries, the choice, and what the button needs", () => {
    const card = readStatement(frameWith(stmt.statementKey({ cause: "c_boat" }, { last: stmt.LAST_WRONG })));
    if (card === null) throw new Error("no card");
    expect(card.parts.map((p) => p.part)).toEqual(["cause", "course", "rumour"]);
    expect(card.parts.map((p) => p.options.length)).toEqual([4, 3, 3]);
    const cause = card.parts[0];
    expect(cause?.title).toEqual({ zh: "桥是怎么坏的", en: "How the bridge broke" });
    expect(cause?.chosen).toBe("c_boat");
    expect(cause?.gap).toBe(false);
    expect(cause?.options[0]).toEqual({ id: "c_boat", text: { zh: "船夫老何夜里撑船，船头撞断了栏杆", en: "Boatman He's boat struck the railing in the night" }, support: 2, against: 0, entries: ["n_scrape", "n_boat"] });
    expect(card.parts[1]?.chosen).toBeNull();
    expect(card.canState).toBe(false);
    expect(card.whyNot).toEqual(stmt.WHY_NOT);
    expect(card.usedToday).toBe(false);
    // The statement made last: where it stood, whether it told, which part did not hold, and why.
    expect(card.last).toEqual({ day: 4, hour: 18, venue: "p_teahouse", named: 7, accepted: 6, percent: 86, elder: "accepted", why: stmt.LAST_WRONG.why, told: false, wrong: ["cause"] });
  });

  test("reads a card that can be stated: the button is on, and there is no reason against it", () => {
    const card = readStatement(frameWith(stmt.readyKey()));
    expect(card?.canState).toBe(true);
    expect(card?.whyNot).toBeNull();
    expect(card?.parts.map((p) => p.chosen)).toEqual(["c_boat", "r_night_boat", "u_clerk_saw"]);
  });

  test("puts the parts in order whatever order the frame gives them, and leaves out a part it does not know", () => {
    const parts = stmt.partsOf();
    const card = readStatement(frameWith({ parts: [parts[2], { part: "motive", options: [] }, parts[0], parts[1], parts[1]] }));
    expect(card?.parts.map((p) => p.part)).toEqual(["cause", "course", "rumour"]);
  });

  test("keeps the options it can use: one with no id or no words is left out, a repeated one is read once, and a count is not below nothing", () => {
    const card = readStatement(
      frameWith({
        parts: [
          {
            part: "cause",
            options: [
              { id: "a", text: { zh: "甲", en: "A" }, support: -3, against: 2.9, entries: ["n_a", "n_a", 7, "", "n_b"] },
              { id: "", text: { zh: "乙", en: "B" } },
              { id: "c" },
              { id: "a", text: { zh: "重复", en: "Again" }, support: 9, against: 9 },
              "x",
              { id: "d", text: "just words" },
            ],
            chosen: "a",
          },
        ],
      }),
    );
    const options = card?.parts[0]?.options ?? [];
    expect(options.map((o) => o.id)).toEqual(["a", "d"]);
    expect(options[0]).toEqual({ id: "a", text: { zh: "甲", en: "A" }, support: 0, against: 2, entries: ["n_a", "n_b"] });
    expect(options[1]?.text).toEqual({ zh: "just words", en: "just words" });
  });

  test("reads a card with fields missing: no choice, no reason, nothing made today, no statement made last, and the button off", () => {
    const card = readStatement(frameWith({}));
    expect(card).toEqual({ parts: [], canState: false, whyNot: null, usedToday: false, last: null });
    const part = readStatement(frameWith({ parts: [{ part: "course" }] }))?.parts[0];
    expect(part).toEqual({ part: "course", title: null, options: [], chosen: null, gap: true });
    // `can_state` is a yes only when it is true.
    expect(readStatement(frameWith({ can_state: "yes" }))?.canState).toBe(false);
    expect(readStatement(frameWith({ used_today: 1 }))?.usedToday).toBe(false);
    expect(readStatement(frameWith({ used_today: true }))?.usedToday).toBe(true);
    // A reason that is not words is no reason.
    expect(readStatement(frameWith({ why_not: 5 }))?.whyNot).toBeNull();
    expect(readStatement(frameWith({ why_not: {} }))?.whyNot).toBeNull();
  });

  test("says a gap where the frame does, and where it does not by whether any note is behind an option", () => {
    const said = readStatement(frameWith({ parts: [{ part: "cause", gap: true, options: [{ id: "a", text: "A", support: 3, against: 0 }] }] }));
    expect(said?.parts[0]?.gap).toBe(true);
    const held = readStatement(frameWith({ parts: [{ part: "cause", options: [{ id: "a", text: "A", support: 0, against: 1 }] }] }));
    expect(held?.parts[0]?.gap).toBe(false);
    const none = readStatement(frameWith({ parts: [{ part: "cause", options: [{ id: "a", text: "A", support: 0, against: 0 }] }] }));
    expect(none?.parts[0]?.gap).toBe(true);
    const unsaid = readStatement(frameWith({ parts: [{ part: "cause", gap: false, options: [{ id: "a", text: "A" }] }] }));
    expect(unsaid?.parts[0]?.gap).toBe(false);
  });

  test("reads the statement made last: the share and the elder are kept inside what they can be, and the parts that did not hold in order", () => {
    const card = readStatement(frameWith({ last: { day: 5, hour: 19, venue: "", named: -2, accepted: 3, percent: 140, elder: "asleep", told: "yes", wrong: ["rumour", "cause", "cause", "motive"], why: { zh: "没有人亲眼看见", en: "Nobody saw it" } } }));
    expect(card?.last).toEqual({ day: 5, hour: 19, venue: null, named: 0, accepted: 3, percent: 100, elder: null, why: { zh: "没有人亲眼看见", en: "Nobody saw it" }, told: false, wrong: ["cause", "rumour"] });
    // Without the day and the hour there is no statement to show.
    expect(readStatement(frameWith({ last: { named: 4 } }))?.last).toBeNull();
    expect(readStatement(frameWith({ last: "now" }))?.last).toBeNull();
    expect(readStatement(frameWith({ last: stmt.LAST_TOLD }))?.last?.told).toBe(true);
  });

  test("is null where the frame has no card, whatever else is in it", () => {
    expect(readStatement({})).toBeNull();
    expect(readStatement({ statement: null })).toBeNull();
    expect(readStatement({ statement: "card" })).toBeNull();
    expect(readStatement({ statement: [] })).toBeNull();
    expect(readStatement({ board: fake.boardKey() })).toBeNull();
    expect(EMPTY_SLICE.statement).toBeNull();
    expect(readSlice(null).statement).toBeNull();
  });

  test("is part of the slice of a frame, and the board keeps its own summary of the parts", () => {
    const slice = readSlice({ statement: stmt.statementKey(), board: fake.boardKey({ statement: [{ part: "cause", support: 3, against: 2, gap: false }] }) });
    expect(slice.statement?.parts).toHaveLength(3);
    expect(slice.board?.statement).toEqual([{ part: "cause", support: 3, against: 2, gap: false }]);
    expect(readSlice({ board: fake.boardKey() }).statement).toBeNull();
  });

  test("lists statement among the ways to speak in public", () => {
    expect(SPEECHES).toEqual(["evidence", "meal", "clarify", "statement"]);
  });
});

test.describe("the words and the state of the card", () => {
  test("fills in a part the frame leaves out, so that the card always has the three", () => {
    const card = readStatement(frameWith({ parts: [stmt.partsOf()[1]] }));
    if (card === null) throw new Error("no card");
    const parts = partsOf(card);
    expect(parts.map((p) => p.part)).toEqual(["cause", "course", "rumour"]);
    expect(parts[0]).toEqual({ part: "cause", title: null, options: [], chosen: null, gap: true });
    expect(parts[1]?.options).toHaveLength(3);
  });

  test("names a part by the question it answers, whatever the core calls it, in both languages", () => {
    const card = readStatement(frameWith({ parts: [{ ...stmt.partsOf()[0], title: { zh: "成因", en: "Cause" } }, { part: "course" }] }));
    const [cause, course, rumour] = partsOf(card ?? { parts: [], canState: false, whyNot: null, usedToday: false, last: null });
    if (cause === undefined || course === undefined || rumour === undefined) throw new Error("no parts");
    setLang("en");
    // A title of the core's that is not the card's name ("Cause") is not used: the card has one name for each part.
    expect(cause.title).not.toBeNull();
    expect([partName(cause, "en"), partName(course, "en"), partName(rumour, "en")]).toEqual(["How the bridge broke", "What happened that night", "Why people got it wrong"]);
    expect(partName(cause, "zh")).toBe("桥是怎么坏的");
    setLang("zh");
    expect([partName(course, "zh"), partName(rumour, "zh")]).toEqual(["那晚的经过", "大家为什么会误会"]);
    setLang("en");
  });

  test("knows the option chosen and how many parts have one", () => {
    const none = readStatement(frameWith(stmt.statementKey()));
    const two = readStatement(frameWith(stmt.statementKey({ cause: "c_boat", rumour: "u_made_up" })));
    expect(chosenCount(null)).toBe(0);
    expect(chosenCount(none)).toBe(0);
    expect(chosenCount(two)).toBe(2);
    expect(chosenOption(partsOf(two ?? EMPTY_CARD)[0] ?? EMPTY_PART)?.id).toBe("c_boat");
    expect(chosenOption(partsOf(two ?? EMPTY_CARD)[1] ?? EMPTY_PART)).toBeUndefined();
    // A choice that the list does not show is a choice, and has no words.
    const odd = readStatement(frameWith({ parts: [{ part: "cause", chosen: "c_gone", options: [{ id: "a", text: "A" }] }] }));
    expect(chosenCount(odd)).toBe(1);
    expect(chosenOption(partsOf(odd ?? EMPTY_CARD)[0] ?? EMPTY_PART)).toBeUndefined();
  });

  test("shows the marks of an option: the notes for it, the notes against it, and whether any bears on it", () => {
    expect(marksOf({ id: "a", text: { zh: "甲", en: "A" }, support: 2, against: 1, entries: [] })).toEqual({ support: 2, against: 1, held: true });
    expect(marksOf({ id: "a", text: { zh: "甲", en: "A" }, support: 0, against: 0, entries: [] })).toEqual({ support: 0, against: 0, held: false });
  });

  test("turns the button on when the core says so, and says why not in the core's words, else its own", () => {
    const ready = readStatement(frameWith(stmt.readyKey()));
    expect(stateButton(ready, false, "en")).toEqual({ enabled: true, why: null, state: "ok" });
    // While the statement waits for the core the button is off and says nothing under it.
    expect(stateButton(ready, true, "en")).toEqual({ enabled: false, why: null, state: "waiting" });
    const early = readStatement(frameWith(stmt.statementKey({}, {})));
    expect(stateButton(early, false, "en")).toEqual({ enabled: false, why: stmt.WHY_NOT.en, state: "core" });
    expect(stateButton(early, false, "zh").why).toBe(stmt.WHY_NOT.zh);
    // Today's is made and the core gives no reason: the page says so.
    const used = readStatement(frameWith(stmt.statementKey({ ...stmt.READY }, { why_not: null, used_today: true })));
    expect(stateButton(used, false, "en")).toEqual({ enabled: false, why: translate("en", "statement.used"), state: "used" });
    expect(stateButton(used, false, "zh").why).toBe("今天已经照讲稿说过一回了。");
    // No reason of any kind, and no card at all.
    const bare = readStatement(frameWith({}));
    expect(stateButton(bare, false, "en")).toEqual({ enabled: false, why: "You cannot make the statement now.", state: "unknown" });
    expect(stateButton(null, false, "zh")).toEqual({ enabled: false, why: "这会儿还不能照讲稿说。", state: "unknown" });
  });

  test("says which parts did not hold, by name, in both languages", () => {
    const card = readStatement(frameWith(stmt.statementKey({}, { last: { ...stmt.LAST_WRONG, wrong: ["cause", "rumour"] } })));
    setLang("en");
    expect(partNames(card, ["cause", "rumour"], "en")).toBe("How the bridge broke, Why people got it wrong");
    expect(wrongLine(card, ["cause", "course"], "en")).toBe("Did not hold: How the bridge broke, What happened that night");
    setLang("zh");
    expect(partNames(card, ["course", "rumour"], "zh")).toBe("那晚的经过、大家为什么会误会");
    expect(wrongLine(card, ["cause"], "zh")).toBe("没站住的：桥是怎么坏的");
    expect(wrongLine(card, [], "zh")).toBeNull();
    // Without a card the page's own names are used.
    expect(wrongLine(null, ["course"], "zh")).toBe("没站住的：那晚的经过");
    setLang("en");
    expect(wrongLine(null, ["rumour"], "en")).toBe("Did not hold: Why people got it wrong");
  });
});

const EMPTY_CARD: StatementCard = { parts: [], canState: false, whyNot: null, usedToday: false, last: null };
const EMPTY_PART: StatementPartCard = { part: "cause", title: null, options: [], chosen: null, gap: true };

const task = (action: Record<string, unknown> | null): Task => ({
  id: "t_x",
  kind: "need",
  job: "truth",
  text: { zh: "任务", en: "Task" },
  why: null,
  next: null,
  state: "open",
  blocker: null,
  action: action === null ? null : { verb: String(action.verb), npc: null, place: null, item: null, request: null, kind: null, target: null, ...action },
  window: null,
  expected: null,
});

test.describe("the buttons of the tasks that fill in the card and make the statement", () => {
  /** The words of a button in a language: `actionLabel` takes the words of the page from the language the page is in. */
  const label = (action: Record<string, unknown>, lang: "en" | "zh"): string => {
    setLang(lang);
    const words = actionLabel(task(action), null, lang);
    setLang("en");
    return words;
  };

  test("say what they do in both languages", () => {
    expect(label({ verb: "state" }, "en")).toBe("Fill in the statement card");
    expect(label({ verb: "state" }, "zh")).toBe("去写讲稿");
    expect(label({ verb: "speak", kind: "statement" }, "en")).toBe("Make the statement");
    expect(label({ verb: "speak", kind: "statement" }, "zh")).toBe("照讲稿当众说");
    // The other ways to speak, and judging the lines, have words of their own.
    expect(label({ verb: "speak", kind: "evidence" }, "en")).toBe("Set the record straight in public");
    expect(label({ verb: "speak", kind: "clarify" }, "zh")).toBe("当众把这话说清");
    expect(label({ verb: "judge" }, "en")).toBe("Compare two lines in the notebook");
  });
});

// --- The flows -------------------------------------------------------------------------------------------------------

/** The part of the host client that the flows use, with a record of what the page sent. */
class FakeClient {
  readonly state = { scene: null as Record<string, unknown> | null };
  readonly sent: Array<Record<string, unknown>> = [];
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
  places: [{ id: "p_teahouse", kind: "teahouse", indoor: true, rect: [30, 5, 4, 3], door: [31, 8], stands: [], cells: [], zh: "茶馆", en: "Teahouse" }],
  cast: [{ id: "li_laotai", zh: "李老太", en: "Granny Li", role: { zh: "李家老太太", en: "Matriarch" }, token: { zh: "李", en: "L" }, family: "fam_li", home: null, work: null }],
  items: [],
  player: { id: "player", zh: "总管", en: "Festival Manager", role: { zh: "灯会总管", en: "Manager" }, token: { zh: "总", en: "M" }, start: [10, 10], things: [] },
};

let tickNo = 0;
const frameOf = (statement: Record<string, unknown> | null, at: { x: number; y: number } = { x: 10, y: 10 }): Frame =>
  ({
    npcs: [{ id: "li_laotai", x: 11, y: 10, activity: "work", carrying: null }],
    time: { day: 4, hour: 18, minute: 0, phase: "day" },
    weather: "clear",
    bubbles: [],
    dots: [],
    lanterns: [],
    hud: { verbs: ["move", "speak", "judge"] },
    player: { x: at.x, y: at.y, activity: "rest", talk: null, look: [], offers: {}, topics: [] },
    notebook: fake.notebook(),
    ending: null,
    ...(statement === null ? {} : { statement }),
  }) as unknown as Frame;

const step = (client: FakeClient, statement: Record<string, unknown> | null, events: CoreEvent[] = [], at?: { x: number; y: number }): void => {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame: frameOf(statement, at), events, clock: { paused: false, rate: [1, 1] } });
};
const ack = (id: unknown, result: "applied" | "rejected", reason: string | null = null): CoreEvent => ({ kind: "action_ack", tick: tickNo, action_id: String(id), result, reason });

const setup = (statement: Record<string, unknown> | null = stmt.statementKey(), at?: { x: number; y: number }) => {
  tickNo = 0;
  const client = new FakeClient();
  client.state.scene = SCENE;
  const play = new Play(client as unknown as HostClient);
  step(client, statement, [], at);
  return { client, play };
};

test.describe("the flows of the card", () => {
  test("choose a part's option, and take it back: the inputs of the card, with no game time asked for", () => {
    const { client, play } = setup();
    play.flows.choose("cause", "c_boat");
    expect(client.last).toMatchObject({ type: "statement", op: "choose", part: "cause", option: "c_boat" });
    play.flows.choose("rumour", "u_made_up");
    expect(client.last).toMatchObject({ type: "statement", op: "choose", part: "rumour", option: "u_made_up" });
    play.flows.clearPart("cause");
    expect(client.last).toMatchObject({ type: "statement", op: "clear", part: "cause" });
    expect(client.sent.map((s) => s.type)).toEqual(["statement", "statement", "statement"]);
  });

  test("a choice the core turns down is told on the card, and the next input clears it", () => {
    const { client, play } = setup();
    play.flows.choose("cause", "c_gone");
    step(client, stmt.statementKey(), [ack(client.last.action_id, "rejected", "unknown_option")]);
    expect(play.flows.state.statement.refused).toEqual({ type: "statement", reason: "unknown_option" });
    play.flows.choose("cause", "c_boat");
    expect(play.flows.state.statement.refused).toBeNull();
  });

  test("the full statement asks to be confirmed first, and only where the core says it can be made", () => {
    const { client, play } = setup(stmt.statementKey());
    play.flows.askToState();
    expect(play.flows.state.statement.confirming).toBe(false);
    step(client, stmt.readyKey());
    play.flows.askToState();
    expect(play.flows.state.statement.confirming).toBe(true);
    // Nothing is sent until the manager says yes.
    expect(client.sent).toEqual([]);
    play.flows.cancelStatement();
    expect(play.flows.state.statement.confirming).toBe(false);
    play.flows.makeStatement();
    expect(client.sent).toEqual([]);
    play.flows.askToState();
    play.flows.makeStatement();
    expect(client.last).toMatchObject({ type: "speak", kind: "statement" });
    expect(play.flows.state.statement).toMatchObject({ confirming: false });
    expect(play.flows.state.statement.waiting).toBe(client.last.action_id);
  });

  test("a question that was asked lapses on a frame where the statement cannot be made any more", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    expect(play.flows.state.statement.confirming).toBe(true);
    step(client, stmt.readyKey({ can_state: false, why_not: stmt.WHY_USED }));
    expect(play.flows.state.statement.confirming).toBe(false);
  });

  test("keeps what the core made of the statement, with the people who were there, to show until the manager puts it away", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    play.flows.makeStatement();
    const id = client.last.action_id;
    const made = stmt.readyKey({ can_state: false, why_not: stmt.WHY_USED, used_today: true, last: stmt.LAST_WRONG });
    step(client, made, [ack(id, "applied"), stmt.spokeEvent()]);
    const stated = play.flows.state.stated;
    expect(play.flows.state.statement.waiting).toBeNull();
    expect(stated?.last).toMatchObject({ told: false, wrong: ["cause"], accepted: 6, named: 7 });
    expect(stated?.heard.audience.map((h) => h.npc)).toEqual(["zhou_huoji", "li_laotai", "cha_laoban", "zhou_zhanggui"]);
    expect(stated?.heard.accepted).toBe(6);
    // The panel of a clarification does not come as well.
    expect(play.flows.state.clarified).toBeNull();
    play.flows.dismissStated();
    expect(play.flows.state.stated).toBeNull();
  });

  test("shows the statement made without an audience when the core does not say who stood where", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    play.flows.makeStatement();
    step(client, stmt.readyKey({ can_state: false, used_today: true, last: stmt.LAST_TOLD }), [ack(client.last.action_id, "applied")]);
    const stated = play.flows.state.stated;
    expect(stated?.last?.told).toBe(true);
    expect(stated?.heard).toMatchObject({ venue: "p_teahouse", accepted: 7, audience: [] });
  });

  test("takes a clarified event of the same frame as the people of the statement, whichever comes first", () => {
    for (const order of ["ack first", "event first"] as const) {
      const { client, play } = setup(stmt.readyKey());
      play.flows.askToState();
      play.flows.makeStatement();
      const done = ack(client.last.action_id, "applied");
      const event: CoreEvent = { kind: "clarified", tick: 910, venue: "p_teahouse", claim: null, basis: [], accepted: 2, audience: stmt.AUDIENCE };
      step(client, stmt.readyKey({ can_state: false, used_today: true, last: stmt.LAST_WRONG }), order === "ack first" ? [done, event] : [event, done]);
      expect(play.flows.state.clarified, order).toBeNull();
      expect(play.flows.state.stated?.heard.audience, order).toHaveLength(4);
    }
    // A clarification on its own is still a clarification.
    const { client, play } = setup(stmt.readyKey());
    step(client, stmt.readyKey(), [{ kind: "clarified", tick: 920, venue: "p_teahouse", claim: "n_broke", basis: ["n_clerk"], accepted: 1, audience: stmt.AUDIENCE }]);
    expect(play.flows.state.clarified?.audience).toHaveLength(4);
    expect(play.flows.state.stated).toBeNull();
  });

  test("tells why the core turned the full statement down, and lets the manager ask again", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    play.flows.makeStatement();
    step(client, stmt.readyKey(), [ack(client.last.action_id, "rejected", "no_venue")]);
    expect(play.flows.state.statement).toEqual({ confirming: false, waiting: null, refused: { type: "speak", reason: "no_venue" } });
    expect(play.flows.state.stated).toBeNull();
    play.flows.askToState();
    expect(play.flows.state.statement).toEqual({ confirming: true, waiting: null, refused: null });
  });

  test("does not make a second statement while the first waits for the core", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    play.flows.makeStatement();
    const sent = client.sent.length;
    play.flows.askToState();
    play.flows.makeStatement();
    expect(client.sent).toHaveLength(sent);
  });

  test("starts over with a new game", () => {
    const { client, play } = setup(stmt.readyKey());
    play.flows.askToState();
    play.flows.makeStatement();
    step(client, stmt.readyKey({ last: stmt.LAST_WRONG }), [ack(client.last.action_id, "applied")]);
    expect(play.flows.state.stated).not.toBeNull();
    client.feed({ type: "reset" } as unknown as HostToPage);
    expect(play.flows.state.stated).toBeNull();
    expect(play.flows.state.statement).toEqual({ confirming: false, waiting: null, refused: null });
  });

  test("points at a note of the notebook for a while, and opens the notebook to show it", () => {
    const { play } = setup();
    let opened = 0;
    play.guide.onNotebook = (open) => {
      if (open) opened++;
    };
    play.flows.pointAt("n_clerk");
    expect(play.flows.state.pointed).toBe("n_clerk");
    expect(opened).toBe(1);
    expect(POINTED_MS).toBeGreaterThan(2000);
  });
});

test.describe("the click on a task that fills in the card or makes the statement", () => {
  const run = (play: Play, action: Record<string, unknown>): void => play.flows.run(task(action));

  test("the verb state opens the card, and judge opens the notebook at the notes as before", () => {
    const { play } = setup();
    const opened: string[] = [];
    play.flows.onCard = () => opened.push("card");
    play.guide.onNotebook = (open) => opened.push(open ? "notes" : "closed");
    run(play, { verb: "state" });
    expect(opened).toEqual(["card"]);
    run(play, { verb: "judge" });
    expect(opened).toEqual(["card", "notes"]);
  });

  test("speaking the statement opens the card while a part has no choice", () => {
    const { client, play } = setup(stmt.statementKey({ cause: "c_boat", course: "r_night_boat" }), { x: 10, y: 10 });
    const opened: string[] = [];
    play.flows.onCard = () => opened.push("card");
    run(play, { verb: "speak", kind: "statement", place: "p_teahouse" });
    expect(opened).toEqual(["card"]);
    expect(client.sent).toEqual([]);
    // A frame with no card at all is a card to look at first.
    const bare = setup(null);
    bare.play.flows.onCard = () => opened.push("bare");
    run(bare.play, { verb: "speak", kind: "statement" });
    expect(opened).toEqual(["card", "bare"]);
  });

  test("with a choice in every part it walks to the place the task names if the manager is not there, and opens the card if they are", () => {
    const far = setup(stmt.readyKey(), { x: 10, y: 10 });
    const opened: string[] = [];
    far.play.flows.onCard = () => opened.push("far");
    run(far.play, { verb: "speak", kind: "statement", place: "p_teahouse" });
    expect(opened).toEqual([]);
    expect(far.client.last).toMatchObject({ type: "move", place: "p_teahouse" });
    const near = setup(stmt.readyKey(), { x: 31, y: 8 });
    near.play.flows.onCard = () => opened.push("near");
    run(near.play, { verb: "speak", kind: "statement", place: "p_teahouse" });
    expect(opened).toEqual(["near"]);
    expect(near.client.sent).toEqual([]);
    // A task that names no place has the card opened, where the manager stands.
    const nowhere = setup(stmt.readyKey(), { x: 10, y: 10 });
    nowhere.play.flows.onCard = () => opened.push("nowhere");
    run(nowhere.play, { verb: "speak", kind: "statement" });
    expect(opened).toEqual(["near", "nowhere"]);
  });

  test("does not touch the other ways to speak", () => {
    const { client, play } = setup();
    play.flows.onCard = () => {
      throw new Error("the card is not for this");
    };
    run(play, { verb: "speak", kind: "evidence" });
    expect(play.flows.state.suggest).toMatchObject({ verb: "speak", kind: "evidence" });
    expect(client.sent).toEqual([]);
  });
});
