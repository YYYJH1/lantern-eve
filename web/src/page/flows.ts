/**
 * The flows that live on the page: following a task, asking for a favour with a preview
 * first, pairing two lines of the notebook and judging how they stand, the clarification the player made, and
 * the paper of the morning (the recap grown) and the summary of the night. Like `Play`, it decides nothing. It sends the actions of the slice (`track`,
 * `judge`, `hint`, `speak` with the kind `clarify`, and the requests with the version of the preview they were
 * made on), reads what the core answers, and keeps what the views need to show it.
 */
import type { CoreEvent, PageNotes } from "../shared/protocol.ts";
import { hasMessage, type MessageKey, translate } from "../i18n/index.ts";
import { dealingNote } from "./deals.ts";
import type { Offer } from "./frame.ts";
import type { Play } from "./play.ts";
import { askPreview, type Preview, type PreviewAction, type PreviewVerb } from "./preview.ts";
import { type Name, readName } from "./scene.ts";
import { proposalId, type Wants } from "./talk-frame.ts";
import { type Clarified, type Gazette, type Night, type RecapLine, type Relation, readClarified, readGazette, readNight, readRecapLines, readSlice, type SliceFrame, STATEMENT_PARTS, type StatementLast, type StatementPart, type Task, type TaskAction } from "./slice.ts";
import { readNightOn, writeNightOn } from "./guide-prefs.ts";
import type { NoteValues } from "./play.ts";
import { countName } from "./ui/paper-text.ts";

/** One thing the core did for a request, in the words of the page. */
export interface Fact {
  key: MessageKey;
  values: NoteValues;
}

/**
 * What a request carries from where it began to its result. `auto`: the player has said yes already (to what a person asked in return), so
 * the promise is sent as soon as the core has previewed it. `follow`: the request to look at again once this is done, which the player may
 * go on with.
 */
interface Carry {
  auto?: boolean;
  follow?: Offer | null;
}

export type RequestState =
  | ({ phase: "loading"; verb: PreviewVerb; npc: string; offer: Offer; token: number; stale: boolean } & Carry)
  /** The host gave no preview: it did not answer in time, refused the call or has none. The player may ask again. */
  | ({ phase: "failed"; verb: PreviewVerb; npc: string; offer: Offer } & Carry)
  | ({ phase: "preview"; verb: PreviewVerb; npc: string; offer: Offer; preview: Preview; actionId: string; stale: boolean } & Carry)
  | ({ phase: "sending"; verb: PreviewVerb; npc: string; offer: Offer; preview: Preview; actionId: string } & Carry)
  | ({ phase: "result"; verb: PreviewVerb; npc: string; offer: Offer; ok: boolean; reason: string | null; facts: Fact[]; reply: Name | null; cost: number | null } & Carry);

/** What the core made of the last judgement, for the pair it was about. */
export interface JudgeOutcome {
  a: string;
  b: string;
  relation: Relation;
  ok: boolean;
  /** For a judgement the core turned down, its reason: `not_shown` or `unknown_note`. */
  reason: string | null;
}

/**
 * The pair the notebook sets side by side: the claim, and the line shown against it. The core's words for them are `b` (the claim) and
 * `a` (what is shown, which is the evidence), and the three answers are the relations it takes (`judge`).
 */
export interface PairState {
  /** The line that is shown against the claim. */
  a: string | null;
  /** The claim: the line that is being judged. */
  b: string | null;
  /** The answer that was given and waits for the core's word. */
  relation: Relation | null;
  /** The id of the judgement that waits for the core's word. */
  waiting: string | null;
  outcome: JudgeOutcome | null;
}

/** What came of the last time the player said a judged pair in public. */
export interface ClarifyOutcome {
  claim: string;
  basis: string[];
  /** The id of the speech that waits for the core's word. */
  waiting: string | null;
  /** Null while it waits. */
  ok: boolean | null;
  /** For a speech the core turned down, its reason: `overclaim`, `not_shown`, `no_witness`, `said_already`, a venue reason and so on. */
  reason: string | null;
}

/** The last time the task that is followed changed, and why in the core's words. */
export interface TaskChange {
  from: string | null;
  to: string | null;
  reason: Name;
  /** `chosen` (the player picked another), `done`, `stale` or `new`; a cause the page does not know is kept as it came. */
  cause: string;
  tick: number;
}

/** Somebody a reply sent the player to ("ask Zhou Erlang"): who, and who said so. */
export interface Lead {
  npc: string;
  from: string;
}

/** How many leads the page keeps: the newest, and the oldest go first. */
export const MAX_LEADS = 5;

/** The recap of the morning, kept from the frame that had it until the player puts it away. */
export interface KeptRecap {
  lines: RecapLine[];
  /** Which recap it is (`paperKey`). */
  key: string;
  /** The tick of the frame that had it, so that a recording taken back to before the morning does not keep it. */
  tick: number;
  /** The paper of that morning, where the core has one: the card is then the paper. Null where the core sends none, and the card is the recap. */
  gazette: Gazette | null;
}

/** The summary of the night, kept from the frame that had it until the player puts it away. */
export interface KeptNight {
  night: Night;
  /** Which night it is (`nightKey`). */
  key: string;
  /** The tick of the frame that had it, as for the recap. */
  tick: number;
}

/** The statement the manager made, kept to show until they put it away. */
export interface Stated {
  /** Which statement it is: the tick of the frame that had it. */
  key: string;
  /** What the frame said of it (`statement.last`) when the core took it. */
  last: StatementLast | null;
  /** What the people who were there made of it, as for a clarification. Its audience is empty where the core does not say who stood where. */
  heard: Clarified;
}

/** The inputs of the statement card that wait for the core, and what the manager has been asked. */
export interface StatementFlow {
  /** The manager pressed the button of the full statement and has not yet said yes or no. */
  confirming: boolean;
  /** The id of the full statement that waits for the core's word. */
  waiting: string | null;
  /** The last input of the card that the core turned down: the full statement (`speak`) or a choice or its taking back (`statement`), and the reason. */
  refused: { type: "speak" | "statement"; reason: string } | null;
}

export interface FlowState {
  request: RequestState | null;
  /** The people replies have sent the player to, and the player has not talked to yet. */
  leads: Lead[];
  /** The latest change of the task that is followed. */
  change: TaskChange | null;
  pair: PairState;
  /** The last speech that said a judged pair in public. */
  clarify: ClarifyOutcome | null;
  /** The clarification to show, until the player puts it away. */
  clarified: Clarified | null;
  /** The recap of the morning that is on show: the core sends it in one frame, and the page keeps it until the player puts it away. */
  recap: KeptRecap | null;
  /** The recap that the player has put away, by its key. */
  recapSeen: string | null;
  /** The summary of the night that is on show, until the player puts it away. */
  night: KeptNight | null;
  /** The summary of the night that the player has put away, by its key. */
  nightSeen: string | null;
  /**
   * A verb that the talk area opens once the talk with the person is on: what a task's button asked for, and the tick it was asked at. A task
   * that names the request (`entrust`) has the request, and for `persuade` the person to talk round, and the talk has that request ready.
   * Speaking up (`speak`, with no person) has the kind of speech, and the list of what to say is cut down to it. A task that keeps a
   * promise (`promise`, of the kind `keep`) has the number of the promise as its `item`, and the talk has the offer that keeps it ready.
   */
  suggest: { verb: string; npc: string; since: number; request?: string | null; target?: string | null; kind?: string | null; item?: string | null } | null;
  /** The core answered the player's call for a hint and had no pair to light. */
  hintNone: boolean;
  /** The id of the call for a hint that waits for the core's word. */
  hintWaiting: string | null;
  /** The topics asked of each person on this day, so that the list of questions puts the ones not asked first. */
  asked: { day: number; by: Record<string, string[]> };
  /** The proposals the player turned down (by the request and the token the core gives them, `proposalId`): the core goes on listing them, and the talk does not show them again. */
  declined: string[];
  /** The statement card: the confirmation asked of the manager, and what waits for the core. */
  statement: StatementFlow;
  /** The full statement to show, until the player puts it away. */
  stated: Stated | null;
  /** The note of the notebook that a line of the statement card sent the player to, for a few seconds. */
  pointed: string | null;
}

/** How long a task's button waits for the talk it asked for, in ticks: a minute of the common pace. */
export const WISH_TICKS = 600;

const freshPair = (): PairState => ({ a: null, b: null, relation: null, waiting: null, outcome: null });

const freshStatement = (): StatementFlow => ({ confirming: false, waiting: null, refused: null });

const fresh = (): FlowState => ({
  request: null,
  leads: [],
  change: null,
  pair: freshPair(),
  clarify: null,
  clarified: null,
  recap: null,
  recapSeen: null,
  night: null,
  nightSeen: null,
  suggest: null,
  hintNone: false,
  hintWaiting: null,
  asked: { day: 0, by: {} },
  declined: [],
  statement: freshStatement(),
  stated: null,
  pointed: null,
});

/** How long the note that the statement card pointed to stays marked, in milliseconds. */
export const POINTED_MS = 3200;

/** The reason the core gives when a request was made on a state that has moved on. */
const STALE = "stale";

/**
 * The offer of `promise` that keeps the promise by this id (`k1`), among those the town puts forward now (`player.offers.promise`): the offer
 * `keep:<id>`. Null where the promise is not open with this person now.
 */
export function keepOffer(offers: readonly Offer[], pledge: string): Offer | null {
  return offers.find((offer) => offer.id === `keep:${pledge}`) ?? null;
}

/**
 * The offer of `entrust` that asks for this request, among those the town puts forward now (`player.offers.entrust`): the one whose body names the
 * kind of request and, for `persuade`, the person to talk round. Null where the person cannot be asked that now.
 */
export function requestOffer(offers: readonly Offer[], request: string, target: string | null): Offer | null {
  return offers.find((offer) => offer.body?.kind === request && (request !== "persuade" || offer.body?.target === target)) ?? null;
}

/**
 * The offers of a list that are of this kind of speech, for a task that asks for `evidence` or for a `meal`. When the town puts none of that
 * kind forward (nothing is held to show) the list is empty, and says so, and does not offer the other kind in its place. A kind the page does
 * not know leaves the list as it is.
 */
export function speechOffers<T extends { body?: Record<string, unknown> | null }>(offers: readonly T[], kind: string | null): T[] {
  if (kind !== "evidence" && kind !== "meal") return [...offers];
  return offers.filter((offer) => offer.body?.kind === kind);
}

/** The key of a recap: the same lines are the same recap. */
export const recapKey = (slice: SliceFrame): string | null => (slice.recap === null ? null : JSON.stringify(slice.recap.map((line) => line.text)));

/** The key of the paper of a morning, else of the recap: the same issue of the same day is the same paper. */
export const paperKey = (slice: SliceFrame): string | null => {
  const paper = slice.gazette;
  return paper === null ? recapKey(slice) : `gazette:${paper.day}:${JSON.stringify([paper.head.text, paper.news.map((item) => item.text)])}`;
};

/** The key of the summary of a night: the same night of the same day is the same summary. */
export const nightKey = (slice: SliceFrame): string | null => {
  const night = slice.night;
  return night === null ? null : `night:${night.day}:${JSON.stringify([night.changed.text, night.blocked?.id ?? null, night.step?.id ?? null])}`;
};

export class Flows {
  state: FlowState = fresh();
  private seq = 0;
  /** Whether the summary of the night is shown: on unless the viewer turned it off (the menu). The core makes it all the same. */
  nightOn = readNightOn();
  /** Opens the notebook at its statement card. Set by the page. */
  onCard: (() => void) | null = null;

  constructor(private readonly play: Play) {}

  private touch(): void {
    this.play.touch();
  }

  /** The slice of the latest frame. */
  get slice(): SliceFrame {
    return this.play.slice;
  }

  reset(): void {
    this.state = fresh();
    this.seq++;
  }

  // --- Leads --------------------------------------------------------------------------------------

  /** Keeps a person a reply pointed to. The same person twice is one lead, and a person is not a lead of their own words. */
  addLead(npc: string, from: string): void {
    if (npc === from || this.state.leads.some((lead) => lead.npc === npc)) return;
    this.state.leads = [...this.state.leads, { npc, from }].slice(-MAX_LEADS);
    this.touch();
  }

  /** The player has talked to them, or no longer wants the lead. */
  dropLead(npc: string): void {
    if (!this.state.leads.some((lead) => lead.npc === npc)) return;
    this.state.leads = this.state.leads.filter((lead) => lead.npc !== npc);
    this.touch();
  }

  // --- Tasks ------------------------------------------------------------------------------------

  track(task: string): void {
    this.play.send({ type: "track", task });
  }

  /** Does what the click on a task is for. A verb of a talk walks up to the person first and then opens its list. */
  run(task: Task): void {
    const action = task.action;
    if (action === null) return;
    const play = this.play;
    switch (action.verb) {
      case "talk":
        if (action.npc !== null) play.talkOrWalk(action.npc);
        break;
      case "move":
      case "go": {
        const place = action.place === null ? undefined : play.scene?.places.find((p) => p.id === action.place);
        if (place?.door != null) play.goTo({ x: place.door[0], y: place.door[1], place: place.id });
        break;
      }
      case "look": {
        const at = action.item ?? action.place;
        if (at === null) break;
        // A thing that lies elsewhere is walked to first, to the place the card names: the click goes there, and the next one looks.
        const place = action.place === null || play.view?.player?.look.includes(at) === true ? undefined : play.scene?.places.find((p) => p.id === action.place);
        if (place?.door != null) play.goTo({ x: place.door[0], y: place.door[1], place: place.id });
        else play.look(at);
        break;
      }
      case "judge":
        // Setting the lines side by side is done in the notebook, where the hint is: the sheet is opened.
        play.guide.onNotebook?.(true);
        break;
      case "state":
        // Filling in the statement is done on the card in the notebook.
        this.onCard?.();
        break;
      case "listen":
        play.listen();
        break;
      case "rally":
        play.rally();
        break;
      case "speak":
        // Clearing up a claim is done from the notebook, where the lines the player judged are, each with its button: the sheet is opened.
        if (action.kind === "clarify") {
          play.guide.onNotebook?.(true);
          break;
        }
        if (action.kind === "statement") {
          this.runStatement(action);
          break;
        }
        this.state.suggest = { verb: "speak", npc: "", since: play.now, kind: action.kind ?? null };
        this.touch();
        break;
      case "ask":
      case "ask_source":
      case "tell":
      case "entrust":
      case "promise":
        if (action.npc !== null) {
          this.state.suggest = { verb: action.verb, npc: action.npc, since: play.now, request: action.request ?? null, target: action.target ?? null, kind: action.kind ?? null, item: action.item ?? null };
          if (play.state.talk?.npc !== action.npc) play.talkOrWalk(action.npc);
          this.touch();
        }
        break;
    }
  }

  /**
   * The button of a task that makes the full statement. A card with a part that has no choice is filled in first, so the card is opened.
   * With a choice in every part the manager goes to the place the task names, as for the other speeches, if they are not there, and the
   * card, which has the button that makes the statement, is opened when they are.
   */
  private runStatement(action: TaskAction): void {
    const play = this.play;
    const card = this.slice.statement;
    const unfilled = card === null || STATEMENT_PARTS.some((part) => card.parts.find((p) => p.part === part)?.chosen == null);
    const place = action.place === null ? undefined : play.scene?.places.find((p) => p.id === action.place);
    if (!unfilled && place?.door != null && !this.near(place.rect)) {
      play.goTo({ x: place.door[0], y: place.door[1], place: place.id });
      return;
    }
    this.onCard?.();
  }

  /** Whether the manager stands within a cell of a rectangle of the town, which is how close the core wants them to be to speak at a place. */
  private near(rect: { x: number; y: number; w: number; h: number }): boolean {
    const me = this.play.view?.player;
    if (me == null) return false;
    return me.x >= rect.x - 1 && me.x <= rect.x + rect.w && me.y >= rect.y - 1 && me.y <= rect.y + rect.h;
  }

  /** Asks the talk with this person to open the list of small things to give, as the card of their hearts can. */
  suggestGift(npc: string): void {
    this.state.suggest = { verb: "gift", npc, since: this.play.now };
    this.touch();
  }

  takeSuggestion(npc: string | null): string | null {
    const wish = this.state.suggest;
    if (wish === null || wish.npc !== (npc ?? "")) return null;
    this.state.suggest = null;
    return wish.verb;
  }

  // --- A request, with its preview ----------------------------------------------------------------

  private bodyOf(offer: Offer): Record<string, unknown> {
    return offer.body ?? { choice: offer.id };
  }

  /**
   * Asks the host for the preview of a request. The preview is the core's and nothing else: when the host cannot give one, the
   * card says so and the player may ask again. `stale` is set when the request goes back to a new preview because the state
   * had moved on.
   */
  begin(verb: PreviewVerb, npc: string, offer: Offer, stale = false, carry: Carry = {}): void {
    const token = ++this.seq;
    this.state.request = { phase: "loading", verb, npc, offer, token, stale, ...carry };
    this.touch();
    const action: PreviewAction = { verb, npc, ...this.bodyOf(offer) };
    const current = (): boolean => {
      const now = this.state.request;
      return now !== null && now.phase === "loading" && now.token === token;
    };
    askPreview(this.play.hostClient, action).then(
      (preview) => {
        if (!current()) return;
        this.state.request = { phase: "preview", verb, npc, offer, preview, actionId: this.play.hostClient.newActionId(), stale, ...carry };
        this.touch();
        // The player said yes to what the person asked in return: the promise goes out as the core previewed it.
        if (carry.auto === true) this.confirm();
      },
      () => {
        if (!current()) return;
        this.state.request = { phase: "failed", verb, npc, offer, ...carry };
        this.touch();
      },
    );
  }

  /** Asks for the preview again, after the host could not give one. */
  retry(): void {
    const now = this.state.request;
    if (now === null || now.phase !== "failed") return;
    this.begin(now.verb, now.npc, now.offer, false, { auto: now.auto, follow: now.follow });
  }

  confirm(): void {
    const now = this.state.request;
    if (now === null || now.phase !== "preview") return;
    const body: Record<string, unknown> = { ...this.bodyOf(now.offer), type: now.verb, action_id: now.actionId, version: now.preview.version };
    this.state.request = { phase: "sending", verb: now.verb, npc: now.npc, offer: now.offer, preview: now.preview, actionId: now.actionId, auto: now.auto, follow: now.follow };
    this.play.send(body, { subject: now.offer.name, npc: now.npc, flow: "request" });
    this.touch();
  }

  cancel(): void {
    if (this.state.request === null) return;
    this.state.request = null;
    this.seq++;
    this.touch();
  }

  /**
   * The player says yes to what a person asked in return for a request: the promise is previewed by the core and made at once, and the card
   * of the request, which was turned down, is offered again afterwards, to be looked at on the state as it is then.
   */
  accept(npc: string, wants: Wants): void {
    this.begin("promise", npc, wants.offer, false, { auto: true, follow: wants.request });
  }

  /** The player says no: nothing is sent, and the proposal is not shown again while it stays the same (the same request, the same token). */
  decline(wants: Pick<Wants, "key" | "token">): void {
    const id = proposalId(wants);
    if (wants.token === "" || this.state.declined.includes(id)) return;
    this.state.declined = [...this.state.declined, id].slice(-20);
    this.touch();
  }

  /** The player goes on with the request that came before a promise: it is previewed again. */
  followUp(): void {
    const now = this.state.request;
    if (now === null || now.phase !== "result" || now.follow == null) return;
    this.begin("entrust", now.npc, now.follow);
  }

  /** Remembers that a topic was asked of a person, on this day. */
  noteAsked(npc: string, topic: string): void {
    const day = this.play.view?.time.day ?? 0;
    if (this.state.asked.day !== day) this.state.asked = { day, by: {} };
    const known = this.state.asked.by[npc] ?? [];
    if (!known.includes(topic)) this.state.asked.by[npc] = [...known, topic];
    this.touch();
  }

  /** The topics already asked of a person on this day. */
  askedOf(npc: string): ReadonlySet<string> {
    const day = this.play.view?.time.day ?? 0;
    return this.state.asked.day === day ? new Set(this.state.asked.by[npc] ?? []) : new Set();
  }

  /** The partner's latest line, as the frame shows it now. */
  private replyOf(npc: string): Name | null {
    const view = this.play.view;
    if (view === null) return null;
    const said = [...view.bubbles].reverse().find((b) => b.npc === npc);
    return said === undefined ? null : said.text;
  }

  private factsOf(events: readonly CoreEvent[]): Fact[] {
    const facts: Fact[] = [];
    const ctx = { nameOf: (id: string) => this.play.nameOf(id), playerId: this.play.scene?.player?.id ?? "player" };
    for (const event of events) {
      const dealing = dealingNote(event, ctx);
      if (dealing !== null && dealing.kind === "info") facts.push({ key: dealing.key, values: dealing.values });
    }
    return facts;
  }

  /** The core took the action of a flow. What it made of it is in the events of the same frame. */
  onApplied(flow: string, actionId: string): void {
    if (flow === "judge") {
      const pair = this.state.pair;
      if (pair.waiting === actionId && pair.a !== null && pair.b !== null && pair.relation !== null) {
        this.state.pair = { ...pair, waiting: null, outcome: { a: pair.a, b: pair.b, relation: pair.relation, ok: true, reason: null } };
        this.touch();
      }
      return;
    }
    if (flow === "hint") {
      // The core has answered: what it lit is in this frame, and a frame with no pair is the answer "nothing to compare".
      if (this.state.hintWaiting === actionId) {
        this.state.hintWaiting = null;
        this.state.hintNone = this.slice.hint === null;
        this.touch();
      }
      return;
    }
    if (flow === "clarify") {
      const said = this.state.clarify;
      if (said !== null && said.waiting === actionId) {
        this.state.clarify = { ...said, waiting: null, ok: true, reason: null };
        this.touch();
      }
      return;
    }
    if (flow === "statement") {
      // A choice or a taking back needs no answer but the next frame. The full statement has its result to show.
      const mine = this.state.statement;
      if (mine.waiting === actionId) {
        this.state.statement = { ...mine, waiting: null, refused: null };
        this.keepStated();
        this.touch();
      }
      return;
    }
    const now = this.state.request;
    if (now === null || now.phase !== "sending" || now.actionId !== actionId) return;
    const events = this.play.frameEvents;
    // A request the core took but that the person turned down says so in an event, and is not a yes.
    const refused = events.find((e) => e.kind === "entrusted" && e.result !== "agreed" && e.result !== undefined);
    this.state.request = {
      phase: "result",
      verb: now.verb,
      npc: now.npc,
      offer: now.offer,
      ok: refused === undefined,
      reason: refused === undefined ? null : typeof refused.reason === "string" ? refused.reason : "refused",
      facts: this.factsOf(events),
      reply: this.replyOf(now.npc),
      cost: now.preview.cost,
      follow: now.follow ?? null,
    };
    this.touch();
  }

  /** The core turned the action of a flow down. */
  onRejected(flow: string, actionId: string, reason: string | null): void {
    if (flow === "judge") {
      const pair = this.state.pair;
      if (pair.waiting === actionId && pair.a !== null && pair.b !== null && pair.relation !== null) {
        this.state.pair = { ...pair, waiting: null, outcome: { a: pair.a, b: pair.b, relation: pair.relation, ok: false, reason } };
        this.touch();
      }
      return;
    }
    if (flow === "hint") {
      if (this.state.hintWaiting === actionId) this.state.hintWaiting = null;
      this.touch();
      return;
    }
    if (flow === "clarify") {
      const said = this.state.clarify;
      if (said !== null && said.waiting === actionId) {
        this.state.clarify = { ...said, waiting: null, ok: false, reason: reason ?? "unknown" };
        this.touch();
      }
      return;
    }
    if (flow === "statement") {
      const mine = this.state.statement;
      const speech = mine.waiting === actionId;
      this.state.statement = { ...mine, waiting: speech ? null : mine.waiting, refused: { type: speech ? "speak" : "statement", reason: reason ?? "unknown" } };
      this.touch();
      return;
    }
    const now = this.state.request;
    if (now === null || now.phase !== "sending" || now.actionId !== actionId) return;
    if (reason === STALE) {
      // The state moved on since the preview: look again, and say why.
      this.begin(now.verb, now.npc, now.offer, true, { auto: now.auto, follow: now.follow });
      return;
    }
    // A person who answered with a no took the minutes of the act as much as one who said yes: the signal `replied` of the same call says so.
    const answered = this.play.frameEvents.some((e) => e.kind === "replied" && e.npc === now.npc);
    this.state.request = {
      phase: "result",
      verb: now.verb,
      npc: now.npc,
      offer: now.offer,
      ok: false,
      reason: reason ?? "unknown",
      facts: [],
      reply: this.replyOf(now.npc),
      cost: answered ? now.preview.cost : null,
      follow: now.follow ?? null,
    };
    this.touch();
  }

  // --- The notebook: pairing two lines and judging how they stand -----------------------------------------

  /** Takes a line as the claim. The same line again puts it back, and the line that was shown against it goes with it. */
  claim(id: string): void {
    const p = this.state.pair;
    this.state.pair = p.b === id ? freshPair() : { a: p.a === id ? null : p.a, b: id, relation: null, waiting: null, outcome: null };
    this.state.hintNone = false;
    this.touch();
  }

  /** Shows a line against the claim. The same line again puts it back. A line cannot be shown against itself, and nothing is shown before there is a claim. */
  present(id: string): void {
    const p = this.state.pair;
    if (p.b === null || id === p.b) return;
    this.state.pair = { a: p.a === id ? null : id, b: p.b, relation: null, waiting: null, outcome: null };
    this.state.hintNone = false;
    this.touch();
  }

  /** Sets the claim and the line shown against it at once, as a hint does and as the tutorial does. */
  setPair(shown: string, claim: string): void {
    this.state.pair = { a: shown, b: claim, relation: null, waiting: null, outcome: null };
    this.state.hintNone = false;
    this.touch();
  }

  /** Sets the pair a hint lit side by side: the player has only to say how they stand. */
  useHint(): void {
    const hint = this.slice.hint;
    if (hint === null) return;
    this.setPair(hint.a, hint.b);
  }

  /** "Look at another pair": nothing is judged and nothing is sent. */
  clear(): void {
    this.state.pair = freshPair();
    this.touch();
  }

  /**
   * One of the three answers is given for the pair, and the core is asked at once: a wrong answer costs nothing and is not written down, so there
   * is no second button to press. The mapping is the core's (`judge.py`): the line shown is `a`, the claim is `b`.
   */
  answer(relation: Relation): void {
    const p = this.state.pair;
    if (p.a === null || p.b === null || p.waiting !== null) return;
    const id = this.play.send({ type: "judge", a: p.a, b: p.b, relation }, { flow: "judge" });
    this.state.pair = { ...p, relation, waiting: id, outcome: null };
    this.touch();
  }

  /** Asks the core to light a pair worth comparing, or, for the pair it lit already, to say how they stand. */
  hint(): void {
    this.state.hintNone = false;
    this.state.hintWaiting = this.play.send({ type: "hint" }, { flow: "hint" });
    this.touch();
  }

  /** Says in public that `claim` goes beyond what `basis` shows, as the player judged it to. */
  clarify(claim: string, basis: string[], relation: Relation | null): void {
    const id = this.play.send({ type: "speak", kind: "clarify", claim, basis, ...(relation === null ? {} : { judgment: relation }) }, { flow: "clarify" });
    this.state.clarify = { claim, basis, waiting: id, ok: null, reason: null };
    this.touch();
  }

  // --- The statement card ----------------------------------------------------------------------------------

  /** Chooses an option for a part of the statement. No game time passes, and the card of the next frame shows the choice. */
  choose(part: StatementPart, option: string): void {
    this.state.statement = { ...this.state.statement, refused: null };
    this.play.send({ type: "statement", op: "choose", part, option }, { flow: "statement" });
    this.touch();
  }

  /** Takes back the choice for a part. */
  clearPart(part: StatementPart): void {
    this.state.statement = { ...this.state.statement, refused: null };
    this.play.send({ type: "statement", op: "clear", part }, { flow: "statement" });
    this.touch();
  }

  /** The manager presses the button that makes the full statement: the card asks them to say yes first, since it can be made once a day. */
  askToState(): void {
    if (this.slice.statement?.canState !== true || this.state.statement.waiting !== null) return;
    this.state.statement = { ...this.state.statement, confirming: true, refused: null };
    this.touch();
  }

  /** The manager is not ready after all. */
  cancelStatement(): void {
    if (!this.state.statement.confirming) return;
    this.state.statement = { ...this.state.statement, confirming: false };
    this.touch();
  }

  /** The manager said yes: the full statement is made where they stand, from the choices the core keeps. */
  makeStatement(): void {
    const now = this.state.statement;
    if (!now.confirming || now.waiting !== null || this.slice.statement?.canState !== true) return;
    const id = this.play.send({ type: "speak", kind: "statement" }, { flow: "statement" });
    this.state.statement = { confirming: false, waiting: id === "" ? null : id, refused: null };
    this.touch();
  }

  /**
   * The core took the full statement. What it made of it is `statement.last` of this frame, and what the people there said, if the
   * core says it, an event of this frame with the stands of an audience (`spoke`, `stated` or `clarified`). The panel of a
   * clarification shows both, so a `clarified` event that comes with a statement is part of it and is not a panel of its own.
   */
  private keepStated(): void {
    const key = `statement:${this.play.now}`;
    const last = this.slice.statement?.last ?? null;
    const event = this.play.frameEvents.find((e) => (e.kind === "spoke" || e.kind === "stated" || e.kind === "clarified") && Array.isArray(e.audience));
    if (event?.kind === "clarified") this.state.clarified = null;
    const nobody: Clarified = { key, venue: last?.venue ?? null, claim: null, basis: [], accepted: last?.accepted ?? null, audience: [] };
    this.state.stated = { key, last, heard: (event === undefined ? null : readClarified(event, key)) ?? nobody };
  }

  /** The player puts the result of the statement away. */
  dismissStated(): void {
    if (this.state.stated === null) return;
    this.state.stated = null;
    this.touch();
    this.play.guide.review();
  }

  /** Opens the notebook at a note and marks it for a few seconds: a line of the statement card names the notes behind its counts. */
  pointAt(id: string): void {
    this.state.pointed = id;
    this.play.guide.onNotebook?.(true);
    this.touch();
    setTimeout(() => {
      if (this.state.pointed !== id) return;
      this.state.pointed = null;
      this.touch();
    }, POINTED_MS);
  }

  // --- What the player is shown ------------------------------------------------------------------------------

  /**
   * The player puts the recap, or the paper of the morning, away. The same lines do not come back, and other lines, or the core saying it once
   * more, do. The card that says the first day is done may have waited behind it, and comes now, and the world, which the paper held, goes on.
   */
  dismissRecap(): void {
    const kept = this.state.recap;
    if (kept === null) return;
    this.state.recapSeen = kept.key;
    this.state.recap = null;
    this.touch();
    this.play.guide.review();
  }

  /** The player puts the summary of the night away, as for the paper of the morning. The same night does not come back. */
  dismissNight(): void {
    const kept = this.state.night;
    if (kept === null) return;
    this.state.nightSeen = kept.key;
    this.state.night = null;
    this.touch();
    this.play.guide.review();
  }

  /** The viewer turns the summary of the night on or off. Off, the one that is up goes, and none comes. */
  setNightOn(on: boolean): void {
    this.nightOn = on;
    writeNightOn(on);
    if (!on && this.state.night !== null) this.dismissNight();
    else this.touch();
  }

  /** Whether a card that holds the world is up: the paper of the morning (not the plain recap) or the summary of the night. */
  get paperUp(): boolean {
    return this.state.recap?.gazette != null || this.state.night !== null;
  }

  /** What the page keeps with a save: the paper or the recap and the summary of the night the player has not put away, so that loading the save brings them back. Null where there is none. */
  keep(): PageNotes | null {
    const notes: PageNotes = {};
    const kept = this.state.recap;
    if (kept !== null) {
      notes.recap = { key: kept.key, lines: kept.lines.map((line) => ({ text: line.text, events: line.events })), ...(kept.gazette === null ? {} : { gazette: kept.gazette }) };
    }
    const night = this.state.night;
    if (night !== null) notes.night = { key: night.key, night: night.night };
    return Object.keys(notes).length === 0 ? null : notes;
  }

  /** Takes back what `keep` kept, when a save is loaded. Anything it does not understand is left. */
  restore(notes: PageNotes | undefined): void {
    const kept = notes?.recap;
    if (typeof kept === "object" && kept !== null && !Array.isArray(kept)) {
      const raw = kept as Record<string, unknown>;
      const lines = readRecapLines(raw.lines);
      const gazette = readGazette({ gazette: raw.gazette });
      if ((lines !== null || gazette !== null) && typeof raw.key === "string" && raw.key !== "" && this.state.recap?.key !== raw.key) {
        this.state.recap = { lines: lines ?? [], key: raw.key, tick: this.play.now, gazette };
        this.state.recapSeen = null;
        this.touch();
      }
    }
    const asleep = notes?.night;
    if (typeof asleep === "object" && asleep !== null && !Array.isArray(asleep)) {
      const raw = asleep as Record<string, unknown>;
      const night = readNight({ night: raw.night });
      if (night !== null && typeof raw.key === "string" && raw.key !== "" && this.state.night?.key !== raw.key) {
        this.state.night = { night, key: raw.key, tick: this.play.now };
        this.state.nightSeen = null;
        this.touch();
      }
    }
  }

  dismissClarified(): void {
    this.state.clarified = null;
    this.touch();
    this.play.guide.review();
  }

  // --- What the core says -----------------------------------------------------------------------------------------

  /** An event of the frame that is about the slice. */
  onEvent(event: CoreEvent): void {
    const play = this.play;
    switch (event.kind) {
      case "clarified": {
        // The people of a full statement are shown with the statement (`keepStated`), in the same frame.
        if (this.state.stated?.key === `statement:${play.now}`) break;
        const seen = readClarified(event, `${String(event.tick ?? "")}:${String(event.claim ?? "")}`);
        if (seen !== null) {
          this.state.clarified = seen;
          this.touch();
        }
        break;
      }
      case "recap":
        this.state.recapSeen = null;
        break;
      case "task_changed": {
        const target = typeof event.to === "string" ? event.to : null;
        const to = target === null ? undefined : this.slice.tasks?.list.find((t) => t.id === target);
        const reason = readName(event.reason);
        const said = reason.zh !== "" || reason.en !== "";
        const cause = typeof event.cause === "string" ? event.cause : "";
        this.state.change = { from: typeof event.from === "string" ? event.from : null, to: target, reason, cause, tick: typeof event.tick === "number" ? event.tick : play.now };
        this.touch();
        // The core says why in both languages. Where it says nothing, the note says what is followed now.
        if (said) play.note("info", "note.taskChanged.reason", { reason });
        else play.note("info", "note.taskChanged", { task: to?.text ?? readName(target ?? "") });
        break;
      }
      case "objection_withdrawn":
        // `what` is the id of the thing she no longer stands in the way of (the bamboo), which the scene names. A name in both languages is taken as it is.
        if (typeof event.npc === "string") play.note("info", "note.objectionWithdrawn", { name: play.nameOf(event.npc), what: typeof event.what === "string" ? this.itemName(event.what) : readName(event.what) });
        break;
      case "commitment": {
        const found = this.slice.commitments?.find((c) => c.id === event.id);
        if (found === undefined) break;
        const name = play.nameOf(found.by);
        // The core says why in both languages, in the commitment of the same frame.
        const why = found.reason;
        if (event.state === "promised") play.note("info", "note.commitment.promised", { name, what: found.what });
        else if (event.state === "broken") play.note("bad", why === null ? "note.commitment.broken" : "note.commitment.broken.why", { name, what: found.what, ...(why === null ? {} : { reason: why }) });
        else if (event.state === "withdrawn") play.note("bad", why === null ? "note.commitment.withdrawn" : "note.commitment.withdrawn.why", { name, what: found.what, ...(why === null ? {} : { reason: why }) });
        break;
      }
      case "delivered": {
        // The errand of a promise says how much it brought as `amount`, or as `qty` in a frame that has only that.
        const brought = typeof event.amount === "number" ? event.amount : typeof event.qty === "number" ? event.qty : 0;
        play.note("info", "note.delivered", { what: this.loadWords(typeof event.item === "string" ? event.item : "", brought), place: play.nameOf(typeof event.place === "string" ? event.place : "") });
        break;
      }
    }
  }

  /**
   * What a delivery brought, counted the way that item is counted: "4 poles of bamboo" and "四根竹料" for the bamboo, lengths for the
   * timber. An item that has no way of its own (`load.<item>`) is counted as it is. The count is in the numerals of the town in Chinese.
   */
  private loadWords(id: string, amount: number): Name {
    const key: MessageKey = hasMessage(`load.${id}`) ? (`load.${id}` as MessageKey) : "load.other";
    const item = this.itemName(id);
    const counted = countName(amount);
    return { zh: translate("zh", key, { amount: counted.zh, item: item.zh }), en: translate("en", key, { amount: counted.en, item: item.en }) };
  }

  /**
   * The name of an item of the scene (bamboo, timber) for the middle of a sentence. The scene names it for a list, so the English
   * has a capital ("Bamboo"), which does not belong inside "…stands in the way of the bamboo". Names of places and people are not
   * items and are not touched.
   */
  private itemName(id: string): Name {
    const named = this.play.scene?.items.get(id);
    return named === undefined ? { zh: id, en: id } : { zh: named.zh, en: named.en.toLowerCase() };
  }

  /**
   * The recap (and the paper of the morning, which is the recap grown) is in the frame of the call that made it and in no other, so it is taken
   * here, from the frame, and kept. A recap is not taken again once the player has put it away, and another one takes the place of one that is
   * still on show. A recording that has been taken back to before the morning loses it.
   */
  private keepRecap(): void {
    const lines = this.slice.recap;
    const gazette = this.slice.gazette;
    const kept = this.state.recap;
    if (lines === null && gazette === null) {
      if (kept !== null && this.play.now < kept.tick) {
        this.state.recap = null;
        this.touch();
      }
      return;
    }
    const key = paperKey(this.slice);
    if (key === null || key === this.state.recapSeen || kept?.key === key) return;
    this.state.recap = { lines: lines ?? [], key, tick: this.play.now, gazette };
    this.touch();
  }

  /** The summary of the night is in the frame of the call that made it and in no other: it is kept like the recap, unless the viewer turned it off. */
  private keepNight(): void {
    const night = this.slice.night;
    const kept = this.state.night;
    if (night === null) {
      if (kept !== null && this.play.now < kept.tick) {
        this.state.night = null;
        this.touch();
      }
      return;
    }
    const key = nightKey(this.slice);
    if (!this.nightOn || key === null || key === this.state.nightSeen || kept?.key === key) return;
    this.state.night = { night, key, tick: this.play.now };
    this.touch();
  }

  /**
   * After the frame is read: the recap is kept, and a request does not outlive its talk, but its answer does. A person who has to go once
   * the act is said goes before the player has read what they answered, so the result stays until the player puts it away or talks to
   * somebody else. A pair cannot name a line the notebook no longer has.
   */
  afterFrame(ids: ReadonlySet<string> | null): void {
    this.keepRecap();
    this.keepNight();
    const request = this.state.request;
    const here = this.play.state.talk;
    if (request !== null && (request.phase === "result" ? here !== null && here.npc !== request.npc : here === null)) {
      this.state.request = null;
      this.seq++;
    }
    const p = this.state.pair;
    if (ids !== null && ((p.a !== null && !ids.has(p.a)) || (p.b !== null && !ids.has(p.b)))) this.state.pair = freshPair();
    // A confirmation asked for on one frame is not carried to a frame where the statement can no longer be made.
    if (this.state.statement.confirming && this.slice.statement?.canState !== true) this.state.statement = { ...this.state.statement, confirming: false };
    // What a task's button asked for is for that person and for the next little while: a talk with another, or a walk that came to nothing, lets it go.
    const wish = this.state.suggest;
    const talk = this.play.state.talk;
    if (wish !== null && ((wish.npc !== "" && talk !== null && talk.npc !== wish.npc) || this.play.now - wish.since > WISH_TICKS)) this.state.suggest = null;
  }
}

/** Reads the slice of a raw frame. Exposed for `Play`. */
export { readSlice };
