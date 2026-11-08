/**
 * The words of the button that skips to the next thing, as functions of what the page reads (`skip.ts`): where the run will stop,
 * in the way the window text of the task card says a time, and what the button says while a run is going. The button (`skip-button.tsx`)
 * draws them; the unit tests read them here, with no page.
 */
import { type Lang, t } from "../../i18n/index.ts";
import type { SkipState, SkipTime } from "../skip.ts";
import { clockText, dayLabel } from "./format.ts";

/** A moment of the game as a person says it: "Day 5, 17:00", 第五日 17:00. */
export function momentText(lang: Lang, at: SkipTime): string {
  return t("skip.when", { day: dayLabel(lang, at.day), clock: clockText(at.hour, at.minute) });
}

/**
 * What the button says: where the run will stop where the frame tells it ("Skip to Day 5, 17:00"), "Skip to the next thing" where it
 * does not (no task is open, or none has a window ahead), and "Stop skipping" while a run is going.
 */
export function skipLabel(lang: Lang, skip: Pick<SkipState, "offer" | "running">): string {
  if (skip.running) return t("skip.stop");
  const until = skip.offer?.until ?? null;
  return until === null ? t("skip.next") : t("skip.until", { when: momentText(lang, until) });
}

/** The short words of the button for a bar that is short of room: "Skip", and "Stop" while a run is going. */
export const skipShort = (skip: Pick<SkipState, "running">): string => t(skip.running ? "skip.stop.short" : "skip.short");
