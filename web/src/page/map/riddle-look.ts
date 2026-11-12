/**
 * How the riddle lantern burns, as numbers: by the hour (the strength of the night's light, 0 by day and 1 at night) and by how many riddles were guessed right.
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */

/** The most riddles that can be guessed right, which is how many steps the lantern has to burn brighter. */
export const STEPS = 5;

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** How the lantern burns: by the hour, and by how many riddles were guessed right. */
export interface RiddleLook {
  /** Whether the lantern is lit (by night, or because a riddle was guessed right). */
  lit: boolean;
  /** The strength of the light that goes round it, from 0. */
  glow: number;
  /** How big that light is, as a share of the common size. */
  size: number;
}

/** What the lantern looks like at the strength of the night's light (0 by day, 1 at night) and with this many riddles guessed right. */
export function lookOf(light: number, level: number): RiddleLook {
  const steps = clamp(Math.trunc(level), 0, STEPS);
  const glow = clamp(0.08 * Math.sign(steps) + light * 0.5 + steps * 0.06, 0, 0.95);
  return { lit: light > 0.15 || steps > 0, glow, size: 1 + steps * 0.05 };
}

