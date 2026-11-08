import { expect, test } from "@playwright/test";
import { hasMessage } from "../../src/i18n/index.ts";
import { passageOf, readHud } from "../../src/page/hud.ts";

// The way across, which the festival part of the board shows beside the households and the turnout: from the state of the bridge in the frame.

test.describe("the way across", () => {
  test("is over the mended bridge or by the detour, and none yet while the bridge is broken or being mended", () => {
    expect(passageOf("mended")).toBe("mended");
    expect(passageOf("detour")).toBe("detour");
    expect(passageOf("broken")).toBe("none");
    expect(passageOf("repairing")).toBe("none");
  });

  test("is not said where the frame does not say, or says something the page does not know", () => {
    expect(passageOf(null)).toBeNull();
    expect(passageOf("")).toBeNull();
    expect(passageOf("flooded")).toBeNull();
  });

  test("is read from the hud of a frame, and a frame with the bridge as a bare percent has none", () => {
    expect(passageOf(readHud({ bridge: { done: 5, need: 5, state: "mended" } }).bridge?.state ?? null)).toBe("mended");
    expect(passageOf(readHud({ bridge: 40 }).bridge?.state ?? null)).toBeNull();
    expect(passageOf(readHud({}).bridge?.state ?? null)).toBeNull();
  });

  test("has its words in both languages", () => {
    for (const key of ["hud.passage", "hud.passage.mended", "hud.passage.detour", "hud.passage.none"]) expect(hasMessage(key), key).toBe(true);
  });
});
