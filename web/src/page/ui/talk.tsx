import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import { type Flows, keepOffer, type RequestState, requestOffer } from "../flows.ts";
import { type FrameTalk, type TalkCosts, runsPastLeaving, type ViewFrame } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play, TalkLine } from "../play.ts";
import type { Name, Scene } from "../scene.ts";
import { Cost, personName, resolveValues } from "./common.tsx";
import { lowerFirst } from "./format.ts";
import { TopicChips } from "./chips.tsx";
import { signalClass } from "./guide.tsx";
import { count } from "./paper-text.ts";
import { LinkedText } from "./pointers.tsx";
import { InkAct, Tick, Underline } from "./ink.tsx";
import { otherGroups, Picker, type PickerGroup, type PickerOption, sourceGroups, wayGroups, wayOffers } from "./picker.tsx";

/**
 * What the player can do once they are talking. A verb is shown when the frame lists it, and left out when it does not.
 * Asking is not a button of this row: it is the row of topic tags above it (`TopicChips`).
 */
const IN_TALK = ["ask", "askSource", "tell", "entrust", "promise", "leave"] as const;
type InTalk = (typeof IN_TALK)[number];
/** The lists of choices a talk opens. `tellOther` is the submenu "say it another way". */
type Choosing = "askSource" | "tell" | "tellOther" | "entrust" | "promise";

const LABEL = {
  ask: "verb.ask",
  askSource: "verb.askSource",
  tell: "verb.tell",
  entrust: "verb.entrust",
  promise: "verb.promise",
  leave: "verb.leave",
} as const;

const HINT = {
  ask: "verb.ask.hint",
  askSource: "verb.askSource.hint",
  tell: "verb.tell.hint",
  entrust: "verb.entrust.hint",
  promise: "verb.promise.hint",
  leave: "verb.leave.hint",
} as const;

const PICKER_TITLE = {
  askSource: "picker.source.title",
  tell: "picker.tell.title",
  tellOther: "picker.tellOther.title",
  entrust: "picker.entrust.title",
  promise: "picker.promise.title",
} as const;

/** The cost of each verb, in game minutes, where the frame says. */
function costOf(costs: TalkCosts | null, verb: InTalk | "tellOther"): number | null {
  if (costs === null) return null;
  switch (verb) {
    case "ask":
      return costs.ask;
    case "askSource":
      return costs.askSource;
    case "tell":
    case "tellOther":
      return costs.tell;
    case "entrust":
      return costs.entrust;
    case "promise":
      return costs.promise;
    default:
      return null;
  }
}

const YOU = {
  ask: "talk.you.ask",
  source: "talk.you.source",
  tell: "talk.you.tell",
  entrust: "talk.you.entrust",
  promise: "talk.you.promise",
} as const;

function Line({ line, partner, lang, scene, onPoint }: { line: TalkLine; partner: string; lang: Lang; scene: Scene | null; onPoint(npc: string): void }) {
  if (line.who === "you") {
    // A request or a promise is named by its offer, which says the act from the manager's side already ("请对方把竹料送到桥边",
    // "Ask them to bring the bamboo to the bridge"), so its line is the offer after "you", lower-cased in English.
    const subject = pick(line.subject, lang);
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
    </li>
  );
}

/**
 * What has been said in the talk so far, the newest at the bottom. It begins with what the person said as the talk opened, their greeting,
 * when they said one: the bar has the same words. The greeting is not a line of the talk (it
 * answers nothing the player did), so it has a test id of its own.
 */
export function TalkLog({ lines, opening, partner, lang, scene, onPoint }: { lines: readonly TalkLine[]; opening?: Name; partner: string; lang: Lang; scene: Scene | null; onPoint(npc: string): void }) {
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
      {lines.map((line, i) => (
        <Line key={i} line={line} partner={partner} lang={lang} scene={scene} onPoint={onPoint} />
      ))}
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

const ODDS_KEY = { high: "request.odds.high", mid: "request.odds.mid", low: "request.odds.low" } as const;

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
              t("request.blockers.none")
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
            <dt>{t("request.odds")}</dt>
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
          {preview.cost === null ? null : <span class="verb-cost" data-testid="request-cost" data-minutes={preview.cost}>{t("talk.cost", { n: count(lang, preview.cost) })}</span>}
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
    <section ref={card} class="request paper-slip" data-testid="request-card" data-phase={request.phase} data-verb={request.verb} aria-live="polite">
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

/** Everything the player does in a talk, in one place: ask, tell, request, promise and leave. */
export function TalkArea({ lang, scene, frame, play, enabled, entries }: TalkAreaProps) {
  const talk = play.state.talk;
  const partner = talk?.npc ?? "";
  const frameTalk: FrameTalk | null = frame?.player?.talk ?? null;
  const costs = frameTalk?.costs ?? null;
  const player = frame?.player ?? null;
  // While an act is being paid for the acts wait, so that they do not pile up; leaving does not.
  const owing = play.owing;
  const partnerName = personName(scene, lang, partner);
  /** What an act of this many minutes does to the talk: the person has to go once it is said, or not. */
  const late = (minutes: number | null): string | null => (frame !== null && runsPastLeaving(frame.time, frameTalk?.leavesAt ?? null, minutes) ? t("talk.willGo", { name: partnerName }) : null);
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  /** The tags are lit for a moment when a task's button has asked for a question. */
  const [flash, setFlash] = useState(false);
  const close = useCallback(() => setChoosing(null), []);
  const flows = play.flows;
  const on = (verb: InTalk): boolean => {
    if (!play.playing) return false;
    if (verb === "askSource") return enabled.has("askSource") || enabled.has("ask_source");
    return enabled.has(verb);
  };
  const hasWays = on("tell") && wayOffers(player).length > 0;

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
      setChoosing(null);
      flows.begin(verb === "promise" ? "promise" : "entrust", partner, { id: ready.id, name: ready.name, body: ready.body });
    } else if (verb === "tell" || verb === "entrust" || verb === "promise") setChoosing(verb);
    else if (verb === "ask_source") setChoosing("askSource");
    else if (verb === "ask") setFlash(true);
  }, [wish, talk === null, partner]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  // A list of choices does not outlive the offer it was opened for, nor the moment the world stands still.
  const stillOn = choosing === null || (!owing && (choosing === "tellOther" ? hasWays : on(choosing)));
  useEffect(() => {
    if (!stillOn) setChoosing(null);
  }, [stillOn]);

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
  const name = personName(scene, lang, partner);

  const press = (verb: Exclude<InTalk, "ask">): void => {
    if (verb === "leave") {
      setChoosing(null);
      flows.cancel();
      play.leave();
      return;
    }
    // Starting something else puts away a request that was not confirmed.
    if (flows.state.request !== null && flows.state.request.phase !== "sending") flows.cancel();
    setChoosing((now) => (now === verb ? null : verb));
  };

  const groups = (verb: Choosing): PickerGroup[] => {
    if (verb === "askSource") return sourceGroups(entries, lang);
    if (verb === "tellOther") return wayGroups(player, lang);
    return otherGroups(verb, player, entries, lang);
  };

  const choose = (verb: Choosing, option: PickerOption, group: PickerGroup): void => {
    setChoosing(null);
    if (verb === "askSource") play.askSource(option.id, option.name);
    else if (verb === "entrust" || verb === "promise") flows.begin(verb, partner, { id: option.id, name: option.name, body: option.body ?? null });
    else if (option.body != null) play.other("tell", option.body, option.name);
    else play.other("tell", group.id === "notebook" ? { entry: option.id } : { choice: option.id }, option.name);
  };

  /** One thing to say, as a word with a stroke under it. The minutes it costs are written after it, small. */
  const button = (verb: Exclude<InTalk, "ask">) =>
    on(verb) ? (
      <button key={verb} type="button" class={`verb ink-act${choosing === verb ? " is-open" : ""}${signalClass(play, `verb-${verb}`)}`} data-sig={`verb-${verb}`} data-testid={`verb-${verb}`} aria-haspopup={verb === "leave" ? undefined : "dialog"} aria-expanded={verb === "leave" ? undefined : choosing === verb} disabled={verb !== "leave" && owing} title={t(HINT[verb])} onClick={() => press(verb)}>
        <span>{t(LABEL[verb])}</span>
        <Cost minutes={costOf(costs, verb)} id={verb} />
        {verb === "leave" || late(costOf(costs, verb)) === null ? null : <WillGo id={verb} name={partnerName} />}
        <Underline seed={verb} />
      </button>
    ) : null;

  const topics = on("ask") && choosing === null;
  return (
    <section class="talk-area" data-testid="talk-area" data-npc={partner} aria-label={t("talk.with", { name })}>
      {costs === null ? null : (
        <p class="talk-area-note" data-testid="talk-time-note" data-paying={owing}>
          {owing ? t("talk.time.paying") : t("talk.time")}
        </p>
      )}
      <TalkLog lines={talk.lines} opening={talk.opening} partner={partner} lang={lang} scene={scene} onPoint={(npc) => play.pointTo(npc, partner)} />
      <div class="verbs verbs-talk" role="group" aria-label={t("dialogue.inTalk")} data-testid="talk-verbs">
        {button("askSource")}
        {button("tell")}
        {hasWays ? (
          <button type="button" class={`verb verb-other ink-act${choosing === "tellOther" ? " is-open" : ""}`} data-testid="verb-tellOther" aria-haspopup="dialog" aria-expanded={choosing === "tellOther"} disabled={owing} title={t("verb.tellOther.hint")} onClick={() => setChoosing((now) => (now === "tellOther" ? null : "tellOther"))}>
            <span>{t("verb.tellOther")}</span>
            <Underline seed="tellOther" />
          </button>
        ) : null}
        {button("entrust")}
        {button("promise")}
        {button("leave")}
      </div>
      <div class="slips">
        {topics ? (
          <TopicChips topics={player?.topics ?? []} entries={entries} lang={lang} partner={partner} cost={costOf(costs, "ask")} willGo={late(costOf(costs, "ask"))} disabled={owing} flash={flash} signal={play.guide.signal("topic-chips")} onAsk={(topic) => {
              if (flows.state.request !== null && flows.state.request.phase !== "sending") flows.cancel();
              setChoosing(null);
              play.ask(topic.id, topic.name);
            }} />
        ) : null}
        {choosing === null ? null : (
          <Picker
            inline
            testId={choosing === "tellOther" ? "picker-tellOther" : `picker-${choosing}`}
            title={t(PICKER_TITLE[choosing])}
            groups={groups(choosing)}
            empty={choosing === "askSource" ? t("picker.source.empty") : t("picker.other.empty")}
            onPick={(option, group) => choose(choosing, option, group)}
            onClose={close}
          />
        )}
        <RequestCard flows={flows} lang={lang} scene={scene} late={late} owing={owing} />
      </div>
    </section>
  );
}
