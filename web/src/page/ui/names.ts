import { type Lang, pick } from "../../i18n/index.ts";
import type { Scene } from "../scene.ts";

/** The name of a place in the scene, or null where the scene does not have it. */
export function placeName(scene: Scene | null, lang: Lang, id: string | null): string | null {
  if (id === null || id === "") return null;
  const found = scene?.places.find((p) => p.id === id);
  return found === undefined ? null : pick(found.name, lang);
}

/** The name of a person of the scene, else the id. */
export function personName(scene: Scene | null, lang: Lang, id: string): string {
  const found = scene?.cast.find((p) => p.id === id);
  return found === undefined ? id : pick(found.name, lang);
}

/** The name of a thing of the story, an item or a place, by the ids the scene knows. */
export function thingName(scene: Scene | null, lang: Lang, id: string): string {
  const named = scene?.player?.things.find((th) => th.id === id)?.name ?? scene?.items.get(id) ?? scene?.places.find((p) => p.id === id)?.name;
  return named === undefined ? id : pick(named, lang);
}

/** The name of an item for the middle of a sentence: the scene names it for a list, so the English has a capital that does not belong there. */
export function itemInSentence(scene: Scene | null, lang: Lang, id: string): string {
  const name = thingName(scene, lang, id);
  return lang === "en" ? name.toLowerCase() : name;
}
