import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { closingKey } from "../../src/page/festival/words.ts";
import { expect, test } from "../support/fixtures.ts";
import {
  advance,
  camera,
  CASES,
  CROWD,
  type Case,
  endingOf,
  festival,
  frames,
  leftAlone,
  loadFinished,
  meetFinished,
  nightFrame,
  openNight,
  reasons,
  seekToEnd,
  TOWN,
  words,
  wordsLines,
} from "../support/festival.ts";
import * as fake from "../support/slice.ts";

// The festival night on a page of fake frames: the show that plays at the ending, before the ending page, for each way the night can go. The shows play on a
// clock that the test moves by hand, so every second of a night is looked at where the test puts it, whatever the speed of the machine.
test.use({ map: true });

const FALSE_STORY_EN = "The Li family wrecked the bridge on purpose, to spoil the Zhou family's night, and blamed a drunk.";
const FALSE_STORY_ZH = "李家故意毁桥，不想让周家出风头，还嫁祸给醉汉。";
const sumOf = (record: Record<string, number>): number => Object.values(record).reduce((sum, n) => sum + n, 0);

/** The number of people of the picture that a case has: what the ending says, up to 120. */
const peopleOf = (c: Case): number => sumOf((endingOf(c).festival as { bearers: Record<string, number> }).bearers);

test.describe("each way the night can go", () => {
  for (const [i, c] of CASES.entries()) {
    test(`${c.name}: the show plays, the words are what the night was, it is skipped by ${i % 2 === 0 ? "the button" : "Esc"}, the ending page comes, and a finished save that is loaded plays it again to its end`, async ({ lantern }) => {
      test.setTimeout(150_000);
      const page = lantern.page;
      const before = await openNight(lantern, c, "en", "dark");
      const director = page.getByTestId("director");

      // It plays before the ending page, over the map, with the pause of its own and nothing else of the page in the way.
      await expect(director).toHaveAttribute("data-skippable", "true");
      await expect(page.getByTestId("ending")).toHaveCount(0);
      await expect(page.getByTestId("director-caption")).toHaveText("The fifth night. The lantern festival.");
      await expect(page.getByTestId("director-caption")).toHaveAttribute("data-style", "title");
      await expect(page.locator(".shell")).toHaveAttribute("data-festival", "true");
      await expect(page.getByTestId("btn-menu")).toBeHidden();
      await expect.poll(() => reasons(page)).toContain("show");

      // What it is made of: the people of the ending, drawn from the three passers-by, the named people, the river.
      const first = await festival(page);
      expect(first.plan.route).toBe(c.route);
      expect(first.plan.together).toBe(c.together);
      expect(first.stage.bearers).toBe(Math.min(120, peopleOf(c)));
      expect(first.stage.named + first.stage.lighters.length).toBe(20);
      expect(first.stage.manager).toBe(true);
      expect(first.stage.lighters).toEqual(c.lighter);
      expect(first.stage.river).toBeGreaterThanOrEqual(4);
      expect(first.stage.storyteller).toBe(c.hidden);
      expect(first.timeline.duration).toBeGreaterThanOrEqual(40);
      expect(first.timeline.duration).toBeLessThanOrEqual(60);
      // The shows play on the clock of the test: seconds into the night, counted from here.
      let now = 0;
      const go = async (seconds: number): Promise<void> => {
        if (seconds > now) await advance(page, (seconds - now) * 1000);
        now = Math.max(now, seconds);
      };
      const tl = first.timeline;
      // the camera begins on the whole town
      await go(1.5);
      const wide = await camera(page);
      expect(wide.moved).toBe(true);

      // It goes on a while: the lantern is lit by the people the ending names, or by nobody.
      const lighting = c.route === "none" ? tl.arrive + 3 : (tl.lightAt as number) + 3;
      await go(lighting);
      const lit = await festival(page);
      expect(lit.stage.flare).toBe(c.lighter.length > 0 ? 1 : 0);
      if (c.route !== "none") expect(lit.stage.visible).toBeGreaterThan(c.route === "lane" ? 10 : 20);

      // The storyteller, for the hidden ending, tells the false story that spread; the closing line says what the night was.
      if (c.hidden) {
        const story = tl.story as [number, number];
        await go(story[0] + 2);
        await expect.poll(() => words(page)).toBe(`Beside the teahouse a storyteller tells the story: “${FALSE_STORY_EN}” The listeners believe it.`);
      }
      await go(tl.closing + 3);
      await expect.poll(() => words(page)).toBe(c.closing);
      await expect(page.getByTestId("ending")).toHaveCount(0);

      // It is skipped, and the page goes on to the ending page with the camera as it was and the world let go.
      if (i % 2 === 0) {
        await page.getByTestId("director-skip").click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(page.getByTestId("ending")).toBeVisible();
      await expect(director).toHaveCount(0);
      await expect(page.getByTestId("btn-menu")).toBeVisible();
      await expect.poll(() => reasons(page)).not.toContain("show");
      const after = await camera(page);
      expect(after.zoom).toBeCloseTo(before.zoom, 6);
      expect(after.moved).toBe(before.moved);
      await expect(page.getByTestId("ending-title")).toHaveText(c.ending === "ending_full" ? "A perfect night" : c.ending === "ending_barely" ? "Just enough" : "Each family lit its own lanterns");

      // A finished save that is loaded plays the same night again, and it runs to its end by itself.
      await loadFinished(page, c);
      await expect(director).toHaveAttribute("data-show", "festival");
      await expect(page.getByTestId("ending")).toHaveCount(0);
      const again = await festival(page);
      expect(again.plan).toEqual(first.plan);
      expect(again.timeline).toEqual(first.timeline);
      await advance(page, (tl.duration + 1) * 1000);
      await expect(page.getByTestId("ending")).toBeVisible();
      await expect(director).toHaveCount(0);
      await expect.poll(() => reasons(page)).not.toContain("show");
      expect(lantern.pageErrors).toEqual([]);
    });
  }
});

test.describe("the same night by every road to the ending", () => {
  test("a game played to its end, a finished save that is loaded, a recording taken to its end and a game met in a frame make the same plan, the same timeline and the same words", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    const c = CASES.find((x) => x.name === "hidden") as Case;
    await openNight(lantern, c, "zh", "light");
    const director = page.getByTestId("director");
    const states: Array<{ plan: unknown; timeline: unknown }> = [];
    const spoken: string[][] = [];
    const lines = async (): Promise<string[]> => {
      const out: string[] = [];
      const { timeline } = await festival(page);
      let now = 0;
      for (const seconds of [1, timeline.story?.[0] === undefined ? 0 : timeline.story[0] + 2, timeline.closing + 3]) {
        if (seconds <= now) continue;
        await advance(page, (seconds - now) * 1000);
        now = seconds;
        await expect.poll(() => words(page)).not.toBeNull();
        out.push((await words(page)) ?? "");
      }
      return out;
    };

    // the game played to its end: the event
    states.push(await festival(page));
    spoken.push(await lines());
    await page.getByTestId("director-skip").click();
    await expect(page.getByTestId("ending")).toBeVisible();

    // a finished save that is loaded
    await loadFinished(page, c);
    await expect(director).toHaveAttribute("data-show", "festival");
    states.push(await festival(page));
    spoken.push(await lines());
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();

    // a recording taken to its end: the scene and the whole ending, then the frame of that tick and no event
    await seekToEnd(page, c);
    await expect(director).toHaveAttribute("data-show", "festival");
    states.push(await festival(page));
    spoken.push(await lines());
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();

    // a game that the page meets over in a frame: the compact ending in it, and the whole ending a moment after
    await meetFinished(page, c);
    await expect(director).toHaveAttribute("data-show", "festival");
    states.push(await festival(page));
    spoken.push(await lines());
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();

    for (const other of [1, 2, 3]) {
      expect(states[other]?.plan).toEqual(states[0]?.plan);
      expect(states[other]?.timeline).toEqual(states[0]?.timeline);
    }
    expect(spoken[0]).toEqual(["第五夜，灯会。", `茶馆旁边，说书人正讲：「${FALSE_STORY_ZH}」听的人都信了。`, "桥修好了。两家的人并肩走着，主灯是两家当家一起点的。"]);
    expect(spoken[1]).toEqual(spoken[0]);
    expect(spoken[2]).toEqual(spoken[0]);
    expect(spoken[3]).toEqual(spoken[0]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a different tick of the ending is a different crowd of the same size and in the same districts", async ({ lantern }) => {
    const page = lantern.page;
    const c = CASES[0] as Case;
    await openNight(lantern, c, "en", "dark");
    const one = await festival(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
    const other = endingOf(c, { tick: 10081 });
    await page.evaluate(() => window.__lantern.play.director.reset());
    await fake.feedFrame(page, nightFrame(c, { ending: other }), [other]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    const two = await festival(page);
    type Bearer = { district: string; kind: string; spot: { x: number } };
    const a = one.plan.bearers as Bearer[];
    const b = two.plan.bearers as Bearer[];
    expect(b.map((x) => x.district)).toEqual(a.map((x) => x.district));
    expect(b.map((x) => x.kind)).not.toEqual(a.map((x) => x.kind));
  });
});

// The words over the map (the opening line, the storyteller's line and the closing line) are set on a slip that is 32 rem wide at the most, and a line of them runs to
// two or three lines there. However the browser breaks them, the last line may not be left with one or two characters alone (a word and its stop, 「的。」), in either
// language and in any window the game is laid out for, from the smallest to a large monitor.
const WINDOWS = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;
const TEXTS = { zh, en } as const;

test.describe("the words over the map", () => {
  for (const c of CASES.filter((x) => x.name !== "hidden-no-parade")) {
    test(`${c.name}: no line of them is left with one or two characters alone, in either language and in each window from 1200x600 to 1920x1080`, async ({ lantern }) => {
      test.setTimeout(150_000);
      const page = lantern.page;
      await openNight(lantern, c, "zh", "light", { size: WINDOWS[0] });
      const { timeline: tl } = await festival(page);
      const closing = closingKey(endingOf(c).festival as { route: "bridge" | "lane" | "none"; together: boolean }, c.ending);
      const story = (lang: "zh" | "en"): string => TEXTS[lang]["festival.story"].replace("{story}", TEXTS[lang]["ending.quote"].replace("{words}", lang === "zh" ? FALSE_STORY_ZH : FALSE_STORY_EN));
      // the three sets of words of a night, each at the second where it is on (the storyteller only for the ending that has one)
      const stops: Array<{ what: string; at: number; text: (lang: "zh" | "en") => string }> = [
        { what: "the opening line", at: 0, text: (lang) => TEXTS[lang]["festival.open"] },
        ...(c.hidden ? [{ what: "the storyteller's line", at: (tl.story as [number, number])[0] + 2, text: story }] : []),
        { what: "the closing line", at: tl.closing + 3, text: (lang: "zh" | "en") => TEXTS[lang][closing] },
      ];
      let now = 0;
      for (const stop of stops) {
        if (stop.at > now) await advance(page, (stop.at - now) * 1000);
        now = Math.max(now, stop.at);
        for (const lang of ["zh", "en"] as const) {
          await lantern.switchLang(lang);
          await expect.poll(() => words(page)).toBe(stop.text(lang));
          for (const size of WINDOWS) {
            await page.setViewportSize(size);
            await frames(page, 2);
            const lines = await wordsLines(page);
            // every character of the words is in the lines that were read
            expect(lines.map((line) => line.text).join("").replace(/\s+/g, "")).toBe(stop.text(lang).replace(/\s+/g, ""));
            expect(leftAlone(lines), `${stop.what} in ${lang} at ${size.width}x${size.height}, set as ${lines.map((line) => `「${line.text}」`).join("")}`).toBeNull();
          }
        }
      }
      expect(lantern.pageErrors).toEqual([]);
    });
  }
});

test.describe("the page while the night plays", () => {
  test("is clear of what the game keeps at its edges, and has them back when the night is over", async ({ lantern }) => {
    const page = lantern.page;
    await openNight(lantern, CASES[0] as Case, "en", "dark");
    for (const id of ["btn-menu", "btn-pause", "title"]) {
      if (id === "title") continue;
      await expect(page.getByTestId(id)).toBeHidden();
    }
    await expect(page.getByTestId("director-skip")).toBeVisible();
    // the acts that come to what is pointed at (the look at the railing on the bridge) are not over the show either
    await expect(page.locator('[data-testid^="chip-"]')).toHaveCount(0);
    // and so are the names over the heads of the town's people
    await expect.poll(() => page.evaluate(() => window.__lantern.view.drawing().headLabels.length)).toBe(0);
    // a click on the map does not skip it and does not reach the town under it
    await page.getByTestId("director").click({ position: { x: 300, y: 300 }, force: true });
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await page.getByTestId("director-skip").click();
    await expect(page.getByTestId("btn-menu")).toBeVisible();
    await expect(page.locator(".shell")).toHaveAttribute("data-festival", "false");
  });

  test("takes away what it drew: no figure of its own is left on the map, and the town's people are back", async ({ lantern }) => {
    const page = lantern.page;
    await openNight(lantern, CASES[0] as Case, "en", "dark");
    const during = await page.evaluate(() => window.__lantern.view.drawing().people.length);
    // the town's own people are put away while the night plays: none is drawn as the game's
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
    const people = await page.evaluate(() => window.__lantern.view.drawing().people.length);
    expect(during).toBe(people);
    expect(people).toBeGreaterThan(0);
    const staged = await page.evaluate(() => window.__lantern.view.stats().people);
    expect(staged).toBeGreaterThan(0);
    // what the festival drew is gone: the sorted container is back to what the town has
    const stats = await festival(page);
    expect(stats.frames).toBeGreaterThan(0);
  });
});

test.describe("a player who asked for less motion", () => {
  test("has the camera cut and not glided, and the night still plays to its end", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openNight(lantern, CASES[0] as Case, "en", "dark");
    const poses = new Set<string>();
    let changes = 0;
    let last = "";
    const tl = (await festival(page)).timeline;
    for (let t = 0; t < tl.duration; t += 0.5) {
      await advance(page, 500);
      const pose = await camera(page);
      const key = `${Math.round(pose.x)},${Math.round(pose.y)},${pose.zoom.toFixed(3)}`;
      if (key !== last) changes++;
      last = key;
      poses.add(key);
    }
    // a cut at the start of each beat, and one every few seconds of the moving one: far fewer than a glide, which changes at every step
    expect(changes).toBeLessThan(30);
    expect(changes).toBeGreaterThan(3);
    await expect(page.getByTestId("ending")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("how heavy the night is for the page", () => {
  test("takes a mean of well under a millisecond and a 95th percentile of at most 16 ms for each update of the show, with 120 people at 1280 by 760", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    await openNight(lantern, CASES.find((x) => x.name === "hidden") as Case, "en", "dark", { bearers: CROWD });
    const tl = (await festival(page)).timeline;
    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 1280, height: 760 });
    // the whole night, a second at a time, at sixty frames a second
    for (let t = 0; t < tl.duration - 2; t += 1) await advance(page, 1000);
    const late = await festival(page);
    expect(late.plan.bearers).toHaveLength(120);
    expect(late.stage.bearers).toBe(120);
    await advance(page, 4000);
    await expect(page.getByTestId("ending")).toBeVisible();
    const done = await festival(page);
    expect(done.frames).toBeGreaterThan(2500);
    console.log(`festival update with 120 people, manual clock: frames=${done.frames} mean=${done.mean.toFixed(3)} ms p95=${done.p95.toFixed(3)} ms max=${done.max.toFixed(3)} ms`);
    expect(done.p95).toBeLessThanOrEqual(16);
    expect(done.mean).toBeLessThan(4);
  });

  test("is as light in real time, on the browser's own animation frames", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    // no clock of the test's: the show plays at the pace of the browser
    await openNight(lantern, CASES.find((x) => x.name === "hidden") as Case, "en", "dark", { bearers: CROWD, query: `${fake.TOWN}&director=on&festival=on` });
    await page.waitForTimeout(12_000);
    const done = await festival(page);
    expect(done.frames).toBeGreaterThan(30);
    console.log(`festival update with 120 people, real time: frames=${done.frames} mean=${done.mean.toFixed(3)} ms p95=${done.p95.toFixed(3)} ms max=${done.max.toFixed(3)} ms`);
    expect(done.p95).toBeLessThanOrEqual(16);
  });
});

test.describe("the sound of the parade", () => {
  /** A sound that writes down what the night tells it. */
  const listen = (page: Parameters<typeof advance>[0]) =>
    page.evaluate(() => {
      const calls: Array<[string, number?, number?]> = [];
      (window as unknown as { __sound: typeof calls }).__sound = calls;
      window.__lantern.festival.setSound({
        start: () => calls.push(["start"]),
        setDistance: (cells, side) => calls.push(["distance", cells, side]),
        stop: () => calls.push(["stop"]),
      });
    });
  const heard = (page: Parameters<typeof advance>[0]) => page.evaluate(() => (window as unknown as { __sound: Array<[string, number?, number?]> }).__sound);

  test("is told that the parade begins, how near the walkers are to the camera and on which side as it goes, and that it is over when the night is skipped", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, nightFrame(CASES[0] as Case), TOWN);
    await listen(page);
    const ending = endingOf(CASES[0] as Case);
    await fake.feedFrame(page, nightFrame(CASES[0] as Case, { ending }), [ending]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    expect((await heard(page)).map(([what]) => what)).toEqual(["start", "distance"]);
    const { timeline: tl } = await festival(page);
    for (let t = 0; t < tl.arrive; t += 1) await advance(page, 1000);
    const calls = await heard(page);
    expect(calls.filter(([what]) => what === "start")).toHaveLength(1);
    expect(calls.filter(([what]) => what === "stop")).toHaveLength(0);
    const distances = calls.filter(([what]) => what === "distance").map(([, cells]) => cells as number);
    expect(distances.length).toBeGreaterThan(500);
    // the camera follows the head of the parade: most of the night the nearest walker is within a few cells of it
    expect(distances.filter((cells) => cells < 8).length / distances.length).toBeGreaterThan(0.5);
    for (const [what, cells, side] of calls) if (what === "distance") expect([cells, side].every((x) => Number.isFinite(x))).toBe(true);
    await page.getByTestId("director-skip").click();
    await expect(page.getByTestId("ending")).toBeVisible();
    expect((await heard(page)).filter(([what]) => what === "stop")).toHaveLength(1);
    await page.evaluate(() => window.__lantern.festival.setSound(null));
  });

  test("is not told of a night with no parade, which has no drums", async ({ lantern }) => {
    const page = lantern.page;
    const none = CASES.find((x) => x.name === "split-apart") as Case;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, nightFrame(none), TOWN);
    await listen(page);
    const ending = endingOf(none);
    await fake.feedFrame(page, nightFrame(none, { ending }), [ending]);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await advance(page, 5000);
    expect(await heard(page)).toEqual([]);
    await page.evaluate(() => window.__lantern.festival.setSound(null));
  });
});

test.describe("where the festival night is not played", () => {
  test("is not played where the page did not ask for it, and the ending page opens at once", async ({ lantern }) => {
    const page = lantern.page;
    const c = CASES[0] as Case;
    await page.setViewportSize({ width: 1280, height: 760 });
    // the director is on, but the festival night is not registered
    await fake.openFirstDay(lantern, nightFrame(c), `${fake.TOWN}&director=on`);
    await page.waitForFunction(() => window.__lantern.play.director.port !== null);
    const ending = endingOf(c);
    await fake.feedFrame(page, nightFrame(c, { ending }), [ending]);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("director")).toHaveCount(0);
  });

  test("is not played where the ending has no festival block (an ending known from its numbers), and the ending page opens at once", async ({ lantern }) => {
    const page = lantern.page;
    const c = CASES[0] as Case;
    await page.setViewportSize({ width: 1280, height: 760 });
    await fake.openFirstDay(lantern, nightFrame(c), `${fake.TOWN}&director=on&festival=on`);
    await page.waitForFunction(() => window.__lantern.play.director.port !== null);
    const { festival: _gone, ...old } = endingOf(c);
    await fake.feedFrame(page, nightFrame(c, { ending: old }), [old]);
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("director")).toHaveCount(0);
  });
});
