import { expect, test } from "@playwright/test";
import { hasMessage } from "../../src/i18n/index.ts";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { GUIDANCES, readGuidance } from "../../src/page/guide-prefs.ts";
import { type HintContext, HINTS, Hints } from "../../src/page/hints.ts";
import { Play } from "../../src/page/play.ts";
import type { Task } from "../../src/page/slice.ts";
import { FakeClient } from "../support/fake-client.ts";

// How much the task card does: the choice is kept per browser, the tutorial teaches with the full guidance whatever it is, and the hints
// that point at the button of the next step say something else to a player who has none.

/** `localStorage` as a browser has it, for the code that keeps a choice. Node has none. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const globals = globalThis as unknown as { localStorage?: MemoryStorage };

test.beforeEach(() => {
  globals.localStorage = new MemoryStorage();
});
test.afterEach(() => {
  delete globals.localStorage;
});

const player = (readOnly = false): Play => new Play(new FakeClient().host, readOnly);

test.describe("the choice of guidance", () => {
  test("is the full guidance until the viewer chooses the brief one, and is kept per browser", () => {
    expect(GUIDANCES).toEqual(["full", "brief"]);
    expect(readGuidance()).toBe("full");
    const play = player();
    play.guide.enabled = true;
    expect(play.guide.guidance).toBe("full");
    expect(play.guide.brief).toBe(false);
    play.guide.setGuidance("brief");
    expect(globals.localStorage?.getItem("lantern.guidance")).toBe("brief");
    expect(readGuidance()).toBe("brief");
    // Another page of the same browser starts with it.
    const next = player();
    next.guide.enabled = true;
    expect(next.guide.guidance).toBe("brief");
    expect(next.guide.brief).toBe(true);
    // And goes back.
    next.guide.setGuidance("full");
    expect(globals.localStorage?.getItem("lantern.guidance")).toBe("full");
    expect(next.guide.brief).toBe(false);
  });

  test("tells the page that it changed, and a choice that is the same changes nothing", () => {
    const client = new FakeClient();
    const play = new Play(client.host);
    play.guide.enabled = true;
    const before = client.touched;
    play.guide.setGuidance("brief");
    expect(client.touched).toBe(before + 1);
    play.guide.setGuidance("brief");
    expect(client.touched).toBe(before + 1);
  });

  test("is read again when a game begins, so that a choice made on another page of the browser holds", () => {
    const play = player();
    play.guide.enabled = true;
    globals.localStorage?.setItem("lantern.guidance", "brief");
    expect(play.guide.guidance).toBe("full");
    play.guide.refreshPrefs();
    expect(play.guide.guidance).toBe("brief");
  });

  test("takes hold only where the help is on, outside the tutorial", () => {
    globals.localStorage?.setItem("lantern.guidance", "brief");
    // A page that was made for a test of something else has no help, and the task card is as it was.
    const bare = player();
    expect(bare.guide.guidance).toBe("brief");
    expect(bare.guide.brief).toBe(false);
    // The page of a recording acts for nobody and has no help.
    const recording = player(true);
    recording.guide.enabled = true;
    expect(recording.guide.brief).toBe(false);
    // The page of a player: brief, except while the tutorial teaches.
    const play = player();
    play.guide.enabled = true;
    expect(play.guide.brief).toBe(true);
    play.guide.tutorial.begin();
    expect(play.guide.tutorial.on).toBe(true);
    expect(play.guide.brief).toBe(false);
    // The choice made at the last step takes hold when the tutorial is over, and skipping it ends it at once.
    play.guide.tutorial.skip();
    expect(play.guide.brief).toBe(true);
    play.guide.tutorial.reset();
    expect(play.guide.brief).toBe(true);
  });
});

const name = (en: string) => ({ zh: en, en });
const task = (id: string, state: Task["state"], over: Partial<Task> = {}): Task => ({ id, kind: "need", job: null, text: name(id), why: null, next: name(`next of ${id}`), state, blocker: null, action: null, window: null, expected: null, ...over });
const idle = (over: Partial<HintContext> = {}): HintContext => ({ tasks: new Map(), tracked: null, entries: [], verbs: new Set(), talking: null, leaves: false, promised: 0, leads: 0, ...over });
const AT = { day: 1, hour: 8, minute: 30 };

test.describe("the hints for a player with the brief guidance", () => {
  test("every hint that points at the button of the next step has a wording that points at the slip, in both languages", () => {
    const pointing = HINTS.filter((hint) => hint.target === "task-do" || /note of the slip says (why, and )?what to try|says whom to ask next|task-do/.test(en[hint.text]));
    expect(pointing.map((hint) => hint.id).sort()).toEqual(["blocked", "opened", "source"]);
    for (const hint of pointing) {
      expect(hint.brief, hint.id).toBeDefined();
      expect(hint.brief?.target, hint.id).not.toBe("task-do");
      const key = hint.brief?.text ?? "hint.log.title";
      expect(hasMessage(key), key).toBe(true);
      expect(en[key], key).not.toMatch(/what to try next|whom to ask next|ask Li Da/);
      expect(zh[key], key).not.toMatch(/下一步|下一个该问谁|去请李大/);
    }
    // The others say the same to everyone.
    for (const hint of HINTS.filter((h) => !pointing.includes(h))) expect(hint.brief, hint.id).toBeUndefined();
  });

  test("give the wording of the brief guidance, and the full one when it is not chosen", () => {
    const blocked = idle({ tracked: task("t_bamboo_first", "blocked") });
    const full = new Hints().check(blocked, 1, AT, 0, false);
    expect(full.map((g) => [g.id, g.target, g.text])).toEqual([["blocked", "task-card", "hint.blocked"]]);
    const brief = new Hints().check(blocked, 1, AT, 0, true);
    expect(brief.map((g) => [g.id, g.target, g.text])).toEqual([["blocked", "task-card", "hint.blocked.brief"]]);
    const source = idle({ tracked: task("t_who_said", "open", { action: { verb: "ask_source", npc: "cha_laoban", place: null, item: null } }) });
    expect(new Hints().check(source, 1, AT, 0, false).map((g) => [g.target, g.text])).toEqual([["task-do", "hint.source"]]);
    expect(new Hints().check(source, 1, AT, 0, true).map((g) => [g.target, g.text])).toEqual([["task-card", "hint.source.brief"]]);
    const opened = idle({ tracked: task("t_bamboo_first", "open", { action: { verb: "entrust", npc: "li_da", place: null, item: "bamboo" } }) });
    expect(new Hints().check(opened, 1, AT, 0, true).map((g) => [g.target, g.text])).toEqual([["task-card", "hint.opened.brief"]]);
    // The log keeps what was said, and lights where it was said.
    const hints = new Hints();
    hints.check(blocked, 1, AT, 0, true);
    expect(hints.log[0]).toMatchObject({ id: "blocked", text: "hint.blocked.brief", target: "task-card" });
    expect(hints.lit?.target).toBe("task-card");
  });
});
