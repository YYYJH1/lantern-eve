/**
 * What the statement card says, as functions of the frame: the three parts in order and their names, how many have a choice,
 * whether the full statement can be made and what to say when it cannot, and the line of the parts that did not hold. The views
 * (`statement.tsx`) draw them; the unit tests read them here, with no page.
 */
import { type Lang, type MessageKey, pick, translate } from "../../i18n/index.ts";
import { STATEMENT_PARTS, type StatementCard, type StatementOption, type StatementPart, type StatementPartCard } from "../slice.ts";

/** The page's own name for each part, used where the frame gives none. */
export const PART_KEY: Readonly<Record<StatementPart, MessageKey>> = {
  cause: "board.statement.cause",
  course: "board.statement.course",
  rumour: "board.statement.rumour",
};

/** A part the frame leaves out: nothing to choose from, and a gap. */
const emptyPart = (part: StatementPart): StatementPartCard => ({ part, title: null, options: [], chosen: null, gap: true });

/** The three parts of the card in order. A part the frame leaves out is an empty one, so that the card always has three. */
export function partsOf(card: StatementCard): StatementPartCard[] {
  return STATEMENT_PARTS.map((part) => card.parts.find((p) => p.part === part) ?? emptyPart(part));
}

/** The name of a part: the core's own where the frame gives it, else the page's. */
export function partName(part: StatementPartCard, lang: Lang): string {
  const named = part.title === null ? "" : pick(part.title, lang);
  return named === "" ? translate(lang, PART_KEY[part.part]) : named;
}

/** The option the manager chose for a part, if the list shows it. */
export function chosenOption(part: StatementPartCard): StatementOption | undefined {
  return part.chosen === null ? undefined : part.options.find((o) => o.id === part.chosen);
}

/** How many of the parts have a choice. */
export function chosenCount(card: StatementCard | null): number {
  return card === null ? 0 : partsOf(card).filter((p) => p.chosen !== null).length;
}

/** The number of parts a statement has. */
export const PART_TOTAL = STATEMENT_PARTS.length;

/** The marks on an option: how many notes support it and how many go against it, and whether any note bears on it. */
export function marksOf(option: StatementOption): { support: number; against: number; held: boolean } {
  return { support: option.support, against: option.against, held: option.support + option.against > 0 };
}

/** The state of the button that makes the full statement, and what is said under it when it cannot be pressed. */
export interface StateButton {
  enabled: boolean;
  /** Why it cannot be pressed: the core's words, else the page's. Null where it can, and while a statement waits for the core's word. */
  why: string | null;
  /** `ok`, `waiting` (the core has not answered), `used` (today's statement is made), `core` (the core gave its reason) or `unknown`. */
  state: "ok" | "waiting" | "used" | "core" | "unknown";
}

export function stateButton(card: StatementCard | null, waiting: boolean, lang: Lang): StateButton {
  if (waiting) return { enabled: false, why: null, state: "waiting" };
  if (card === null) return { enabled: false, why: translate(lang, "statement.why.none"), state: "unknown" };
  if (card.canState) return { enabled: true, why: null, state: "ok" };
  const words = card.whyNot === null ? "" : pick(card.whyNot, lang);
  if (words !== "") return { enabled: false, why: words, state: "core" };
  if (card.usedToday) return { enabled: false, why: translate(lang, "statement.used"), state: "used" };
  return { enabled: false, why: translate(lang, "statement.why.none"), state: "unknown" };
}

/** The names of the parts, in a line: "Cause, Course" and 「成因、经过」. */
export function partNames(card: StatementCard | null, parts: readonly StatementPart[], lang: Lang): string {
  const names = parts.map((part) => partName(card?.parts.find((p) => p.part === part) ?? emptyPart(part), lang));
  return names.join(lang === "zh" ? "、" : ", ");
}

/** The line of the parts that did not hold in the last statement. Null where every part held or there was no statement. */
export function wrongLine(card: StatementCard | null, wrong: readonly StatementPart[], lang: Lang): string | null {
  return wrong.length === 0 ? null : translate(lang, "statement.last.wrong", { parts: partNames(card, wrong, lang) });
}
