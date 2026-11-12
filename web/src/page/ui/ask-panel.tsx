import { useState } from "preact/hooks";
import { type Lang, type MessageKey, pick, t } from "../../i18n/index.ts";
import type { AskKind, Topic } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import { rankTopics, TOP_TOPICS, type TopicContext } from "../talk-frame.ts";
import { bare } from "./format.ts";
import { CloseCorner, Underline } from "./ink.tsx";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { useDismiss } from "./picker.tsx";
import { sourceWords } from "./source-text.ts";

/** The titles of the groups of "others": what the manager has written down comes first. */
const ORDER: readonly AskKind[] = ["entry", "thing", "place", "person", "taste"];
const TITLE: Readonly<Record<AskKind, MessageKey>> = {
  entry: "ask.group.notes",
  thing: "ask.group.things",
  place: "ask.group.places",
  person: "ask.group.people",
  taste: "ask.group.taste",
};

/** The least height, in pixels, at which the list has a phrase that turns it. In a small window the strip of the talk leaves a list about this much. */
const ROOM = 60;
/** The least height at which it has the phrase while a request is open under it: the list is then a few lines that the request has left, and the phrase would cover them. */
const ROOM_UNDER_REQUEST = 160;

export interface AskPanelProps {
  /** What the player can ask about: `player.topics` of the frame. */
  topics: readonly Topic[];
  /** What the order of the list is made from (`rankTopics`). */
  context: TopicContext;
  lang: Lang;
  /** The person of the talk. */
  partner: string;
  /** The lines of the notebook whose trail ends at this person: asking them who told them is the next step. */
  followUps: readonly NotebookEntry[];
  /** The questions wait while an act is being paid for. */
  disabled: boolean;
  /** Said when a question would run to the hour the person has to go. */
  willGo: string | null;
  /** Lit for a moment when a task's button has asked for a question. */
  flash: boolean;
  /** Whether a signal of the hints is on the list. */
  signal: boolean;
  /** Whether a request is open under the list. */
  underRequest: boolean;
  onAsk(topic: Topic): void;
  onFollow(entry: NotebookEntry): void;
  onClose(): void;
}

/**
 * What to ask a person: the three topics that matter most now, and "others" for the rest. A tag asks at once. A line of the notebook whose trail
 * ends at this person has a tag of its own at the head: asking who told them.
 */
export function AskPanel({ topics, context, lang, partner, followUps, disabled, willGo, flash, signal, underRequest, onAsk, onFollow, onClose }: AskPanelProps) {
  const [all, setAll] = useState(false);
  const { leaf, more } = useMoreBelow<HTMLElement>(`${partner}-${all}-${underRequest}`, underRequest ? ROOM_UNDER_REQUEST : ROOM);
  useDismiss(leaf, onClose);
  const ranked = rankTopics(topics, context);
  const top = ranked.slice(0, TOP_TOPICS);
  const rest = ranked.slice(TOP_TOPICS);
  const written = new Map(context.entries.map((entry) => [entry.id, entry]));
  const chip = (topic: Topic) => {
    const entry = topic.kind === "entry" ? written.get(topic.id) : undefined;
    const source = entry === undefined ? null : sourceWords(entry.source, lang);
    return (
      <li key={topic.id}>
        <button type="button" class="topic-chip ink-act" data-testid="topic-chip" data-id={topic.id} data-kind={topic.kind} title={pick(topic.name, lang)} disabled={disabled} onClick={() => onAsk(topic)}>
          <span class="topic-chip-label">{pick(topic.name, lang)}</span>
          {source === null ? null : <span class="topic-chip-note">{source}</span>}
          <Underline seed={topic.id} />
        </button>
      </li>
    );
  };
  return (
    <section ref={leaf} class={`chips ask-panel paper-slip${flash ? " is-flash" : ""}${signal ? " is-signal" : ""}`} data-testid="topic-chips" data-signal={signal} data-all={all} aria-label={t("ask.title")}>
      <CloseCorner label={t("picker.close")} testid="ask-close" onClose={onClose} />
      <h4 class="chips-title">{t("ask.title")}</h4>
      {willGo === null ? null : (
        <p class="chips-late" data-testid="chips-late">
          {willGo}
        </p>
      )}
      {followUps.length === 0 ? null : (
        <div class="chip-group" data-kind="follow" data-testid="ask-follow-group">
          <span class="chip-group-label">{t("ask.follow")}</span>
          <ul class="chip-row">
            {followUps.map((entry) => (
              <li key={entry.id}>
                <button type="button" class="topic-chip ink-act" data-testid="ask-follow" data-id={entry.id} disabled={disabled} onClick={() => onFollow(entry)}>
                  <span class="topic-chip-label">{t("ask.follow.item", { text: bare(pick(entry.text, lang)) })}</span>
                  <Underline seed={`follow-${entry.id}`} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {top.length === 0 ? (
        <p class="chips-empty" data-testid="chips-empty">
          {t("ask.empty")}
        </p>
      ) : (
        <ul class="chip-row ask-top" data-testid="ask-top">
          {top.map(chip)}
        </ul>
      )}
      {rest.length === 0 ? null : (
        <button type="button" class="ink-act ask-more" data-testid="ask-more" aria-expanded={all} onClick={() => setAll((now) => !now)}>
          {all ? t("ask.less") : t("ask.more")}
          <Underline seed="ask-more" />
        </button>
      )}
      {!all
        ? null
        : ORDER.map((kind) => ({ kind, list: rest.filter((topic) => topic.kind === kind) }))
            .filter((group) => group.list.length > 0)
            .map((group) => (
              <div key={group.kind} class="chip-group" data-kind={group.kind}>
                <span class="chip-group-label">{t(TITLE[group.kind])}</span>
                <ul class="chip-row">{group.list.map(chip)}</ul>
              </div>
            ))}
      {more ? <TurnBar leaf={leaf} word={t("chips.turn")} testId="chips-turn" /> : null}
    </section>
  );
}
