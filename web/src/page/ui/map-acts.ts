import { hasMessage, type MessageKey, t } from "../../i18n/index.ts";
import type { OffReason } from "../hud.ts";

/**
 * The acts of the manager on the map, outside a talk: listen in on two people who talk, look closely at a thing within reach, call for helpers, and speak
 * up where there is a meeting. Each is there from the start. One that cannot be done now is shown grey and says why, on hover and when pressed, in the
 * core's own reason (`hud.verbs_off`). None of them shows minutes.
 */
export const MAP_ACTS = ["listen", "look", "rally", "speak"] as const;
export type MapAct = (typeof MAP_ACTS)[number];

/** The verb the core lists for each act. Speaking in public is listed under two names, and either is the act. */
export const VERBS_OF: Readonly<Record<MapAct, readonly string[]>> = { listen: ["listen"], look: ["look"], rally: ["rally"], speak: ["speak", "speak_publicly"] };

export const LABEL: Readonly<Record<MapAct, MessageKey>> = { listen: "act.listen", look: "act.look", rally: "act.rally", speak: "act.speak" };
export const HINT: Readonly<Record<MapAct, MessageKey>> = { listen: "act.listen.hint", look: "act.look.hint", rally: "act.rally.hint", speak: "act.speak.hint" };

/** The words of a reason for an act: the act's own where it has them, else the reason's. */
export function offWords(act: MapAct, reason: OffReason): string {
  const own = `act.off.${act}.${reason}`;
  if (hasMessage(own)) return t(own);
  const common = `act.off.${reason}`;
  return hasMessage(common) ? t(common) : t("act.off.other");
}

/** Whether the frame offers the act, and if it does not, why: the reason of the first of its verbs that has one. */
export function actState(act: MapAct, enabled: ReadonlySet<string>, off: ReadonlyMap<string, OffReason>): { on: boolean; reason: OffReason | null } {
  if (VERBS_OF[act].some((verb) => enabled.has(verb))) return { on: true, reason: null };
  for (const verb of VERBS_OF[act]) {
    const reason = off.get(verb);
    if (reason !== undefined) return { on: false, reason };
  }
  return { on: false, reason: null };
}
