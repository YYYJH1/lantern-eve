import { useLayoutEffect } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { FramePlayer, Offer } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Name, Scene } from "../scene.ts";
import { CloseCorner, Underline } from "./ink.tsx";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { sourceWords } from "./source-text.ts";

export interface PickerOption {
  id: string;
  label: string;
  /** A short note under the label, such as who an entry was heard from. */
  badge?: string;
  /** For a choice the core offered: the name, which a talk records, and the fields to send. */
  name: Name;
  body?: Record<string, unknown> | null;
}

export interface PickerGroup {
  id: string;
  title: string;
  /** A short line under the heading, such as the risk of a way of telling. */
  note?: string;
  options: PickerOption[];
}

export interface PickerProps {
  testId: string;
  title: string;
  groups: PickerGroup[];
  /** Said when no group has an option. */
  empty: string;
  /** Laid out in the flow of the page, where it is put, and not over the bar under it. */
  inline?: boolean;
  onPick(option: PickerOption, group: PickerGroup): void;
  onClose(): void;
}

/** Where each row begins and ends in the paper, counted from the head of what is written on it and not from the part that is in view. The rows of a list of choices are the parts that its phrase for turning the page keeps whole. */
function rowsOf(list: HTMLElement): Array<{ top: number; bottom: number }> {
  const origin = list.getBoundingClientRect().top + list.clientTop - list.scrollTop;
  return Array.from(list.querySelectorAll("li")).map((row) => {
    const box = row.getBoundingClientRect();
    return { top: box.top - origin, bottom: box.bottom - origin };
  });
}

/**
 * What makes a list of choices close: Escape, a click outside it, and (the caller's) a choice. A click on a verb button is left to the
 * button. The first choice has the focus when the list opens, set up before it is painted, so that a key pressed the moment it opens is heard.
 */
export function useDismiss(box: { current: HTMLElement | null }, onClose: () => void): void {
  useLayoutEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".picker-option, .topic-chip")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (box.current?.contains(target) === true || target.closest(".verb, .verb-more, .gift-open, .context-more, .talk-context") !== null) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);
}

/**
 * A list of choices over the dialogue bar, grouped under headings. It closes with Escape, with a click outside it, and when a choice is made.
 * A click on a verb button is left to the button. A list that is longer than the room over the bar shows whole rows, and a phrase at its foot
 * turns it to the rows that come next.
 */
export function Picker({ testId, title, groups, empty, inline = false, onPick, onClose }: PickerProps) {
  const shown = groups.filter((group) => group.options.length > 0);
  // Which rows there are, to begin at the head again when the list is another one and to measure it again when its rows change.
  const rows = `${testId}:${shown.map((group) => group.options.map((option) => option.id).join(",")).join(";")}`;
  const { leaf: box, more } = useMoreBelow<HTMLDivElement>(rows, 0, rowsOf);
  useDismiss(box, onClose);
  return (
    <div class={`picker paper-slip${inline ? " picker-inline" : ""}`} role="dialog" aria-label={title} data-testid={testId} ref={box}>
      <CloseCorner label={t("picker.close")} testid="picker-close" onClose={onClose} />
      <header class="picker-head">
        <h3 class="picker-title">{title}</h3>
      </header>
      {shown.length === 0 ? (
        <p class="picker-empty" data-testid="picker-empty">
          {empty}
        </p>
      ) : (
        shown.map((group) => (
          <section key={group.id} class="picker-group" data-group={group.id}>
            {group.title === "" ? null : <h4 class="picker-heading">{group.title}</h4>}
            {group.note === undefined ? null : <p class="picker-note">{group.note}</p>}
            <ul class="picker-list">
              {group.options.map((option) => (
                <li key={option.id}>
                  <button type="button" class="picker-option ink-act" data-testid="picker-option" data-id={option.id} onClick={() => onPick(option, group)}>
                    <span class="picker-label">{option.label}</span>
                    {option.badge === undefined ? null : <span class="picker-badge">{option.badge}</span>}
                    <Underline seed={option.id} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {more ? <TurnBar leaf={box} word={t("picker.turn")} testId="picker-turn" partsOf={rowsOf} /> : null}
    </div>
  );
}

// --- The choices of each verb ----------------------------------------------------------------

/** How an entry of the notebook reached the player, in a few words: who told it and how they came to know it. */
export function sourceBadge(entry: NotebookEntry, lang: Lang): string | undefined {
  return entry.source.kind === "unknown" ? undefined : sourceWords(entry.source, lang);
}

const noteOption = (entry: NotebookEntry, lang: Lang): PickerOption => ({
  id: entry.id,
  label: pick(entry.text, lang),
  badge: sourceBadge(entry, lang),
  name: entry.text,
});

/** The entries that were heard from someone: those are the ones that have a source to ask for. */
export function sourceGroups(entries: readonly NotebookEntry[], lang: Lang): PickerGroup[] {
  const heard = entries.filter((e) => e.source.kind === "heard" || e.chain.length > 0);
  return [{ id: "notebook", title: "", options: heard.map((e) => noteOption(e, lang)) }];
}

/** The things and the places within reach that hold something to find, by the names the scene gives them. */
export function lookGroups(scene: Scene | null, player: FramePlayer | null, lang: Lang): PickerGroup[] {
  const nameOf = (id: string): Name => scene?.player?.things.find((th) => th.id === id)?.name ?? scene?.places.find((p) => p.id === id)?.name ?? { zh: id, en: id };
  return [{ id: "look", title: "", options: (player?.look ?? []).map((id) => ({ id, label: pick(nameOf(id), lang), name: nameOf(id) })) }];
}

const offerOption = (offer: Offer, lang: Lang): PickerOption => ({ id: offer.id, label: pick(offer.name, lang), name: offer.name, body: offer.body });

/** The choices of a verb that takes one from the town (speaking in public): what the frame offers for it. */
export function otherGroups(verb: string, player: FramePlayer | null, lang: Lang): PickerGroup[] {
  const offers = player?.offers[verb] ?? [];
  return [{ id: "offered", title: t("picker.other.offered"), options: offers.map((o) => offerOption(o, lang)) }];
}
