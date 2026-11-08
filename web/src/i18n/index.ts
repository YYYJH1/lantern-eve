/**
 * The two languages of the interface. Every string the page shows lives in en.ts and zh.ts under
 * one key, and the Chinese table must have exactly the keys of the English one, which the type
 * checks. Names that come from the game itself (places, people, weather, bubbles) come in both
 * languages from the core and are chosen with `pick`.
 *
 * This module holds no storage and touches no document: the page reads and writes the choice.
 */
import { en, type MessageKey } from "./en.ts";
import { zh } from "./zh.ts";

export type Lang = "zh" | "en";
export const LANGS: readonly Lang[] = ["zh", "en"];
export type { MessageKey };

const tables: Record<Lang, Readonly<Record<MessageKey, string>>> = { en, zh };

/** A name that comes in both languages, or one string that serves for both. */
export type Localized = string | { readonly zh?: string; readonly en?: string };

let current: Lang = "en";
const listeners = new Set<() => void>();

export function isLang(value: unknown): value is Lang {
  return value === "zh" || value === "en";
}

/** The first language of the browser's list that the interface has. English when none is. */
export function detectLanguage(languages: readonly string[]): Lang {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split("-")[0];
    if (primary === "zh") return "zh";
    if (primary === "en") return "en";
  }
  return "en";
}

/** Whether the tables have a text under this key. For keys that are built from a code of the host. */
export function hasMessage(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const listener of [...listeners]) listener();
}

/** Calls the listener whenever the language changes. Returns a function that stops it. */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The text of a key in the current language, with each `{name}` replaced by its value. */
export function t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  return translate(current, key, values);
}

export function translate(lang: Lang, key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const text = tables[lang][key];
  if (values === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** A name in the given language (the current one by default), borrowing the other if it is empty. */
export function pick(value: Localized | null | undefined, lang: Lang = current): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const other: Lang = lang === "zh" ? "en" : "zh";
  return value[lang] || value[other] || "";
}

export function formatNumber(value: number, lang: Lang = current): string {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US").format(value);
}

/** The value of the lang attribute of the document for a language. */
export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}
