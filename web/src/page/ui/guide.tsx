import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { type Lang, type MessageKey, pick, t } from "../../i18n/index.ts";
import { REST_WORDS, restOf } from "../firstday.ts";
import { GUIDANCES } from "../guide-prefs.ts";
import type { NotebookEntry } from "../notebook.ts";
import { elderAnswer } from "../hints.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { type SliceFrame, type Task, trackedTask } from "../slice.ts";
import { STEPS, type StepId, TASK, type TutorialPhase } from "../tutorial.ts";
import { personName, placeName } from "./common.tsx";
import { bare, clockText, dayLabel, spanText } from "./format.ts";
import { count } from "./paper-text.ts";
import { whenWhere } from "./slip-text.ts";
import { CloseCorner, InkAct, Underline } from "./ink.tsx";
import { ANSWER_KEY } from "./pairing-text.ts";
import { actionLabel, EXPECTED_SHOWN } from "./taskcard.tsx";

/** The class that lights an element the help points at, and the key that tells which it is. */
export function signalClass(play: Play, key: string): string {
  return play.guide.signal(key) ? " is-signal" : "";
}

/** How far below the line of the help a sheet that is open under it starts, in pixels. */
const LINE_GAP = 8;

/**
 * Keeps `--line-room` of the page at the lower edge of the line of the help while it is up (the line of the tutorial, or the hint that is lit), plus a margin,
 * measured as the page runs. A sheet that lies in its band (the notebook, the ledger, a card such as the clan elder's) starts below it
 * (the style sheets say how) and starts where it always did when the line goes. The line itself stays where it is. The ref goes on the element of the line.
 */
function useLineRoom<E extends HTMLElement>(): preact.RefObject<E | null> {
  const line = useRef<E>(null);
  useLayoutEffect(() => {
    const element = line.current;
    const shell = element?.closest<HTMLElement>(".shell") ?? null;
    if (element === null || shell === null) return;
    const measure = (): void => {
      shell.style.setProperty("--line-room", `${Math.ceil(element.getBoundingClientRect().bottom) + LINE_GAP}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
      shell.style.removeProperty("--line-room");
    };
  }, []);
  return line;
}

const REL_KEY = { unsupported: "rel.unsupported", contradicts: "rel.contradicts", mismatch: "rel.mismatch" } as const;

/** The choice of how much the task card does for the player, full or brief, in the menu and at the last step of the tutorial. It is kept per browser. */
export function GuidanceSwitch({ play }: { play: Play }) {
  const guide = play.guide;
  return (
    <div class="choice" role="group" aria-label={t("settings.guidance")} data-testid="guidance-switch" data-guidance={guide.guidance}>
      {GUIDANCES.map((id) => (
        <button key={id} type="button" class="choice-word" data-testid={`guidance-${id}`} aria-pressed={guide.guidance === id} onClick={() => guide.setGuidance(id)}>
          {t(`settings.guidance.${id}`)}
          {guide.guidance === id ? <Underline seed={id} /> : null}
        </button>
      ))}
    </div>
  );
}

// --- The tutorial ---------------------------------------------------------------------------------------------------

interface BodyProps {
  step: StepId;
  play: Play;
  scene: Scene | null;
  lang: Lang;
  slice: SliceFrame;
  verbs: ReadonlySet<string>;
}

/** The title of the card of each step. */
const TITLE: Readonly<Record<StepId, MessageKey>> = {
  granny: "tut.granny.title",
  clerk: "tut.clerk.title",
  compare: "tut.pair.title",
  evening: "tut.evening.title",
};

/** What the card of a step says, with the words of the game itself where the game has them. */
function StepBody({ step, play, scene, lang, slice, verbs }: BodyProps) {
  const task = trackedTask(slice.tasks);
  const bamboo = slice.tasks?.list.find((x) => x.id === TASK.bamboo) ?? task;
  switch (step) {
    case "granny":
      return (
        <>
          <p>{t("tut.granny.body")}</p>
          {task === null ? null : (
            <div class="tut-task" data-testid="tut-task">
              <span class="tut-task-label">{t("tut.goal.task")}</span>
              <strong>{pick(task.text, lang)}</strong>
              {task.why === null ? null : <span>{pick(task.why, lang)}</span>}
            </div>
          )}
        </>
      );
    case "clerk":
      return (
        <>
          <p>{t("tut.clerk.body")}</p>
          {bamboo === null ? null : (
            <dl class="tut-facts" data-testid="tut-refusal">
              {bamboo.blocker === null ? null : (
                <div data-testid="tut-blocker">
                  <dt>{t("task.blocker")}</dt>
                  <dd>{pick(bamboo.blocker, lang)}</dd>
                </div>
              )}
              {bamboo.why === null ? null : (
                <div data-testid="tut-why">
                  <dt>{t("task.why")}</dt>
                  <dd>{pick(bamboo.why, lang)}</dd>
                </div>
              )}
            </dl>
          )}
        </>
      );
    case "compare": {
      const pair = play.guide.pair;
      return (
        <>
          {pair === null ? <p>{t("tut.clerk.body")}</p> : <p data-testid="tut-pair">{t("tut.pair.body", { a: bare(pick(pair.a.text, lang)), b: bare(pick(pair.b.text, lang)) })}</p>}
          <p class="tut-relation" data-testid="tut-relation" data-relation="unsupported">
            {t(ANSWER_KEY.unsupported)}
          </p>
          {verbs.has("judge") ? <p>{t("tut.pair.judge")}</p> : null}
        </>
      );
    }
    case "evening": {
      const evening = slice.tasks?.list.find((x) => x.id === TASK.evening);
      const expected = evening?.expected ?? null;
      return (
        <>
          <p>{t("tut.evening.body")}</p>
          {evening?.window == null ? null : (
            <p class="tut-when" data-testid="tut-when">
              {whenWhere(lang, evening.window, placeName(scene, lang, evening.window.place))}
            </p>
          )}
          {expected === null ? null : (
            <>
              <ul class="tut-expected" data-testid="tut-expected">
                {expected.slice(0, EXPECTED_SHOWN).map((person) => (
                  <li key={person.id}>
                    <strong>{personName(scene, lang, person.id)}</strong> <span>{spanText(person.from, person.to)}</span>
                  </li>
                ))}
              </ul>
              {expected.length <= EXPECTED_SHOWN ? null : (
                <p class="tut-more" data-testid="tut-expected-more">
                  {t("task.expected.more", { n: count(lang, expected.length - EXPECTED_SHOWN) })}
                </p>
              )}
            </>
          )}
          <div class="tut-guidance" data-testid="tut-guidance">
            <p class="tut-guidance-lead">{t("tut.guidance.lead")}</p>
            <GuidanceSwitch play={play} />
            <p class="tut-guidance-help">{t("settings.guidance.help")}</p>
          </div>
        </>
      );
    }
  }
}

/** The line of what to do until the step is done. */
const CHIP = { granny: "tut.ask.chip", clerk: "tut.clerk.chip", compare: "tut.pair.chip" } as const;

/** The clan elder at the bottom of the map: the card of a step, which holds the world, and between cards the line of what to do. */
function Tutorial({ play, scene, lang, slice, verbs }: { play: Play; scene: Scene | null; lang: Lang; slice: SliceFrame; verbs: ReadonlySet<string> }) {
  const guide = play.guide;
  const tutorial = guide.tutorial;
  const card = tutorial.card;
  const focus = useRef<HTMLButtonElement>(null);
  // A new card takes the keyboard to its button, so that Enter puts it away.
  useEffect(() => {
    if (card !== null) focus.current?.focus({ preventScroll: true });
  }, [card]);
  if (!tutorial.on) return null;
  const step = tutorial.step;
  if (step === null) return null;
  const total = STEPS.length;
  if (card !== null) {
    const token = scene?.cast.find((p) => p.id === "zuzhang")?.token[lang] ?? t("tut.who").charAt(0);
    return (
      <section class="tut paper-slip" data-testid="tutorial-card" data-step={card} data-n={guide.number} role="dialog" aria-label={t(TITLE[card])}>
        <div class="tut-main">
          <header class="tut-head">
            <span class="tut-token" aria-hidden="true" lang={lang === "zh" ? "zh-CN" : "en"}>
              {token}
            </span>
            <div class="tut-who">
              <strong>{t("tut.who")}</strong>
              <span data-testid="tutorial-step">{t("tut.step", { n: guide.number, total })}</span>
            </div>
          </header>
          <h2 class="tut-title" data-testid="tutorial-title">
            {t(TITLE[card])}
          </h2>
          <div class="tut-body">
            <StepBody step={card} play={play} scene={scene} lang={lang} slice={slice} verbs={verbs} />
          </div>
        </div>
        <footer class="tut-foot">
          <InkAct seed="tut-skip" class="is-quiet" data-testid="tutorial-skip" onClick={() => guide.skipTutorial()}>
            {t("tut.skip")}
          </InkAct>
          <button type="button" class="ink-act" data-testid="tutorial-next" ref={focus} onClick={() => guide.dismissCard()}>
            {t("tut.got")}
            <Underline seed="tut-next" />
          </button>
        </footer>
      </section>
    );
  }
  const text = tutorial.phase === "waiting" ? (step === "evening" ? t("tut.evening.wait") : null) : step === "granny" || step === "clerk" || step === "compare" ? t(CHIP[step], { name: personName(scene, lang, slice.tasks?.list.find((x) => x.id === TASK.bamboo)?.action?.npc ?? "li_laotai") }) : null;
  if (text === null) return null;
  return <TutorialLine step={step} phase={tutorial.phase} number={guide.number} total={total} text={text} onSkip={() => guide.skipTutorial()} />;
}

/** The line between two cards: which step it is, what to do, and the way out of the tutorial. */
function TutorialLine({ step, phase, number, total, text, onSkip }: { step: StepId; phase: TutorialPhase; number: number; total: number; text: string; onSkip: () => void }) {
  const line = useLineRoom<HTMLDivElement>();
  return (
    <div class="tut-chip paper-slip" data-testid="tutorial-chip" data-step={step} data-phase={phase} ref={line}>
      <span class="tut-chip-n" data-testid="tutorial-step">
        {number}/{total}
      </span>
      <span class="tut-chip-text" data-testid="tutorial-line">
        {text}
      </span>
      <InkAct seed="tut-chip-skip" class="is-quiet" data-testid="tutorial-skip" onClick={onSkip}>
        {t("tut.skip")}
      </InkAct>
    </div>
  );
}

// --- The hint of the world ------------------------------------------------------------------------------------------

/** The seal of the clan elder, who is the one who speaks up: the character of his surname, from the scene. */
function elderToken(scene: Scene | null, lang: Lang): string {
  return scene?.cast.find((p) => p.id === "zuzhang")?.token[lang] ?? t("tut.who").charAt(0);
}

/**
 * The hint that is lit: what the clan elder says, in a line or two near the bottom of the map, with his seal at its head, and for an act
 * that is taught the name of the act over the words. It is not a window: nothing waits for it, and the button it is about glows.
 */
function HintPill({ play, scene, lang }: { play: Play; scene: Scene | null; lang: Lang }) {
  const guide = play.guide;
  const lit = guide.hints.lit;
  if (!guide.hintsOn || guide.tutorial.on || lit === null) return null;
  const entry = guide.hints.log.find((e) => e.id === lit.id);
  if (entry === undefined) return null;
  return <HintLine id={entry.id} text={entry.text} title={entry.title} token={elderToken(scene, lang)} lang={lang} onClose={() => guide.touched(lit.target)} />;
}

function HintLine({ id, text, title, token, lang, onClose }: { id: string; text: MessageKey; title: MessageKey | null; token: string; lang: Lang; onClose: () => void }) {
  const line = useLineRoom<HTMLParagraphElement>();
  return (
    <p class="hint-pill paper-slip" data-testid="hint-pill" data-hint={id} data-card={title !== null} role="status" ref={line}>
      <span class="tut-token" aria-hidden="true" lang={lang === "zh" ? "zh-CN" : "en"}>
        {token}
      </span>
      <span class="hint-pill-body">
        {title === null ? null : (
          <strong class="hint-pill-title" data-testid="hint-pill-title">
            {t(title)}
          </strong>
        )}
        <span class="hint-pill-text">{t(text)}</span>
      </span>
      <CloseCorner label={t("menu.close")} testid="hint-pill-close" onClose={onClose} />
    </p>
  );
}

/** What the help puts at the bottom of the map: the tutorial, or else the hint that is lit. */
export function GuideDock({ play, scene, lang, slice, verbs }: { play: Play; scene: Scene | null; lang: Lang; slice: SliceFrame; verbs: ReadonlySet<string> }) {
  // Something that was lit and was pressed has done its work.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const key = target.closest("[data-sig]")?.getAttribute("data-sig");
      if (key !== null && key !== undefined) play.guide.touched(key);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [play]);
  return (
    <div class="guide-dock" data-testid="guide-dock">
      <HintPill play={play} scene={scene} lang={lang} />
      <Tutorial play={play} scene={scene} lang={lang} slice={slice} verbs={verbs} />
    </div>
  );
}

// --- The log of hints, and asking the elder ---------------------------------------------------------------------------

/**
 * The hints that have been given, in the menu: when each was given, what it said, and a button that lights what it is about once more.
 * They are the cues of the story and the cards that taught an act. A closed line, so that the menu stays short.
 */
export function HintList({ play, lang, onShow }: { play: Play; lang: Lang; onShow: () => void }) {
  const guide = play.guide;
  const log = guide.hints.log;
  if (!guide.active) return null;
  return (
    <details class="menu-hints-list" data-testid="hint-log">
      <summary data-testid="btn-hints">{t("hint.log.open", { n: log.length })}</summary>
      {guide.hintsOn ? null : (
        <p class="hint-log-off" data-testid="hint-log-off">
          {t("hint.log.off")}
        </p>
      )}
      {log.length === 0 ? (
        <p class="hint-log-empty" data-testid="hint-log-empty">
          {t("hint.log.empty")}
        </p>
      ) : (
        <ol class="hint-log-list">
          {[...log].reverse().map((entry) => (
            <li key={entry.id} data-testid="hint-log-entry" data-hint={entry.id}>
              <span class="hint-log-when">
                {dayLabel(lang, entry.at.day)} {clockText(entry.at.hour, entry.at.minute)}
              </span>
              <span class="hint-log-text">
                {entry.title === null ? null : <strong>{t(entry.title)}</strong>}
                {t(entry.text)}
              </span>
              <InkAct
                seed={entry.id}
                data-testid="hint-show"
                onClick={() => {
                  guide.hints.again(entry.id, performance.now());
                  onShow();
                  play.touch();
                }}
              >
                {t("hint.log.show")}
              </InkAct>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** The words of an answer of the elder at a level. */
function answerText(level: number, lang: Lang, slice: SliceFrame, entries: readonly NotebookEntry[], scene: Scene | null, ended: boolean): { text: string; extra: string | null; from: string; doTask: Task | null } {
  // Nothing is left to follow: no task is open now, or the festival is over, whatever the level.
  const rest = restOf(slice.tasks, ended);
  if (rest !== null) {
    const words = REST_WORDS[rest];
    const key = level <= 1 ? words.elder1 : level === 2 ? (rest === "over" ? words.elder1 : "elder.l2.done") : words.elder3;
    return { text: t(key ?? "elder.l2.done"), extra: null, from: rest, doTask: null };
  }
  const answer = elderAnswer(level, { tracked: trackedTask(slice.tasks), entries, hint: slice.hint, judgments: slice.judgments ?? [], tasks: slice.tasks?.list ?? [] });
  if (answer.level === 1) {
    const next = answer.next;
    return { text: next === null ? t("elder.l1.none") : t("elder.l1.say", { next: pick(next, lang) }), extra: null, from: "task", doTask: null };
  }
  if (answer.level === 2) {
    if (answer.pair === null) return { text: t("elder.l2.none"), extra: null, from: "none", doTask: null };
    const lines = { a: bare(pick(answer.pair.a.text, lang)), b: bare(pick(answer.pair.b.text, lang)) };
    // A pair the player judged already is not to be compared again: it is what they have to say in public.
    if (answer.from === "judged") return { text: t("elder.l2.judged", { ...lines, relation: answer.relation === null ? "" : t(REL_KEY[answer.relation as keyof typeof REL_KEY]).toLowerCase() }), extra: null, from: "judged", doTask: null };
    const relation = slice.hint?.relation ?? null;
    return {
      text: t("elder.l2.say", lines),
      extra: answer.from === "core" && relation !== null ? t("elder.l2.relation", { relation: t(REL_KEY[relation]).toLowerCase() }) : null,
      from: answer.from,
      doTask: null,
    };
  }
  const task = answer.task;
  if (task === null) return { text: t("elder.l3.none"), extra: null, from: "none", doTask: null };
  const label = task.action === null ? (task.next === null ? "" : pick(task.next, lang)) : actionLabel(task, scene, lang);
  if (label === "") return { text: t("elder.l3.none"), extra: null, from: "none", doTask: null };
  const where = answer.window === null ? null : t("elder.l3.where", { when: whenWhere(lang, answer.window, placeName(scene, lang, answer.window.place)) });
  return { text: t("elder.l3.say", { step: label }), extra: where, from: "task", doTask: task.action === null ? null : task };
}

/**
 * The button that does the next step, which the task card does not have for a player who chose the brief guidance. The elder gives it with the third level,
 * whether it was asked for or he came by himself: the card is put away and the step is taken.
 */
function ElderDo({ task, play, scene, lang }: { task: Task; play: Play; scene: Scene | null; lang: Lang }) {
  return (
    <InkAct
      seed="elder-do"
      class="elder-do"
      data-testid="elder-do"
      data-verb={task.action?.verb}
      onClick={() => {
        play.guide.closeElder();
        play.flows.run(task);
      }}
    >
      {actionLabel(task, scene, lang)}
    </InkAct>
  );
}

/** The clan elder, asked or come by himself: the levels he has given, and the ones he could still. */
export function ElderSheet({ play, scene, lang, slice, entries }: { play: Play; scene: Scene | null; lang: Lang; slice: SliceFrame; entries: readonly NotebookEntry[] }) {
  const guide = play.guide;
  const elder = guide.elder;
  const sheet = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!elder.open) return;
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") guide.closeElder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [elder.open, guide]);
  if (!elder.open) return null;
  const levels = [1, 2, 3];
  return (
    <section ref={sheet} class="sheet paper-slip sheet-elder" data-testid="elder" data-visit={elder.visit} role="dialog" aria-label={t("elder.title")}>
      <CloseCorner label={t("menu.close")} testid="elder-x" onClose={() => guide.closeElder()} />
      <header class="sheet-head">
        <h2 class="sheet-title">{t("elder.title")}</h2>
      </header>
      <div class="sheet-scroll">
        <p class="elder-lead" data-testid="elder-lead">
          {elder.visit ? t("elder.visit") : t("elder.asked")}
        </p>
        <ol class="elder-answers">
          {levels
            .filter((level) => elder.given.includes(level))
            .map((level) => {
              const said = answerText(level, lang, slice, entries, scene, play.state.ending !== null);
              return (
                <li key={level} class="elder-answer" data-testid={`elder-answer-${level}`} data-level={level} data-from={said.from}>
                  <h3>{t(`elder.level.${level as 1 | 2 | 3}`)}</h3>
                  <p data-testid="elder-text">{said.text}</p>
                  {said.extra === null ? null : <p class="elder-extra">{said.extra}</p>}
                  {level === 3 && guide.brief && said.doTask !== null ? <ElderDo task={said.doTask} play={play} scene={scene} lang={lang} /> : null}
                </li>
              );
            })}
        </ol>
        <div class="elder-levels" role="group" aria-label={t("elder.more")}>
          {levels
            .filter((level) => !elder.given.includes(level))
            .map((level) => (
              <InkAct key={level} seed={`level-${level}`} data-testid={`elder-level-${level}`} onClick={() => guide.giveLevel(level)}>
                {t(`elder.level.${level as 1 | 2 | 3}`)}
              </InkAct>
            ))}
        </div>
        <span class="elder-seal" aria-hidden="true" lang={lang === "zh" ? "zh-CN" : "en"}>
          {scene?.cast.find((p) => p.id === "zuzhang")?.token[lang] ?? t("tut.who").charAt(0)}
        </span>
      </div>
      <div class="sheet-foot">
        <InkAct seed="elder" data-testid="elder-close" data-sheet-focus onClick={() => guide.closeElder()}>
          {t("elder.close")}
        </InkAct>
      </div>
    </section>
  );
}

// --- The end of the first day ----------------------------------------------------------------------------------------

/**
 * The card that says the first day is done: over the map, once in a game, with one button to go on. It names what the days after ask
 * for. It holds the world while it is up (the guide does), and Enter on the button or Escape anywhere puts it away.
 */
export function EndCard({ play }: { play: Play }) {
  const guide = play.guide;
  const up = guide.endUp;
  const sheet = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!up) return;
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") guide.closeEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up, guide]);
  if (!up) return null;
  return (
    <section ref={sheet} class="sheet paper-slip sheet-end" data-testid="end-card" role="dialog" aria-label={t("firstday.title")}>
      <header class="sheet-head">
        <h2 class="sheet-title" data-testid="end-title">
          {t("firstday.title")}
        </h2>
      </header>
      <div class="sheet-scroll">
        <p class="end-reached" data-testid="end-reached">
          {t("firstday.reached")}
        </p>
      </div>
      <div class="sheet-foot">
        <InkAct seed="end" data-testid="end-close" data-sheet-focus onClick={() => guide.closeEnd()}>
          {t("firstday.keep")}
        </InkAct>
      </div>
    </section>
  );
}
