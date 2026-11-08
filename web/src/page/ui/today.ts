/**
 * The line that ends the card of the morning: what is to be done today. It is made from the tasks of the frame, so it names only what the
 * player has been told.
 */
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { Scene } from "../scene.ts";
import { isLive, type SliceFrame, type Task, trackedTask } from "../slice.ts";
import { placeName } from "./names.ts";
import { whenWhere } from "./slip-text.ts";

/** The task of today: the one that is followed if it is still to be done, else the most urgent that is (the frame lists them most urgent first). */
export function todayTask(slice: SliceFrame): Task | null {
  const followed = trackedTask(slice.tasks);
  if (followed !== null && isLive(followed)) return followed;
  return slice.tasks?.list.find(isLive) ?? null;
}

/** "Today: Ask Li Da for another batch of bamboo, Li Family House, Day 2 08:00 to 17:00", with the time and the place where the task has them. Null where there is no task. */
export function todayLine(slice: SliceFrame, scene: Scene | null, lang: Lang): string | null {
  const task = todayTask(slice);
  if (task === null) return null;
  const words = pick(task.text, lang);
  if (task.window === null) return t("recap.today", { task: words });
  return t("recap.today.when", { task: words, when: whenWhere(lang, task.window, placeName(scene, lang, task.window.place)) });
}
