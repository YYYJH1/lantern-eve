import { expect, test } from "@playwright/test";
import { budgetNotes, CLOUD_OFF_PERCENT, readBudget, STRONG_OFF_PERCENT } from "../../src/page/budget.ts";
import { hasMessage } from "../../src/i18n/index.ts";
import { readHud } from "../../src/page/hud.ts";

const view = (hud: Record<string, unknown>) => readBudget(readHud(hud));

test.describe("the budget of the game", () => {
  test("has the places where the gate switches the strong model and the cloud off", () => {
    expect([STRONG_OFF_PERCENT, CLOUD_OFF_PERCENT]).toEqual([70, 90]);
  });

  test("is read from the money of the frame: settled, held, and the cap, in percent of the cap", () => {
    expect(view({ spent: 750_000, held: 150_000, cap: 3_000_000, stage: 0, cloud: true, local: false })).toEqual({
      spentPercent: 25,
      heldPercent: 5,
      stage: 0,
      cloud: true,
      local: false,
    });
    // Money past the cap does not run off the gauge, and the held part keeps to the room that is left.
    expect(view({ spent: 4_000_000, held: 500_000, cap: 3_000_000, stage: 2 })).toMatchObject({ spentPercent: 100, heldPercent: 0, stage: 2 });
    expect(view({ spent: 2_900_000, held: 500_000, cap: 3_000_000, stage: 2 })?.heldPercent).toBeCloseTo(100 - (2_900_000 / 3_000_000) * 100, 6);
  });

  test("is none for a game with no cap or no stage, as the demo world has none", () => {
    expect(view({})).toBeNull();
    expect(view({ spent: 1, cap: 0, stage: 0 })).toBeNull();
    expect(view({ spent: 1, cap: 5, held: 0 })).toBeNull();
  });

  test("takes a host that has said nothing for a host with a cloud and no local model", () => {
    expect(view({ cap: 5, stage: 0 })).toMatchObject({ cloud: true, local: false });
    expect(view({ cap: 5, stage: 0, cloud: false, local: true })).toMatchObject({ cloud: false, local: true });
  });

  test("says plainly what is off and what answers instead", () => {
    const notes = (hud: Record<string, unknown>) => budgetNotes(view({ cap: 100, ...hud }) as NonNullable<ReturnType<typeof view>>);
    expect(notes({ stage: 0 })).toEqual(["budget.allOn"]);
    expect(notes({ stage: 1 })).toEqual(["budget.strongOff"]);
    expect(notes({ stage: 2 })).toEqual(["budget.cloudOff", "budget.insteadScript"]);
    expect(notes({ stage: 2, local: true })).toEqual(["budget.cloudOff", "budget.insteadLocal"]);
    // The cloud can be off with the budget untouched: the host could not reach it.
    expect(notes({ stage: 0, cloud: false })).toEqual(["budget.cloudDown", "budget.insteadScript"]);
    expect(notes({ stage: 0, cloud: false, local: true })).toEqual(["budget.cloudDown", "budget.insteadLocal"]);
    // And both together say both.
    expect(notes({ stage: 1, cloud: false })).toEqual(["budget.cloudDown", "budget.strongOff", "budget.insteadScript"]);
    for (const key of ["budget.allOn", "budget.strongOff", "budget.cloudOff", "budget.cloudDown", "budget.insteadLocal", "budget.insteadScript"]) {
      expect(hasMessage(key)).toBe(true);
    }
  });
});
