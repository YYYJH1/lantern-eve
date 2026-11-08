/**
 * What the preparation board says, as functions of the frame: the materials of the bridge, the next time work is done, the
 * words of the truth and of the peace, and the one line of the shut board. The views (`board.tsx`) draw them; the unit tests
 * read them here, with no page. A value the frame leaves out is null, and the view shows a dash for it.
 */
import { formatNumber, type Lang, pick, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import { readHud } from "../hud.ts";
import type { Scene } from "../scene.ts";
import { type Board, type Commitment, type ElderStand, type SliceFrame, type TaskWindow, type TruthLast } from "../slice.ts";
import { dueText, numberWord, tenthsText } from "./format.ts";
import { placeName, thingName } from "./names.ts";
import { count } from "./paper-text.ts";

export interface Material {
  item: string;
  /** Agreed and not taken back: what is promised, delivered or not. */
  promised: number;
  delivered: number;
  /** Promised and not kept, or taken back. It is not in `promised`. */
  lost: number;
  site: number | null;
}

/** For each item that is promised or lies at the bridge: how much was promised, how much came, how much was not kept, how much lies there. */
export function materialsOf(slice: SliceFrame): Material[] {
  const commitments: Commitment[] = slice.commitments ?? [];
  const items: string[] = [];
  for (const c of commitments) if (c.item !== "" && !items.includes(c.item)) items.push(c.item);
  for (const item of Object.keys(slice.site ?? {})) if (!items.includes(item)) items.push(item);
  return items.map((item) => {
    const mine = commitments.filter((c) => c.item === item);
    const total = (states: readonly Commitment["state"][]): number => mine.filter((c) => states.includes(c.state)).reduce((sum, c) => sum + c.amount, 0);
    return {
      item,
      promised: total(["promised", "delivered"]),
      delivered: total(["delivered"]),
      lost: total(["broken", "withdrawn"]),
      site: slice.site === null ? null : (slice.site[item] ?? 0),
    };
  });
}

/** The place of the town that the bridge is. */
export const BRIDGE = "p_bridge";

/**
 * The next time work can be done at the bridge: the board's own word, else the earliest window at the bridge of a task of the bridge that is not over.
 * A task of the bridge can also have the time and place of the person it sends the player to, which is not a time at the bridge, and a task that
 * is done or stale (its morning has gone by) is not a time to come.
 */
export function nextWindow(slice: SliceFrame, board: Board | null): TaskWindow | null {
  if (board?.window != null) return board.window;
  const windows = (slice.tasks?.list ?? [])
    .filter((task) => task.job === "bridge" && task.window?.place === BRIDGE && task.state !== "done" && task.state !== "stale")
    .map((task) => task.window as TaskWindow);
  windows.sort((x, y) => x.day - y.day || x.from - y.from);
  return windows[0] ?? null;
}

/** What lies at the bridge, item by item and against what the bridge takes where the board says: "Bamboo 4 of 10, Timber 0 of 8". Null where the frame has no `site`. */
export function siteText(slice: SliceFrame, board: Board | null, scene: Scene | null, lang: Lang): string | null {
  if (slice.site === null) return null;
  const entries = Object.entries(slice.site);
  if (entries.length === 0) return t("board.site.empty");
  return entries
    .map(([item, n]) => {
      const need = board?.needs?.[item] ?? null;
      const name = thingName(scene, lang, item);
      return need === null ? `${name} ${formatNumber(n, lang)}` : t("board.site.of", { item: name, n: formatNumber(n, lang), need: formatNumber(need, lang) });
    })
    .join(lang === "zh" ? "，" : ", ");
}

/** How many helpers agreed in all: the board's count, else the number the hud has for the workers. Null where there is neither. */
export function helperTotal(board: Board | null, fallback: number | null): number | null {
  return board?.helpers == null ? fallback : board.helpers.reduce((sum, h) => sum + h.count, 0);
}

/**
 * The total of the helpers as a line: the count where the frame does not say how many the work takes, the count against the need ("3 of 5")
 * while there are no more than the work takes, and, with more than it takes, that there are enough and what it takes ("17 in all, enough
 * (5 needed)"), which a count against the need ("17 of 5") does not say.
 */
export function helperTotalText(total: number, need: number | null): string {
  if (need === null) return t("board.helpers.total", { n: total });
  return t(total > need ? "board.helpers.enough" : "board.helpers.of", { n: total, need });
}

// --- The truth -----------------------------------------------------------------------------------------------

/** What a public statement takes to count as clearing the matter: the people with a name who must be there, and the share of them who must accept (`assembly.py`). The elder must accept too. */
export const TRUTH_NAMED = 5;
export const TRUTH_PERCENT = 60;

/** The three conditions of a public statement in words, each with whether the last statement met it (null where there was none). */
export interface TruthNeed {
  id: "named" | "accept" | "elder";
  text: string;
  met: boolean | null;
}

export function truthNeeds(lang: Lang, last: TruthLast | null): TruthNeed[] {
  return [
    { id: "named", text: t("board.truth.need.named", { n: numberWord(lang, TRUTH_NAMED) }), met: last === null ? null : last.named >= TRUTH_NAMED },
    { id: "accept", text: t("board.truth.need.accept", { share: tenthsText(lang, TRUTH_PERCENT) }), met: last === null ? null : last.percent >= TRUTH_PERCENT },
    { id: "elder", text: t("board.truth.need.elder"), met: last === null ? null : last.elder === "accepted" },
  ];
}

const ELDER_KEY: Readonly<Record<ElderStand, "board.truth.elder.absent" | "board.truth.elder.refused" | "board.truth.elder.accepted">> = {
  absent: "board.truth.elder.absent",
  refused: "board.truth.elder.refused",
  accepted: "board.truth.elder.accepted",
};

/** The last statement in a line: when and where, how many were there and how many accepted. */
export function truthLastText(last: TruthLast, scene: Scene | null, lang: Lang): string {
  const where = placeName(scene, lang, last.venue);
  const values = { when: dueText(lang, last), named: count(lang, last.named), accepted: count(lang, last.accepted), percent: last.percent };
  return where === null ? t("board.truth.lastLine.nowhere", values) : t("board.truth.lastLine", { ...values, where });
}

/** Where the elder stood at the last statement, in words. Null where the frame does not say. */
export function elderText(last: TruthLast): string | null {
  return last.elder === null ? null : t(ELDER_KEY[last.elder]);
}

// --- The peace -----------------------------------------------------------------------------------------------

/** The line about the witness of the peace: "Publicly witnessed" or "No public witness yet". Null where the frame does not say. */
export function witnessText(witnessed: boolean | null): string | null {
  return witnessed === null ? null : t(witnessed ? "board.peace.witness.yes" : "board.peace.witness.no");
}

// --- The shut board ------------------------------------------------------------------------------------------

/**
 * The word for the truth in the line of the shut board: that it is done once the truth has been told, else the three columns of the
 * statement where the frame has them, else that it is open. A dash only where the frame has neither.
 */
export function truthSummary(board: Board | null): string {
  if (board?.truth?.state === "done") return t("board.summary.done");
  if (board?.statement != null) return `${board.statement.filter((c) => !c.gap).length}/${board.statement.length}`;
  if (board?.truth != null) return t("board.summary.open");
  return t("hud.none");
}

/** The word for the peace: done, or how much of the grudge is gone, or open where the frame has no number. A dash only where the frame has nothing. */
export function peaceSummary(board: Board | null): string {
  const peace = board?.peace ?? null;
  if (peace === null) return t("hud.none");
  if (peace.state === "done") return t("board.summary.done");
  if (peace.grudge !== null) return `${100 - peace.grudge}%`;
  return peace.state === "open" ? t("board.summary.open") : t("hud.none");
}

/** One line for the board when it is shut: how the three things stand. */
export function summaryOf(frame: ViewFrame | null, slice: SliceFrame): string {
  const hud = readHud(frame?.hud ?? {});
  const bridge = hud.bridge?.percent ?? null;
  return t("board.summary", {
    bridge: bridge === null ? t("hud.none") : `${bridge}%`,
    statement: truthSummary(slice.board),
    peace: peaceSummary(slice.board),
  });
}

/** The family by name, for a list of helpers. A helper of no family is "No family", and a family the scene does not name is its id. */
export function familyName(scene: Scene | null, lang: Lang, id: string | null): string {
  return id === null ? t("board.helpers.none") : pick(scene?.families.get(id), lang) || id;
}
