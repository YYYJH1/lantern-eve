/**
 * The words of the slip of the task in hand that are made of parts: when and where something can be done, as a person says it
 * ("茶馆，酉时 17:00 到 19:00", "Teahouse, 17:00 to 19:00"). The slip (`taskcard.tsx`) draws them; the unit tests read them here, with
 * no page. A clock time is always in digits, and the day is left out when it is today.
 */
import { type Lang, t } from "../../i18n/index.ts";
import { shichen } from "../frame.ts";
import { dayLabel, hourText } from "./format.ts";

export interface SlipWindow {
  day: number;
  from: number;
  to: number;
}

/** The hours of a window: "酉时 17:00 到 19:00" in Chinese, "17:00 to 19:00" in English, which has no double hours. */
export function spanWords(lang: Lang, win: Pick<SlipWindow, "from" | "to">): string {
  const part = lang === "zh" ? `${shichen(win.from)}时 ` : "";
  return t("slip.span", { part, from: hourText(win.from), to: hourText(win.to) });
}

/** Where and when: the place first (where there is one), then the day unless it is `today`, then the hours. */
export function whenWhere(lang: Lang, win: SlipWindow, place: string | null, today: number | null = null): string {
  const day = today !== null && win.day === today ? "" : `${dayLabel(lang, win.day)} `;
  const span = spanWords(lang, win);
  return place === null || place === "" ? `${day}${span}` : t("slip.when", { place, day, span });
}

/** Where and when for a line of the ledger: the day always, then the hours, then the place: "第四日 辰时 08:00 到 12:00，石桥". */
export function ledgerWhen(lang: Lang, win: SlipWindow, place: string | null): string {
  const day = `${dayLabel(lang, win.day)} `;
  const span = spanWords(lang, win);
  return place === null || place === "" ? `${day}${span}` : t("ledger.when", { day, span, place });
}
