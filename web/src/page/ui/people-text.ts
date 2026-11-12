import { type Lang, pick, t } from "../../i18n/index.ts";
import type { Stamp } from "../people.ts";
import type { Relation } from "../relations.ts";
import type { Name, Scene } from "../scene.ts";
import { clockText, dayLabel } from "./format.ts";
import { placeName } from "./names.ts";

/** A moment of the game as a person writes it in a book: "第一天 09:20" or "Day 1 09:20". */
export function whenWords(lang: Lang, when: { day: number; hour: number; minute: number }): string {
  return `${dayLabel(lang, when.day)} ${clockText(when.hour, when.minute)}`;
}

/** When and where something happened: "第一天 09:20，在李家宅", and in the street where it was at no place of the town. */
export function stampWords(scene: Scene | null, lang: Lang, stamp: Stamp): string {
  const when = whenWords(lang, stamp);
  const place = placeName(scene, lang, stamp.place);
  return place === null ? t("people.at.street", { when }) : t("people.at", { when, place });
}

/** The names of some small things, in the language of the page and in the order given: "点心、灯纸" and "pastries, lantern paper". */
export function itemsWords(scene: Scene | null, lang: Lang, ids: readonly string[]): string {
  const named = ids.map((id) => {
    const name: Name | undefined = scene?.gifts.get(id);
    return name === undefined ? id : pick(name, lang);
  });
  return named.join(lang === "zh" ? "、" : ", ");
}

/** The people the player has talked with, in the order they first met them. A person whose first talk the core did not keep comes last, in the order of the cast. */
export function knownPeople(rows: readonly Relation[] | null): Relation[] {
  const known = (rows ?? []).filter((row) => row.known);
  const order = new Map(known.map((row, index) => [row.id, index]));
  const first = (row: Relation): number => row.met[0]?.tick ?? Number.POSITIVE_INFINITY;
  return [...known].sort((a, b) => first(a) - first(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Whether a role already names the family, so that the family is not said again beside it: 李家老太太 names 李家, and "Head of the Zhou shop" names the Zhou family. */
export function roleNamesFamily(role: string, family: Name): boolean {
  if (family.zh !== "" && role.includes(family.zh)) return true;
  const word = family.en.split(/\s+/)[0] ?? "";
  return word !== "" && new RegExp(`\\b${word.replace(/[^\w]/g, "")}\\b`, "i").test(role);
}

