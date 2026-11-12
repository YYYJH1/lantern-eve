/**
 * The words of the festival night: which closing line an ending gets, whether it has the storyteller, and which false story the storyteller tells.
 * The texts are in the tables of the page (`festival.*`); what is decided here is the choice, from what the ending says happened.
 */
import type { MessageKey } from "../../i18n/index.ts";
import type { EndingView, Festival, Reveal } from "../ending.ts";
import type { Name } from "../scene.ts";

/** The hidden ending that has the storyteller: most of the named townsfolk believe a false story about the bridge. */
export const HIDDEN_LEGEND = "hidden_legend_of_lie";

export const OPENING: MessageKey = "festival.open";

/**
 * The closing line of the night. It says what the night really was: whether there was a way across (the bridge or the lane) and whether the two
 * families were together. A full night, which is bridge and peace and the truth told, has a line of its own.
 */
export function closingKey(festival: Pick<Festival, "route" | "together">, endingId: string): MessageKey {
  if (festival.route === "none") return festival.together ? "festival.close.noWayTogether" : "festival.close.noWayApart";
  if (endingId === "ending_full" && festival.route === "bridge" && festival.together) return "festival.close.full";
  if (festival.route === "bridge") return festival.together ? "festival.close.bridgeTogether" : "festival.close.bridgeApart";
  return festival.together ? "festival.close.laneTogether" : "festival.close.laneApart";
}

/** Every closing line, for the tests. */
export const CLOSING_KEYS: readonly MessageKey[] = [
  "festival.close.full",
  "festival.close.bridgeTogether",
  "festival.close.laneTogether",
  "festival.close.bridgeApart",
  "festival.close.laneApart",
  "festival.close.noWayTogether",
  "festival.close.noWayApart",
];

/** Whether the night has the storyteller at the teahouse door. */
export const hasStoryteller = (ending: Pick<EndingView, "hidden">): boolean => ending.hidden.some((tag) => tag.id === HIDDEN_LEGEND);

/**
 * The false story that spread: of the versions of a story that are not true, the one that most people hold at the end, and among those that are
 * held by as many, the one that was told most often and then the one told last. A version nobody was told and nobody holds did not spread. Null when
 * the reveal has none (an ending that is known by its frame only has no reveal), and the storyteller then tells how the bridge broke without saying it.
 */
export function falseStory(reveal: Reveal | null): Name | null {
  let best: { name: Name; held: number; told: number; last: number } | null = null;
  for (const chain of reveal?.chains ?? []) {
    // Where the chain does not say which versions are true, none of them can be called false.
    if (chain.trueVersions.length === 0) continue;
    const truth = new Set(chain.trueVersions);
    for (const [prop, name] of Object.entries(chain.texts)) {
      if (truth.has(prop)) continue;
      const tellings = chain.told.filter((telling) => telling.prop === prop);
      const held = chain.held[prop] ?? 0;
      if (held === 0 && tellings.length === 0) continue;
      const last = tellings.reduce((most, telling) => Math.max(most, telling.tick), 0);
      const here = { name, held, told: tellings.length, last };
      if (best === null || here.held > best.held || (here.held === best.held && (here.told > best.told || (here.told === best.told && here.last > best.last)))) best = here;
    }
  }
  return best?.name ?? null;
}
