import { type Lang, type MessageKey, pick, t } from "../../i18n/index.ts";
import type { AskKind, Topic } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { count } from "./paper-text.ts";
import { sourceBadge } from "./picker.tsx";
import { Underline } from "./ink.tsx";

/** The order of the rows: people first, because a rumour is followed by asking about a person, then the notebook, things and places. */
const ORDER: readonly AskKind[] = ["person", "entry", "thing", "place"];

const TITLE: Readonly<Record<AskKind, MessageKey>> = {
  person: "chips.people",
  entry: "chips.notes",
  thing: "chips.things",
  place: "chips.places",
};

/** How many tags of a kind are shown at once. The rest are behind a line that says how many, so that the acts under the tags stay in reach. */
export const CHIPS_SHOWN = 8;

/** The least height, in pixels, at which the list of tags has a phrase that turns it: under it the list is a few lines that the request below it has left, and the phrase would cover them. */
const CHIPS_ROOM = 160;

export interface TopicChipsProps {
  /** What the player can ask about: `player.topics` of the frame. */
  topics: readonly Topic[];
  entries: readonly NotebookEntry[];
  lang: Lang;
  /** The person of the talk, who is not a topic of their own talk. */
  partner: string;
  /** What one question costs in game minutes, where the frame says. */
  cost: number | null;
  /** Said under the cost when a question would run to the hour the person has to go. */
  willGo?: string | null;
  /** The questions wait while an act is being paid for. */
  disabled?: boolean;
  /** Lit while a task's button has asked for a question and the chips are where the answer begins. */
  flash: boolean;
  /** Whether a signal of the hints is on the chips. */
  signal: boolean;
  onAsk(topic: Topic): void;
}

/**
 * What the person may know, as a row of small tags with a line that says what a tag does. A tag asks at once.
 */
export function TopicChips({ topics, entries, lang, partner, cost, willGo = null, disabled = false, flash, signal, onAsk }: TopicChipsProps) {
  const { leaf, more } = useMoreBelow<HTMLElement>(partner, CHIPS_ROOM);
  const written = new Map(entries.map((entry) => [entry.id, entry]));
  const groups = ORDER.map((kind) => ({ kind, list: topics.filter((topic) => topic.kind === kind && !(kind === "person" && topic.id === partner)) })).filter((group) => group.list.length > 0);
  const chip = (topic: Topic, kind: AskKind) => {
    const entry = kind === "entry" ? written.get(topic.id) : undefined;
    const source = entry === undefined ? undefined : sourceBadge(entry, lang);
    return (
      <li key={topic.id}>
        <button type="button" class="topic-chip ink-act" data-testid="topic-chip" data-id={topic.id} data-kind={topic.kind} title={pick(topic.name, lang)} disabled={disabled} onClick={() => onAsk(topic)}>
          <span class="topic-chip-label">{pick(topic.name, lang)}</span>
          {source === undefined ? null : <span class="topic-chip-note">{source}</span>}
          <Underline seed={topic.id} />
        </button>
      </li>
    );
  };
  return (
    <section ref={leaf} class={`chips paper-slip${flash ? " is-flash" : ""}${signal ? " is-signal" : ""}`} data-testid="topic-chips" data-signal={signal} aria-label={t("chips.title")}>
      <h4 class="chips-title">{t("chips.title")}</h4>
      <p class="chips-note" data-testid="chips-note">
        {cost === null ? t("chips.note") : t("chips.note.cost", { n: count(lang, cost) })}
      </p>
      {willGo == null ? null : (
        <p class="chips-late" data-testid="chips-late">
          {willGo}
        </p>
      )}
      {groups.length === 0 ? (
        <p class="chips-empty" data-testid="chips-empty">
          {t("chips.empty")}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} class="chip-group" data-kind={group.kind}>
            <span class="chip-group-label">{t(TITLE[group.kind])}</span>
            <ul class="chip-row">{group.list.slice(0, CHIPS_SHOWN).map((topic) => chip(topic, group.kind))}</ul>
            {group.list.length <= CHIPS_SHOWN ? null : (
              <details class="chip-more" data-testid="chips-more" data-kind={group.kind}>
                <summary>{t("chips.more", { n: count(lang, group.list.length - CHIPS_SHOWN) })}</summary>
                <ul class="chip-row">{group.list.slice(CHIPS_SHOWN).map((topic) => chip(topic, group.kind))}</ul>
              </details>
            )}
          </div>
        ))
      )}
      {more ? <TurnBar leaf={leaf} word={t("chips.turn")} testId="chips-turn" /> : null}
    </section>
  );
}
