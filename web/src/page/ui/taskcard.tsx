import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { TaskChange } from "../flows.ts";
import { REST_WORDS, restOf } from "../firstday.ts";
import type { BridgeProgress } from "../hud.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { type Commitment, type Expected, type SliceFrame, type Task, trackedTask } from "../slice.ts";
import { actionLabel } from "./actions.ts";
import { Dash, personName, placeName } from "./common.tsx";
import { agreedText, spanText } from "./format.ts";
import { signalClass } from "./guide.tsx";
import { CloseIcon } from "./icons.tsx";
import { Brush, Stamp, Tick, Underline } from "./ink.tsx";
import { STRIKE_LINES } from "./marks.ts";
import { count } from "./paper-text.ts";
import { crewShortfall, isCrewTask, shortfallWords, whenWhere } from "./slip-text.ts";

// The words of the buttons and the names of things are in actions.ts and names.ts, which the unit tests can read; the views take them from here.
export { actionLabel };
export { thingName } from "./names.ts";

/**
 * Why the task that is followed is the one it is, in the core's words: shown while it is the task that came of the
 * change, and not for the first task of the game or for a task the player picked themselves.
 */
function changeNote(change: TaskChange | null, tracked: string | null, lang: Lang): string | null {
  if (change === null || change.to === null || change.to !== tracked) return null;
  if (change.cause === "chosen" || (change.cause === "new" && change.from === null)) return null;
  const reason = pick(change.reason, lang);
  return reason === "" ? null : reason;
}

/** Who will be there, the first few in a list and the rest behind a line that says how many. */
export const EXPECTED_SHOWN = 5;

export function ExpectedList({ expected, scene, lang }: { expected: readonly Expected[]; scene: Scene | null; lang: Lang }) {
  const row = (person: Expected) => (
    <li key={person.id} data-testid="task-expected-person" data-id={person.id} data-from={person.from} data-to={person.to}>
      <strong>{personName(scene, lang, person.id)}</strong>
      <span>{spanText(person.from, person.to)}</span>
    </li>
  );
  const rest = expected.slice(EXPECTED_SHOWN);
  return (
    <>
      <ul class="expected-list">{expected.slice(0, EXPECTED_SHOWN).map(row)}</ul>
      {rest.length === 0 ? null : (
        <details class="expected-more" data-testid="task-expected-more">
          <summary>{t("task.expected.more", { n: count(lang, rest.length) })}</summary>
          <ul class="expected-list">{rest.map(row)}</ul>
        </details>
      )}
    </>
  );
}

/** The people replies have sent the player to and the player has not talked to yet, each with a phrase that goes there. */
function Leads({ play, scene, lang }: { play: Play; scene: Scene | null; lang: Lang }) {
  const leads = play.flows.state.leads;
  if (leads.length === 0) return null;
  return (
    <section class={`leads${signalClass(play, "leads")}`} data-sig="leads" data-testid="leads" aria-label={t("leads.title")}>
      <h3 class="leads-title">{t("leads.title")}</h3>
      <ul class="leads-list">
        {leads.map((lead) => (
          <li key={lead.npc} class="lead" data-testid="lead" data-npc={lead.npc}>
            <span class="lead-text">
              <strong>{personName(scene, lang, lead.npc)}</strong>
              <em>{t("leads.from", { name: personName(scene, lang, lead.from) })}</em>
            </span>
            <button type="button" class="phrase" data-testid="lead-go" onClick={() => play.talkOrWalk(lead.npc)}>
              {t("leads.go")}
              <Underline seed={lead.npc} />
            </button>
            <button type="button" class="toast-close" data-testid="lead-drop" aria-label={t("leads.drop")} title={t("leads.drop")} onClick={() => play.flows.dropLead(lead.npc)}>
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OtherTask({ task, canTrack, play, lang }: { task: Task; canTrack: boolean; play: Play; lang: Lang }) {
  return (
    <li class="task-other" data-testid="task-other" data-id={task.id} data-state={task.state}>
      <span class="task-other-text">{pick(task.text, lang)}</span>
      <span class="task-other-state" data-testid="task-state" data-state={task.state}>
        {t(`task.state.${task.state}`)}
      </span>
      {canTrack ? (
        <button type="button" class="phrase" data-testid="task-track" onClick={() => play.flows.track(task.id)}>
          {t("task.track")}
          <Underline seed={task.id} />
        </button>
      ) : null}
    </li>
  );
}

/** The gap between the note of the slip and the note of a picked person that stands under it, in pixels. */
const NOTE_GAP = 8;
/** The least the note of the slip is as tall as, however little room the note of the person leaves it, in pixels. */
const NOTE_LEAST = 120;

/**
 * While a person is picked their note stands at the foot of the page, and the note of the slip ends above it and scrolls. The room is what lies between where the
 * title of the slip ends (which depends on the lines it runs to, in this language and this window) and where the note of the person begins (which depends on what
 * is written in it), measured as the page runs. Where nobody is picked the note is as tall as what is written in it. The ref goes on the note of the slip.
 * The lines the title runs to are also kept in `--slip-lines` of the page: the ledger and the book start one line lower for each line after the first, so that
 * they never lie over the slip (the style sheets say how).
 */
function useNoteRoom(): preact.RefObject<HTMLDivElement | null> {
  const note = useRef<HTMLDivElement>(null);
  /** The note of the person that is watched for a change of its size, which a fold in it makes without the page being drawn again. */
  const watched = useRef<Element | null>(null);
  const watch = useRef<ResizeObserver | null>(null);
  const fit = (): void => {
    const element = note.current;
    const shell = element?.closest<HTMLElement>(".shell") ?? null;
    const head = element?.parentElement?.querySelector<HTMLElement>(".slip-head") ?? null;
    if (element === null || shell === null || head === null) return;
    const title = head.querySelector<HTMLElement>(".slip-title");
    const leading = title === null ? 0 : Number.parseFloat(getComputedStyle(title).lineHeight);
    shell.style.setProperty("--slip-lines", String(title !== null && leading > 0 ? Math.max(1, Math.round(title.offsetHeight / leading)) : 1));
    const person = shell.querySelector<HTMLElement>(".person-note");
    if (person === null) element.style.removeProperty("max-height");
    else element.style.maxHeight = `${Math.max(NOTE_LEAST, Math.floor(person.getBoundingClientRect().top - head.getBoundingClientRect().bottom - NOTE_GAP))}px`;
    if (person !== watched.current) {
      if (watched.current !== null) watch.current?.unobserve(watched.current);
      watched.current = person;
      if (person !== null) watch.current?.observe(person);
    }
  };
  // After every drawing of the page, and when the title or the note of the person changes its size or the window does.
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const head = note.current?.parentElement?.querySelector(".slip-head") ?? null;
    const shell = note.current?.closest<HTMLElement>(".shell") ?? null;
    const observer = new ResizeObserver(fit);
    watch.current = observer;
    if (head !== null) observer.observe(head);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      watch.current = null;
      watched.current = null;
      window.removeEventListener("resize", fit);
      shell?.style.removeProperty("--slip-lines");
    };
  }, []);
  return note;
}

export interface TaskCardProps {
  slice: SliceFrame;
  scene: Scene | null;
  lang: Lang;
  play: Play;
  /** The verbs the world offers now: `track` is one of them where the core lets the player change what they follow. */
  verbs: ReadonlySet<string>;
  /** Whether the festival night has come and gone (the ending is there). */
  ended?: boolean;
  /** The day of the game, to leave the day out of the time of a window that is today. Null where the frame does not say. */
  today: number | null;
  /** Something else has taken the stage (the ledger or the notebook is open, or the manager is in a talk): the note folds, and the player can open it again. */
  yielded?: boolean;
  /** How the bridge stands (`hud.bridge`), for what its crew still lacks, which the note says where the bridge is the thing. */
  bridge?: BridgeProgress | null;
}

/**
 * The task the player follows, as a slip of red paper that hangs from the roof line with the name of the task in brush on it, and
 * that opens into a small note that says one thing: what to do, where and when, and one phrase underlined in ink that does it. Why it
 * is so and what stands in the way are behind a line of their own, and the other tasks are behind "and more". Where the bridge is the
 * thing (the task is about its crew) the note says how many helpers are still missing and which family has nobody. A player who chose
 * the brief guidance gets the goal, why, what is in the way, and the time and place, and neither the next step nor the phrase
 * (`Guide.brief`): the clan elder gives them when asked.
 *
 * The note is open for each new task, and the player folds it by pressing the slip. It opens again for the next task, and where the
 * help points at something in it. The slip only stresses a task: every act stays where it is.
 */
export function TaskCard({ slice, scene, lang, play, verbs, ended = false, today, yielded = false, bridge = null }: TaskCardProps) {
  const tasks = slice.tasks;
  const task = trackedTask(tasks);
  const brief = play.guide.brief;
  const others = (tasks?.list ?? []).filter((x) => x.id !== task?.id && x.state !== "done" && x.state !== "stale");
  const canTrack = verbs.has("track");
  const place = task?.window == null ? null : placeName(scene, lang, task.window.place);
  const changeLine = changeNote(play.flows.state.change, task?.id ?? null, lang);
  const lack = isCrewTask(task) ? crewShortfall(bridge) : null;
  const rest = task === null && tasks !== null ? restOf(slice.tasks, ended) : null;
  const barState = task === null ? (rest ?? "none") : task.state;
  // The note is open for a task until the player folds it. The key says which task that was.
  const key = task?.id ?? (tasks === null ? "-" : "none");
  const [folded, setFolded] = useState<string | null>(null);
  /** The task whose note the page folded because something else had the stage: it opens again when that is over, unless the player has touched it. */
  const foldedForStage = useRef<string | null>(null);
  const lit = play.guide.signal("task-do") || play.guide.signal("task-more") || play.guide.signal("leads") || play.guide.signal("task-card");
  useEffect(() => {
    if (lit) setFolded(null);
  }, [lit]);
  useEffect(() => {
    if (yielded) {
      if (folded !== key) {
        foldedForStage.current = key;
        setFolded(key);
      }
    } else if (foldedForStage.current !== null) {
      if (foldedForStage.current === key && folded === key) setFolded(null);
      foldedForStage.current = null;
    }
  }, [yielded]);
  const open = folded !== key;
  const done = task?.state === "done";
  const noteRef = useNoteRoom();
  return (
    <div class="slip" data-testid="topbar-task" data-state={barState} data-id={task?.id ?? ""} data-open={open}>
      <section class={`slip-card${signalClass(play, "task-card")}`} data-sig="task-card" data-testid="task-card" data-state={task?.state ?? "none"} data-id={task?.id ?? ""} aria-label={t("task.title")}>
        <button type="button" class="slip-head" data-testid="slip-head" aria-expanded={open} aria-controls="slip-note" onClick={() => {
            foldedForStage.current = null;
            setFolded(open ? key : null);
          }}>
          <span class="slip-title" data-testid="topbar-task-text">
            {tasks === null ? <Dash /> : task === null ? t(REST_WORDS[rest ?? "pick"].bar) : <span data-testid="task-text">{pick(task.text, lang)}</span>}
          </span>
          {done ? <Tick seed={task.id} class="slip-tick" /> : null}
          {task === null ? null : (
            <>
              <span class="sr-only" data-testid="task-state" data-state={task.state}>
                {t(`task.state.${task.state}`)}
              </span>
              {task.job === null ? null : (
                <span class="sr-only" data-testid="task-job" data-job={task.job}>
                  {t(`task.job.${task.job}`)}
                </span>
              )}
            </>
          )}
        </button>
        <div class="slip-note" id="slip-note" ref={noteRef} hidden={!open}>
          {tasks === null ? null : task === null ? (
            <p class="note-line task-empty">
              <span data-testid="task-text">{t(REST_WORDS[rest ?? "pick"].card)}</span>
            </p>
          ) : (
            <>
              {changeLine === null ? null : (
                <p class="note-line task-changed" data-testid="task-changed" data-cause={play.flows.state.change?.cause ?? ""}>
                  {changeLine}
                </p>
              )}
              {task.next === null || brief ? null : (
                <p class="note-line note-next" data-testid="task-next">
                  {pick(task.next, lang)}
                </p>
              )}
              {task.window === null ? null : (
                <p class="note-when" data-testid="task-window">
                  {whenWhere(lang, task.window, place, today)}
                </p>
              )}
              {lack === null ? null : (
                <p class="note-short" data-testid="task-short" data-short={lack.short} data-families={lack.families.join(" ")}>
                  {shortfallWords(lang, scene, lack)}
                </p>
              )}
              {task.why === null && !(task.state === "blocked" && task.blocker !== null) && !(task.expected !== null && task.state !== "done" && task.state !== "stale") ? null : (
                <details class="slip-why" data-testid="slip-why" open={play.guide.signal("task-card") && task.state === "blocked" ? true : undefined}>
                  <summary>{t("slip.why")}</summary>
                  {task.why === null ? null : (
                    <p class="note-line" data-testid="task-why">
                      {pick(task.why, lang)}
                    </p>
                  )}
                  {task.state === "blocked" && task.blocker !== null ? (
                    <p class="note-line is-blocked" data-testid="task-blocker">
                      {t("slip.blocked", { text: pick(task.blocker, lang) })}
                    </p>
                  ) : null}
                  {task.expected === null || task.state === "done" || task.state === "stale" ? null : (
                    <div class="note-expected" data-testid="task-expected">
                      <p class="note-lead">{t("slip.there")}</p>
                      <ExpectedList expected={task.expected} scene={scene} lang={lang} />
                    </div>
                  )}
                </details>
              )}
              {task.action === null || brief ? null : (
                <p class="note-do">
                  <button type="button" class={`act${signalClass(play, "task-do")}`} data-sig="task-do" data-testid="task-do" data-verb={task.action.verb} onClick={() => play.flows.run(task)}>
                    {actionLabel(task, scene, lang)}
                    <Underline seed={task.id} />
                  </button>
                </p>
              )}
            </>
          )}
          <Leads play={play} scene={scene} lang={lang} />
          {others.length === 0 ? null : (
            <details class={`task-more${signalClass(play, "task-more")}`} data-sig="task-more" data-testid="task-more">
              <summary>{t("slip.more", { n: count(lang, others.length) })}</summary>
              <ul class="task-others">
                {others.map((other) => (
                  <OtherTask key={other.id} task={other} canTrack={canTrack} play={play} lang={lang} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}

/** The state of a promise, as the ledger marks it: the seal 送到 on one that came, a stroke through one that did not, nothing on one that is still to come. The word is there for a reader that cannot see the mark. */
export function CommitmentState({ state }: { state: Commitment["state"] }) {
  return (
    <span class={`commit-state is-${state}`} data-testid="commitment-state" data-state={state}>
      {state === "delivered" ? <Stamp word="delivered" shape="wide" /> : null}
      <span class={state === "delivered" || state === "promised" ? "sr-only" : "commit-word"}>{t(`commit.state.${state}`)}</span>
    </span>
  );
}

/** Why a promise was not kept or was taken back, in the core's words. Nothing for a promise that has no reason. */
export function CommitmentReason({ commitment, lang }: { commitment: Commitment; lang: Lang }) {
  const why = commitment.reason === null ? "" : pick(commitment.reason, lang);
  if (why === "") return null;
  return (
    <span class="commit-reason" data-testid="commitment-reason">
      {why}
    </span>
  );
}

/** What a person promised, as one sentence: "李大答应明早7点前把4根竹料送到石桥". */
export function promiseText(c: Commitment, scene: Scene | null, lang: Lang, today: number | null): string {
  const who = personName(scene, lang, c.by);
  const said = agreedText(lang, c, today);
  return lang === "zh" ? `${who}${said}` : `${who} ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
}

export interface CommitmentsProps {
  slice: SliceFrame;
  scene: Scene | null;
  lang: Lang;
  play: Play;
  /** The day of the game, to say "tomorrow morning" and not "Day 2 07:00". Null where the frame does not say. */
  today: number | null;
}

/** The newest promises that stand on the page of the ledger: the older ones are folded under a line of their own, so that no line of the page is cut off at its foot. */
export const COMMITS_SHOWN = 4;

/** What somebody promised the manager, a line each in the ledger: who, what, by when, the seal if it came, and why not if it did not. */
export function Commitments({ slice, scene, lang, play, today }: CommitmentsProps) {
  const list = slice.commitments;
  if (list === null || list.length === 0) return null;
  const older = list.slice(0, Math.max(0, list.length - COMMITS_SHOWN));
  const row = (c: Commitment) => (
    <li key={c.id} class="commit" data-testid="commitment" data-id={c.id} data-by={c.by} data-state={c.state}>
      <span class="commit-what">
        {promiseText(c, scene, lang, today)}
        {c.state === "broken" || c.state === "withdrawn" ? <Brush mark={STRIKE_LINES[0]} width="100%" height={9} stretch class="commit-strike" /> : null}
      </span>
      <CommitmentReason commitment={c} lang={lang} />
      <CommitmentState state={c.state} />
    </li>
  );
  return (
    <section class={`commits${signalClass(play, "commitments")}`} data-sig="commitments" data-testid="commitments" aria-label={t("commit.title")}>
      {older.length === 0 ? null : (
        <details class="commits-older" data-testid="commitments-older">
          <summary>{t("commit.older", { n: count(lang, older.length) })}</summary>
          <ul class="commit-list">{older.map(row)}</ul>
        </details>
      )}
      <ul class="commit-list">{list.slice(older.length).map(row)}</ul>
    </section>
  );
}
