import { expect, test } from "@playwright/test";
import { applyCalls, callTotals, emptyLog } from "../../src/page/calls.ts";
import { MAX_CALLS } from "../../src/shared/model-calls.ts";
import type { ModelCallRecord } from "../../src/shared/protocol.ts";

function call(id: string, extra: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    id,
    tick: 1,
    category: "reply",
    asked: "cheap",
    tier: "cheap",
    reason: null,
    model: "m",
    hold: 10,
    status: "pending",
    code: null,
    latency_ms: null,
    usage: null,
    cost: null,
    settled: null,
    late: false,
    voided: null,
    ...extra,
  };
}

const ids = (log: ReturnType<typeof emptyLog>): string[] => log.list.map((c) => c.id);

test.describe("the list of calls on the page", () => {
  test("puts a new call at the top and updates a known one where it stands", () => {
    const log = emptyLog();
    applyCalls(log, false, [call("a")]);
    applyCalls(log, false, [call("b")]);
    applyCalls(log, false, [call("c"), call("a", { status: "ok", cost: 5 })]);
    expect(ids(log)).toEqual(["c", "b", "a"]);
    expect(log.list[2]).toMatchObject({ status: "ok", cost: 5 });
  });

  test("starts again from a whole list that comes oldest first, and shows it newest first", () => {
    const log = emptyLog();
    applyCalls(log, false, [call("x")]);
    applyCalls(log, true, [call("a"), call("b"), call("c")]);
    expect(ids(log)).toEqual(["c", "b", "a"]);
    applyCalls(log, true, []);
    expect(log.list).toEqual([]);
  });

  test("keeps the newest calls, counts the others, and still adds up to what the core booked", () => {
    const log = emptyLog();
    for (let i = 0; i < MAX_CALLS + 7; i++) applyCalls(log, false, [call(`c${i}`, { status: "ok", cost: 3 })]);
    expect(log.list).toHaveLength(MAX_CALLS);
    expect(log.list[0]?.id).toBe(`c${MAX_CALLS + 6}`);
    expect(log.dropped).toEqual({ count: 7, cost: 21 });
    expect(callTotals(log)).toMatchObject({ count: MAX_CALLS + 7, booked: 3 * (MAX_CALLS + 7), pending: 0 });
  });

  test("counts what is in flight, what was turned into a line, and what was moved down", () => {
    const log = emptyLog();
    applyCalls(log, false, [
      call("a", { hold: 30 }),
      call("b", { hold: 12 }),
      call("c", { status: "ok", cost: 9 }),
      call("d", { asked: "strong", tier: "cheap", reason: "budget", status: "ok", cost: 4 }),
      call("e", { asked: "cheap", tier: "template", reason: "cloud_down", status: "template", hold: 0, cost: 0 }),
    ]);
    expect(callTotals(log)).toEqual({ count: 5, pending: 2, templated: 1, moved: 2, booked: 13, held: 42 });
  });

  test("has no money to add up for a game that has no prices, and none for an empty list", () => {
    const log = emptyLog();
    expect(callTotals(log).booked).toBe(0);
    applyCalls(log, false, [call("a", { status: "ok", cost: null })]);
    expect(callTotals(log).booked).toBeNull();
  });
});
