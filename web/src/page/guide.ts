/**
 * The help of the page, in one place: the tutorial of the first day, the signals of the world, the log of hints, the
 * clan elder who answers when asked and comes by when nothing moves, and the card that says the first day is done. It reads
 * what the frame shows and what the player does, holds the world while a card is up, and decides nothing in the game. The
 * rules are in `tutorial.ts`, `hints.ts` and `firstday.ts`; this class gives them the game to look at and the page to act on.
 */
import type { CoreEvent } from "../shared/protocol.ts";
import { type DayFrame, type DayState, OVER, primeDay, stepDay, WATCHING } from "./firstday.ts";
import type { ViewFrame } from "./frame.ts";
import { type Guidance, readGuidance, readHintsOn, readTaught, readTutorialPref, writeGuidance, writeHintsOn, writeTaught, writeTutorialPref } from "./guide-prefs.ts";
import { ELDER_LEVELS, type HintContext, type HintEntry, Hints, Stall, ticksCount } from "./hints.ts";
import { readVerbs } from "./hud.ts";
import { type NotebookEntry, readNotebook } from "./notebook.ts";
import type { Play } from "./play.ts";
import { type Job, jobOf, jobsDone, Shows } from "./shows.ts";
import { isLive, type SliceFrame, trackedTask } from "./slice.ts";
import { followedEntry } from "./talk-frame.ts";
import { actsOfAction, liveAsks } from "./teach.ts";
import { CLERK, examplePair, TASK, Tutorial, type TutorialContext } from "./tutorial.ts";

/** How long the light on the map goes on after the card of a job is put away, in milliseconds. */
export const GLOW_FADE_MS = 2600;

/** The clan elder's card: whether it is open, which levels the player has been given, and whether he came by himself. */
export interface ElderState {
  open: boolean;
  given: number[];
  /** True when the elder came by because nothing moved, false when the player asked. */
  visit: boolean;
}

const closedElder = (): ElderState => ({ open: false, given: [], visit: false });

/**
 * The kinds of request the town puts forward for the person the manager talks with: the one on the button of the talk and the others behind
 * "others" (`player.talk`), or, for a frame that does not carry them, the requests among the offers.
 */
function askKinds(view: ViewFrame | null): Set<string> {
  const more = view?.player?.talk?.more ?? null;
  const offers = more === null ? (view?.player?.offers.entrust ?? []) : [...(more.askFor === null ? [] : [more.askFor]), ...more.asksMore];
  return new Set(offers.flatMap((offer) => (typeof offer.body?.kind === "string" ? [offer.body.kind] : [])));
}

/** The element a verb of a talk is on, for the signal that points at it. */
const VERB_TARGET: Readonly<Record<string, string>> = {
  ask: "topic-chips",
  ask_source: "verb-askSource",
  tell: "verb-tell",
  entrust: "verb-entrust",
  promise: "verb-promise",
};

export class Guide {
  readonly tutorial = new Tutorial();
  readonly hints = new Hints();
  readonly stall = new Stall();
  /** The cards that say a job is done (the bridge, the truth, the peace), each once in a game (see `shows.ts`). */
  readonly shows = new Shows();
  /** The light on the map for the job whose card is up, and for a moment after: `fading` once the card is put away. */
  glow: { job: Job; fading: boolean } | null = null;
  hintsOn = readHintsOn();
  /** The acts the player has been taught or has used, so that a card does not teach them again. Kept per browser. */
  readonly taught: Set<string> = readTaught();
  /** How much the task card and the bars do for the player: what the viewer chose, which the tutorial does not follow (see `brief`). */
  guidance: Guidance = readGuidance();
  /**
   * Whether the help is on for this page. It is for a page that began with the opening page, which is the page of a
   * player. A page that was made for a test of something else, with a game named in its address, has none of it.
   */
  enabled = false;
  elder: ElderState = closedElder();
  /** Opens the notebook for a step that is about it. Set by the page. */
  onNotebook: ((open: boolean) => void) | null = null;

  private refused = false;
  /** Whether the first frame of the game was looked at, which hints that are true already are not given for. */
  private primed = false;
  /** Where the card that says the first day is done stands (see `firstday.ts`). */
  private day: DayState = WATCHING;
  /** A new game with the tutorial was asked for, and its first message is awaited. */
  private restarting = false;
  private context: TutorialContext | null = null;
  private entries: readonly NotebookEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private glowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly play: Play) {}

  // --- What the interface asks ---------------------------------------------------------------------------------

  /** Whether the help is on and has a game to help with: not on the page of a recording. */
  get active(): boolean {
    return this.enabled && !this.play.isReadOnly;
  }

  /** The viewer's choices of the settings, read again when the game begins. */
  refreshPrefs(): void {
    this.hintsOn = readHintsOn();
    this.guidance = readGuidance();
  }

  /**
   * Whether the task card and the bars leave out the next step and the button that does it: the viewer chose the brief guidance, and the tutorial is
   * not on. The tutorial teaches with the full guidance whatever the choice is, and the choice takes hold when it ends. The clan elder gives the
   * next step in either.
   */
  get brief(): boolean {
    return this.active && this.guidance === "brief" && !this.tutorial.on;
  }

  /** Whether a card of the guide is up, and the world is held: a step of the tutorial, the elder, the end of the first day, the paper of the morning, the summary of the night. */
  get cardUp(): boolean {
    return this.tutorial.card !== null || this.elder.open || this.endUp || this.play.flows.paperUp || this.shows.up !== null;
  }

  /** Whether the card that says a job is done is up. */
  get showUp(): boolean {
    return this.shows.up !== null;
  }

  /** Whether the card that says the first day is done is up. */
  get endUp(): boolean {
    return this.day.phase === "up";
  }

  /** The number of the step that is on, from 1. */
  get number(): number {
    return this.tutorial.index + 1;
  }

  /** Whether the element with this key is lit: by the step of the tutorial, or by a hint of the world. */
  signal(key: string): boolean {
    if (!this.active) return false;
    if (this.tutorial.on) return this.tutorialSignals().has(key);
    return this.hintsOn && this.hints.lit?.target === key;
  }

  /**
   * The two lines the tutorial sets side by side, if the notebook has them: the line heard at first hand and the rumour that
   * goes beyond it, which is what its words explain. A pair that the core lit for a hint is not the tutorial's (it may be two
   * rumours that do not match), so the hint is not asked.
   */
  get pair(): { a: NotebookEntry; b: NotebookEntry } | null {
    const found = examplePair(this.entries, null);
    if (found === null) return null;
    const a = this.entries.find((e) => e.id === found.a);
    const b = this.entries.find((e) => e.id === found.b);
    return a === undefined || b === undefined ? null : { a, b };
  }

  private tutorialSignals(): Set<string> {
    const out = new Set<string>();
    const step = this.tutorial.step;
    if (step === null || this.tutorial.phase === "waiting") return out;
    const verb = trackedTask(this.play.slice.tasks)?.action?.verb;
    if (step === "granny" || step === "clerk") {
      out.add("task-do");
      // In a talk the button of the act the task asks for is the one that is lit.
      const target = verb === undefined ? undefined : VERB_TARGET[verb];
      if (this.play.state.talk !== null && target !== undefined) out.add(target);
    } else if (step === "evening") {
      out.add("task-do");
    } else if (step === "compare") {
      for (const key of ["btn-notebook", "pairing", "pair-unsupported"]) out.add(key);
    }
    return out;
  }

  // --- The tutorial -----------------------------------------------------------------------------------------------

  /** Whether the tutorial is offered to the player who starts: not once it was done or turned away. */
  get tutorialWanted(): boolean {
    return readTutorialPref() === "new";
  }

  /** Begins the tutorial at the start of a game, with the world held at once. */
  startTutorial(): void {
    if (!this.active) return;
    this.tutorial.begin();
    this.play.hold.take("guide");
    this.play.touch();
  }

  /** A new game with the tutorial: the page asks for the game, and the tutorial begins when the game does. */
  restartWithTutorial(newGame: () => void): void {
    writeTutorialPref("new");
    // A player who asks to see the help again is shown all of it again.
    this.taught.clear();
    writeTaught(this.taught);
    this.restarting = true;
    this.play.hold.take("guide");
    newGame();
  }

  skipTutorial(): void {
    if (!this.tutorial.on) return;
    this.tutorial.skip();
    writeTutorialPref("skipped");
    this.ended();
  }

  /** Puts the card of the step away. */
  dismissCard(): void {
    const ctx = this.context;
    if (ctx === null || this.tutorial.card === null) return;
    this.tutorial.dismiss(ctx);
    this.moved();
  }

  /** The acts of the cards are learned: a card is not given for one that is taught. */
  private markTaught(acts: readonly string[]): void {
    let more = false;
    for (const act of acts) {
      if (!this.taught.has(act)) {
        this.taught.add(act);
        more = true;
      }
    }
    if (more) writeTaught(this.taught);
  }

  /** The manager did something: an act that is used is learned, its card is not given, and the card that is lit for it has done its work. */
  noteUsed(body: Readonly<Record<string, unknown>>): void {
    if (!this.active) return;
    const acts = actsOfAction(body);
    this.markTaught(acts);
    const lit = this.hints.lit;
    if (lit !== null && acts.some((act) => lit.id === `teach.${act}`)) this.touched(lit.target);
  }

  setHintsOn(on: boolean): void {
    this.hintsOn = on;
    writeHintsOn(on);
    if (!on) this.hints.settle();
    this.play.touch();
  }

  /** The viewer chose how much the task card does, in the menu or at the last step of the tutorial. It is kept per browser. */
  setGuidance(guidance: Guidance): void {
    if (guidance === this.guidance) return;
    this.guidance = guidance;
    writeGuidance(guidance);
    this.play.touch();
  }

  /** What the tutorial wants of the page when it has moved: the card of a step to show, a step done, the end. */
  private moved(): void {
    const phase = this.tutorial.phase;
    if (phase === "done") {
      writeTutorialPref("done");
      this.play.note("info", "tut.done");
      this.ended();
      return;
    }
    if (phase === "skipped") {
      this.ended();
      return;
    }
    const ctx = this.context;
    const step = this.tutorial.step;
    if (ctx !== null && step !== null) {
      if (phase === "card" && step === "compare") this.setUpPair();
      if (phase === "doing" && step === "granny") this.ringFor(ctx.tasks.get(TASK.bamboo)?.action?.npc ?? null, "person");
      if (phase === "doing" && step === "clerk") this.ringFor(CLERK, "person");
      if (phase === "doing" && step === "evening") this.ringFor(ctx.tasks.get(TASK.evening)?.window?.place ?? null, "place");
    }
    this.settle();
  }

  /** The tutorial is over: what was true while it went is not news to the hints. */
  private ended(): void {
    if (this.context !== null) this.hints.absorb(this.hintContext(this.context, this.play.view));
    this.stall.reset();
    this.settle();
  }

  private ringFor(id: string | null, kind: "person" | "place"): void {
    if (id !== null) this.play.ping(id, kind);
  }

  /** The notebook open, the two lines picked and how they stand: shown once, by the tutorial. */
  private setUpPair(): void {
    const pair = examplePair(this.entries, null);
    if (pair === null) return;
    // The first-hand line is what is shown, and the rumour is the claim.
    this.play.flows.setPair(pair.a, pair.b);
    this.onNotebook?.(true);
  }

  // --- The elder --------------------------------------------------------------------------------------------------

  /** The player asks for a hand. */
  askElder(): void {
    if (!this.active || this.tutorial.card !== null || this.endUp || this.showUp) return;
    this.elder = { open: true, given: [], visit: false };
    this.settle();
  }

  /** The elder gives a level. For the second, the core is asked which two lines to compare, where it can say. */
  giveLevel(level: number): void {
    if (!this.elder.open || level < 1 || level > ELDER_LEVELS || this.elder.given.includes(level)) return;
    this.elder = { ...this.elder, given: [...this.elder.given, level].sort() };
    if (level === 2) this.askCoreForPair();
    this.play.touch();
  }

  closeElder(): void {
    if (!this.elder.open) return;
    this.elder = closedElder();
    this.settle();
  }

  // --- The end of the first day ------------------------------------------------------------------------------------

  /** The player puts the card away and goes on: it does not come again in this game. */
  closeEnd(): void {
    if (!this.endUp) return;
    this.day = OVER;
    this.settle();
  }

  /**
   * Looks at the cards again, for whatever puts away a card that they waited behind (the recap, what the people said). The world goes on when the
   * last card that held it is put away.
   */
  review(): void {
    const day = this.reviewDay();
    const show = this.reviewShow();
    if (day || show) this.settle();
    else this.syncHold();
  }

  /** Holds the world while a card of the guide is up (the paper, the night and the cards of a job included) and lets it go when none is. */
  private syncHold(): void {
    if (!this.active) return;
    this.play.hold.set("guide", this.cardUp);
  }

  // --- A job is done -------------------------------------------------------------------------------------------------

  /** The player puts the card of a job away. The light on the map goes on for a moment, and the next card that waits comes. */
  closeShow(): void {
    const job = this.shows.close();
    if (job === null) return;
    this.glow = { job, fading: true };
    this.clearGlowTimer();
    this.glowTimer = setTimeout(() => {
      this.glowTimer = null;
      this.glow = null;
      this.play.touch();
    }, GLOW_FADE_MS);
    this.settle();
  }

  private clearGlowTimer(): void {
    if (this.glowTimer !== null) clearTimeout(this.glowTimer);
    this.glowTimer = null;
  }

  /** Lets the next card of a job take its turn if it is due, and says whether it came up just now. The hold on the world is `settle`'s. */
  private reviewShow(): boolean {
    if (!this.active || this.restarting || !this.primed) return false;
    const flows = this.play.flows.state;
    const over = this.play.state.ending !== null;
    const covered = this.tutorial.card !== null || this.elder.open || this.endUp || flows.recap !== null || flows.night !== null || flows.clarified !== null || flows.stated !== null || over;
    if (!this.shows.step(covered, over)) return false;
    this.clearGlowTimer();
    this.glow = this.shows.up === null ? null : { job: this.shows.up, fading: false };
    return true;
  }

  /** What the card reads of the latest frame. */
  private dayFrame(view: ViewFrame): DayFrame {
    const flows = this.play.flows.state;
    return {
      bamboo: this.play.slice.tasks?.list.find((task) => task.id === TASK.bamboo)?.state ?? null,
      time: view.time,
      covered: this.tutorial.card !== null || this.elder.open || this.shows.up !== null || flows.recap !== null || flows.night !== null || flows.clarified !== null || this.play.state.ending !== null,
    };
  }

  /** Lets the card take its turn if it is due, and says whether it came up just now. The hold on the world is `settle`'s. */
  private reviewDay(): boolean {
    const view = this.play.view;
    if (!this.active || this.restarting || !this.primed || view === null) return false;
    const step = stepDay(this.day, this.dayFrame(view));
    this.day = step.state;
    return step.show;
  }

  private askCoreForPair(): void {
    if (readVerbs(this.play.view?.hud ?? {}).has("hint")) this.play.flows.hint();
  }

  // --- The game ---------------------------------------------------------------------------------------------------

  /** A new game, or a game that was loaded. A new game that was asked for with the tutorial begins it. */
  reset(): void {
    const again = this.restarting;
    this.restarting = false;
    this.tutorial.reset();
    this.hints.reset();
    this.stall.reset();
    this.elder = closedElder();
    this.refused = false;
    this.primed = false;
    this.day = WATCHING;
    this.context = null;
    this.entries = [];
    this.shows.reset();
    this.clearGlowTimer();
    this.glow = null;
    if (again) this.tutorial.begin();
    this.settle();
  }

  /** An event of the frame: the refusal of Granny Li is what the first step waits for, and a flag that says a job is done is a card to come. */
  onEvent(event: CoreEvent): void {
    const job = jobOf(event);
    if (job !== null) this.shows.note(job);
    if (event.kind !== "entrusted" || event.result === "agreed" || event.result === undefined) return;
    const asked = this.context?.tasks.get(TASK.bamboo)?.action?.npc;
    if (asked === undefined || event.npc === asked) this.refused = true;
  }

  /** Looks at the game after a frame. */
  afterFrame(view: ViewFrame, tick: number): void {
    if (!this.active || this.restarting) return;
    const slice = this.play.slice;
    const entries = readNotebook(view.raw) ?? [];
    this.entries = entries;
    const ctx = this.contextOf(view, slice, entries);
    this.context = ctx;
    const hintCtx = this.hintContext(ctx, view);
    if (!this.primed) {
      // The first frame of a game, or of one that was loaded: what is true already is not news.
      this.primed = true;
      this.hints.absorb(hintCtx);
      this.day = primeDay({ bamboo: ctx.tasks.get(TASK.bamboo)?.state ?? null });
      this.shows.prime(jobsDone(view.hud, slice.board));
    }

    if (this.tutorial.update(ctx)) this.moved();
    // The bamboo is at the bridge: the card that says the first day is done comes when no other card is up.
    if (this.reviewDay()) this.settle();
    // A job is done: its card comes when no other card is up.
    if (this.reviewShow()) this.settle();

    const verbs = ctx.verbs;
    if (this.hintsOn && !this.tutorial.on) {
      const at = { day: view.time.day, hour: view.time.hour, minute: view.time.minute };
      const gave = this.hints.check(hintCtx, tick, at, performance.now(), this.brief);
      // A card is given once: the act it teaches is taught from now on, in this browser.
      this.markTaught(gave.flatMap((entry) => (entry.act === null ? [] : [entry.act])));
      for (const entry of gave) this.ringHint(entry, hintCtx);
      if (gave.length > 0 || this.hints.lit !== null) this.scheduleExpiry();
    }

    // Nothing has moved for a while: the elder comes by, and gives more at each visit. The night does not count, when the town
    // sleeps and there is nothing to do, nor does the wait for goods somebody promised that are not yet due: the player is right to wait.
    // Nor does a game with no task left to follow, where he would hold the world to say there is nothing to pick, nor a skip to the
    // next thing, in which the player waits on purpose.
    const tasks = slice.tasks?.list ?? [];
    this.stall.note(this.signature(slice, entries), tick, !this.play.skip.running && ticksCount({ time: view.time, tasks, tracked: hintCtx.tracked, promises: slice.commitments ?? [] }));
    const idle = this.play.state.talk === null && this.play.state.ending === null && !this.elder.open && !this.endUp && !this.showUp;
    if (this.hintsOn && !this.tutorial.on && idle && tasks.some(isLive) && this.stall.due()) {
      const level = this.stall.level;
      this.stall.visited();
      this.elder = { open: true, given: Array.from({ length: level }, (_, i) => i + 1), visit: true };
      if (level >= 2 && verbs.has("hint")) this.play.flows.hint();
      this.settle();
    }
    // The paper of the morning and the summary of the night were taken from this frame by the flows, and they hold the world.
    this.syncHold();
  }

  private ringHint(entry: HintEntry, ctx: HintContext): void {
    const ping = this.hints.def(entry.id)?.ping?.(ctx) ?? null;
    if (ping !== null) this.play.ping(ping.id, ping.kind);
  }

  private contextOf(view: ViewFrame, slice: SliceFrame, entries: readonly NotebookEntry[]): TutorialContext {
    return {
      tasks: new Map((slice.tasks?.list ?? []).map((task) => [task.id, task])),
      entries,
      judgments: slice.judgments ?? [],
      verbs: readVerbs(view.hud),
      refused: this.refused,
    };
  }

  private hintContext(ctx: TutorialContext, view: ViewFrame | null): HintContext {
    const slice = this.play.slice;
    return {
      tasks: ctx.tasks,
      tracked: trackedTask(slice.tasks),
      entries: ctx.entries,
      verbs: ctx.verbs,
      talking: this.play.state.talk?.npc ?? null,
      follow: (this.play.state.talk?.lines ?? []).some((line) => followedEntry(line, ctx.entries) !== null),
      leaves: view?.player?.talk?.leavesAt != null,
      promised: (slice.commitments ?? []).filter((c) => c.state === "promised").length,
      leads: this.play.flows.state.leads.length,
      day: view?.time.day ?? 1,
      taught: this.taught,
      asks: askKinds(view),
      live: liveAsks(slice.tasks?.list ?? []),
    };
  }

  /** What has moved in the story, in one string: when it changes, the story moved. */
  private signature(slice: SliceFrame, entries: readonly NotebookEntry[]): string {
    const tasks = (slice.tasks?.list ?? []).map((task) => `${task.id}:${task.state}`).join(",");
    const commitments = (slice.commitments ?? []).map((c) => `${c.id}:${c.state}`).join(",");
    return [tasks, slice.tasks?.tracked ?? "", entries.length, slice.judgments?.length ?? 0, commitments].join("|");
  }

  // --- The page ---------------------------------------------------------------------------------------------------

  /**
   * Holds the world while a card is up, lets it go when none is, and has the page draw again. A card that the card of the end of the
   * first day waited behind may have gone, and then that one takes its turn.
   */
  private settle(): void {
    this.reviewDay();
    this.reviewShow();
    this.play.hold.set("guide", this.cardUp);
    this.scheduleExpiry();
    this.play.touch();
  }

  /** Puts out the signal that is lit when its time is up, and lights the next. The page asks nothing of the frame for it. */
  private scheduleExpiry(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const lit = this.hints.lit;
    if (lit === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.hints.advance(performance.now());
        this.scheduleExpiry();
        this.play.touch();
      },
      Math.max(50, lit.until - performance.now()),
    );
  }

  /** The player pressed something that is lit: the signal has done its work. */
  touched(target: string): void {
    if (this.hints.lit?.target !== target) return;
    this.hints.settle(target);
    this.hints.advance(performance.now());
    this.scheduleExpiry();
    this.play.touch();
  }
}
