/**
 * The words of the cards and the notebook for a number of things, and the marks between the parts of a line, as a person would write them on
 * paper: the number of things is in words (四条, 4), the hours are figures (the clock of the town, see `slip-text.ts`), and there is no row of dots
 * between the parts.
 */
import { formatNumber, type Lang } from "../../i18n/index.ts";
import type { Name } from "../scene.ts";
import { zhNumeral } from "./format.ts";

/**
 * A count of things in the town as a person says it before a measure word: 四条 and 两条 in Chinese, 4 in English. A count past what has a
 * numeral (99 in Chinese) keeps its digits, grouped in thousands as the language writes them.
 */
export const count = (lang: Lang, n: number): string => (lang === "zh" && Number.isInteger(n) && n >= 0 && n <= 99 ? (n === 2 ? "两" : zhNumeral(n)) : formatNumber(n, lang));

/** The same count in both languages at once, for the words that are made for both together (a note, the name of a promise). */
export const countName = (n: number): Name => ({ zh: count("zh", n), en: count("en", n) });

/** The marks between the parts of a line, which are not the same in the two languages: a comma, a full stop with what follows it, and the last full stop. */
export const marks = (lang: Lang): { comma: string; stop: string; end: string } => (lang === "zh" ? { comma: "，", stop: "。", end: "。" } : { comma: ", ", stop: ". ", end: "." });

/** Whether words already end in a full stop, a question mark or an exclamation mark, so that the line that carries them has no stop to add. */
export const endsInStop = (text: string): boolean => /[。！？.!?…]$/.test(text);

