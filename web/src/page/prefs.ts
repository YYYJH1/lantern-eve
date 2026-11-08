/**
 * The viewer's two choices: the language and the theme. Both are applied to the document here
 * (the lang attribute and title, the data-theme attribute) and remembered per viewer in
 * localStorage. A browser that blocks storage still gets a working switch, which holds until the
 * page is closed.
 */
import { detectLanguage, getLang, htmlLang, isLang, type Lang, setLang, subscribeLang, t } from "../i18n/index.ts";
import { readPref, writePref } from "./storage.ts";

export type ThemeChoice = "auto" | "light" | "dark";
const THEMES: readonly ThemeChoice[] = ["auto", "light", "dark"];

const isTheme = (value: unknown): value is ThemeChoice => THEMES.includes(value as ThemeChoice);

// --- Language ---------------------------------------------------------------------------------

function browserLanguages(): string[] {
  const list = navigator.languages;
  if (list !== undefined && list.length > 0) return [...list];
  return navigator.language === "" ? [] : [navigator.language];
}

/** The remembered language if there is one, else the browser's first language the page has. */
export function initialLanguage(): Lang {
  const stored = readPref("lang");
  return isLang(stored) ? stored : detectLanguage(browserLanguages());
}

/** Puts the language on the document, now and whenever it changes. */
export function bindLanguage(): void {
  const apply = (): void => {
    document.documentElement.lang = htmlLang(getLang());
    document.title = t("app.title");
  };
  setLang(initialLanguage());
  apply();
  subscribeLang(apply);
}

/** A choice made by the viewer: it is applied and remembered. */
export function chooseLanguage(lang: Lang): void {
  setLang(lang);
  writePref("lang", lang);
}

// --- Theme ------------------------------------------------------------------------------------

let theme: ThemeChoice = "auto";
const themeListeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  return theme;
}

function applyTheme(): void {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function initialTheme(): ThemeChoice {
  const stored = readPref("theme");
  return isTheme(stored) ? stored : "auto";
}

export function bindTheme(): void {
  theme = initialTheme();
  applyTheme();
}

export function chooseTheme(next: ThemeChoice): void {
  if (next === theme) return;
  theme = next;
  applyTheme();
  writePref("theme", next);
  for (const listener of [...themeListeners]) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}
