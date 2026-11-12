import { useEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import type { MarkId, NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import type { Relation } from "../relations.ts";
import type { Scene } from "../scene.ts";
import type { Judgment, SliceFrame } from "../slice.ts";
import { bare } from "./format.ts";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { count } from "./paper-text.ts";
import { PeopleBook } from "./people-book.tsx";
import { stampWords } from "./people-text.ts";
import { sourceWords } from "./source-text.ts";
import { StatementCardView } from "./statement.tsx";
import { pick as markPick, RULES, VERTICAL_RULES } from "./marks.ts";
import { Brush, CloseCorner, InkAct } from "./ink.tsx";
import { PairButton, Pairing } from "./pairing.tsx";
import { ANSWER_KEY } from "./pairing-text.ts";
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

/** Where a line came from, in a few words: seen with one's own eyes, or who told it and what they said of how they know it. The hover has when and where it was learned. */
function Badge({ entry, scene, lang }: { entry: NotebookEntry; scene: Scene | null; lang: Lang }) {
  const source = entry.source;
  const when = entry.at === null ? undefined : stampWords(scene, lang, entry.at);
  if (source.kind === "seen") {
    return (
      <span class="note-from from-seen" data-testid="source-badge" data-source="seen" title={when}>
        {sourceWords(source, lang)}
      </span>
    );
  }
  if (source.kind === "heard") {
    return (
      <span class="note-from from-heard" data-testid="source-badge" data-source="heard" data-how={source.how} title={when}>
        {sourceWords(source, lang)}
      </span>
    );
  }
  return (
    <span class="note-from from-unknown" data-testid="source-badge" data-source="unknown">
      {sourceWords(source, lang)}
    </span>
  );
}

interface NoteProps {
  entry: NotebookEntry;
  scene: Scene | null;
  lang: Lang;
  fresh: boolean;
  play: Play;
  talking: boolean;
  /** 1 for the line shown against the claim, 2 for the claim, 0 for neither. */
  slot: 0 | 1 | 2;
  hinted: boolean;
  /** Whether there are two lines to put side by side. */
  canPair: boolean;
  /** Whether a line of the statement card sent the player to this one. */
  pointed: boolean;
}

/** One line of the notebook: the words as they were said on the left, where they came from on the right. */
function Note({ entry, scene, lang, fresh, play, talking, slot, hinted, canPair, pointed }: NoteProps) {
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
      <div class={canPair ? "note-cols is-pairable" : "note-cols"}>
        <div class="note-words" data-testid="note-words">
          <span class="col-label">{t("notebook.words")}</span>
          <p class="note-text">
            {fresh ? <span class="note-new" role="img" aria-label={t("notebook.fresh")} /> : null}
            {pick(entry.text, lang)}
          </p>
        </div>
        <div class="note-source" data-testid="note-source">
          <span class="col-label">{t("notebook.source")}</span>
          <Badge entry={entry} scene={scene} lang={lang} />
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
        {canPair ? (
          <div class="note-meta">
            <PairButton entry={entry} play={play} />
          </div>
        ) : null}
      </div>
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

/** What the player judged right, each with a button to use it when speaking in public. */
function Judgments({ slice, entries, play, lang, canSpeak, talking }: { slice: SliceFrame; entries: readonly NotebookEntry[]; play: Play; lang: Lang; canSpeak: boolean; talking: boolean }) {
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
              <span class="judgment-relation">{t(ANSWER_KEY[j.relation])}</span>
              <span class="judgment-pair">{t("judged.pair", { a: bare(text(j.a)), b: bare(text(j.b)) })}</span>
              <InkAct seed={`${j.a}-${j.b}`} data-testid="judgment-clarify" disabled={!canSpeak || waiting || play.owing} title={canSpeak ? undefined : t(talking ? "ack.talking" : "clarify.where")} onClick={() => play.flows.clarify(j.b, [j.a], j.relation)}>
                <span>{t("clarify.use")}</span>
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
      {t("hint.pair", { a: bare(text(hint.a)), b: bare(text(hint.b)) })}
      {hint.relation === null ? null : <strong data-testid="hint-relation"> {t(ANSWER_KEY[hint.relation])}</strong>}{" "}
      {set ? null : (
        <InkAct seed="hint-use" data-testid="hint-use" onClick={() => play.flows.useHint()}>
          {t("hint.use")}
        </InkAct>
      )}
    </p>
  );
}

/** The pages of the notebook: the notes with the pairing, the statement card, and the book of the people. */
export type WorkspacePart = "notes" | "statement" | "people";

export interface WorkspaceProps {
  open: boolean;
  /** Which page is turned to. The statement card is shown only where the frame has one. */
  part?: WorkspacePart;
  /** The people of the frame, for the book of the people. */
  people?: readonly Relation[] | null;
  /** Whether the page has the sprites to cut the portraits of the people from. */
  sprites?: boolean;
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
  onClose: () => void;
}

/**
 * The notebook as a workspace on a sheet of paper: each line with its words and its source side by side, two
 * lines to pair and a relation to judge, a way to ask for help, and what was judged right, to use in public.
 */
export function NotebookWorkspace({ open, part = "notes", people = null, sprites = false, onPart, scene = null, entries, sample, lang, fresh, play, slice, verbs, talking, onClose }: WorkspaceProps) {
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
  const showing: WorkspacePart = part === "people" ? "people" : part === "statement" && card !== null ? "statement" : "notes";
  const pointed = play.flows.state.pointed;
  // The book is open at both pages when there is a card to put on the right one, and at the people alone when they are turned to.
  const spread = card !== null && showing !== "people";
  const notesLeaf = showing !== "people" && (spread || showing === "notes");
  const cardLeaf = showing !== "people" && card !== null && (spread || showing === "statement");
  const peopleLeaf = showing === "people";
  const peopleKnown = (people ?? []).filter((row) => row.known).length;
  // Where a page of the book runs past its foot, a phrase there turns it.
  const notesTurn = useMoreBelow<HTMLElement>(`${showing}-${spread}`);
  const cardTurn = useMoreBelow<HTMLElement>(`${showing}-${spread}-${card !== null}`);
  const peopleTurn = useMoreBelow<HTMLElement>(`${showing}-${peopleKnown}`);
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
              <Judgments slice={slice} entries={entries} play={play} lang={lang} canSpeak={canSpeak} talking={talking} />
            </div>
          ) : null}
          {entries.map((entry) => (
            <Note key={entry.id} entry={entry} scene={scene} lang={lang} fresh={fresh.includes(entry.id)} play={play} talking={talking} slot={pair.a === entry.id ? 1 : pair.b === entry.id ? 2 : 0} hinted={hint !== null && (hint.a === entry.id || hint.b === entry.id)} canPair={canJudge && entries.length > 1} pointed={pointed === entry.id} />
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
        <header class="book-head">
          <div class="workspace-tabs" role="tablist" aria-label={t("workspace.tabs")} data-testid="workspace-tabs" data-tabs={card !== null ? 2 : 1}>
            <button type="button" role="tab" class={`workspace-tab${showing === "notes" ? " is-on" : ""}`} aria-selected={showing === "notes"} data-testid="workspace-tab-notes" onClick={() => onPart("notes")}>
              <span class="paper-title">{t("workspace.notes")}</span>
              <span class="count">{entries.length}</span>
            </button>
            {card !== null ? (
              <button type="button" role="tab" class={`workspace-tab${showing === "statement" ? " is-on" : ""}`} aria-selected={showing === "statement"} data-testid="workspace-tab-statement" onClick={() => onPart("statement")}>
                <span class="paper-title">{t("workspace.statement")}</span>
                <span class="count" data-testid="workspace-statement-count">
                  {chosenCount(card)}/{PART_TOTAL}
                </span>
              </button>
            ) : null}
            {/* The tab of the people stands at the right of the head of the book, out of the columns of the other two (people.css). */}
            <button type="button" role="tab" class={`workspace-tab workspace-tab-people${peopleLeaf ? " is-on" : ""}`} aria-selected={peopleLeaf} data-testid="workspace-tab-people" onClick={() => onPart("people")}>
              <span class="paper-title">{t("people.tab")}</span>
              <span class="count" data-testid="workspace-people-count">
                {peopleKnown}
              </span>
            </button>
          </div>
        </header>
        <div class="leaves">
          {notesLeaf ? notes : null}
          {peopleLeaf ? (
            <section ref={peopleTurn.leaf} class="leaf leaf-people" role="tabpanel" data-testid="people-leaf" aria-label={t("people.title")}>
              <PeopleBook rows={people} play={play} scene={scene} entries={entries} lang={lang} sprites={sprites} />
              {peopleTurn.more ? <TurnBar leaf={peopleTurn.leaf} word={t("notebook.turn")} testId="people-turn" /> : null}
            </section>
          ) : null}
          {cardLeaf && card !== null ? (
            <section ref={cardTurn.leaf} class="leaf leaf-statement" role="tabpanel" data-testid="workspace-statement">
              <StatementCardView card={card} entries={entries} scene={scene} lang={lang} play={play} />
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
