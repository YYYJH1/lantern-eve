import { type Lang, pick, t } from "../../i18n/index.ts";
import { dayPart, shichen } from "../frame.ts";
import type { Name } from "../scene.ts";
import type { Commitment } from "../slice.ts";

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** A whole number in Chinese numerals, up to 99. Larger numbers keep their digits. */
export function zhNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return DIGITS[n] ?? String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? "" : DIGITS[tens]}十${ones === 0 ? "" : DIGITS[ones]}`;
}

const EN_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small whole number in words: "five" and 五. A number past what has a word (ten in English, 99 in Chinese) keeps its digits. */
export function numberWord(lang: Lang, n: number): string {
  if (lang === "zh") return zhNumeral(n);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? (EN_WORDS[n] ?? String(n)) : String(n);
}

/** A share in tenths, as a person would say it: 60 is "six in ten" and 六成. A share that is not a whole number of tenths is the percent. */
export function tenthsText(lang: Lang, percent: number): string {
  if (!Number.isInteger(percent) || percent <= 0 || percent >= 100 || percent % 10 !== 0) return `${percent}%`;
  const tenths = percent / 10;
  return lang === "zh" ? `${zhNumeral(tenths)}成` : `${numberWord(lang, tenths)} in ten`;
}

/** 1st, 2nd, 3rd, 4th in English, 一, 二, 三 in Chinese: the number of a hand in the chain of a rumour. */
export function ordinal(lang: Lang, n: number): string {
  if (lang === "zh") return zhNumeral(n);
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
}

export function clockText(hour: number, minute: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor(minute);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "第三日" or "Day 3". */
export function dayLabel(lang: Lang, day: number): string {
  return t("hud.day", { n: lang === "zh" ? zhNumeral(day) : day });
}

/** The name of the time of day: the double hour in Chinese (申时), a word in English. */
export function partLabel(lang: Lang, hour: number): string {
  if (lang === "zh") return `${shichen(hour)}时`;
  return t(`hud.part.${dayPart(hour)}`);
}

export function moneyText(yuan: number): string {
  if (yuan > 0 && yuan < 0.01) return t("unit.moneyLess");
  return t("unit.money", { amount: yuan.toFixed(2) });
}

/**
 * Money in micro-yuan, as the core counts it. A call costs a fraction of a fen, so the amount is
 * written whole, down to the last micro-yuan, without the zeros at the end: 70 is ¥0.00007 and
 * 30,000 is ¥0.03. What the list adds up to is then exactly what the frame says was spent.
 */
export function microText(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const part = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return t("unit.money", { amount: part === "" ? String(whole) : `${whole}.${part}` });
}

/** Minutes of the day as a clock time: 1050 is 17:30. */
export const minutesText = (minutes: number): string => clockText(Math.floor(minutes / 60), minutes % 60);

/** A span of minutes of the day: "17:30–19:00". */
export const spanText = (from: number, to: number): string => `${minutesText(from)}–${minutesText(to)}`;

/** A line of the notebook as part of a sentence of the page: without the full stop it ends with, which the sentence has of its own. */
export const bare = (text: string): string => text.replace(/[\s.。!！?？]+$/u, "");

/** A whole hour as a clock time: 15 is 15:00. */
export const hourText = (hour: number): string => clockText(hour, 0);

/** The day and hour something is due by: "Day 2 06:00". */
export function dueText(lang: Lang, due: { day: number; hour: number }): string {
  return `${dayLabel(lang, due.day)} ${hourText(due.hour)}`;
}

/** The part of the day a whole hour belongs to, as a promise names it. Hours after midnight are 24 and up. */
type DuePart = "early" | "forenoon" | "noon" | "afternoon" | "evening" | "night";

function duePart(hour: number): DuePart {
  if (hour >= 24 || hour < 5) return "night";
  if (hour < 9) return "early";
  if (hour < 12) return "forenoon";
  if (hour < 13) return "noon";
  if (hour < 18) return "afternoon";
  return hour < 21 ? "evening" : "night";
}

/**
 * The hour something is due by, as a person would say it when it is today or tomorrow: "7 tomorrow morning", "明早07:00". The clock
 * time of the town is in figures in Chinese (07:00), the way the core's own words for a promise have it, and the hour of the day in
 * English. Any other day, and a frame that does not say what day it is, give "Day 4 07:00". The word for "by" is the caller's.
 */
export function dueWords(lang: Lang, due: { day: number; hour: number }, today: number | null): string {
  const offset = today === null ? Number.NaN : due.day - today;
  if (offset !== 0 && offset !== 1) return dueText(lang, due);
  const part = duePart(due.hour);
  const hour = lang === "zh" ? hourText(due.hour) : String(due.hour % 12 === 0 ? 12 : due.hour % 12);
  return t(`commit.at.${offset === 0 ? "today" : "tomorrow"}.${part}`, { n: hour });
}

/**
 * A request as the middle of an English sentence: "Bring 4 poles of bamboo" is "bring 4 poles of bamboo" after "agreed to".
 * The core writes a promise as a request that starts with a verb, so its first letter is the only capital to lower.
 */
export const lowerFirst = (text: string): string => (/^[A-Z][a-z]/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/**
 * What a person does, beside or under their name, or null where the name says it already. The town
 * calls the clan elder, the teahouse keeper, the temple keeper, the carpenter and the lantern maker by
 * what they do, so their role is their name. The Chinese words decide in both languages, because the
 * English role of such a person says the name again in other words.
 */
export function roleText(person: { readonly name: Name; readonly role: Name }, lang: Lang): string | null {
  if (person.role.zh === person.name.zh) return null;
  const role = pick(person.role, lang);
  return role === "" ? null : role;
}

/** What a person agreed to, as a sentence: "Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning". The core says the count in its own words (四根). */
export function agreedText(lang: Lang, commitment: Commitment, today: number | null): string {
  const request = pick(commitment.what, lang);
  const what = lang === "en" ? lowerFirst(request) : request;
  if (commitment.due === null) return t("commit.agreed.open", { what });
  return t("commit.agreed", { what, when: dueWords(lang, commitment.due, today) });
}
