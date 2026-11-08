/**
 * The cases of a named game. The rules of the first game the opening page starts (the slice) can be played at any seed and with any of
 * the stories of the script true: a new game from the menu and "another truth" ask for a seed at random and a story at random, and the
 * page does not say which. This module knows the stories by their ids (the same ones as `variants` in the script, held equal to them by
 * `test/unit/truths.spec.ts`), picks one that is not the one just played where the page knows it, and keeps per viewer whether a game
 * has been played to its end, which is when the opening page offers another truth.
 */
import { readPref, writePref } from "./storage.ts";

/** The stories the script can make true. The core refuses any other id. */
export const VARIANTS = ["v_boat", "v_flood", "v_drunk"] as const;
export type Variant = (typeof VARIANTS)[number];

/** A seed for a game of a case of its own. The core takes any whole number from 0 up to 2^53 - 1. */
export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 2 ** 31);
}

/**
 * A story at random. With `avoid` (the story of the game that was just played, as the ending says it) it is one of the other two,
 * and without it, or with a text that is none of the stories, one of the three.
 */
export function anotherVariant(avoid?: string | null, random: () => number = Math.random): Variant {
  const pool = VARIANTS.filter((variant) => variant !== avoid);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? VARIANTS[0];
}

const FINISHED = "finished";

/**
 * Whether a game was played to its end on this browser before, and if the page then knew the story that was true in it, which. The
 * opening page offers another truth from then on. `null` where no game was finished, or where the browser keeps nothing.
 */
export function readFinished(): { variant: string | null } | null {
  const stored = readPref(FINISHED);
  if (stored === null || stored === "") return null;
  return { variant: (VARIANTS as readonly string[]).includes(stored) ? stored : null };
}

/** Notes that a game reached its end, with the story the ending told if it is known yet (it comes a moment after the end itself). */
export function writeFinished(variant?: string | null): void {
  writePref(FINISHED, variant !== undefined && variant !== null && (VARIANTS as readonly string[]).includes(variant) ? variant : "1");
}
