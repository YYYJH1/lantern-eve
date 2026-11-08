import { useLayoutEffect } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { FramePlayer, Offer } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Name, Scene } from "../scene.ts";
import { ordinal } from "./format.ts";
import { CloseCorner, Underline } from "./ink.tsx";
import { TurnBar, useMoreBelow } from "./more-below.tsx";

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

/** The least height, in pixels, of the phrase that turns the page at the foot of the list, which hides what lies under it. */
const TURN_ROOM = 38;

/** Where each row begins and ends in the paper, counted from the head of what is written on it and not from the part that is in view. */
function rowsOf(list: HTMLElement): Array<{ top: number; bottom: number }> {
  const origin = list.getBoundingClientRect().top + list.clientTop - list.scrollTop;
  return Array.from(list.querySelectorAll("li")).map((row) => {
    const box = row.getBoundingClientRect();
    return { top: box.top - origin, bottom: box.bottom - origin };
  });
}

/**
 * Where the rows that are whole above the phrase that turns the page end (`foot`), and where the first row that is not begins (`next`), for the part of the list
 * that is in view. A row that the foot of the paper would cut is under the phrase, which reaches up to `foot`.
 */
function wholeRows(list: HTMLElement): { foot: number; next: number } {
  const seen = list.scrollTop + list.clientHeight;
  let foot = 0;
  for (const row of rowsOf(list)) {
    if (row.bottom + TURN_ROOM > seen) return { foot, next: row.top };
    foot = row.bottom;
  }
  return { foot, next: list.scrollHeight };
}

/**
 * Keeps `--turn-h`, the height of the phrase that turns the page, at what lies between the last row that is whole above it and the foot of the paper, so that
 * a list shows whole rows at the foot wherever it is turned to: what the foot would cut in half is under the phrase. It is measured again as the list scrolls.
 */
function useTurnHeight(list: preact.RefObject<HTMLElement | null>, rows: string): void {
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const fit = (): void => {
      const { foot } = wholeRows(element);
      element.style.setProperty("--turn-h", `${Math.floor(foot === 0 ? TURN_ROOM : element.scrollTop + element.clientHeight - foot)}px`);
    };
    fit();
    element.addEventListener("scroll", fit, { passive: true });
    // The list changes its size, and so does a row (a face that loads after the list is drawn sets the words a little differently).
    const watch = new ResizeObserver(fit);
    watch.observe(element);
    for (const row of Array.from(element.querySelectorAll("li"))) watch.observe(row);
    return () => {
      element.removeEventListener("scroll", fit);
      watch.disconnect();
    };
  }, [rows]);
}

/**
 * A list of choices over the dialogue bar, grouped under headings. It closes with Escape, with a
 * click outside it, and when a choice is made. A click on a verb button is left to the button.
 * A list that is longer than the room over the bar shows whole rows, and a phrase at its foot turns it to the rows that come next.
 */
export function Picker({ testId, title, groups, empty, inline = false, onPick, onClose }: PickerProps) {
  const shown = groups.filter((group) => group.options.length > 0);
  // Which rows there are, to begin at the head again when the list is another one and to measure it again when its rows change.
  const rows = `${testId}:${shown.map((group) => group.options.map((option) => option.id).join(",")).join(";")}`;
  const { leaf: box, more } = useMoreBelow<HTMLDivElement>(rows);
  useTurnHeight(box, rows);
  // Set up before the list is painted, so that a key pressed the moment it opens is heard.
  useLayoutEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".picker-option")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (box.current?.contains(target) === true || target.closest(".verb") !== null) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

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
      {more ? <TurnBar leaf={box} word={t("picker.turn")} testId="picker-turn" to={(list) => Math.max(wholeRows(list).next, list.scrollTop + 40)} /> : null}
    </div>
  );
}

// --- The choices of each verb ----------------------------------------------------------------

/** How an entry of the notebook reached the player, in a few words. */
export function sourceBadge(entry: NotebookEntry, lang: Lang): string | undefined {
  if (entry.source.kind === "seen") return t("source.seen");
  if (entry.source.kind === "heard") return t("source.heard", { who: pick(entry.source.who, lang), hand: ordinal(lang, entry.source.hand) });
  return undefined;
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

/** The ways of telling besides telling it as it is. They have a submenu of their own, each with the risk it runs. */
export const WAYS = ["as_seen", "sharpen", "hide_source", "fabricate"] as const;
export type Way = (typeof WAYS)[number];

const wayOf = (offer: Offer): Way | null => {
  const how = offer.body?.how;
  return WAYS.find((way) => way === how) ?? null;
};

/** The offers of `tell` that are one of the other ways. */
export const wayOffers = (player: FramePlayer | null): Offer[] => (player?.offers.tell ?? []).filter((offer) => wayOf(offer) !== null);

/** The submenu "say it another way": a group for each way, with its risk in a line, and what can be told that way. */
export function wayGroups(player: FramePlayer | null, lang: Lang): PickerGroup[] {
  return WAYS.map((way) => ({
    id: `way-${way}`,
    title: t(`way.${way}`),
    note: t(`way.${way}.risk`),
    options: (player?.offers.tell ?? []).filter((offer) => wayOf(offer) === way).map((offer) => offerOption(offer, lang)),
  }));
}

/**
 * The choices of a verb that takes one from the town (telling, entrusting, promising, speaking): what
 * the frame offers for it. A telling can also be of any entry of the notebook, as it stands. The other ways of
 * telling are in the submenu (`wayGroups`) and not here.
 */
export function otherGroups(verb: string, player: FramePlayer | null, entries: readonly NotebookEntry[], lang: Lang): PickerGroup[] {
  const offers = (player?.offers[verb] ?? []).filter((offer) => verb !== "tell" || wayOf(offer) === null);
  return [
    { id: "offered", title: t("picker.other.offered"), options: offers.map((o) => offerOption(o, lang)) },
    { id: "notebook", title: t("picker.other.notebook"), options: verb === "tell" ? entries.map((e) => noteOption(e, lang)) : [] },
  ];
}
