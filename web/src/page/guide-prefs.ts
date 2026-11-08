/**
 * What the viewer chose about the help the page gives: whether the tutorial of the first day is shown, whether the
 * hints of the world are, whether the summary of the night is, and how much the task card does for the player. All are
 * kept in `localStorage` where the browser allows it (see storage.ts).
 */
import { readPref, writePref } from "./storage.ts";

/** `new` until the viewer has been through the tutorial or has turned it away. */
export type TutorialPref = "new" | "done" | "skipped";

export function readTutorialPref(): TutorialPref {
  const stored = readPref("tutorial");
  return stored === "done" || stored === "skipped" ? stored : "new";
}

export function writeTutorialPref(value: TutorialPref): void {
  writePref("tutorial", value);
}

/** Whether the world signals what is new in it, and the elder comes by when nothing moves. On unless the viewer turned it off. */
export function readHintsOn(): boolean {
  return readPref("hints") !== "off";
}

export function writeHintsOn(on: boolean): void {
  writePref("hints", on ? "on" : "off");
}

/** Whether the summary of the night is shown when the day ends. On unless the viewer turned it off. */
export function readNightOn(): boolean {
  return readPref("night") !== "off";
}

export function writeNightOn(on: boolean): void {
  writePref("night", on ? "on" : "off");
}

/**
 * How much the task card and the bars do for the player. `full` spells out the next step and has a button that does it.
 * `brief` names the goal, what is in the way, why, and the time and place, and leaves the way to the player: the clan elder
 * still gives the next step when asked, and when he comes by.
 */
export type Guidance = "full" | "brief";

export const GUIDANCES: readonly Guidance[] = ["full", "brief"];

/** `full` unless the viewer chose `brief`. */
export function readGuidance(): Guidance {
  return readPref("guidance") === "brief" ? "brief" : "full";
}

export function writeGuidance(value: Guidance): void {
  writePref("guidance", value);
}
