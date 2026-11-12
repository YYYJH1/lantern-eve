/**
 * What the page knows of the people beyond the rows of `people` of the frame (`relations.ts` reads those): the six that the opening page
 * introduces, the moments and places of a meeting or a note, the return a person asked, and the first clause of a role.
 */
import { type Name, type Person, readName, type Scene } from "./scene.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const whole = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback);

/** The six people the opening page introduces, in the order it shows them: the clan elder, Granny Li, her two sons and the Zhou side's two. */
export const OPENING_SIX: readonly string[] = ["zuzhang", "li_laotai", "li_er", "li_da", "zhou_zhanggui", "zhou_huoji"];

/** The six people of the opening page, in the order it shows them, as far as the scene has them. */
export function openingSix(scene: Scene | null): Person[] {
  const cast = scene?.cast ?? [];
  return OPENING_SIX.map((id) => cast.find((person) => person.id === id)).filter((person): person is Person => person !== undefined);
}

/** A moment and, for a meeting or a note, the place it was at: `place` is the id of a place of the scene, or null for the street. */
export interface Stamp {
  tick: number;
  day: number;
  hour: number;
  minute: number;
  place: string | null;
}

/** The return a person asked in a talk, and the request they turned down for want of weight. */
export interface Asked {
  what: Name;
  /** The request that they turned down, in words that name them. */
  forRequest: Name;
  day: number;
  hour: number;
  minute: number;
}

export function readStamp(value: unknown): Stamp | null {
  if (!isRecord(value) || typeof value.tick !== "number") return null;
  return { tick: whole(value.tick), day: Math.max(1, whole(value.day, 1)), hour: whole(value.hour), minute: whole(value.minute), place: typeof value.place === "string" && value.place !== "" ? value.place : null };
}

export function readAsked(value: unknown): Asked | null {
  if (!isRecord(value)) return null;
  const what = readName(value.what);
  if (what.zh === "" && what.en === "") return null;
  return { what, forRequest: readName(value.for), day: Math.max(1, whole(value.day, 1)), hour: whole(value.hour), minute: whole(value.minute) };
}

/** The part of a role that says what the person is, before the comma that goes on to say more: "周家掌柜，管木料" is 周家掌柜. */
export function firstClause(role: Name): Name {
  const cut = (text: string, mark: RegExp): string => (text.split(mark)[0] ?? text).trim();
  return { zh: cut(role.zh, /[，,]/), en: cut(role.en, /,\s/) };
}
