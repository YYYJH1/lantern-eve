import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import { type Flows, keepOffer, type RequestState, requestOffer } from "../flows.ts";
import { type FrameTalk, type Offer, runsPastLeaving, type ViewFrame } from "../frame.ts";
import { isOffReason, readVerbsOffAny } from "../hud.ts";
import { followedEntry, frontierEntries, readGiftHud, type TopicContext } from "../talk-frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play, TalkLine } from "../play.ts";
import type { Name, Scene } from "../scene.ts";
import { personName, resolveValues } from "./common.tsx";
import { bare, lowerFirst } from "./format.ts";
import { AskPanel } from "./ask-panel.tsx";
import { contextItems } from "../context-items.ts";
import { ContextRow, GivePanel, RestPanel } from "./context.tsx";
import { GiftPanel } from "./gift.tsx";
import { signalClass } from "./guide.tsx";
import { HeartPop, Hearts } from "./hearts.tsx";
import { count } from "./paper-text.ts";
import { LinkedText } from "./pointers.tsx";
import { InkAct, Tick, Underline } from "./ink.tsx";
import { Picker, type PickerGroup, type PickerOption, sourceGroups } from "./picker.tsx";
import { SayPanel } from "./say-panel.tsx";

/**
 * What the player can do once they are talking: four acts, and the one thing the talk puts forward besides them. Asking is a list of
 * topics, asking a favour is one request named on its button, telling is a line of the notebook and how to tell it, and leaving ends the talk.
 * An act the town cannot offer now is there all the same, greyed, and says why when it is pressed.
 */
const MAIN = ["ask", "entrust", "tell", "leave"] as const;
type Main = (typeof MAIN)[number];

/** The lists a talk opens above its strip. */
type Panel = "ask" | "entrust" | "tell" | "give" | "rest" | "gift" | "askSource";

const LABEL = {
  ask: "talk.btn.ask",
  entrust: "talk.btn.entrust",
  tell: "talk.btn.tell",
  leave: "talk.btn.leave",
} as const;

const HINT = {
  ask: "talk.btn.ask.hint",
  entrust: "talk.btn.entrust.hint",
  tell: "talk.btn.tell.hint",
  leave: "talk.btn.leave.hint",
} as const;

/** The verb of the town each button asks for. */
const VERB_OF: Readonly<Record<Main, string>> = { ask: "ask", entrust: "entrust", tell: "tell", leave: "leave" };

const YOU = {
  ask: "talk.you.ask",
  source: "talk.you.source",
  tell: "talk.you.tell",
  entrust: "talk.you.entrust",
  promise: "talk.you.promise",
  gift: "talk.you.gift",
} as const;

function Line({ line, partner, lang, scene, onPoint, followUp, signal }: { line: TalkLine; partner: string; lang: Lang; scene: Scene | null; onPoint(npc: string): void; followUp: (() => void) | null; signal: (key: string) => string }) {
  if (line.who === "you") {
    // A request or a promise is named by its offer, which says the act from the manager's side and names the person already ("请李大把竹料送到桥边",
    // "Ask Li Da to bring the bamboo to the bridge"), so its line is the offer after "you", lower-cased in English.
    // A line of the notebook asked after is quoted inside the sentence, without its own full stop.
    const subject = line.how === "source" ? bare(pick(line.subject, lang)) : pick(line.subject, lang);
    const offered = line.how === "entrust" || line.how === "promise";
    return (
      <li class="talk-you" data-testid="talk-line" data-who="you" data-how={line.how}>
        {t(YOU[line.how], { subject: offered && lang === "en" ? lowerFirst(subject) : subject })}
      </li>
    );
  }
  return (
    <li class="talk-them" data-testid="talk-line" data-who="them" data-npc={partner}>
      <LinkedText text={pick(line.text, lang)} points={line.points ?? []} scene={scene} lang={lang} onPoint={onPoint} />
      {followUp === null ? null : (
        <InkAct seed={`follow-${line.entry ?? "x"}`} class={`talk-follow${signal("verb-askSource")}`} data-sig="verb-askSource" data-testid="talk-follow" data-entry={line.entry} onClick={followUp}>
          {t("talk.follow")}
        </InkAct>
      )}
    </li>
  );
}

/**
 * What has been said in the talk so far, the newest at the bottom. It begins with what the person said as the talk opened, their greeting,
 * when they said one: the bar has the same words. The greeting is not a line of the talk (it
 * answers nothing the player did), so it has a test id of its own. An answer that was passed on to the person (they heard it from somebody)
 * has a phrase beside it that asks who told them.
 */
export function TalkLog({ lines, opening, partner, lang, scene, onPoint, entries, onFollow, signal = () => "" }: { lines: readonly TalkLine[]; opening?: Name; partner: string; lang: Lang; scene: Scene | null; onPoint(npc: string): void; entries?: readonly NotebookEntry[]; onFollow?: (entry: string, name: Name) => void; signal?: (key: string) => string }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines.length]);
  if (lines.length === 0 && opening === undefined) return null;
  return (
    <ol class="talk-log" ref={list} data-testid="talk-log" aria-label={t("talk.log")}>
      {opening === undefined ? null : (
        <li class="talk-them" data-testid="talk-opening" data-npc={partner}>
          {pick(opening, lang)}
        </li>
      )}
      {lines.map((line, i) => {
        const entry = followedEntry(line, entries ?? []);
        const follow = entry !== null && onFollow !== undefined ? () => onFollow(entry.id, entry.text) : null;
        return <Line key={i} line={line} partner={partner} lang={lang} scene={scene} onPoint={onPoint} followUp={follow} signal={signal} />;
      })}
    </ol>
  );
}

/** Said on a button, in a preview and over the tags when the act would run to the hour the person has to go. */
function WillGo({ id, name }: { id: string; name: string }) {
  return (
    <span class="verb-late" data-testid={`late-${id}`} role="note">
      {t("talk.willGo", { name })}
    </span>
  );
}

// --- A request: the preview first, and the result in the same place --------------------------------

const ODDS_KEY = { high: "request.odds.high2", mid: "request.odds.mid2", low: "request.odds.low2" } as const;

function Preview({ request, flows, lang, late, owing }: { request: Extract<RequestState, { phase: "preview" | "sending" }>; flows: Flows; lang: Lang; late: string | null; owing: boolean }) {
  const { preview } = request;
  const sending = request.phase === "sending";
  const gives = request.verb === "promise" ? (preview.gives ?? preview.asks) : preview.gives;
  return (
    <>
      {request.phase === "preview" && request.stale ? (
        <p class="request-stale" data-testid="request-stale" role="status">
          {t("request.stale")}
        </p>
      ) : null}
      <dl class="request-facts">
        {request.verb === "promise" ? null : (
          <div data-testid="request-asks">
            <dt>{t("request.asks")}</dt>
            <dd>{pick(preview.asks, lang)}</dd>
          </div>
        )}
        {gives === null ? null : (
          <div data-testid="request-gives">
            <dt>{t(request.verb === "promise" ? "request.promises" : "request.gives")}</dt>
            <dd>{pick(gives, lang)}</dd>
          </div>
        )}
        <div data-testid="request-blockers">
          <dt>{t("request.blockers")}</dt>
          <dd>
            {preview.blockers.length === 0 ? (
              t("request.blockers.none2")
            ) : (
              <ul class="request-blockers">
                {preview.blockers.map((b, i) => (
                  <li key={i} data-testid="request-blocker">
                    {pick(b, lang)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {preview.odds === null ? null : (
          <div data-testid="request-odds" data-odds={preview.odds}>
            <dt>{t("request.odds2")}</dt>
            <dd>{t(ODDS_KEY[preview.odds])}</dd>
          </div>
        )}
      </dl>
      {preview.reasons.length === 0 ? null : (
        <ul class="request-reasons" data-testid="request-reasons">
          {preview.reasons.map((r, i) => (
            <li key={i} data-sign={r.sign}>
              <span class="reason-sign" aria-hidden="true">
                {r.sign > 0 ? "+" : "−"}
              </span>
              {pick(r.text, lang)}
            </li>
          ))}
        </ul>
      )}
      {late === null ? null : (
        <p class="request-leaves" data-testid="request-leaves" role="note">
          {late}
        </p>
      )}
      <div class="request-buttons">
        <button type="button" class="ink-frame" data-testid="request-confirm" disabled={sending || owing} title={owing ? t("talk.time.paying") : undefined} onClick={() => flows.confirm()}>
          <span>{sending ? t("request.sending") : t("request.confirm")}</span>
        </button>
        <InkAct seed="request-cancel" data-testid="request-cancel" disabled={sending} onClick={() => flows.cancel()}>
          {t("request.cancel")}
        </InkAct>
      </div>
    </>
  );
}

function Result({ request, flows, lang, name }: { request: Extract<RequestState, { phase: "result" }>; flows: Flows; lang: Lang; name: string }) {
  return (
    <>
      <p class={`request-result ${request.ok ? "is-ok" : "is-no"}`} data-testid="request-result" data-ok={request.ok}>
        <span class="result-mark" aria-hidden="true">
          {request.ok ? <Tick seed={request.verb} /> : "×"}
        </span>
        <span>
          {request.ok
            ? t(request.verb === "promise" ? "request.result.promised" : "request.result.agreed", { name })
            : t(refusalKey(request.verb, request.reason ?? "unknown"), { name, reason: request.reason ?? "" })}
        </span>
      </p>
      {request.reply === null ? null : (
        <p class="request-reply" data-testid="request-reply">
          {pick(request.reply, lang)}
        </p>
      )}
      {request.facts.length === 0 ? null : (
        <ul class="request-facts-list" data-testid="request-facts">
          {request.facts.map((fact, i) => (
            <li key={i}>{t(fact.key, resolveValues(fact.values, lang))}</li>
          ))}
        </ul>
      )}
      {request.cost !== null ? <p class="request-spent" data-testid="request-spent">{t("request.spent", { n: count(lang, request.cost) })}</p> : null}
      <div class="request-buttons">
        {request.ok && request.follow != null ? (
          <InkAct seed="request-follow" data-testid="request-follow" onClick={() => flows.followUp()}>
            {t("request.follow")}
          </InkAct>
        ) : null}
        <InkAct seed="request-close" data-testid="request-close" onClick={() => flows.cancel()}>
          {t("request.close")}
        </InkAct>
      </div>
    </>
  );
}

/** The request in progress: its preview, and after the player confirms it the result, in the same place. */
function RequestCard({ flows, lang, scene, late, owing }: { flows: Flows; lang: Lang; scene: Scene | null; late: (minutes: number | null) => string | null; owing: boolean }) {
  const request = flows.state.request;
  const card = useRef<HTMLElement>(null);
  const phase = request?.phase ?? null;
  // The card opens, and turns into its result, where the player is looking: the button that decides is not left below the fold.
  useEffect(() => {
    const element = card.current;
    if (phase === null || element === null) return;
    const frame = requestAnimationFrame(() => element.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  if (request === null) return null;
  const name = personName(scene, lang, request.npc);
  return (
    <section ref={card} class="request paper-slip" data-testid="request-card" data-phase={request.phase} data-verb={request.verb} data-offer={request.offer.id} data-cost={"preview" in request ? (request.preview.cost ?? "") : ""} aria-live="polite">
      <h3 class="request-title">{t(request.verb === "promise" ? "request.title.promise" : "request.title", { name })}</h3>
      {request.phase === "loading" ? (
        <p class="request-loading" data-testid="request-loading">
          {t("request.loading")}
        </p>
      ) : request.phase === "failed" ? (
        <>
          <p class="request-failed" data-testid="request-failed" role="status">
            {t("request.failed")}
          </p>
          <div class="request-buttons">
            <button type="button" class="ink-frame" data-testid="request-retry" onClick={() => flows.retry()}>
              {t("request.retry")}
            </button>
            <InkAct seed="request-cancel" data-testid="request-cancel" onClick={() => flows.cancel()}>
              {t("request.cancel")}
            </InkAct>
          </div>
        </>
      ) : request.phase === "result" ? (
        <Result request={request} flows={flows} lang={lang} name={name} />
      ) : (
        <Preview request={request} flows={flows} lang={lang} late={late(request.preview.cost)} owing={owing} />
      )}
    </section>
  );
}

// --- The talk area ----------------------------------------------------------------------------------------------

export interface TalkAreaProps {
  lang: Lang;
  scene: Scene | null;
  frame: ViewFrame | null;
  play: Play;
  /** The verbs the world offers now (`hud.verbs`). */
  enabled: ReadonlySet<string>;
  entries: readonly NotebookEntry[];
}

/** How long the reason an act is greyed for stays under the acts, in milliseconds. */
const OFF_MS = 5000;

/** The reason an act is not on offer, in words. The core gives a code; a code the page has no words for is said in a general line. */
export function offWords(reason: string, verb: string, name: string): string {
  if (reason === "not_yet" && verb === "ask_source") return t("talk.off.not_yet.ask_source");
  return isOffReason(reason) ? t(`talk.off.${reason}`, { name }) : t("talk.off.other");
}

/** Everything the player does in a talk, in one place: ask, ask for a favour, tell, leave and what the person is waiting for. */
export function TalkArea({ lang, scene, frame, play, enabled, entries }: TalkAreaProps) {
  const talk = play.state.talk;
  const partner = talk?.npc ?? "";
  const frameTalk: FrameTalk | null = frame?.player?.talk ?? null;
  const costs = frameTalk?.costs ?? null;
  const more = frameTalk?.more ?? null;
  const player = frame?.player ?? null;
  const hud = frame?.hud ?? {};
  // While an act is being paid for the acts wait, so that they do not pile up; leaving does not.
  const owing = play.owing;
  const partnerName = personName(scene, lang, partner);
  /** What an act of this many minutes does to the talk: the person has to go once it is said, or not. */
  const late = (minutes: number | null): string | null => (frame !== null && runsPastLeaving(frame.time, frameTalk?.leavesAt ?? null, minutes) ? t("talk.willGo", { name: partnerName }) : null);
  const [panel, setPanel] = useState<Panel | null>(null);
  /** The list of the others has the request on the button too, where a task's button opened it. */
  const [entrustAll, setEntrustAll] = useState(false);
  /** The list of questions is lit for a moment when a task's button has asked for a question. */
  const [flash, setFlash] = useState(false);
  /** The act that is greyed and was pressed: the reason it is greyed for is read from the frame when it is shown, and goes with it. */
  const [off, setOff] = useState<string | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const flows = play.flows;
  const verbsOff = readVerbsOffAny(hud);
  const gift = readGiftHud(hud);
  const relation = frame?.relations.get(partner);
  const on = (verb: string): boolean => play.playing && enabled.has(verb);
  const items = contextItems(more, flows.state.declined);

  // What was open is put away when the partner changes, before a task's button opens its list for the new talk (the effects run in this order).
  useEffect(() => {
    setPanel(null);
    setOff(null);
  }, [partner]);

  // A task's button asked for a verb of this talk: open its list as soon as the talk is on. A task that names the request has it ready, with its
  // preview, when the town puts it forward to this person now; else the list is opened, as for a task that names only the thing.
  const wish = flows.state.suggest?.npc === partner && talk !== null ? flows.state.suggest.verb : null;
  useEffect(() => {
    if (wish === null || talk === null) return;
    const asked = flows.state.suggest;
    const verb = flows.takeSuggestion(partner);
    const ready =
      verb === "entrust" && asked?.request != null
        ? requestOffer(player?.offers.entrust ?? [], asked.request, asked.target ?? null)
        : verb === "promise" && asked?.kind === "keep" && asked.item != null
          ? keepOffer(player?.offers.promise ?? [], asked.item)
          : null;
    if (ready !== null) {
      setPanel(null);
      flows.begin(verb === "promise" ? "promise" : "entrust", partner, { id: ready.id, name: ready.name, body: ready.body });
    } else if (verb === "tell") setPanel("tell");
    else if (verb === "gift") setPanel("gift");
    else if (verb === "entrust") {
      // A task that asks for the thing and names no request is asking for the one request the town puts forward, which is the red slip's. A task that
      // names a request the town does not put forward now gets the list of everything that can be asked, the one on the button included.
      if (asked?.request == null && more?.askFor != null) flows.begin("entrust", partner, more.askFor);
      else {
        setEntrustAll(true);
        setPanel("entrust");
      }
    }
    else if (verb === "promise") setPanel("give");
    else if (verb === "ask_source") setPanel("askSource");
    else if (verb === "ask") {
      setPanel("ask");
      setFlash(true);
    }
  }, [wish, talk === null, partner]);
  useEffect(() => {
    if (panel !== "entrust") setEntrustAll(false);
  }, [panel]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (off === null) return;
    const timer = setTimeout(() => setOff(null), OFF_MS);
    return () => clearTimeout(timer);
  }, [off]);

  // A list of choices does not outlive the offer it was opened for, nor the moment the world stands still.
  const open =
    panel === null ||
    (!owing &&
      (panel === "ask" || panel === "entrust" || panel === "tell"
        ? on(panel)
        : panel === "gift"
          ? enabled.has("gift")
          : panel === "askSource"
            ? on("ask_source") || on("askSource")
            : panel === "rest"
              ? items.length > 1
              : true));
  useEffect(() => {
    if (!open) setPanel(null);
  }, [open]);

  if (talk === null) {
    // The person had to go once the act was said: what they answered stays where the player can read it, until it is put away.
    const last = flows.state.request;
    if (last === null || last.phase !== "result") return null;
    return (
      <section class="talk-area talk-ended" data-testid="talk-ended" aria-label={t("talk.with", { name: personName(scene, lang, last.npc) })}>
        {/* A card of its own, so that it scrolls itself into view where the player is looking, as it did when it opened. */}
        <RequestCard key="ended" flows={flows} lang={lang} scene={scene} late={late} owing={false} />
      </section>
    );
  }
  const name = partnerName;
  const cancelRequest = (): void => {
    // Starting something else puts away a request that was not confirmed.
    if (flows.state.request !== null && flows.state.request.phase !== "sending") flows.cancel();
  };

  const press = (verb: Main): void => {
    setOff(null);
    if (verb === "leave") {
      setPanel(null);
      flows.cancel();
      play.leave();
      return;
    }
    cancelRequest();
    if (verb === "entrust") {
      // With one request put forward the button asks for it; with none, or to ask for another, the list is the way.
      if (more?.askFor != null) {
        setPanel(null);
        flows.begin("entrust", partner, more.askFor);
      } else setPanel((now) => (now === "entrust" ? null : "entrust"));
      return;
    }
    setPanel((now) => (now === verb ? null : verb));
  };

  /** The core's reason an act is off, or null where it gives none. */
  const reasonOf = (verb: string): string | null => verbsOff.get(verb) ?? null;
  const wordsOf = (verb: string): string | null => {
    const reason = reasonOf(verb);
    return reason === null ? null : offWords(reason, verb, name);
  };

  const pressOff = (verb: string): void => {
    setPanel(null);
    setOff(verb);
  };

  const chooseEntrust = (option: PickerOption, group: PickerGroup): void => {
    setPanel(null);
    // What can be promised is in the list of the others too, so that a promise can be made without having been turned down first.
    flows.begin(group.id === "give" ? "promise" : "entrust", partner, { id: option.id, name: option.name, body: option.body ?? null });
  };

  const give = (item: { id: string; name: Name }): void => {
    setPanel(null);
    play.gift(item.id, item.name);
  };

  /** The label of a request on the button: the request put forward, or "Ask for a favour". */
  const entrustLabel = more?.askFor != null ? pick(more.askFor.name, lang) : t(LABEL.entrust);

  const mainButton = (verb: Main) => {
    const button = mainButtonOnly(verb);
    if (button === null || verb !== "entrust" || more?.askFor == null || (more.asksMore.length === 0 && more.give.preferred === null && more.give.more.length === 0)) return button;
    return [
      button,
      <button key="entrust-more" type="button" class={`ink-act verb-more${panel === "entrust" ? " is-open" : ""}`} data-testid="entrust-more" aria-haspopup="dialog" aria-expanded={panel === "entrust"} disabled={owing || !on("entrust")} onClick={() => (cancelRequest(), setOff(null), setPanel((now) => (now === "entrust" ? null : "entrust")))}>
        {t("asks.more")}
        <Underline seed="entrust-more" />
      </button>,
    ];
  };

  const mainButtonOnly = (verb: Main) => {
    const enabledNow = verb === "leave" ? play.playing : on(VERB_OF[verb]);
    const reason = enabledNow ? null : wordsOf(VERB_OF[verb]);
    // A button the town does not offer and gives no reason for is not drawn.
    if (!enabledNow && reason === null) return null;
    const cost = verb === "ask" ? costs?.ask : verb === "tell" ? costs?.tell : verb === "entrust" ? costs?.entrust : null;
    const willGo = enabledNow && verb !== "leave" ? late(cost ?? null) : null;
    const label = verb === "entrust" ? entrustLabel : t(LABEL[verb]);
    const sig = verb === "ask" ? "topic-chips" : `verb-${verb}`;
    return (
      <button
        key={verb}
        type="button"
        class={`verb ink-act${panel === verb || (verb === "ask" && panel === "askSource") ? " is-open" : ""}${enabledNow ? "" : " is-off"}${signalClass(play, `verb-${verb}`)}${verb === "ask" ? signalClass(play, "topic-chips") : ""}`}
        data-sig={sig}
        data-testid={`verb-${verb}`}
        aria-haspopup={verb === "leave" || (verb === "entrust" && more?.askFor != null) ? undefined : "dialog"}
        aria-expanded={verb === "leave" ? undefined : panel === verb}
        aria-disabled={enabledNow ? undefined : true}
        disabled={enabledNow && verb !== "leave" && owing}
        title={reason ?? t(HINT[verb], { name })}
        onClick={() => (enabledNow ? press(verb) : pressOff(VERB_OF[verb]))}
      >
        <span>{label}</span>
        {willGo === null ? null : <WillGo id={verb} name={name} />}
        <Underline seed={verb} />
      </button>
    );
  };

  const groupsOfEntrust = (): PickerGroup[] => {
    // A frame from before the keys has the town's offers to ask a person for, and those are the list.
    const list = more === null ? (player?.offers.entrust ?? []).map((offer) => ({ ...offer, status: "open" as const, task: null })) : [...(entrustAll && more.askFor !== null ? [more.askFor] : []), ...more.asksMore];
    const option = (item: (typeof list)[number]): PickerOption => ({ id: item.id, label: pick(item.name, lang), badge: item.status === "open" ? undefined : t(`asks.status.${item.status}`), name: item.name, body: item.body });
    const persuade = list.filter((item) => item.body?.kind === "persuade");
    const gives = [more?.give.preferred ?? null, ...(more?.give.more ?? [])].filter((offer): offer is Offer => offer !== null);
    return [
      { id: "asks", title: more?.askFor != null ? t("asks.others") : "", options: list.filter((item) => item.body?.kind !== "persuade").map(option) },
      { id: "persuade", title: t("asks.persuade", { name }), options: persuade.map(option) },
      { id: "give", title: t("give.title", { name }), options: gives.map((offer) => ({ id: offer.id, label: pick(offer.name, lang), name: offer.name, body: offer.body })) },
    ];
  };

  const keepNow = (keep: { offer: { id: string; name: Name; body: Record<string, unknown> | null } }): void => {
    setPanel(null);
    cancelRequest();
    flows.begin("promise", partner, keep.offer);
  };

  const topicContext: TopicContext = { partner, slice: play.slice, entries, fresh: play.state.fresh, asked: flows.askedOf(partner) };
  const followUps = frontierEntries((frame?.raw as Record<string, unknown> | undefined)?.notebook, partner)
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is NotebookEntry => e !== undefined);
  const giftOpen = gift !== null && (enabled.has("gift") || verbsOff.has("gift"));
  const giftOff = giftOpen && !enabled.has("gift") ? wordsOf("gift") : null;
  const pops = play.state.pops.filter((pop) => pop.npc === partner);

  return (
    <section class="talk-area" data-testid="talk-area" data-npc={partner} aria-label={t("talk.with", { name })}>
      {costs === null ? null : (
        <p class="talk-area-note" data-testid="talk-time-note" data-paying={owing}>
          {owing ? t("talk.time.paying") : t("talk.time2")}
        </p>
      )}
      {relation === undefined ? null : (
        <div class="talk-head" data-testid="talk-head">
          <Hearts value={relation.hearts} size="m" onOpen={() => play.openHearts(partner)} />
          {pops.map((pop) => (
            <HeartPop key={pop.id} delta={pop.delta} why={pop.why} name={name} />
          ))}
          {!giftOpen ? null : (
            <button type="button" class={`ink-act gift-open${giftOff === null ? "" : " is-off"}${signalClass(play, "verb-gift")}`} data-testid="gift-open" data-sig="verb-gift" aria-disabled={giftOff === null ? undefined : true} aria-expanded={panel === "gift"} title={giftOff ?? t("gift.hint", { name })} onClick={() => (giftOff === null ? (cancelRequest(), setOff(null), setPanel((now) => (now === "gift" ? null : "gift"))) : pressOff("gift"))}>
              {t("gift.open")}
              <Underline seed="gift" />
            </button>
          )}
        </div>
      )}
      <TalkLog lines={talk.lines} opening={talk.opening} partner={partner} lang={lang} scene={scene} onPoint={(npc) => play.pointTo(npc, partner)} entries={entries} onFollow={(entry, subject) => play.askSource(entry, subject)} signal={(key) => signalClass(play, key)} />
      <div class="verbs verbs-talk" role="group" aria-label={t("dialogue.inTalk")} data-testid="talk-verbs">
        {MAIN.map(mainButton)}
      </div>
      {off === null || wordsOf(off) === null ? null : (
        <p class="talk-off" data-testid="talk-off" data-verb={off} role="status">
          {wordsOf(off)}
        </p>
      )}
      <ContextRow
        signal={(key) => signalClass(play, key)}
        items={items}
        name={name}
        lang={lang}
        disabled={owing}
        restOpen={panel === "rest"}
        onAccept={(wants) => {
          setPanel(null);
          cancelRequest();
          flows.accept(partner, wants);
        }}
        onDecline={(wants) => flows.decline(wants)}
        onKeep={keepNow}
        onGive={() => {
          cancelRequest();
          setPanel((now) => (now === "give" ? null : "give"));
        }}
        onRest={() => setPanel((now) => (now === "rest" ? null : "rest"))}
      />
      <div class="slips">
        {panel === "ask" ? (
          <AskPanel
            topics={player?.topics ?? []}
            context={topicContext}
            lang={lang}
            partner={partner}
            followUps={followUps}
            disabled={owing}
            willGo={late(costs?.ask ?? null)}
            flash={flash}
            signal={play.guide.signal("topic-chips")}
            underRequest={flows.state.request !== null}
            onAsk={(topic) => {
              cancelRequest();
              play.ask(topic.id, topic.name);
            }}
            onFollow={(entry) => {
              cancelRequest();
              play.askSource(entry.id, entry.text);
            }}
            onClose={close}
          />
        ) : null}
        {panel === "tell" ? (
          <SayPanel
            entries={entries}
            offers={player?.offers.tell ?? []}
            lang={lang}
            name={name}
            disabled={owing}
            onTell={(entry, how) => {
              setPanel(null);
              play.other("tell", { entry: entry.id, how }, entry.text);
            }}
            onClose={close}
          />
        ) : null}
        {panel === "entrust" ? (
          <Picker inline testId="picker-entrust" title={t("asks.title", { name })} groups={groupsOfEntrust()} empty={t("picker.other.empty")} onPick={(option, group) => chooseEntrust(option, group)} onClose={close} />
        ) : null}
        {panel === "askSource" ? (
          <Picker
            inline
            testId="picker-askSource"
            title={t("picker.source.title2")}
            groups={sourceGroups(entries, lang)}
            empty={t("picker.source.empty2")}
            onPick={(option) => {
              setPanel(null);
              play.askSource(option.id, option.name);
            }}
            onClose={close}
          />
        ) : null}
        {panel === "give" && more !== null ? (
          <GivePanel
            give={more.give}
            name={name}
            lang={lang}
            onPromise={(offer) => {
              setPanel(null);
              flows.begin("promise", partner, offer);
            }}
            onGift={() => setPanel("gift")}
            onClose={close}
          />
        ) : null}
        {panel === "rest" ? (
          <RestPanel
            items={items}
            name={name}
            lang={lang}
            onKeep={keepNow}
            onGive={() => setPanel("give")}
            onAccept={(wants) => {
              setPanel(null);
              flows.accept(partner, wants);
            }}
            onClose={close}
          />
        ) : null}
        {panel === "gift" && gift !== null ? <GiftPanel gift={gift} relation={relation} name={name} lang={lang} disabled={owing} onGive={give} onClose={close} /> : null}
        <RequestCard flows={flows} lang={lang} scene={scene} late={late} owing={owing} />
      </div>
    </section>
  );
}
