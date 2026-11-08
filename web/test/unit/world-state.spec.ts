import { expect, test } from "@playwright/test";
import { stoppedBy, worldWord } from "../../src/page/world-state.ts";

const stats = (reasons: Array<"user" | "hidden" | "page">) => ({ reasons }) as never;

test.describe("the word for what the world is doing", () => {
  test("is starting, running or failed by the phase of the host and the clock of the core", () => {
    expect(worldWord({ phase: "boot", paused: false, stats: null }, false)).toBe("starting");
    expect(worldWord({ phase: "failed", paused: true, stats: null }, true)).toBe("failed");
    expect(worldWord({ phase: "ready", paused: false, stats: null }, true)).toBe("running");
  });

  test("is paused when the player or a hidden page paused the world, in a talk or not, and when the host has not said why", () => {
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["user"]) }, false)).toBe("paused");
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["user"]) }, true)).toBe("paused");
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["hidden"]) }, true)).toBe("paused");
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["user", "hidden"]) }, true)).toBe("paused");
    expect(worldWord({ phase: "ready", paused: true, stats: null }, true)).toBe("paused");
  });

  test("is held when the core stopped the clock for a talk and nobody pressed pause", () => {
    expect(worldWord({ phase: "ready", paused: true, stats: stats([]) }, true)).toBe("held");
    // Outside a talk nothing but the player or the page stops the world, so an unexplained stop is still a pause.
    expect(worldWord({ phase: "ready", paused: true, stats: stats([]) }, false)).toBe("paused");
  });

  test("stays held in a talk when the page holds the world on top of the core, as it does while the notebook is open, and is paused when the player pressed pause too", () => {
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["page"]) }, true)).toBe("held");
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["page", "user"]) }, true)).toBe("paused");
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["page", "hidden"]) }, true)).toBe("paused");
    // Outside a talk the page's hold is a pause, which the bar has always said while the notebook is open.
    expect(worldWord({ phase: "ready", paused: true, stats: stats(["page"]) }, false)).toBe("paused");
  });
});

test.describe("who stopped the world", () => {
  const given = (reasons: string[]) => ({ reasons });

  test("is nobody while it runs, and the player for a pause or for a stop the host has not explained", () => {
    expect(stoppedBy({ paused: false, stats: given(["user"]) })).toBeNull();
    expect(stoppedBy({ paused: false })).toBeNull();
    expect(stoppedBy({ paused: true, stats: given(["user"]) })).toBe("player");
    expect(stoppedBy({ paused: true, stats: given(["user", "hidden"]) })).toBe("player");
    expect(stoppedBy({ paused: true, stats: null })).toBe("player");
    expect(stoppedBy({ paused: true })).toBe("player");
  });

  test("is a hidden tab when that is the only reason, and the core when the host gives none", () => {
    expect(stoppedBy({ paused: true, stats: given(["hidden"]) })).toBe("tab");
    expect(stoppedBy({ paused: true, stats: given([]) })).toBe("core");
  });

  test("is the page when its hold is the only reason, and the player or the tab when they stopped it as well", () => {
    expect(stoppedBy({ paused: true, stats: given(["page"]) })).toBe("page");
    expect(stoppedBy({ paused: true, stats: given(["page", "user"]) })).toBe("player");
    expect(stoppedBy({ paused: true, stats: given(["hidden", "page"]) })).toBe("tab");
    expect(stoppedBy({ paused: false, stats: given(["page"]) })).toBeNull();
  });
});
