/**
 * What the budget of the game means for the player, said plainly. The core reports the money
 * (`spent`, `held`, `cap`), the `stage` of the budget gate and what the host last said about the
 * cloud and the local model (see core/lantern_core/world/bridge/budget.py). The stage alone is a
 * number from 0 to 2. Here it becomes what the player should know: the strong model is off from 70
 * percent of the cap and every cloud model from 90 percent, the cloud may be off for another
 * reason, and in each case something else answers.
 */
import type { MessageKey } from "../i18n/index.ts";
import type { HudValues } from "./hud.ts";

/** Where the gate switches the strong model off and the cloud off, in percent of the cap. */
export const STRONG_OFF_PERCENT = 70;
export const CLOUD_OFF_PERCENT = 90;

export interface BudgetView {
  /** Money settled and money held for calls in flight, in percent of the cap, at most 100. */
  spentPercent: number;
  heldPercent: number;
  stage: 0 | 1 | 2;
  cloud: boolean;
  local: boolean;
}

/** The budget as the frame reports it, or null where the game has none (the demo world). */
export function readBudget(hud: HudValues): BudgetView | null {
  const cap = hud.capMicro;
  if (cap === null || cap <= 0 || hud.stage === null) return null;
  const percent = (micro: number | null): number => Math.min(100, Math.max(0, ((micro ?? 0) / cap) * 100));
  const spent = percent(hud.spentMicro);
  return {
    spentPercent: spent,
    heldPercent: Math.min(100 - spent, percent(hud.heldMicro)),
    stage: hud.stage >= 2 ? 2 : hud.stage === 1 ? 1 : 0,
    // A host that has said nothing has not said that the cloud is down.
    cloud: hud.cloud !== false,
    local: hud.local === true,
  };
}

/** The sentences the budget block says, as keys of the message tables, most important first. */
export function budgetNotes(view: BudgetView): MessageKey[] {
  const notes: MessageKey[] = [];
  if (!view.cloud) notes.push("budget.cloudDown");
  if (view.stage === 2) notes.push("budget.cloudOff");
  else if (view.stage === 1) notes.push("budget.strongOff");
  if (!view.cloud || view.stage === 2) notes.push(view.local ? "budget.insteadLocal" : "budget.insteadScript");
  if (notes.length === 0) notes.push("budget.allOn");
  return notes;
}
