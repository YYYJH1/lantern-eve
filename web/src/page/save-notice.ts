/**
 * A save that cannot be made is told to the player, and not to the console alone. The page says so in its own words, for an automatic
 * save and for one the player asked for in the menu, once for each kind of failure until a save is made again: the morning after a
 * morning of the same trouble is not a new notice every time, and a trouble that has passed is news again when it comes back.
 *
 * This module has the kinds, how a failure is told from what was thrown, and the memory of what was said. It decides nothing in the game.
 */
import { t } from "../i18n/index.ts";

/** What went wrong, as far as the player can do something about it. */
export type SaveFailure = "storage" | "full" | "server" | "other";

/** The kinds, each with words of its own (`save.failed.<kind>`). */
export const SAVE_FAILURES: readonly SaveFailure[] = ["storage", "full", "server", "other"];

/** The browser's own names for what a store of saves can throw (IndexedDB), apart from the one for a full store. */
const STORAGE_ERRORS = /\b(UnknownError|AbortError|InvalidStateError|TransactionInactiveError|SecurityError|NotAllowedError|ConstraintError|VersionError|NotFoundError|ReadOnlyError)\b/;

/**
 * What kind of failure a refused or thrown save is. The host answers a call with a code and a message (`HostCallError`): `unsupported` is the
 * server host, which keeps no saves, `storage` is a store the browser would not open, and what the store throws while writing comes with the
 * browser's own name for it in the message (a full store is `QuotaExceededError`). Anything else, a host that is busy or has stopped on an error,
 * is `other`.
 */
export function failureOf(err: unknown): SaveFailure {
  const code = typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "";
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (code === "unsupported") return "server";
  if (/quota/i.test(message)) return "full";
  if (code === "storage" || STORAGE_ERRORS.test(message)) return "storage";
  return "other";
}

/** The words for a failure, in the language of the page: what happened, and what the player can do. */
export const failureText = (kind: SaveFailure): string => t(`save.failed.${kind}`);

/**
 * What the page has said of saves that failed: each kind once, until a save is made again, whoever asked for it. A kind counts as said only once its
 * notice was on screen (over the map, or in the open menu): a notice that is still waiting behind a card, or that came to a menu that was shut, has told
 * nobody, and the next failure of that kind is news.
 */
export class SaveNotices {
  private readonly said = new Set<SaveFailure>();

  /** A save failed: whether the player is yet to be told, which is so unless they were told of this kind since the last save that was made. */
  due(kind: SaveFailure): boolean {
    return !this.said.has(kind);
  }

  /** The notice of this kind was on screen: the player was told. */
  told(kind: SaveFailure): void {
    this.said.add(kind);
  }

  /** A save was made, so the trouble is over: the next failure is news again. */
  made(): void {
    this.said.clear();
  }
}
