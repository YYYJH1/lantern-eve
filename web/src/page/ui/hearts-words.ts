import { type Lang, t } from "../../i18n/index.ts";
import { heartParts } from "../relations.ts";
import { count } from "./paper-text.ts";

/** How many hearts, in words: "three and a half", 三颗半, 半颗. */
export function heartsWords(lang: Lang, value: number): string {
  const { whole, half } = heartParts(value);
  if (lang === "zh") {
    if (whole === 0 && !half) return t("hearts.words.none");
    if (whole === 0) return "半颗";
    return half ? `${count("zh", whole)}颗半` : `${count("zh", whole)}颗`;
  }
  if (whole === 0 && !half) return t("hearts.words.none");
  if (whole === 0) return "half a heart";
  return half ? `${whole} and a half` : String(whole);
}

/** A change of the hearts in words, in half hearts: "half a heart", 一颗半. */
export function deltaWords(lang: Lang, halves: number): string {
  const n = Math.abs(Math.trunc(halves));
  if (lang === "zh") {
    const whole = Math.floor(n / 2);
    if (whole === 0) return "半颗心";
    return n % 2 === 1 ? `${count("zh", whole)}颗半心` : `${count("zh", whole)}颗心`;
  }
  const whole = Math.floor(n / 2);
  if (whole === 0) return "half a heart";
  if (n % 2 === 1) return whole === 1 ? "a heart and a half" : `${whole} and a half hearts`;
  return whole === 1 ? "a heart" : `${whole} hearts`;
}
