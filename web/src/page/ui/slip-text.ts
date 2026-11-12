/**
 * The words of the slip of the task in hand that are made of parts: when and where something can be done, as a person says it
 * ("茶馆，酉时 17:00 到 19:00", "Teahouse, 17:00 to 19:00"). The slip (`taskcard.tsx`) draws them; the unit tests read them here, with
 * no page. A clock time is always in digits, and the day is left out when it is today.
 */
import { type Lang, t } from "../../i18n/index.ts";
import { shichen } from "../frame.ts";
import type { BridgeProgress } from "../hud.ts";
import type { Scene } from "../scene.ts";
import type { Task } from "../slice.ts";
import { familyName } from "./board-text.ts";
import { dayLabel, hourText } from "./format.ts";
import { count } from "./paper-text.ts";

export interface SlipWindow {
  day: number;
  from: number;
  to: number;
}

/** The hours of a window: "酉时 17:00 到 19:00" in Chinese, "17:00 to 19:00" in English, which has no double hours. */
export function spanWords(lang: Lang, win: Pick<SlipWindow, "from" | "to">): string {
  const part = lang === "zh" ? `${shichen(win.from)}时 ` : "";
  return t("slip.span", { part, from: hourText(win.from), to: hourText(win.to) });
}

/** Where and when: the place first (where there is one), then the day unless it is `today`, then the hours. */
export function whenWhere(lang: Lang, win: SlipWindow, place: string | null, today: number | null = null): string {
  const day = today !== null && win.day === today ? "" : `${dayLabel(lang, win.day)} `;
  const span = spanWords(lang, win);
  return place === null || place === "" ? `${day}${span}` : t("slip.when", { place, day, span });
}

/** Where and when for a line of the ledger: the day always, then the hours, then the place: "第四天 辰时 08:00 到 12:00，石桥". */
export function ledgerWhen(lang: Lang, win: SlipWindow, place: string | null): string {
  const day = `${dayLabel(lang, win.day)} `;
  const span = spanWords(lang, win);
  return place === null || place === "" ? `${day}${span}` : t("ledger.when", { day, span, place });
}

// --- What the crew of the bridge still lacks -------------------------------------------------------------

/** The tasks of the slice that are about the crew of the bridge: finding helpers, and the mornings of work that need them. */
const CREW_TASKS: readonly string[] = ["t_helpers", "t_work_3", "t_work_4"];

/** Whether the bridge, as the slip has it, is about its crew: the task asks for helpers (the call, a request to join, a friend to talk round) or is a morning of work. */
export function isCrewTask(task: Task | null): boolean {
  if (task === null || task.job !== "bridge") return false;
  const action = task.action;
  return CREW_TASKS.includes(task.id) || action?.verb === "rally" || action?.request === "join" || action?.request === "persuade";
}

/** How many helpers the crew lacks for the next morning, and the families that have nobody in it. */
export interface CrewShortfall {
  short: number;
  /** The ids of the families with nobody in the crew. */
  families: string[];
}

/** The shortfall the core reports (`hud.bridge.short`, `families_missing`). Null where the crew is complete or the frame does not say. */
export function crewShortfall(bridge: BridgeProgress | null): CrewShortfall | null {
  if (bridge === null || bridge.short === null) return null;
  if (bridge.short <= 0 && bridge.familiesMissing.length === 0) return null;
  return { short: bridge.short, families: bridge.familiesMissing };
}

/** The shortfall in two short sentences: "帮手还差三个。周家还没有人。" The number is the town's way of saying it, and the family is its name. */
export function shortfallWords(lang: Lang, scene: Scene | null, lack: CrewShortfall): string {
  const who = lack.families.map((id) => familyName(scene, lang, id)).join(lang === "zh" ? "和" : " and ");
  const head = lack.short > 0 ? t("crew.short", { n: count(lang, lack.short) }) : "";
  const tail = lack.families.length > 0 ? t("crew.nobody", { family: who }) : "";
  return lang === "zh" ? `${head}${tail}` : [head, tail].filter((part) => part !== "").join(" ");
}
