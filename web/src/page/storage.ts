import type { ProviderId } from "../shared/protocol.ts";
import { isProviderId } from "../shared/providers.ts";

/**
 * The one place the page writes a key to disk, and only when the player ticked "remember".
 * Browsers can refuse localStorage (private windows, blocked site data), so every access is
 * wrapped and the page works without it.
 */
const STORAGE_KEY = "lantern.remembered";

export interface Remembered {
  provider: ProviderId;
  key: string;
  model?: string;
}

export function loadRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (isProviderId(value.provider) && typeof value.key === "string" && value.key !== "") {
      return {
        provider: value.provider,
        key: value.key,
        model: typeof value.model === "string" ? value.model : undefined,
      };
    }
  } catch {
    // Unreadable or blocked: treat it as nothing remembered.
  }
  return null;
}

export function remember(value: Remembered): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The key stays in the worker for this session only.
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove.
  }
}

/**
 * Small settings of the viewer (the language, the theme). They are kept in localStorage when the
 * browser allows it and in memory for the rest of the visit when it does not.
 */
const PREF_PREFIX = "lantern.";

export function readPref(name: string): string | null {
  try {
    return localStorage.getItem(PREF_PREFIX + name);
  } catch {
    return null;
  }
}

export function writePref(name: string, value: string): void {
  try {
    localStorage.setItem(PREF_PREFIX + name, value);
  } catch {
    // Blocked storage: the choice holds until the page is closed.
  }
}
