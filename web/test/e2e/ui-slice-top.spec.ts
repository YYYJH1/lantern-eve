import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const WORDS = {
  en: { day: "Day 1", clock: "08:30", weather: "Clear", left: "4 days to the festival", task: "Get the first load of bamboo from the Li family", pause: "Resume" },
  zh: { day: "第一天", clock: "08:30", weather: "晴", left: "离灯会还有四天", task: "借到李家的第一批竹料", pause: "继续" },
} as const;

test.describe("the top bar", () => {
  test("has the day, the hour, the weather, the days left and the task that is followed, in both languages and both themes, and the two drawings of the world", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const bar = page.locator("header.topbar");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        await expect(bar.getByTestId("hud-day")).toHaveText(w.day);
        await expect(bar.getByTestId("hud-clock")).toHaveText(w.clock);
        await expect(bar.getByTestId("hud-weather")).toHaveText(w.weather);
        await expect(bar.getByTestId("hud-left")).toHaveText(w.left);
        await expect(bar.getByTestId("topbar-task-text")).toHaveText(w.task);
        await expect(bar.getByTestId("btn-pause")).toHaveText(w.pause);
        await expect(bar.getByTestId("btn-menu")).toBeVisible();
        // The text is readable on what is behind it.
        expect(await fake.contrast(page, '[data-testid="topbar-task-text"]'), `${theme} ${lang} task`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="hud-day"]'), `${theme} ${lang} day`).toBeGreaterThan(4.5);
        expect(await fake.overflows(page, '[data-testid="topbar-task-text"]')).toBe(false);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the language, the theme, the model and the cost in the menu and not in the bar", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const bar = page.locator("header.topbar");
    for (const id of ["lang-switch", "theme-switch", "select-provider", "stat-cost", "budget"]) await expect(bar.getByTestId(id)).toHaveCount(0);
    // Shut, the menu shows none of them. Open, it has all of them.
    await expect(page.getByTestId("lang-switch")).toBeHidden();
    await page.getByTestId("btn-menu").click();
    for (const id of ["lang-switch", "theme-switch", "select-provider", "stat-cost", "budget", "budget-notes"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("menu-look")).toContainText("Language and theme");
    await expect(page.getByTestId("stat-cost")).toContainText("¥0.00");
    await page.getByTestId("lang-zh").click();
    await expect(page.getByTestId("menu-look")).toContainText("语言与主题");
    await expect(page.getByTestId("hud-cost")).toContainText("本局花费");
    await page.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("shows a dash for the task until the frame has a list, asks the player to pick when none is followed, and shows how the followed task stands", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(fake.TOWN, { menu: false });
    await lantern.waitForTick(300);
    // The core follows its first task from the start of the day.
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Get the first load of bamboo from the Li family");
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-id", "t_bamboo_first");
    await fake.feedFrame(page, fake.tasks(null));
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Pick something to do");
    await lantern.setLang("zh");
    await expect(page.getByTestId("topbar-task-text")).toHaveText("挑一件事来办");
    await lantern.setLang("en");
    await fake.feedFrame(page, fake.tasks("t_source"));
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Why was Li Er by the bridge that night?");
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-id", "t_source");
    await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "blocked");
    const done = fake.tasks("t_bamboo_first");
    (done.tasks as Array<Record<string, unknown>>)[0] = { ...(done.tasks as Array<Record<string, unknown>>)[0], state: "done" };
    await fake.feedFrame(page, done);
    await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "done");
    // A tracked id that the list does not have is no task.
    await fake.feedFrame(page, { ...fake.tasks(), tracked: "t_gone" });
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Pick something to do");
  });

  test("counts the days to the festival down, and says so on the last day", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const at = (day: number) => fake.feedFrame(page, { time: { day, hour: 9, minute: 0, phase: "day" } });
    await at(4);
    await expect(page.getByTestId("hud-left")).toHaveText("1 day to the festival");
    await at(5);
    await expect(page.getByTestId("hud-left")).toHaveText("The festival is tonight");
    await lantern.setLang("zh");
    await expect(page.getByTestId("hud-left")).toHaveText("今晚就是灯会");
    await at(3);
    await expect(page.getByTestId("hud-left")).toHaveText("离灯会还有二天");
    await at(4);
    await expect(page.getByTestId("hud-left")).toHaveText("离灯会还有一天");
  });

  test("does not call the player's own pause a hold by the talk", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    // The world stands still because the player (the test) paused it, and a talk does not change what that is called.
    await expect(page.getByTestId("status")).toHaveText("paused");
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("talk-area")).toBeVisible();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
  });
});

test.describe("the speed of the day", () => {
  test("is chosen in the menu, remembered by the viewer, and told to the host as a multiple of the common pace", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await lantern.openMenu();
    await expect(page.getByTestId("speed-normal")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("speed-slow")).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => {
      const client = window.__lantern.client;
      const seen: number[] = [];
      (window as unknown as { __pace: number[] }).__pace = seen;
      const original = client.setPace.bind(client);
      client.setPace = (speed: number) => {
        seen.push(speed);
        original(speed);
      };
    });
    await page.getByTestId("speed-slow").click();
    await expect(page.getByTestId("speed-slow")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("lantern.speed"))).toBe("slow");
    const asked = () => page.evaluate(() => (window as unknown as { __pace: number[] }).__pace);
    await expect.poll(asked).toEqual([0.75]);
    await page.getByTestId("speed-normal").click();
    await expect.poll(asked).toEqual([0.75, 1]);
    await page.getByTestId("speed-slow").click();
    // A new visit has the choice again.
    await lantern.open(fake.TOWN, { menu: true });
    await expect(page.getByTestId("speed-slow")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("speed-switch")).toHaveAttribute("title", /three minutes of daylight/);
    await lantern.setLang("zh");
    await expect(page.getByTestId("speed-switch")).toHaveAttribute("title", /白天大约三分钟/);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the budget", () => {
  test("tells the player in a note that can be put away when a limit is crossed, and has its gauge and its words in the menu", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const cap = 3_000_000;
    await fake.feedFrame(page, { hud: { cap, spent: 2_200_000, held: 0, stage: 1, cloud: true, local: false } }, [{ kind: "budget_stage", tick: 301, stage: 1, previous: 0, spent: 2_200_000, held: 0, cap }]);
    const note = page.getByTestId("game-note");
    await expect(note.last()).toContainText("70% of the budget is spent or held, so the strong model is off.");
    await expect(note.last()).toHaveAttribute("data-kind", "bad");
    // The note has a button that puts it away.
    await note.last().getByRole("button").click();
    await expect(note).toHaveCount(0);
    // The gauge and its words are in the menu.
    await page.getByTestId("btn-menu").click();
    await expect(page.getByTestId("budget")).toHaveAttribute("data-stage", "1");
    await expect(page.getByTestId("budget-gauge")).toHaveAttribute("data-used", "73");
    await expect(page.getByTestId("budget-notes")).toContainText("so the strong model is off");
    await expect(page.getByTestId("stat-cost")).toContainText("¥2.20");
    // And in Chinese, with the note in Chinese too.
    await page.getByTestId("menu-close").click();
    await lantern.setLang("zh");
    await fake.feedFrame(page, { hud: { cap, spent: 2_800_000, held: 0, stage: 2, cloud: true, local: false } }, [{ kind: "budget_stage", tick: 302, stage: 2, previous: 1, spent: 2_800_000, held: 0, cap }]);
    await expect(note.last()).toContainText("预算已用或已预留到 90%，云端模型都停了。");
    await note.last().getByRole("button").click();
    await expect(note).toHaveCount(0);
  });
});

// The note of the slip opens under its title, which runs to two lines or more where the words are long, and while a person is picked their note stands at the foot of the
// page. The note of the slip ends above the note of the person, whatever lines the title runs to, and scrolls inside what room it has. Looked at in the windows of the
// smallest size and a little above it, in Chinese on the light theme and in English on the dark one.

const NOTE_WINDOWS = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 760 },
];

const NOTE_LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

const name = (zh: string, en: string) => ({ zh, en });

/** The task that clears the talk of Li Er in public, as the core words it: a long title, the reason, the next step, the window and who will be there. */
const LONG_TASK = {
  id: "t_clear_rumour",
  kind: "obstacle",
  job: "truth",
  text: name("「李二毁桥」这话还没有当众说清", "The talk that Li Er wrecked the bridge has not been set straight in public"),
  why: name("李老太认定你默认了这话，不肯借竹料。", "Granny Li takes your silence for consent, so she lends no bamboo."),
  next: name("用你判对了的两句话，当众说清。", "Set it straight in public with the two lines you judged."),
  state: "open",
  blocker: null,
  action: { verb: "move", place: "p_teahouse" },
  window: { day: 1, from: 17, to: 19, place: "p_teahouse" },
  expected: [
    { id: "cha_laoban", from: 1020, to: 1140 },
    { id: "zhou_huoji", from: 1116, to: 1140 },
    { id: "li_laotai", from: 1050, to: 1140 },
    { id: "li_da", from: 1050, to: 1140 },
    { id: "zuzhang", from: 1080, to: 1140 },
    { id: "gengfu", from: 1080, to: 1140 },
  ],
};

for (const size of NOTE_WINDOWS) {
  for (const look of NOTE_LOOKS) {
    test.describe(`the note of the slip and the note of a picked person, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      test("ends above the note of the person, with a title that runs to more than one line, and scrolls; it is as tall as what is written in it when nobody is picked", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        const others = (fake.tasks("t_source").tasks as Array<Record<string, unknown>>).filter((task) => task.id !== "t_bamboo_first");
        await fake.openFirstDay(lantern, { tracked: "t_clear_rumour", tasks: [LONG_TASK, ...others] });
        const read = () =>
          page.evaluate(() => {
            const box = (css: string) => {
              const el = document.querySelector(css);
              if (el === null) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, scroll: el.scrollHeight, client: el.clientHeight };
            };
            return { head: box('[data-testid="slip-head"]'), note: box(".slip-note"), card: box('[data-testid="person-card"]') };
          });
        await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_clear_rumour");
        // Nobody is picked: the note is as tall as what is written in it.
        const alone = await read();
        expect(alone.card).toBeNull();
        expect(alone.note?.scroll).toBeLessThanOrEqual((alone.note?.client ?? 0) + 1);
        // A person is picked: their note stands at the foot of the page, and the note of the slip is over it.
        await page.evaluate(() => {
          window.__lantern.view.events.select?.("li_laotai");
        });
        await expect(page.getByTestId("person-card")).toBeVisible();
        await expect.poll(async () => (await read()).card?.top ?? 0).toBeGreaterThan(0);
        const picked = await read();
        expect(picked.head && picked.head.bottom - picked.head.top, "the title runs to more than one line").toBeGreaterThan(70);
        expect(picked.note?.bottom ?? 1e9, "the note of the slip ends above the note of the person").toBeLessThanOrEqual((picked.card?.top ?? 0) - 7);
        // What does not fit scrolls: the note has more written in it than it shows.
        expect(picked.note?.scroll ?? 0).toBeGreaterThanOrEqual(picked.note?.client ?? 0);
        // The phrase that does the step is in view and is not under the note of the person.
        const act = await page.evaluate(() => {
          const button = document.querySelector('[data-testid="task-do"]');
          if (button === null) return false;
          const r = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        expect(act, "the phrase of the step is in reach").toBe(true);
        // The person is put away: the note is as it was.
        await page.evaluate(() => {
          window.__lantern.view.events.select?.(null);
        });
        await expect(page.getByTestId("person-card")).toHaveCount(0);
        await expect.poll(async () => ((await read()).note?.scroll ?? 0) <= ((await read()).note?.client ?? 0) + 1).toBe(true);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
