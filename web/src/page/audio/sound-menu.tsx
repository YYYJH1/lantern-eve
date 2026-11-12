import { useEffect, useState } from "preact/hooks";
import { t } from "../../i18n/index.ts";
import { type SoundPrefs, soundPrefs, VOLUME_IDS } from "./settings.ts";

/** Re-renders the component whenever the choices about sound change. */
function useSoundPrefs(prefs: SoundPrefs): void {
  const [, setVersion] = useState(0);
  useEffect(() => prefs.subscribe(() => setVersion((n) => n + 1)), [prefs]);
}

/**
 * The part of the menu that is about sound: one switch and the volumes of the ambience, the music and the effects. A choice is kept
 * in the browser and takes hold at once, and the volumes can be moved while the switch is off.
 */
export function SoundSection() {
  const prefs = soundPrefs();
  useSoundPrefs(prefs);
  const value = prefs.value;
  return (
    <section class="menu-section" data-testid="menu-sound">
      <h3 class="menu-heading">{t("sound.title")}</h3>
      <label class="setting setting-menu" data-testid="sound-switch">
        <input type="checkbox" checked={value.on} onChange={(event) => prefs.setOn((event.target as HTMLInputElement).checked)} />
        <span class="setting-text">
          <strong>{t("sound.on")}</strong>
          <span>{t("sound.on.help")}</span>
        </span>
      </label>
      {VOLUME_IDS.map((id) => {
        const percent = Math.round(value[id] * 100);
        const name = t(`sound.${id}`);
        return (
          <label key={id} class="sound-volume" data-testid={`sound-${id}`}>
            <span class="sound-volume-name">{name}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              aria-label={name}
              aria-valuetext={t("sound.volume", { name, n: percent })}
              onInput={(event) => prefs.setVolume(id, Number((event.target as HTMLInputElement).value) / 100)}
            />
            <span class="sound-volume-value" aria-hidden="true">
              {percent}
            </span>
          </label>
        );
      })}
    </section>
  );
}
