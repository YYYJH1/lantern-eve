/**
 * The viewer's choices about sound: one switch and three volumes (the ambience, the music, the effects). They are kept in the
 * browser like the language and the theme, and a browser that blocks storage still gets working controls for the visit. The sound
 * is on at a middle volume until the viewer says otherwise, and it starts only after the first press of Start or Continue.
 */
import { readPref, writePref } from "../storage.ts";

export interface SoundSettings {
  on: boolean;
  /** Each volume, 0 to 1. */
  ambience: number;
  music: number;
  effects: number;
}

export type VolumeId = "ambience" | "music" | "effects";
export const VOLUME_IDS: readonly VolumeId[] = ["ambience", "music", "effects"];

export const DEFAULT_SETTINGS: Readonly<SoundSettings> = { on: true, ambience: 0.7, music: 0.7, effects: 0.7 };

/** A volume read from storage: a whole number from 0 to 100, as the slider has it. Anything else is not a volume. */
export function readVolume(text: string | null): number | null {
  if (text === null || !/^\d{1,3}$/.test(text)) return null;
  const percent = Number(text);
  return percent <= 100 ? percent / 100 : null;
}

export function readSettings(): SoundSettings {
  const switchText = readPref("sound");
  return {
    on: switchText === "off" ? false : switchText === "on" ? true : DEFAULT_SETTINGS.on,
    ambience: readVolume(readPref("sound.ambience")) ?? DEFAULT_SETTINGS.ambience,
    music: readVolume(readPref("sound.music")) ?? DEFAULT_SETTINGS.music,
    effects: readVolume(readPref("sound.effects")) ?? DEFAULT_SETTINGS.effects,
  };
}

export class SoundPrefs {
  private current: SoundSettings;
  private readonly listeners = new Set<() => void>();

  constructor(initial: SoundSettings = readSettings()) {
    this.current = { ...initial };
  }

  get value(): Readonly<SoundSettings> {
    return this.current;
  }

  /** The switch, as a choice of the viewer: it is applied and remembered. */
  setOn(on: boolean): void {
    if (on === this.current.on) return;
    this.current = { ...this.current, on };
    writePref("sound", on ? "on" : "off");
    this.changed();
  }

  /** A volume, 0 to 1, as a choice of the viewer: it is applied and remembered as a whole percent. */
  setVolume(id: VolumeId, volume: number): void {
    const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100);
    if (percent / 100 === this.current[id]) return;
    this.current = { ...this.current, [id]: percent / 100 };
    writePref(`sound.${id}`, String(percent));
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

let shared: SoundPrefs | null = null;

/** The one set of choices of the page: the menu changes it and the sound follows it. */
export function soundPrefs(): SoundPrefs {
  shared ??= new SoundPrefs();
  return shared;
}
