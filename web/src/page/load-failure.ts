/**
 * A saved game that cannot be loaded is told to the player in plain words. A save is a replay that the game rebuilds and checks against the hashes it
 * was saved with, so a save made by another version of the game (its content, or what the core keeps in its state, is not the same) does not come out
 * the same, and the host refuses it with a code. This module tells that cause from the others. It decides nothing in the game.
 */

/** Why a save could not be loaded, as far as the player can do something about it. */
export type LoadFailure = "version" | "other";

/**
 * The codes of the host that say the save was read and does not replay here: the hashes differ, the core's format is another, the core refuses what was
 * recorded, or counts its ticks another way. A save that is not there, a host that is busy and a save that is not a replay at all are other causes.
 */
const VERSION_CODES: ReadonlySet<string> = new Set(["hash_mismatch", "unsupported_format", "replay_failed", "tick_mismatch"]);

/** What kind of failure a refused or thrown load is, from the code that the host answered with (`HostCallError`). */
export function loadFailureOf(err: unknown): LoadFailure {
  const code = typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
  return VERSION_CODES.has(code) ? "version" : "other";
}
