/**
 * The numbers of the side panel, read from the `hud` object of the frame. The core fills the
 * object in as the numbers come to exist, and the panel shows a dash for each value
 * that is not there yet. A key may be written under any of its names below.
 *
 *   promised     households that promised to come (an integer)
 *   turnout      the expected turnout (an integer)
 *   bridge       {"done": workers on the job, "need": workers it takes, "percent"?: the work done,
 *                 "hours"?: the work hours done, "hours_need"?: the work hours it takes,
 *                 "lacking"?: an item id or {"zh", "en"}, "state"?: broken, repairing, mended or detour},
 *                 or a number, the percent that is done
 *   reputation   the player's standing, from 0 to 3 stars (a value above 3 is read as a percent)
 *   cost         what the game has cost so far, in millionths of a yuan (the budget gate calls it `spent`)
 *   cap          what the game may cost, in millionths of a yuan
 *   stage        how far the budget gate has cut the models down: 0 none, 1 no strong model, 2 no cloud
 *   held         the money held for the model calls in flight, in millionths of a yuan
 *   cloud        whether the host last said that the cloud can be reached (true until it says not)
 *   local        whether the host last said that a local model is there (false until it says so)
 *   verbs        the verbs the player can use now, a list of ids
 *   pledges      the promises still open, [{id, to: {zh, en, id}, what, item, amount, due}]: `what` is
 *                stall, role, wage or slot, `item` which one (front or back, a role, a slot), `amount`
 *                the coins of a wage, and `due` the game day by which it has to be kept
 *   resources    what the manager can still promise: {stall_front, stall_back, roles: [role ids],
 *                slots: ["1", ...], purse: coins}
 */
import { type Name, readName } from "./scene.ts";

export interface BridgeProgress {
  done: number | null;
  need: number | null;
  percent: number | null;
  /** Work hours done and work hours it takes. */
  hours: number | null;
  hoursNeed: number | null;
  lacking: Name | null;
  /** An item id, when the core names the missing item by its id only. */
  lackingId: string | null;
  state: string | null;
}

/** A promise of the manager that is still open. */
export interface Pledge {
  id: string;
  /** Whom it was made to. */
  to: Name;
  what: string;
  item: string;
  /** The coins of a wage, else 0. */
  amount: number;
  /** The game day by which it has to be kept. */
  due: number;
}

/** What the manager can still promise. */
export interface Resources {
  stallFront: number;
  stallBack: number;
  /** Ids of the roles of honour that are not promised. */
  roles: string[];
  /** The places of the programme that are not promised, "1" being the first. */
  slots: string[];
  /** Coins of wages left. */
  purse: number;
}

export interface HudValues {
  promised: number | null;
  turnout: number | null;
  bridge: BridgeProgress | null;
  /** From 0 to 3. */
  reputation: number | null;
  /** In yuan. */
  cost: number | null;
  /** In yuan. */
  cap: number | null;
  stage: number | null;
  /** The budget in millionths of a yuan, as the core counts it: settled, held for the calls in flight, and the cap. */
  spentMicro: number | null;
  heldMicro: number | null;
  capMicro: number | null;
  /** What the host last said. Null where the frame does not say (the demo world). */
  cloud: boolean | null;
  local: boolean | null;
  /** Null when the frame does not say (the demo world, a core before the promises). */
  pledges: Pledge[] | null;
  resources: Resources | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

function firstOf(hud: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) if (hud[name] !== undefined && hud[name] !== null) return hud[name];
  return null;
}

function readBridge(value: unknown): BridgeProgress | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { done: null, need: null, percent: Math.min(100, Math.max(0, Math.round(value))), hours: null, hoursNeed: null, lacking: null, lackingId: null, state: null };
  }
  if (!isRecord(value)) return null;
  const lacking = firstOf(value, ["lacking", "missing", "short"]);
  return {
    done: int(firstOf(value, ["done", "workers", "have"])),
    need: int(firstOf(value, ["need", "required", "of"])),
    percent: int(value.percent) === null ? null : Math.min(100, Math.max(0, int(value.percent) ?? 0)),
    hours: int(value.hours),
    hoursNeed: int(value.hours_need),
    lacking: typeof lacking === "string" ? null : isRecord(lacking) ? readName(lacking) : null,
    lackingId: typeof lacking === "string" ? lacking : null,
    state: typeof value.state === "string" ? value.state : null,
  };
}

/**
 * How the festival can walk to the far bank, from the state of the bridge (`hud.bridge.state`): over the mended bridge, by the detour, or not at all yet
 * (the bridge is broken or is being mended). Null where the frame does not say. The turnout of the festival goes with it.
 */
export type Passage = "mended" | "detour" | "none";

export function passageOf(state: string | null): Passage | null {
  if (state === "mended" || state === "detour") return state;
  return state === "broken" || state === "repairing" ? "none" : null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function readPledges(value: unknown): Pledge[] | null {
  if (!Array.isArray(value)) return null;
  const out: Pledge[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    const to = isRecord(raw.to) ? raw.to : {};
    out.push({
      id: raw.id,
      to: readName(to, typeof to.id === "string" ? to.id : ""),
      what: typeof raw.what === "string" ? raw.what : "",
      item: typeof raw.item === "string" ? raw.item : "",
      amount: Math.max(0, int(raw.amount) ?? 0),
      due: int(raw.due) ?? 0,
    });
  }
  return out;
}

function readResources(value: unknown): Resources | null {
  if (!isRecord(value)) return null;
  return {
    stallFront: Math.max(0, int(value.stall_front) ?? 0),
    stallBack: Math.max(0, int(value.stall_back) ?? 0),
    roles: strings(value.roles),
    slots: strings(value.slots),
    purse: Math.max(0, int(value.purse) ?? 0),
  };
}

export function readHud(hud: Record<string, unknown>): HudValues {
  const reputation = int(firstOf(hud, ["reputation", "standing"]));
  const cost = int(firstOf(hud, ["cost", "spent"]));
  const cap = int(hud.cap);
  return {
    pledges: readPledges(hud.pledges),
    resources: readResources(hud.resources),
    promised: int(firstOf(hud, ["promised", "promises", "committed"])),
    turnout: int(firstOf(hud, ["turnout", "expected", "expected_turnout"])),
    bridge: readBridge(firstOf(hud, ["bridge"])),
    reputation: reputation === null ? null : Math.min(3, Math.max(0, reputation > 3 ? Math.round((reputation / 100) * 3) : reputation)),
    cost: cost === null ? null : cost / 1_000_000,
    cap: cap === null || cap <= 0 ? null : cap / 1_000_000,
    stage: int(hud.stage),
    spentMicro: cost,
    heldMicro: int(hud.held),
    capMicro: cap,
    cloud: typeof hud.cloud === "boolean" ? hud.cloud : null,
    local: typeof hud.local === "boolean" ? hud.local : null,
  };
}

/** The verbs that the frame offers, if it says: `hud.verbs`, a list of ids. None until it does. */
export function readVerbs(hud: Record<string, unknown>): Set<string> {
  const verbs = hud.verbs;
  return new Set(Array.isArray(verbs) ? verbs.filter((v): v is string => typeof v === "string") : []);
}
