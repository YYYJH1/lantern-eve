import { LANGS, type Lang, t } from "../../i18n/index.ts";
import type { PageState } from "../client.ts";
import type { ViewFrame } from "../frame.ts";
import type { Play } from "../play.ts";
import { chooseLanguage, chooseTheme, type ThemeChoice } from "../prefs.ts";
import type { Scene } from "../scene.ts";
import { daysLeft, type SliceFrame } from "../slice.ts";
import { worldWord } from "../world-state.ts";
import { Dash, weatherName } from "./common.tsx";
import { clockText, dayLabel, partLabel, zhNumeral } from "./format.ts";
import { AutoIcon, CloseIcon, MoonIcon, SpeedIcon, SunIcon } from "./icons.tsx";
import { Glyph } from "./ink.tsx";
import { TaskCard } from "./taskcard.tsx";

const LANG_NAMES: Record<Lang, string> = { zh: "中文", en: "EN" };
const THEMES: ReadonlyArray<{ id: ThemeChoice; icon: () => preact.JSX.Element }> = [
  { id: "auto", icon: AutoIcon },
  { id: "light", icon: SunIcon },
  { id: "dark", icon: MoonIcon },
];

/** The switch between the two languages. It changes every word of the page at once. */
export function LanguageSwitch({ lang }: { lang: Lang }) {
  return (
    <div class="seg seg-lang" role="group" aria-label={t("top.language")} data-testid="lang-switch" data-lang={lang}>
      {LANGS.map((id) => (
        <button
          key={id}
          type="button"
          class="seg-btn"
          lang={id === "zh" ? "zh-CN" : "en"}
          data-testid={`lang-${id}`}
          aria-pressed={lang === id}
          onClick={() => chooseLanguage(id)}
        >
          {LANG_NAMES[id]}
        </button>
      ))}
    </div>
  );
}

/** The switch between the system's theme, the light one and the dark one. */
export function ThemeSwitch({ theme }: { theme: ThemeChoice }) {
  return (
    <div class="seg seg-theme" role="group" aria-label={t("top.theme")} data-testid="theme-switch" data-theme-choice={theme}>
      {THEMES.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          class="seg-btn seg-icon"
          data-testid={`theme-${id}`}
          aria-pressed={theme === id}
          aria-label={t(`theme.${id}`)}
          title={t(`theme.${id}`)}
          onClick={() => chooseTheme(id)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

/** The two speeds of the day: the common one, three minutes of daylight, and a slower one, four. */
export type SpeedChoice = "normal" | "slow";
export const SPEEDS: readonly SpeedChoice[] = ["normal", "slow"];

/** The speed of the world. It is the pace of the clock, and changes nothing the core does. */
export function SpeedSwitch({ speed, onSpeed, disabled }: { speed: SpeedChoice; onSpeed: (speed: SpeedChoice) => void; disabled: boolean }) {
  return (
    <div class="seg seg-speed" role="group" aria-label={t("top.speed")} data-testid="speed-switch" data-speed={speed} title={t("top.speed.hint")}>
      <span class="seg-icon-lead" aria-hidden="true">
        <SpeedIcon />
      </span>
      {SPEEDS.map((id) => (
        <button key={id} type="button" class="seg-btn" data-testid={`speed-${id}`} aria-pressed={speed === id} disabled={disabled} onClick={() => onSpeed(id)}>
          {t(`top.speed.${id}`)}
        </button>
      ))}
    </div>
  );
}

/** The word for what a recording is doing, for the status in the top bar. */
function replayStatusKey(s: PageState): "loading" | "playing" | "paused" | "ended" | "failed" {
  const status = s.replay;
  if (s.phase === "failed" || status?.phase === "failed") return "failed";
  if (status === null || status.phase !== "ready" || status.busy) return "loading";
  return status.ended ? "ended" : status.playing ? "playing" : "paused";
}

/** What the top bar is for when it belongs to a recording: what it is called, and the way back. */
export interface ReplayTop {
  title: string;
  onClose: () => void;
}

/**
 * The placard that hangs at the top left: the day, the hour (the double hour and the clock) and the weather, three lines (four in English, where the part of the day and the clock are on lines of their own). The days that
 * are left before the festival are in its title, and in the words that a reader that cannot see the placard is given.
 */
function Placard({ frame, scene, lang }: { frame: ViewFrame | null; scene: Scene | null; lang: Lang }) {
  const time = frame?.time;
  const weather = frame?.weather ?? "clear";
  const days = scene?.days ?? 5;
  const left = time === undefined ? null : daysLeft(time.day, days);
  const leftWords = left === null ? null : left === 0 ? t("top.left.today") : left === 1 ? t("top.left.one") : t("top.left", { n: lang === "zh" ? zhNumeral(left) : left });
  return (
    <div class="placard" data-testid="hud-time" data-phase={time?.phase ?? "day"} aria-label={t("hud.clock")} title={leftWords ?? undefined}>
      <span class="pl-day" data-testid="hud-day">
        {time === undefined ? <Dash /> : dayLabel(lang, time.day)}
      </span>
      <span class="pl-hour">
        <span class="pl-part" data-testid="hud-part">
          {time === undefined ? null : partLabel(lang, time.hour)}
        </span>
        <span class="pl-clock" data-testid="hud-clock">
          {time === undefined ? <Dash /> : clockText(time.hour, time.minute)}
        </span>
      </span>
      <span class="pl-sky" data-testid="hud-weather" data-weather={weather}>
        {frame === null ? <Dash /> : weatherName(scene, lang, weather)}
      </span>
      <span class="sr-only" data-testid="hud-left" data-left={left ?? ""}>
        {leftWords === null ? <Dash /> : leftWords}
      </span>
    </div>
  );
}

export interface TopBarProps {
  s: PageState;
  lang: Lang;
  theme: ThemeChoice;
  sceneName: string;
  scene: Scene | null;
  frame: ViewFrame | null;
  slice: SliceFrame;
  play: Play;
  /** The verbs the world offers now. */
  verbs: ReadonlySet<string>;
  /** Whether the festival night has come and gone (the ending is there). */
  ended?: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onPause: () => void;
  /** The player is in a talk, in which the core may hold the world by itself. */
  talking: boolean;
  /** A card of the help holds the world, and the button does not let it go. */
  held?: boolean;
  /** Something else has the stage (the ledger, the notebook, a talk): the note of the slip folds. */
  yielded?: boolean;
  replay?: ReplayTop | null;
}

/**
 * The frame of the page that hangs from the roof line: the placard of the day, the slip of the task in hand, and at the top right two
 * small drawings, pause (or play, while the world is held) and the menu. The name of the game and of the town are there for a reader
 * that cannot see the page.
 */
export function TopBar({ s, lang, theme, sceneName, scene, frame, slice, play, verbs, ended = false, menuOpen, onMenu, onPause, talking, held = false, yielded = false, replay = null }: TopBarProps) {
  const ready = s.phase === "ready";
  // The core holds the world in a talk. That is not the player's pause: the word says so, and the button offers a pause.
  const state = worldWord(s, talking);
  const replaying = replayStatusKey(s);
  return (
    <header class="topbar" data-replay={replay !== null}>
      <div class="eave" aria-hidden="true" />
      <h1 class="sr-only" data-lang={lang} data-testid="title">
        {t("app.title")}
      </h1>
      <p class="sr-only" data-testid="brand-sub">
        {replay !== null ? t("replay.of", { title: replay.title }) : sceneName === "" ? t("app.tagline") : sceneName}
      </p>

      <Placard frame={frame} scene={scene} lang={lang} />
      <TaskCard slice={slice} scene={scene} lang={lang} play={play} verbs={verbs} ended={ended} today={frame?.time.day ?? null} yielded={yielded} />

      {replay !== null ? (
        <div class="run run-replay">
          <span class="replay-badge" data-testid="replay-badge" title={t("replay.readOnly")}>
            {t("replay.badge")}
          </span>
          <span class={`status status-replay-${replaying}`} data-testid="status" data-phase={s.phase}>
            {t(`replay.status.${replaying}`)}
          </span>
          <LanguageSwitch lang={lang} />
          <ThemeSwitch theme={theme} />
          <button type="button" class="btn btn-menu" data-testid="replay-close" onClick={replay.onClose}>
            <CloseIcon />
            <span>{t("replay.back")}</span>
          </button>
        </div>
      ) : (
        <div class="run">
          <span class={`status status-${state}`} data-testid="status" data-phase={s.phase}>
            {t(`status.${state}`)}
          </span>
          <button type="button" class="glyph-btn" data-testid="btn-pause" disabled={!ready || held} onClick={onPause}>
            <Glyph name={state === "paused" ? "play" : "pause"} />
            <span class="sr-only">{state === "paused" ? t("top.resume") : t("top.pause")}</span>
          </button>
          <button type="button" class="glyph-btn" data-testid="btn-menu" aria-label={t("top.menu")} aria-expanded={menuOpen} aria-controls="game-menu" onClick={onMenu}>
            <Glyph name="menu" />
            <span class="sr-only">{t("top.menu")}</span>
          </button>
        </div>
      )}
    </header>
  );
}
