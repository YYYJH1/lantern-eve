/**
 * The list of model calls on the page. The host sends the records that changed in each call of
 * the core (`model-calls`), and the page keeps the newest ones, newest first. The calls it lets go
 * of are still counted in the totals, so that what the list adds up to stays what the game spent.
 */
import { MAX_CALLS } from "../shared/model-calls.ts";
import type { ModelCallRecord } from "../shared/protocol.ts";

export interface CallLog {
  /** Counts the messages taken in, so that a view can tell whether the list moved. */
  version: number;
  /** The newest call first. At most `MAX_CALLS`. */
  list: ModelCallRecord[];
  /** The calls that were let go of to keep the list short, and what they cost. */
  dropped: { count: number; cost: number };
}

export function emptyLog(): CallLog {
  return { version: 0, list: [], dropped: { count: 0, cost: 0 } };
}

/**
 * Takes in a message of the host. A record of a call the list holds replaces it where it stands, a
 * record of a new call goes to the top. `replace` starts the list again from the records, which the
 * host sends oldest first.
 */
export function applyCalls(log: CallLog, replace: boolean, calls: readonly ModelCallRecord[]): void {
  log.version++;
  if (replace) {
    log.list = [];
    log.dropped = { count: 0, cost: 0 };
  }
  for (const call of calls) {
    const at = log.list.findIndex((known) => known.id === call.id);
    if (at >= 0) log.list[at] = call;
    else log.list.unshift(call);
  }
  while (log.list.length > MAX_CALLS) {
    const gone = log.list.pop();
    if (gone === undefined) break;
    log.dropped.count++;
    log.dropped.cost += gone.cost ?? 0;
  }
}

export interface CallTotals {
  /** Every call the page has heard of, the dropped ones too. */
  count: number;
  /** In flight now. */
  pending: number;
  /** Turned into a line from the script, which never went out. */
  templated: number;
  /** Moved down to a lower tier than the one asked for (a script line is the last step of that). */
  moved: number;
  /** What the core booked for the calls, in micro-yuan. Null for a game that has no prices. */
  booked: number | null;
  /** The money held for the calls in flight, in micro-yuan. */
  held: number;
}

export function callTotals(log: CallLog): CallTotals {
  let pending = 0;
  let templated = 0;
  let moved = 0;
  let booked = log.dropped.cost;
  let priced = log.dropped.cost > 0;
  let held = 0;
  for (const call of log.list) {
    if (call.status === "pending") {
      pending++;
      held += call.hold ?? 0;
    }
    if (call.status === "template") templated++;
    if (call.asked !== call.tier) moved++;
    if (call.cost !== null) {
      booked += call.cost;
      priced = true;
    }
  }
  return {
    count: log.list.length + log.dropped.count,
    pending,
    templated,
    moved,
    booked: priced || log.list.length === 0 ? booked : null,
    held,
  };
}
