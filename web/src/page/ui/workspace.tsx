import { useEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import type { MarkId, NoteSource, NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { type Judgment, RELATIONS, type SliceFrame } from "../slice.ts";
import { Cost } from "./common.tsx";
import { bare, ordinal } from "./format.ts";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { count } from "./paper-text.ts";
import { signalClass } from "./guide.tsx";
import { StatementCardView } from "./statement.tsx";
import { pick as markPick, RULES, VERTICAL_RULES } from "./marks.ts";
import { Brush, CloseCorner, Circle, InkAct } from "./ink.tsx";
import { chosenCount, PART_TOTAL } from "./statement-text.ts";

/** The four marks of the notebook: what the manager has found out about a line, written after its source in a heavier hand. The hover says what it means. */
export function Seal({ mark, lang }: { mark: MarkId; lang: Lang }) {
  const label = t(`mark.${mark}`);
  return (
    <span class={`seal seal-${mark}`} title={t(`mark.${mark}.hint`)} data-testid={`seal-${mark}`} lang={lang === "zh" ? "zh-CN" : "en"}>
      {label}
    </span>
  );
}

/** Where a line came from, in a few words: seen first hand, heard from someone and at which hand, or not known. */
function Badge({ source, lang }: { source: NoteSource; lang: Lang }) {
  if (source.kind === "seen") {
    return (
      <span class="note-from from-seen" data-testid="source-badge" data-source="seen">
        {t("source.seen")}
      </span>
    );
  }
  if (source.kind === "heard") {
    return (
      <span class="note-from from-heard" data-testid="source-badge" data-source="heard" data-hand={source.hand}>
        {t("source.heard", { who: pick(source.who, lang), hand: ordinal(lang, source.hand) })}
      </span>
    );
  }
  return (
    <span class="note-from from-unknown" data-testid="source-badge" data-source="unknown">
      {t("source.unknown")}
    </span>
  );
}

interface NoteProps {
  entry: NotebookEntry;
  lang: Lang;
  fresh: boolean;
  play: Play;
  talking: boolean;
  /** 1 for the first line of the pair, 2 for the second, 0 for neither. */
  slot: 0 | 1 | 2;
  hinted: boolean;
  /** Whether there are two lines to put side by side. */
  canPair: boolean;
  /** Whether a line of the statement card sent the player to this one. */
  pointed: boolean;
}

/** One line of the notebook: the words as they were said on the left, where they came from on the right. */
function Note({ entry, lang, fresh, play, talking, slot, hinted, canPair, pointed }: NoteProps) {
  const article = useRef<HTMLElement>(null);
  // A new entry is brought into view when the sheet shows it.
  useEffect(() => {
    if (fresh) article.current?.scrollIntoView?.({ block: "nearest" });
  }, [fresh]);
  // So is the line that the statement card named.
  useEffect(() => {
    if (pointed) article.current?.scrollIntoView?.({ block: "center" });
  }, [pointed]);
  const heard = entry.source.kind === "heard" || entry.chain.length > 0;
  return (
    <article ref={article} class={`note${fresh ? " is-fresh" : ""}${pointed ? " is-pointed" : ""}${hinted ? " is-hinted" : ""}${slot > 0 ? " is-picked" : ""}`} data-testid="note" data-id={entry.id} data-marks={entry.marks.join(" ")} data-fresh={fresh} data-pointed={pointed} data-slot={slot} data-hinted={hinted}>
      <div class="note-cols">
        <div class="note-words" data-testid="note-words">
          <span class="col-label">{t("notebook.words")}</span>
          <p class="note-text">
            {fresh ? <span class="note-new" role="img" aria-label={t("notebook.fresh")} /> : null}
            {pick(entry.text, lang)}
          </p>
        </div>
        <div class="note-source" data-testid="note-source">
          <span class="col-label">{t("notebook.source")}</span>
          <Badge source={entry.source} lang={lang} />
          {entry.marks.length === 0 ? null : (
            <span class="seals">
              {entry.marks.map((mark) => (
                <Seal key={mark} mark={mark} lang={lang} />
              ))}
            </span>
          )}
          {entry.chain.length === 0 ? null : (
            <details class="chain" data-testid="chain">
              <summary>{t("chain.open")}</summary>
              <ol class="hops" aria-label={t("chain.title")}>
                <li class="hop hop-you">{t("chain.you")}</li>
                {entry.chain.map((hop, i) => (
                  <li key={i} class={hop === null ? "hop hop-unknown" : "hop"}>
                    {hop === null ? "?" : pick(hop, lang)}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </div>
      {canPair ? (
        <div class="note-meta">
          <InkAct seed={`pick-${entry.id}`} class={`note-pick${slot > 0 ? " is-on" : ""}`} data-testid="note-pick" aria-pressed={slot > 0} onClick={() => play.flows.pick(entry.id)}>
            {slot === 1 ? t("pair.first") : slot === 2 ? t("pair.second") : t("pair.compare")}
          </InkAct>
        </div>
      ) : null}
      {talking ? (
        <div class="note-ask">
          <InkAct seed={`ask-${entry.id}`} data-testid="note-ask" disabled={play.owing} onClick={() => play.ask(entry.id, entry.text)}>
            {t("notebook.askAbout")}
          </InkAct>
          {heard ? (
            <InkAct seed={`source-${entry.id}`} data-testid="note-ask-source" disabled={play.owing} onClick={() => play.askSource(entry.id, entry.text)}>
              {t("notebook.askSource")}
            </InkAct>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

const REL_KEY = { unsupported: "rel.unsupported", contradicts: "rel.contradicts", mismatch: "rel.mismatch" } as const;

/** The two lines picked, the relation to choose, and what the core made of it. Shown only where the frame lists `judge`. */
function Pairing({ entries, play, lang, open }: { entries: readonly NotebookEntry[]; play: Play; lang: Lang; open: boolean }) {
  const { pair } = play.flows.state;
  const section = useRef<HTMLElement>(null);
  // The tutorial lights the pair and how they stand: the sheet is scrolled to it. The entries that are new scroll themselves into view as
  // the sheet opens, so this waits for the next frame, which is after they have.
  const lit = open && play.guide.signal("pairing");
  useEffect(() => {
    if (!lit) return;
    const frame = requestAnimationFrame(() => section.current?.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [lit]);
  const find = (id: string | null): NotebookEntry | undefined => (id === null ? undefined : entries.find((e) => e.id === id));
  const a = find(pair.a);
  const b = find(pair.b);
  const ready = a !== undefined && b !== undefined;
  const outcome = pair.outcome;
  return (
    <section ref={section} class={`pairing${signalClass(play, "pairing")}`} data-sig="pairing" data-testid="pairing" data-ready={ready} data-waiting={pair.waiting !== null}>
      <h3 class="pairing-title">{t("pair.title")}</h3>
      {a === undefined && b === undefined ? (
        <p class="pairing-hint" data-testid="pairing-hint">
          {t("pair.hint")}
        </p>
      ) : (
        <ol class="pairing-cards">
          <li data-testid="pair-first" data-id={a?.id ?? ""}>
            <span class="slot">{t("pair.first")}</span>
            <span class="slot-text">{a === undefined ? t("pair.empty") : pick(a.text, lang)}</span>
          </li>
          <li data-testid="pair-second" data-id={b?.id ?? ""}>
            <span class="slot">{t("pair.second")}</span>
            <span class="slot-text">{b === undefined ? t("pair.empty") : pick(b.text, lang)}</span>
          </li>
        </ol>
      )}
      {ready ? (
        <>
          <div class="relations" role="radiogroup" aria-label={t("pair.relation")} data-testid="relations">
            {RELATIONS.map((relation) => (
              <button key={relation} type="button" role="radio" aria-checked={pair.relation === relation} class={`relation${pair.relation === relation ? " is-on" : ""}`} data-testid={`rel-${relation}`} onClick={() => play.flows.setRelation(relation)}>
                <span>{t(REL_KEY[relation])}</span>
                {pair.relation === relation ? <Circle kind="wide" /> : null}
              </button>
            ))}
          </div>
          <div class="pairing-buttons">
            <button type="button" class={`ink-frame${signalClass(play, "pair-judge")}`} data-sig="pair-judge" data-testid="pair-judge" disabled={pair.relation === null || pair.waiting !== null} onClick={() => play.flows.judge()}>
              {t("pair.judge")}
            </button>
            <InkAct seed="pair-hold" data-testid="pair-hold" onClick={() => play.flows.clear()}>
              {t("pair.hold")}
            </InkAct>
          </div>
        </>
      ) : null}
      {outcome === null || outcome.a !== pair.a || outcome.b !== pair.b ? null : (
        <p class={`pairing-outcome ${outcome.ok ? "is-ok" : "is-no"}`} data-testid="pair-outcome" data-ok={outcome.ok} data-reason={outcome.reason ?? ""} role="status">
          {outcome.ok ? t("pair.ok") : t(refusalKey("judge", outcome.reason ?? "unknown"), { reason: outcome.reason ?? "" })}
        </p>
      )}
    </section>
  );
}

/** What the player judged right, each with a button to use it when speaking in public. */
function Judgments({ slice, entries, play, lang, canSpeak, talking, speakCost }: { slice: SliceFrame; entries: readonly NotebookEntry[]; play: Play; lang: Lang; canSpeak: boolean; talking: boolean; speakCost: number | null }) {
  const list = slice.judgments;
  if (list === null || list.length === 0) return null;
  const text = (id: string): string => {
    const found = entries.find((e) => e.id === id);
    return found === undefined ? id : pick(found.text, lang);
  };
  const said = play.flows.state.clarify;
  return (
    <section class="judgments" data-testid="judgments">
      <h3 class="pairing-title">{t("judged.title")}</h3>
      <ul>
        {list.map((j: Judgment) => {
          // What came of the last time this pair was said in public.
          const here = said !== null && said.claim === j.b && said.basis.length === 1 && said.basis[0] === j.a ? said : null;
          const waiting = here !== null && here.waiting !== null;
          return (
            <li key={`${j.a}>${j.b}>${j.relation}`} data-testid="judgment" data-a={j.a} data-b={j.b} data-relation={j.relation}>
              <span class="judgment-relation">{t(REL_KEY[j.relation])}</span>
              <span class="judgment-pair">{t("judged.pair", { a: bare(text(j.a)), b: bare(text(j.b)) })}</span>
              <InkAct seed={`${j.a}-${j.b}`} data-testid="judgment-clarify" disabled={!canSpeak || waiting || play.owing} title={canSpeak ? undefined : t(talking ? "ack.talking" : "clarify.where")} onClick={() => play.flows.clarify(j.b, [j.a], j.relation)}>
                <span>{t("clarify.use")}</span>
                <Cost minutes={speakCost} id="clarify" />
              </InkAct>
              {canSpeak ? null : (
                <span class="judgment-where" data-testid="judgment-where">
                  {t(talking ? "ack.talking" : "clarify.where")}
                </span>
              )}
              {here === null || here.ok !== false ? null : (
                <span class="judgment-no" data-testid="clarify-no" data-reason={here.reason ?? ""} role="status">
                  {t(refusalKey("speak", here.reason ?? "unknown"), { reason: here.reason ?? "" })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The sentence under "Help me look": which two lines are worth comparing, and later how they stand. */
function HintLine({ slice, entries, lang, play }: { slice: SliceFrame; entries: readonly NotebookEntry[]; lang: Lang; play: Play }) {
  const hint = slice.hint;
  if (hint === null) {
    // The core was asked, and had no pair to light.
    return play.flows.state.hintNone ? (
      <p class="hint-line" data-testid="hint-line" data-empty="true">
        {t("hint.none")}
      </p>
    ) : null;
  }
  const text = (id: string): string => {
    const found = entries.find((e) => e.id === id);
    return found === undefined ? id : pick(found.text, lang);
  };
  const { pair } = play.flows.state;
  const set = pair.a === hint.a && pair.b === hint.b;
  return (
    <p class="hint-line" data-testid="hint-line" data-a={hint.a} data-b={hint.b}>
      {t("hint.pair", { a: text(hint.a), b: text(hint.b) })}
      {hint.relation === null ? null : <strong data-testid="hint-relation"> {t(REL_KEY[hint.relation])}</strong>}{" "}
      {set ? null : (
        <InkAct seed="hint-use" data-testid="hint-use" onClick={() => play.flows.useHint()}>
          {t("hint.use")}
        </InkAct>
      )}
    </p>
  );
}

/** The two pages of the notebook: the notes with the pairing, and the statement card. */
export type WorkspacePart = "notes" | "statement";

export interface WorkspaceProps {
  open: boolean;
  /** Which page is turned to. The statement card is shown only where the frame has one. */
  part?: WorkspacePart;
  /** Turns the page, from the tabs of the sheet. */
  onPart: (part: WorkspacePart) => void;
  scene?: Scene | null;
  entries: readonly NotebookEntry[];
  sample: boolean;
  lang: Lang;
  /** The ids of the entries that were written since the player last looked. */
  fresh: readonly string[];
  play: Play;
  slice: SliceFrame;
  /** The verbs the world offers now: speaking in public is one of them where a clarification can be made. */
  verbs: ReadonlySet<string>;
  /** Whether the player is in a talk, when each entry can be asked about. */
  talking: boolean;
  /** The game minutes of speaking in public (`player.costs.speak`), written on the button that clarifies. */
  speakCost: number | null;
  onClose: () => void;
}

/**
 * The notebook as a workspace on a sheet of paper: each line with its words and its source side by side, two
 * lines to pair and a relation to judge, a way to ask for help, and what was judged right, to use in public.
 */
export function NotebookWorkspace({ open, part = "notes", onPart, scene = null, entries, sample, lang, fresh, play, slice, verbs, talking, speakCost, onClose }: WorkspaceProps) {
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    // A closed sheet takes no focus and is not read out.
    if (sheet.current !== null) sheet.current.inert = !open;
  }, [open]);
  const { pair } = play.flows.state;
  const hint = slice.hint;
  const canJudge = verbs.has("judge");
  const canHint = verbs.has("hint");
  const canSpeak = verbs.has("speak") || verbs.has("speak_publicly");
  const card = slice.statement;
  const showing: WorkspacePart = part === "statement" && card !== null ? "statement" : "notes";
  const pointed = play.flows.state.pointed;
  // The book is open at both pages when there is a card to put on the right one.
  const spread = card !== null;
  const notesLeaf = spread || showing === "notes";
  const cardLeaf = card !== null && (spread || showing === "statement");
  // Where a page of the book runs past its foot, a phrase there turns it.
  const notesTurn = useMoreBelow<HTMLElement>(`${showing}-${spread}`);
  const cardTurn = useMoreBelow<HTMLElement>(`${showing}-${spread}-${card !== null}`);
  const notes = (
    <section ref={notesTurn.leaf} class="leaf leaf-notes" data-testid="notes-leaf" aria-label={t("notebook.title")}>
      {showing === "statement" && !spread ? null : (
        <p class="leaf-count" data-testid="notebook-entries">
          {t(entries.length === 1 ? "notebook.count.one" : "notebook.count", { n: count(lang, entries.length) })}
        </p>
      )}
      {sample ? (
        <p class="paper-sample" data-testid="notebook-sample">
          {t("notebook.sample")}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p class="paper-empty" data-testid="notebook-empty">
          {t("notebook.empty")}
        </p>
      ) : (
        <div class="notes">
          {canJudge || canHint || (slice.judgments?.length ?? 0) > 0 ? (
            <div class="workspace-bar">
              {canJudge ? <Pairing entries={entries} play={play} lang={lang} open={open} /> : null}
              {canHint ? (
                <div class="hint-bar">
                  <InkAct seed="hint-ask" data-testid="notebook-hint" disabled={play.flows.state.hintWaiting !== null} onClick={() => play.flows.hint()}>
                    {hint !== null && hint.relation === null ? t("hint.again") : t("hint.ask")}
                  </InkAct>
                  <HintLine slice={slice} entries={entries} lang={lang} play={play} />
                </div>
              ) : null}
              <Judgments slice={slice} entries={entries} play={play} lang={lang} canSpeak={canSpeak} talking={talking} speakCost={speakCost} />
            </div>
          ) : null}
          {entries.map((entry) => (
            <Note key={entry.id} entry={entry} lang={lang} fresh={fresh.includes(entry.id)} play={play} talking={talking} slot={pair.a === entry.id ? 1 : pair.b === entry.id ? 2 : 0} hinted={hint !== null && (hint.a === entry.id || hint.b === entry.id)} canPair={canJudge && entries.length > 1} pointed={pointed === entry.id} />
          ))}
        </div>
      )}
      {notesTurn.more ? <TurnBar leaf={notesTurn.leaf} word={t("notebook.turn")} testId="notes-turn" /> : null}
    </section>
  );
  return (
    <aside class="notebook" id="notebook" ref={sheet} data-testid="notebook" data-open={open} data-part={showing} data-spread={spread} aria-hidden={!open} aria-label={t("notebook.title")}>
      <div class="book paper-page">
        <CloseCorner label={t("notebook.close")} testid="notebook-close" onClose={onClose} />
        {spread ? (
          <header class="book-head">
            <div class="workspace-tabs" role="tablist" aria-label={t("workspace.tabs")} data-testid="workspace-tabs">
              <button type="button" role="tab" class={`workspace-tab${showing === "notes" ? " is-on" : ""}`} aria-selected={showing === "notes"} data-testid="workspace-tab-notes" onClick={() => onPart("notes")}>
                <span class="paper-title">{t("workspace.notes")}</span>
                <span class="count">{entries.length}</span>
              </button>
              <button type="button" role="tab" class={`workspace-tab${showing === "statement" ? " is-on" : ""}`} aria-selected={showing === "statement"} data-testid="workspace-tab-statement" onClick={() => onPart("statement")}>
                <span class="paper-title">{t("workspace.statement")}</span>
                <span class="count" data-testid="workspace-statement-count">
                  {chosenCount(card)}/{PART_TOTAL}
                </span>
              </button>
            </div>
          </header>
        ) : (
          <header class="book-head">
            <h2 class="paper-title">{t(showing === "statement" ? "statement.title" : "notebook.title")}</h2>
          </header>
        )}
        <div class="leaves">
          {notesLeaf ? notes : null}
          {cardLeaf && card !== null ? (
            <section ref={cardTurn.leaf} class="leaf leaf-statement" role="tabpanel" data-testid="workspace-statement">
              <StatementCardView card={card} entries={entries} scene={scene} lang={lang} play={play} speakCost={speakCost} />
              {cardTurn.more ? <TurnBar leaf={cardTurn.leaf} word={t("notebook.turn")} testId="statement-turn" /> : null}
            </section>
          ) : null}
        </div>
        {spread ? (
          <span class="thread" aria-hidden="true">
            <Brush mark={VERTICAL_RULES[0]} stretch class="thread-rule thread-rule-a" />
            <Brush mark={VERTICAL_RULES[1] ?? VERTICAL_RULES[0]} stretch class="thread-rule thread-rule-b" />
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Brush key={n} mark={markPick(RULES, n)} stretch class={`stitch stitch-${n}`} />
            ))}
          </span>
        ) : null}
      </div>
    </aside>
  );
}
