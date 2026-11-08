import { expect, test } from "@playwright/test";
import { browserEntry, browserId, isReplayId, parseReplayHash, refOf, replayHash, serverEntries, sizeText } from "../../src/page/replays.ts";

test.describe("a link to a recording", () => {
  test("names the recording and, for a moment in it, the tick", () => {
    expect(parseReplayHash("#replay=save-3")).toEqual({ id: "save-3", tick: null });
    expect(parseReplayHash("#replay=save-3&tick=540")).toEqual({ id: "save-3", tick: 540 });
    expect(parseReplayHash("replay=20261102T120000Z-seed7-s-ab12cd&tick=0")).toEqual({ id: "20261102T120000Z-seed7-s-ab12cd", tick: 0 });
    expect(replayHash("save-3")).toBe("#replay=save-3");
    expect(replayHash("save-3", 540)).toBe("#replay=save-3&tick=540");
    expect(replayHash("save-3", null)).toBe("#replay=save-3");
    expect(parseReplayHash(replayHash("a.b_c-d", 12))).toEqual({ id: "a.b_c-d", tick: 12 });
  });

  test("carries nothing else: whatever else a hash holds is left out of what is read, and never put in", () => {
    expect(parseReplayHash("#replay=save-3&tick=7&key=sk-123&provider=bailian")).toEqual({ id: "save-3", tick: 7 });
    expect(replayHash("save-3", 7)).not.toMatch(/key|provider|sk-/);
    expect(parseReplayHash("#key=sk-123")).toBeNull();
    expect(parseReplayHash("")).toBeNull();
    expect(parseReplayHash("#")).toBeNull();
    expect(parseReplayHash("#replays")).toBeNull();
  });

  test("is no link when the name is not a name, and a tick that is not a number is no tick", () => {
    for (const bad of ["../etc/passwd", "a/b", "%2e%2e%2fsecret", ".hidden", "-x", "", "a b", "a;b", "x".repeat(129), "café"]) {
      expect(parseReplayHash(`#replay=${encodeURIComponent(bad)}`), bad).toBeNull();
      expect(isReplayId(bad), bad).toBe(false);
    }
    expect(parseReplayHash("#replay=save-3&tick=abc")?.tick).toBeNull();
    expect(parseReplayHash("#replay=save-3&tick=-4")?.tick).toBeNull();
    expect(parseReplayHash("#replay=save-3&tick=1.5")?.tick).toBeNull();
    expect(parseReplayHash("#replay=save-3&tick=99999999999999")?.tick).toBeNull();
    expect(isReplayId("x".repeat(128))).toBe(true);
    expect(isReplayId(7)).toBe(false);
  });

  test("says where a recording is kept: a save in this browser, a file of the server", () => {
    expect(refOf("save-12")).toEqual({ source: "browser", save: 12 });
    expect(refOf("20261102T120000Z-seed7-s-ab12cd")).toEqual({ source: "server", name: "20261102T120000Z-seed7-s-ab12cd" });
    expect(refOf("save-12x")).toEqual({ source: "server", name: "save-12x" });
    expect(refOf("../x")).toBeNull();
    expect(browserId(4)).toBe("save-4");
    expect(refOf(browserId(4))).toEqual({ source: "browser", save: 4 });
  });
});

test.describe("the entries of the gallery", () => {
  test("a save is listed by its name and its length", () => {
    expect(browserEntry({ id: 4, name: "first game", savedAt: "2026-11-02T10:00:00.000Z", tick: 900, hash: "ab".repeat(32) })).toEqual({
      id: "save-4",
      source: "browser",
      title: "first game",
      seed: null,
      scenario: null,
      ticks: 900,
      when: "2026-11-02T10:00:00.000Z",
      bytes: null,
      coreVersion: null,
    });
  });

  test("what the server lists is read, and what is not a recording in it is left out", () => {
    const listing = {
      replays: [
        { id: "20261102T120000Z-seed7-s-a", bytes: 1_400_000, modified: "2026-11-02T12:00:00Z", seed: 7, scenario: "bridge", coreVersion: "0.0.1", endTick: 5000, records: 12, snapshots: 41, host: "server" },
        { id: "../escape", bytes: 1, modified: "x", seed: 1, scenario: "m0", endTick: 3 },
        { id: "no-seed", bytes: 1, modified: "x", scenario: "m0", endTick: 3 },
        { id: "no-length", bytes: 1, modified: "x", seed: 2, scenario: "m0" },
        null,
        "text",
        { id: "bare", seed: 9, endTick: 10 },
      ],
    };
    const entries = serverEntries(listing);
    expect(entries.map((e) => e.id)).toEqual(["20261102T120000Z-seed7-s-a", "bare"]);
    expect(entries[0]).toEqual({ id: "20261102T120000Z-seed7-s-a", source: "server", title: "7", seed: 7, scenario: "bridge", ticks: 5000, when: "2026-11-02T12:00:00Z", bytes: 1_400_000, coreVersion: "0.0.1" });
    expect(entries[1]).toMatchObject({ scenario: null, bytes: null, coreVersion: null, when: "" });
    expect(serverEntries({})).toEqual([]);
    expect(serverEntries(null)).toEqual([]);
    expect(serverEntries({ replays: "nope" })).toEqual([]);
  });

  test("a size is in kilobytes or megabytes", () => {
    expect(sizeText(380_000)).toBe("380 KB");
    expect(sizeText(1_400_000)).toBe("1.4 MB");
    expect(sizeText(12)).toBe("1 KB");
  });
});
