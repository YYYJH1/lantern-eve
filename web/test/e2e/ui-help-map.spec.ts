import type { Locator } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The acts of the manager on the map outside a talk: listen in, look closely, call for helpers and speak up. Each is there from the start. One that cannot
// be done now is grey and says why, on hover and when pressed, in the core's own reason (`hud.verbs_off`), and none of them shows minutes. A pair that
// talks, picked on the map, offers to be listened in on, and a thing within reach offers a look, over the manager's own piece.

test.use({ map: true });

const OFF = (over: Record<string, string> = {}): Record<string, string> => ({ listen: "far", look: "far", speak: "far", speak_publicly: "far", leave: "not_talking", ...over });

/** Whether the element is what a pointer finds at the middle of it: nothing of the page lies over it. */
const reachable = (element: Locator): Promise<boolean> =>
  element.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top === el || el.contains(top);
  });

test.describe("the strip of acts around the manager", () => {
  test("has the four acts from the start, grey with the core's reason for those that cannot be done, and no minutes on any of them", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: OFF() } });
    for (const act of ["listen", "look", "rally", "speak"]) await expect(page.getByTestId(`verb-${act}`)).toBeVisible();
    await expect(page.getByTestId("verb-rally")).toHaveAttribute("aria-disabled", "false");
    for (const [act, reason] of [["listen", "far"], ["look", "far"], ["speak", "far"]] as const) {
      const button = page.getByTestId(`verb-${act}`);
      await expect(button, act).toHaveAttribute("aria-disabled", "true");
      await expect(button, act).toHaveAttribute("data-off", reason);
      await expect(button, act).toHaveClass(/is-off/);
      // The reason is the title of the button, which is what a pointer on it shows.
      await expect(button, act).toHaveAttribute("title", en[`act.off.${act}.${reason}` as keyof typeof en]);
    }
    // No minutes: not on the acts that are on, nor on the one that was never offered a price.
    await expect(page.getByTestId("around").locator(".verb-cost")).toHaveCount(0);
    await expect(page.getByTestId("cost-speak")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(page.getByTestId("verb-listen")).toHaveText(zh["act.listen"]);
    await expect(page.getByTestId("verb-look")).toHaveText(zh["act.look"]);
    await expect(page.getByTestId("verb-rally")).toHaveText(zh["act.rally"]);
    await expect(page.getByTestId("verb-speak")).toHaveText(zh["act.speak"]);
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("title", zh["act.off.speak.far"]);
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says the reason when a grey act is pressed, in a line under the strip, and sends nothing", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: OFF() } });
    await page.getByTestId("verb-listen").click({ force: true });
    const why = page.getByTestId("around-why");
    await expect(why).toHaveText(en["act.off.listen.far"]);
    await expect(why).toHaveAttribute("data-act", "listen");
    await expect(why).toHaveAttribute("data-reason", "far");
    // Another act says its own reason in its own words.
    await page.getByTestId("verb-speak").click({ force: true });
    await expect(why).toHaveText(en["act.off.speak.far"]);
    expect((await fake.sentSoFar(page)).filter((m) => m.type !== "move")).toEqual([]);
    // The line is not for good: it goes by itself.
    await expect(why).toHaveCount(0, { timeout: 8000 });
  });

  test("gives each reason in words that fit the act: not yet, night, done, busy", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const cases: Array<[string, string, Record<string, string>, string]> = [
      ["speak", "not_yet", { speak: "not_yet", speak_publicly: "not_yet" }, "act.off.speak.not_yet"],
      ["speak", "night", { speak: "night", speak_publicly: "night" }, "act.off.speak.night"],
      ["rally", "done", { rally: "done" }, "act.off.rally.done"],
      ["look", "busy", { look: "busy" }, "act.off.busy"],
      ["listen", "talking", { listen: "talking" }, "act.off.talking"],
    ];
    for (const [act, reason, off, key] of cases) {
      await fake.feedFrame(page, { hud: { verbs: ["move"], verbs_off: { listen: "far", look: "far", rally: "done", speak: "far", ...off } } });
      // The page has drawn the frame before the press, as a person's press comes after it.
      await expect(page.getByTestId(`verb-${act}`)).toHaveAttribute("data-off", reason);
      await page.getByTestId(`verb-${act}`).click({ force: true });
      await expect(page.getByTestId("around-why"), `${act} ${reason}`).toHaveText(en[key as keyof typeof en]);
      await expect(page.getByTestId("around-why")).toHaveAttribute("data-reason", reason);
    }
  });

  test("shows only what the frame offers where it gives no reasons, as a core from before them does", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: null } });
    await expect(page.getByTestId("verb-rally")).toBeVisible();
    for (const act of ["listen", "look", "speak"]) await expect(page.getByTestId(`verb-${act}`)).toHaveCount(0);
  });

  test("does what the act says when it can be done, and a grey act turns back into a button when it can", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: OFF() } });
    await page.getByTestId("verb-listen").click({ force: true });
    await expect(page.getByTestId("around-why")).toBeVisible();
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally", "listen"], verbs_off: OFF({ listen: "far" }) } });
    await expect(page.getByTestId("around-why")).toHaveCount(0);
    await expect(page.getByTestId("verb-listen")).toHaveAttribute("aria-disabled", "false");
    await page.getByTestId("verb-listen").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "listen" });
    await page.getByTestId("verb-rally").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "rally" });
  });

  test("is not there in a talk, where the acts of the talk take its place", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "rally"], verbs_off: OFF() } });
    await expect(page.getByTestId("around")).toBeVisible();
    await fake.startTalk(page, "li_laotai", {}, ["leave", "ask"], []);
    await expect(page.getByTestId("around")).toHaveCount(0);
  });
});

test.describe("the acts that come to what is pointed at", () => {
  /** A pair that talks beyond hearing, as the frame says: the speaker has a marker and no words. */
  const talking = { npc: "li_er", talking: true, until: 999_999, text: null };

  test("offers to listen in over a pair that talks, once picked: it hears them where it can and walks up to them where it must", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { bubbles: [talking], hud: { verbs: ["move", "talk"], verbs_off: OFF() } });
    // Nothing is offered until the pair is picked.
    await expect(page.getByTestId("chip-listen")).toHaveCount(0);
    await page.evaluate(() => window.__lantern.play.onFocus?.("li_er"));
    const chip = page.getByTestId("chip-listen");
    const button = chip.locator("button");
    await expect(button).toBeVisible();
    await expect(chip).toHaveAttribute("data-for", "li_er");
    // A pointer reaches it: nothing of the page is over it. The chip follows the card of the person a frame at a time, so the check waits for the frame that puts it clear.
    await expect.poll(() => reachable(button)).toBe(true);
    // Too far to hear: the chip says it walks closer, and walks.
    await expect(button).toHaveText(en["act.listen.walk"]);
    await button.dispatchEvent("click");
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "move" });
    // Near enough: the same chip listens.
    await fake.feedFrame(page, { bubbles: [talking], hud: { verbs: ["move", "talk", "listen"], verbs_off: {} } });
    await expect(button).toHaveText(en["act.listen"]);
    await button.dispatchEvent("click");
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "listen" });
    await lantern.setLang("zh");
    await expect(button).toHaveText(zh["act.listen"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says why the pair cannot be listened in on where the reason is not distance, and goes when somebody else is picked", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { bubbles: [talking], hud: { verbs: ["move"], verbs_off: OFF({ listen: "busy" }) } });
    await page.evaluate(() => window.__lantern.play.onFocus?.("li_er"));
    const button = page.getByTestId("chip-listen").locator("button");
    await expect(button).toHaveText(en["act.listen"]);
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await button.dispatchEvent("click");
    await expect(page.getByTestId("chip-said")).toHaveText(en["act.off.busy"]);
    expect((await fake.sentSoFar(page)).filter((m) => m.type !== "move")).toEqual([]);
    // A person who is not talking has no such chip.
    await page.evaluate(() => window.__lantern.play.onFocus?.("li_da"));
    await expect(page.getByTestId("chip-listen")).toHaveCount(0);
  });

  test("offers a look at a thing within reach, over the manager, and looks at it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "look"], verbs_off: OFF({ look: "far" }) }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
    const chip = page.getByTestId("chip-acts");
    const thing = chip.getByTestId("chip-look-thing");
    await expect(thing).toBeVisible();
    await expect(thing).toHaveCount(1);
    await expect(thing).toHaveAttribute("data-id", "t_rail");
    await expect(thing).toContainText("Look at");
    await expect.poll(() => reachable(thing)).toBe(true);
    await thing.dispatchEvent("click");
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "look", at: "t_rail" });
    // The strip's own button opens the list, as it did.
    await page.getByTestId("verb-look").click();
    await expect(page.getByTestId("picker-look")).toBeVisible();
    // Nothing in reach, nothing offered; and while the manager is looking, nothing either.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), look: [] } });
    await expect(page.getByTestId("chip-acts")).toHaveCount(0);
  });
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1200, height: 600 },
  ]) {
    test(`never lies on the words of the slip, with its reasons open, in a window of ${size.width}x${size.height}`, async ({ lantern }) => {
      const page = lantern.page;
      await page.setViewportSize(size);
      await fake.openFirstDay(lantern);
      await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "look"], verbs_off: OFF({ look: "far" }) }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
      await page.getByTestId("slip-why").locator("summary").click();
      await expect(page.getByTestId("task-why")).toBeVisible();
      const thing = page.getByTestId("chip-look-thing");
      await expect(thing).toBeVisible();
      // The chip goes where the slip is not, and the slip's reasons open under it or close over it: the box of the chip never meets the box of the slip.
      await expect
        .poll(async () => {
          const chip = await thing.boundingBox();
          const slip = await page.getByTestId("task-card").boundingBox();
          if (chip === null || slip === null) return "no box";
          const apart = chip.y >= slip.y + slip.height || chip.y + chip.height <= slip.y || chip.x >= slip.x + slip.width || chip.x + chip.width <= slip.x;
          return apart ? "apart" : "on the slip";
        })
        .toBe("apart");
      await expect.poll(() => reachable(thing)).toBe(true);
    });
  }

  test("stands under the open note of the slip where the manager's piece is behind it, and over the piece where it is not", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1200, height: 600 });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "look"], verbs_off: OFF({ look: "far" }) }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
    const thing = page.getByTestId("chip-look-thing");
    await expect(thing).toBeVisible();
    await expect(page.locator("#slip-note")).toBeVisible();
    const where = (): Promise<{ head: { x: number; y: number }; note: { bottom: number; left: number; right: number; top: number } }> =>
      page.evaluate(() => {
        const head = window.__lantern.view.headPositionOf(window.__lantern.play.scene?.player?.id ?? "") ?? { x: -1, y: -1 };
        const note = (document.querySelector("#slip-note") as Element).getBoundingClientRect();
        return { head, note: { bottom: note.bottom, left: note.left, right: note.right, top: note.top } };
      });
    // In this window the open note lies over the manager's piece, and the chip stands under the note, which is where the piece is.
    const behind = await where();
    expect(behind.head.x).toBeGreaterThan(behind.note.left);
    expect(behind.head.x).toBeLessThan(behind.note.right);
    expect(behind.head.y).toBeLessThan(behind.note.bottom);
    expect((await thing.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(behind.note.bottom);
    await expect.poll(() => reachable(thing)).toBe(true);
    // The note is folded: the piece is seen, and the chip is over it.
    await page.getByTestId("slip-head").click();
    await expect(page.locator("#slip-note")).toBeHidden();
    const head = (await where()).head;
    await expect.poll(async () => (await thing.boundingBox())?.y ?? Infinity).toBeLessThan(head.y);
    await expect.poll(() => reachable(thing)).toBe(true);
  });

  test("hangs over the map and the slip, and under the ledger and under the sheets and the notebook, which a chip never lies over", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "look"], verbs_off: OFF({ look: "far" }) }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
    await expect(page.getByTestId("chip-look-thing")).toBeVisible();
    const order = await page.evaluate(() => {
      const z = (selector: string): number => Number(getComputedStyle(document.querySelector(selector) as Element).zIndex);
      return { map: z("canvas.map-canvas"), chips: z(".chip-layer"), slip: z(".slip"), ledger: z("#ledger"), sheets: z(".map-ui") };
    });
    expect(order.chips).toBeGreaterThan(order.map);
    // The manager stands under the slip at the start, and what the manager can look at is offered there: over the slip, not under it.
    expect(order.chips).toBeGreaterThan(order.slip);
    expect(order.chips).toBeLessThan(order.ledger);
    expect(order.chips).toBeLessThan(order.sheets);
    // The layer takes no press of its own: only the chips do.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".chip-layer") as Element).pointerEvents)).toBe("none");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".chip-act") as Element).pointerEvents)).toBe("auto");
  });

  test("offers speaking up over the manager where there is a meeting to speak to, and opens the list of what to say", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    // Not at a meeting: nothing is offered over the manager.
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk"], verbs_off: OFF() } });
    await expect(page.getByTestId("chip-speak")).toHaveCount(0);
    await fake.feedFrame(page, fake.speakingFrame(await fake.playerOf(page)));
    const chip = page.getByTestId("chip-speak");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(en["act.speak"]);
    await chip.dispatchEvent("click");
    await expect(page.getByTestId("picker-speak")).toBeVisible();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveCount(3);
    await lantern.setLang("zh");
    await expect(chip).toHaveText(zh["act.speak"]);
    expect(lantern.pageErrors).toEqual([]);
  });
});
