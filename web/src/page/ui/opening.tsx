import { useState } from "preact/hooks";
import { type Lang, t } from "../../i18n/index.ts";
import { lanternFestivalOn } from "../eggs.ts";
import type { PageState } from "../client.ts";
import { readHintsOn, readTutorialPref, writeHintsOn, writeTutorialPref } from "../guide-prefs.ts";
import type { LoadFailure } from "../load-failure.ts";
import type { ThemeChoice } from "../prefs.ts";
import { useWindowSize } from "./hooks.ts";
import { CloseCorner, InkAct } from "./ink.tsx";
import { LanguageSwitch, ThemeSwitch } from "./topbar.tsx";
import { MIN_WINDOW, tooSmall } from "./window.ts";

export interface OpeningProps {
  s: PageState;
  lang: Lang;
  theme: ThemeChoice;
  /** Whether this page can load a saved game: the browser host keeps them, the server host does not. */
  canContinue: boolean;
  /** Whether the host has a first picture of the town, which is when the world can be let go. */
  ready: boolean;
  /** Set when the last try to continue failed, with why: a save made by another version of the game says so in words of its own. */
  failed: LoadFailure | null;
  /** Whether a game was played to its end on this browser before, which is when another truth is offered. */
  another?: boolean;
  onStart(): void;
  onContinue(): void;
  /** Starts a game of the same rules with a seed and a story of its own. */
  onAnother?(): void;
  onGallery(): void;
}

/** The three things the festival asks, as the page shows them under the goal. */
const THINGS = ["bridge", "truth", "peace"] as const;

/**
 * The first page: the title, the one line of what the five days are for, the three things, and the buttons that start the
 * game or pick up the last one. The world is held behind it, and runs only when the player presses Start or Continue.
 */
export function OpeningPage({ s, lang, theme, canContinue, ready, failed, another = false, onStart, onContinue, onAnother, onGallery }: OpeningProps) {
  const [settings, setSettings] = useState(false);
  const [hints, setHints] = useState(readHintsOn);
  const [tutorial, setTutorial] = useState(() => readTutorialPref() === "new");
  // A window smaller than the page is laid out for gets a notice in place of the game, until the player asks for the game anyway.
  const size = useWindowSize();
  const [anyway, setAnyway] = useState(false);
  const small = tooSmall(size.width, size.height) && !anyway;
  const saved = s.saves.length > 0;
  // The day of the player's computer is a Lantern Festival, by the table of the page: one more line says so.
  const festival = lanternFestivalOn(new Date());
  const broken = s.phase === "failed";
  const status = broken ? "failed" : ready ? "ready" : "loading";
  return (
    <div class="opening" data-testid="opening" data-ready={ready} data-lang={lang}>
      <div class="opening-corner">
        <LanguageSwitch lang={lang} />
        <ThemeSwitch theme={theme} />
      </div>
      {small ? (
        <main class="opening-card paper-page" data-testid="size-notice">
          <h1 class="opening-title" data-lang={lang}>
            {t("app.title")}
          </h1>
          <p class="size-notice-text" data-testid="size-notice-text">
            {t("window.small", { w: MIN_WINDOW.width, h: MIN_WINDOW.height })}
          </p>
          <InkAct seed="anyway" data-testid="size-notice-open" onClick={() => setAnyway(true)}>
            {t("window.anyway")}
          </InkAct>
        </main>
      ) : (
        <main class="opening-card paper-page">
          <h1 class="opening-title" data-lang={lang} data-testid="opening-title">
            {t("app.title")}
          </h1>
          <p class="opening-chapter" data-testid="opening-chapter">
            {t("opening.chapter")}
          </p>
          <p class="opening-goal" data-testid="opening-goal">
            {t("opening.goal")}
          </p>
          {festival ? (
            <p class="opening-today" data-testid="opening-today">
              {t("egg.festival")}
            </p>
          ) : null}
          <ul class="opening-things" data-testid="opening-things" aria-label={t("opening.things")}>
            {THINGS.map((id) => (
              <li key={id} data-thing={id}>
                <strong>{t(`opening.thing.${id}`)}</strong>
                <span>{t(`opening.thing.${id}.text`)}</span>
              </li>
            ))}
          </ul>
          <div class="opening-buttons">
            <button type="button" class="ink-frame opening-start" data-testid="opening-start" disabled={!ready} onClick={onStart}>
              {t("opening.start")}
            </button>
            <InkAct seed="continue" data-testid="opening-continue" disabled={!ready || !canContinue || !saved} onClick={onContinue} aria-describedby="opening-continue-note">
              {t("opening.continue")}
            </InkAct>
            {another && onAnother !== undefined ? (
              <InkAct seed="another" data-testid="opening-another" disabled={!ready} onClick={onAnother}>
                {t("opening.another")}
              </InkAct>
            ) : null}
          </div>
          <p class="opening-note" id="opening-continue-note" data-testid="opening-continue-note" data-failed={failed !== null} data-why={failed ?? ""}>
            {failed !== null ? t(failed === "version" ? "opening.continue.version" : "opening.continue.failed") : !canContinue ? t("opening.continue.server") : saved ? "" : t("opening.continue.none")}
          </p>
          <div class="opening-more">
            <InkAct seed="gallery" data-testid="opening-gallery" onClick={onGallery}>
              {t("opening.gallery")}
            </InkAct>
            <InkAct seed="settings" data-testid="opening-settings" aria-expanded={settings} onClick={() => setSettings((now) => !now)}>
              {t("opening.settings")}
            </InkAct>
          </div>
          {settings ? (
            <section class="opening-settings" data-testid="settings" aria-label={t("settings.title")}>
              <header class="opening-settings-head">
                <h2>{t("settings.title")}</h2>
                <CloseCorner label={t("settings.close")} testid="settings-close" onClose={() => setSettings(false)} />
              </header>
              <label class="setting" data-testid="setting-hints">
                <input
                  type="checkbox"
                  checked={hints}
                  onChange={(event) => {
                    const on = (event.target as HTMLInputElement).checked;
                    setHints(on);
                    writeHintsOn(on);
                  }}
                />
                <span class="setting-text">
                  <strong>{t("settings.hints")}</strong>
                  <span>{t("settings.hints.help")}</span>
                </span>
              </label>
              <label class="setting" data-testid="setting-tutorial">
                <input
                  type="checkbox"
                  checked={tutorial}
                  onChange={(event) => {
                    const on = (event.target as HTMLInputElement).checked;
                    setTutorial(on);
                    writeTutorialPref(on ? "new" : "skipped");
                  }}
                />
                <span class="setting-text">
                  <strong>{t("settings.tutorial")}</strong>
                  <span>{t("settings.tutorial.help")}</span>
                </span>
              </label>
            </section>
          ) : null}
          <p class={`opening-status opening-status-${status}`} data-testid="opening-status" data-status={status} role="status">
            {t(`opening.status.${status}`)}
          </p>
        </main>
      )}
    </div>
  );
}
