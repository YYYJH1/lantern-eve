import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { startServerHost } from "../support/server-host.ts";
import * as fake from "../support/slice.ts";

// The incense that skips to the next thing, on fake frames of the days after the first: where it is (on the table at the bottom right, one
// of the three things of the corner), what it says and when it is not lit, in both languages and themes and at two widths of a window, and the run it begins (the pace the page asks the host for, and the pace it gives back). The host is not asked anything here: the page's requests are written down and not passed on, and the frames
// are the test's own. The run against the real core is in skip-real.spec.ts.

const RUNNING = { paused: false, rate: [1, 1] as [number, number] };
/** Where the pictures go, when a folder is named: the button at each width, in both languages and themes. */
const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

const at = (day: number, hour: number, minute = 0) => ({ day, hour, minute, phase: hour >= 21 || hour < 6 ? "night" : "day" });
const n = (zh: string, en: string) => ({ zh, en });

const task = (id: string, state: string, title: { zh: string; en: string }, over: Record<string, unknown> = {}) => ({
  id,
  kind: "need",
  job: "bridge",
  text: title,
  why: null,
  next: null,
  state,
  blocker: null,
  action: null,
  window: null,
  ...over,
});

const WORK_DONE = task("t_work_3", "done", n("第三天早上施工", "Work on the bridge, the third morning"));
const FESTIVAL = task("t_festival_night", "open", n("灯会之夜", "Festival night"), {
  kind: "venue",
  why: n("今夜游灯过桥。先看走不走得通，再看三件事成了几件", "Tonight the lanterns cross the bridge"),
  next: n("天黑前把没办完的办完，然后到桥边", "Finish what is left before dark, then be at the bridge"),
  window: { day: 5, from: 18, to: 21, place: "p_bridge" },
});
const FESTIVAL_STEP = { ...FESTIVAL, action: { verb: "move", place: "p_bridge" } };

/** The board of a game whose three jobs are done. */
const BOARD = fake.boardKey({ hours: { done: 10, need: 10 }, window: null, truth: { state: "done", last: null }, peace: { state: "done", grudge: 20, acts: fake.peaceActs(["stop_blaming", "work_together", "witnessed_meal"]), witnessed: true } });

/** A frame of the later days: the festival waits for its hour, the work done. */
const waiting = (time: ReturnType<typeof at>): Record<string, unknown> => ({ time, tracked: "t_festival_night", tasks: [WORK_DONE, FESTIVAL], commitments: [], board: BOARD, hud: { verbs: fake.FREE_VERBS } });
/** A frame in which no task is open: the game says there is nothing to follow. */
const nothing = (time: ReturnType<typeof at>): Record<string, unknown> => ({ time, tracked: null, tasks: [WORK_DONE], commitments: [], board: BOARD, hud: { verbs: fake.FREE_VERBS } });
/** The same morning, the festival's button come. */
const step = (time: ReturnType<typeof at>): Record<string, unknown> => ({ time, tracked: "t_festival_night", tasks: [WORK_DONE, FESTIVAL_STEP], commitments: [], board: BOARD, hud: { verbs: fake.FREE_VERBS } });

const feed = (page: Page, frame: Record<string, unknown>, events: unknown[] = []): Promise<void> => fake.feedFrame(page, frame, events, RUNNING);

/** What the page asks the host for is written down here and not passed on: the pace of the day, and a resume. */
async function recordHost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const asked: Array<number | string> = [];
    (window as unknown as { __host: typeof asked }).__host = asked;
    const client = window.__lantern.client;
    const skips: boolean[] = [];
    (window as unknown as { __skips: boolean[] }).__skips = skips;
    client.setPace = (speed: number, skip = false) => {
      asked.push(speed);
      skips.push(skip);
    };
    client.resume = (reason = "user") => {
      asked.push(`resume:${reason}`);
    };
  });
}

const asked = (page: Page) => page.evaluate(() => (window as unknown as { __host: Array<number | string> }).__host);
/** For each pace asked for, whether it said it was a skip's (the host takes a higher pace for that). */
const skipFlags = (page: Page) => page.evaluate(() => (window as unknown as { __skips: boolean[] }).__skips);

/** Chooses the speed of the day in the menu, where it is, and puts the menu away. */
async function chooseSpeed(lantern: LanternPage, id: "speed-normal" | "speed-slow"): Promise<void> {
  await lantern.openMenu();
  await lantern.page.getByTestId(id).click();
  await lantern.page.getByTestId("menu-close").click();
  await expect(lantern.page.getByTestId("menu")).toHaveAttribute("data-open", "false");
}

test.describe("the incense that skips to the next thing, with the brief guidance", () => {
  test("is there: it is not a next step, which the brief guidance leaves to the elder", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.guidance", "brief"));
    await fake.openFirstDay(lantern, {}, fake.GUIDED);
    await fake.primeHelp(page);
    await feed(page, waiting(at(5, 6, 10)));
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await expect(page.getByTestId("btn-skip")).toHaveAttribute("aria-label", "Skip to Day 5, 17:00");
    await expect(page.getByTestId("btn-skip")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the incense that skips to the next thing", () => {
  test("is always on the table, lit when every task only waits, and says the time the run stops at, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    // Nothing to skip to yet: the burner is there, unlit, and is no button.
    await expect(page.getByTestId("incense")).toHaveCount(1);
    await expect(page.getByTestId("btn-skip")).toHaveCount(0);
    await feed(page, waiting(at(5, 6, 10)));
    const incense = page.getByTestId("btn-skip");
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Festival night");
    await expect(page.getByTestId("incense")).toHaveCount(0);
    await expect(incense).toHaveAttribute("aria-label", "Skip to Day 5, 17:00");
    await expect(incense).toHaveAttribute("data-running", "false");
    await expect(incense).toHaveAttribute("data-day", "5");
    await expect(incense).toHaveAttribute("data-hour", "17");
    await expect(incense).toBeEnabled();
    // The words are on a slip that shows when the burner is pointed at.
    await expect(page.getByTestId("skip-words")).toBeHidden();
    await incense.hover();
    await expect(page.getByTestId("skip-words")).toHaveText("Skip to Day 5, 17:00");
    // The festival has no button to press yet: the slip says when and where, and the incense is what there is to do.
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-window")).toHaveText(/Stone Bridge, 18:00 to 21:00/);
    await lantern.setLang("zh");
    await expect(incense).toHaveAttribute("aria-label", "快进到第五日 17:00");
    // No window ahead, and no task open: the next thing is not said by its time.
    await feed(page, nothing(at(3, 9, 5)));
    await expect(incense).toHaveAttribute("aria-label", "快进到下一件事");
    await expect(incense).toHaveAttribute("data-day", "");
    await lantern.setLang("en");
    await expect(incense).toHaveAttribute("aria-label", "Skip to the next thing");
    await expect(page.getByTestId("task-text")).toHaveText("Everything on the list is done. Look around if you like, and wait for the festival on the night of the fifth day.");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not a button while a task has a step to take now, in a talk, after the ending, and where the frame has no days after the first", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const button = page.getByTestId("btn-skip");
    await feed(page, waiting(at(5, 6, 10)));
    await expect(button).toHaveCount(1);
    // A task that has something to do now: the festival's button has come, and so has the timber's.
    await feed(page, step(at(5, 17, 0)));
    await expect(button).toHaveCount(0);
    await expect(page.getByTestId("task-do")).toBeVisible();
    await feed(page, { ...waiting(at(5, 6, 10)), tasks: [WORK_DONE, FESTIVAL, task("t_timber", "open", n("请周掌柜送木料", "Ask Shopkeeper Zhou for the timber"), { action: { verb: "entrust", npc: "zhou_zhanggui", item: "timber", request: "ask_timber" } })] });
    await expect(button).toHaveCount(0);
    // A person's talk holds the world, and the burner is not lit in it.
    await feed(page, waiting(at(5, 6, 10)));
    await expect(button).toHaveCount(1);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("talk-area")).toBeVisible();
    await expect(button).toHaveCount(0);
    // The talk is over, and it is lit again.
    await feed(page, { ...waiting(at(5, 6, 20)), player: { ...(await fake.playerOf(page)), talk: null } });
    await expect(button).toHaveCount(1);
    // A frame with no board does not say what lies ahead, so there is nothing to skip to.
    await feed(page, { ...nothing(at(1, 15)), tasks: [task("t_bamboo_first", "done", n("取得李家的第一批竹料", "Get the first bamboo from the Li family"))], board: null });
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "idle");
    await expect(button).toHaveCount(0);
    // The festival is over once the ending is there.
    await feed(page, nothing(at(5, 21, 0)));
    await expect(button).toHaveCount(1);
    await feed(page, { ...nothing(at(5, 21, 0)), ending: { kind: "ending", tick: 9, ending: "full", label: n("圆满", "Complete"), hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100 } }, [
      { kind: "ending", tick: 9, ending: "full", label: n("圆满", "Complete"), hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100, reveal: null },
    ]);
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "over");
    await expect(button).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("runs the day at the highest pace until a step comes, and gives the pace the player chose back", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await recordHost(page);
    await chooseSpeed(lantern, "speed-slow");
    await expect.poll(() => asked(page)).toEqual([0.75]);
    await feed(page, waiting(at(5, 6, 10)));
    const button = page.getByTestId("btn-skip");
    await button.click();
    await expect.poll(() => asked(page)).toEqual([0.75, 12]);
    await expect(button).toHaveAttribute("data-running", "true");
    await expect(button).toHaveAttribute("aria-label", "Stop skipping");
    // The day goes on: the run does too, and the player's choice of the speed meanwhile waits for the end of it.
    await feed(page, waiting(at(5, 9, 0)));
    await feed(page, waiting(at(5, 12, 30)));
    await expect(button).toHaveAttribute("data-running", "true");
    await chooseSpeed(lantern, "speed-normal");
    await feed(page, waiting(at(5, 14, 0)));
    expect(await asked(page)).toEqual([0.75, 12]);
    // Pressed again it ends the run, and the pace is the one the player chose last.
    await button.click();
    await expect.poll(() => asked(page)).toEqual([0.75, 12, 1]);
    await expect(button).toHaveAttribute("data-running", "false");
    await expect(button).toHaveAttribute("aria-label", "Skip to Day 5, 17:00");
    // Pressed again, it runs until the festival's button comes, and ends there.
    await button.click();
    await expect.poll(() => asked(page)).toEqual([0.75, 12, 1, 12]);
    await feed(page, step(at(5, 17, 0)));
    await expect.poll(() => asked(page)).toEqual([0.75, 12, 1, 12, 1]);
    // the pace of a run says it is a skip's, which the host takes more than four for; the player's choices do not
    expect(await skipFlags(page)).toEqual([false, true, false, true, false]);
    await expect(button).toHaveCount(0);
    await expect(page.getByTestId("task-do")).toHaveAttribute("data-verb", "move");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("ends when the followed task changes, when a person comes to talk and when the world is paused", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await recordHost(page);
    // No task open, and the festival comes on the morning of the fifth day.
    await feed(page, nothing(at(3, 9, 5)));
    await page.getByTestId("btn-skip").click();
    await expect.poll(() => asked(page)).toEqual([12]);
    await feed(page, nothing(at(4, 12, 0)));
    await feed(page, waiting(at(5, 6, 0)));
    await expect.poll(() => asked(page)).toEqual([12, 1]);
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Festival night");
    await expect(page.getByTestId("btn-skip")).toHaveAttribute("aria-label", "Skip to Day 5, 17:00");
    // A person comes to talk to the manager.
    await page.getByTestId("btn-skip").click();
    await expect.poll(() => asked(page)).toEqual([12, 1, 12]);
    await fake.startTalk(page, "li_laotai");
    await expect.poll(() => asked(page)).toEqual([12, 1, 12, 1]);
    await expect(page.getByTestId("btn-skip")).toHaveCount(0);
    // The player pauses.
    await feed(page, { ...waiting(at(5, 8, 0)), player: { ...(await fake.playerOf(page)), talk: null } });
    await page.getByTestId("btn-skip").click();
    await expect.poll(() => asked(page)).toEqual([12, 1, 12, 1, 12]);
    await page.evaluate(() => window.__lantern.client.pause());
    await fake.feedFrame(page, waiting(at(5, 8, 5)), [], { paused: true, rate: [1, 1] });
    await expect.poll(() => asked(page)).toEqual([12, 1, 12, 1, 12, 1]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lets a world the player paused go when it is pressed, and cannot be pressed while a card holds the world", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, {}, fake.GUIDED);
    await fake.primeHelp(page);
    await recordHost(page);
    // The world is paused, by the player: the page held it at the start of the game and nobody has let it go.
    await fake.feedFrame(page, waiting(at(5, 6, 10)), [], { paused: true, rate: [1, 1] });
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-skip")).toBeEnabled();
    await page.getByTestId("btn-skip").click();
    await expect.poll(() => asked(page)).toEqual(["resume:user", 12]);
    await expect(page.getByTestId("btn-skip")).toHaveAttribute("data-running", "true");
    await feed(page, waiting(at(5, 6, 20)));
    await page.getByTestId("btn-skip").click();
    await expect.poll(() => asked(page)).toEqual(["resume:user", 12, 1]);
    // The elder's card holds the world, and the incense waits for it to be put away.
    await page.getByTestId("btn-elder").click();
    await expect(page.getByTestId("elder")).toBeVisible();
    await expect(page.getByTestId("btn-skip")).toBeDisabled();
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the incense in both themes and at each width", () => {
  for (const [name, width, height] of [
    ["a wide window", 1280, 760],
    ["a window of middling width", 1000, 760],
  ] as const) {
    test(`stays on the screen and uncovered on ${name}, in Chinese on the light theme and in English on the dark one`, async ({ lantern }) => {
      const page = lantern.page;
      await page.setViewportSize({ width, height });
      await fake.openFirstDay(lantern);
      await feed(page, waiting(at(5, 6, 10)));
      for (const [lang, theme] of [["zh", "light"], ["en", "dark"]] as const) {
        await lantern.setLang(lang);
        await lantern.setTheme(theme);
        const label = lang === "zh" ? "快进到第五日 17:00" : "Skip to Day 5, 17:00";
        const button = page.getByTestId("btn-skip");
        // The menu slides away for a moment after it is shut, and lies over the corner while it does.
        await expect(page.getByTestId("menu")).toBeHidden();
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute("aria-label", label);
        expect(await fake.fitsWidth(page), `${name} ${lang}: the page has no sideways scroll`).toBe(true);
        const box = await button.boundingBox();
        expect(box !== null).toBe(true);
        if (box === null) return;
        expect(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= height + 0.5, `${name} ${lang}: the incense is inside the screen`).toBe(true);
        // Nothing lies over it: the point at its middle is the burner's.
        const top = await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest('[data-testid="btn-skip"]') === null ? (hit?.outerHTML.slice(0, 160) ?? "nothing") : "the incense";
        }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        expect(top, `${name} ${lang}: what lies over the incense`).toBe("the incense");
        // The words on the slip are ink on paper, read when the slip is shown.
        await button.hover();
        await expect.poll(() => fake.contrast(page, '[data-testid="skip-words"]'), { message: `${name} ${lang} ${theme}` }).toBeGreaterThan(4.5);
        if (SHOTS !== "") {
          mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: path.join(SHOTS, `skip-ui-${width}-${lang}-${theme}.png`) });
        }
      }
      expect(lantern.pageErrors).toEqual([]);
    });
  }
});

test.describe("with the server host", () => {
  test("the button is not shown: the server keeps its own pace and ignores the one the page asks for", async ({ page }) => {
    test.setTimeout(300_000);
    const server = await startServerHost("skip", ["--pace", "20"]);
    try {
      await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
      await page.goto(`${server.origin}/?host=ws&map=off`);
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      await page.getByTestId("opening-start").click();
      await expect(page.getByTestId("status")).toHaveText("running");
      await page.waitForFunction(() => window.__lantern.client.state.simTick >= 20, undefined, { timeout: 60_000 });
      expect(await page.evaluate(() => window.__lantern.client.paced)).toBe(false);
      // A frame in which every task waits: the offer is the page's own, in the same call that the frame is given in.
      const offered = await page.evaluate(
        ([frame]) => {
          const client = window.__lantern.client as unknown as { onMessage(message: unknown): void; paced: boolean };
          const base = window.__lantern.client.state.frame as Record<string, unknown>;
          client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick + 1, advanced: true, frame: { ...base, ...(frame as object) }, events: [], clock: { paused: false, rate: [1, 1] } });
          const server = window.__lantern.play.skip.state.offer;
          Object.defineProperty(client, "paced", { value: true });
          const browser = window.__lantern.play.skip.state.offer;
          return { server, browser };
        },
        [waiting(at(5, 6, 10))] as const,
      );
      expect(offered.server).toBeNull();
      expect(offered.browser).toEqual({ until: { day: 5, hour: 17, minute: 0 } });
    } finally {
      expect(await server.stop()).toBe(0);
    }
  });
});
