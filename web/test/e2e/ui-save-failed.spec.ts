import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { startServerHost } from "../support/server-host.ts";
import * as fake from "../support/slice.ts";

// A save that cannot be made is told on the page, in both languages: over the map for a save of the page's own (once for each kind of failure
// until a save is made again), and in the menu, where it says what came of a save, for one the player asked for. The store of saves is made to
// refuse by the test build's worker (`fail-saves`), so the host answers as it does when a browser will not let the game write, when the store is full
// or when the host is busy, and the page reads the answer as it always has. The frames are the test's own: a morning with its paper, which is
// what the page saves at. The words are the ones the page has under `save.failed.*`.

const WORDS = {
  en: {
    storage: "The game could not be saved: the browser did not let it write. You can try again from Saves in the menu.",
    full: "The game could not be saved: the browser has no room left for it. Delete an old save under Saves in the menu, then try again.",
    server: "The game could not be saved: this game is run by a server, which keeps no saves.",
    other: "The game could not be saved. You can try again from Saves in the menu.",
  },
  zh: {
    storage: "没能存档：浏览器没有让游戏写入。可以在菜单的「存档」里再存一次。",
    full: "没能存档：浏览器给这个页面留的地方满了。可以在菜单的「存档」里删掉旧存档，再存一次。",
    server: "没能存档：这一局由服务器运行，服务器不保存存档。",
    other: "没能存档。可以在菜单的「存档」里再存一次。",
  },
} as const;

const QUIET = { head: { kind: "quiet", text: { zh: "昨天镇上没有什么大事。", en: "Nothing much happened in town yesterday." } }, news: [] };

/** The morning of a day: the paper comes in the frame of the tick that made it, which reads 07:00, and with no event `recap`, as when the core had nothing to recap. */
const morning = (page: Page, day: number): Promise<void> => fake.feedFrame(page, { time: { day, hour: 7, minute: 0, phase: "day" }, gazette: fake.gazetteBody({ day, ...QUIET }), recap: null });

/** The player reads the paper and puts it away. */
async function putAway(page: Page): Promise<void> {
  await expect(page.getByTestId("gazette")).toBeVisible();
  await page.getByTestId("gazette-done").click();
  await expect(page.getByTestId("gazette")).toHaveCount(0);
}

/** How many saves of the page's own the host has refused so far: the page says so in the console each time it could not make one. */
const refused = (lantern: LanternPage): number => lantern.consoleLines.filter((line) => line.includes("the game was not saved by itself")).length;

for (const lang of ["en", "zh"] as const) {
  test.describe(`a save of the page's own that cannot be made, in ${lang === "en" ? "English" : "Chinese"}`, () => {
    test("is told over the map once for a kind of failure, and again when it fails after a save was made", async ({ lantern }) => {
      const page = lantern.page;
      await lantern.open(`${fake.TOWN}&autosave=on`, { menu: false });
      await lantern.waitForTick(300);
      if (lang === "zh") await lantern.setLang("zh");
      const failed = page.getByTestId("save-failed");
      await lantern.e2e("fail-saves", { how: "storage" });

      // The second morning: the browser would not let the game write. The paper is up and lies over the place of the note, so the note waits behind it,
      // and is there when the paper is put away.
      await morning(page, 2);
      await expect.poll(() => refused(lantern)).toBe(1);
      await expect(failed).toHaveCount(0);
      await putAway(page);
      await expect(failed).toHaveText(WORDS[lang].storage);
      await expect(failed).toHaveAttribute("data-kind", "storage");
      // The player puts the note away. The next morning fails the same way, and the page says nothing more.
      await page.getByTestId("save-failed-close").click();
      await expect(failed).toHaveCount(0);
      await morning(page, 3);
      await expect.poll(() => refused(lantern)).toBe(2);
      await putAway(page);
      await expect(failed).toHaveCount(0);

      // Another kind of failure is news.
      await lantern.e2e("fail-saves", { how: "quota" });
      await morning(page, 4);
      await expect.poll(() => refused(lantern)).toBe(3);
      await putAway(page);
      await expect(failed).toHaveText(WORDS[lang].full);
      await expect(failed).toHaveAttribute("data-kind", "full");

      // The browser lets the game write again: the next morning is saved, and the note that is still up goes with it.
      await lantern.e2e("fail-saves", { how: null });
      await morning(page, 5);
      await expect(page.getByTestId("autosave-note")).toBeVisible();
      await expect(failed).toHaveCount(0);
      await putAway(page);
      await expect(failed).toHaveCount(0);
      expect((await page.evaluate(() => window.__lantern.client.state.saves.map((save) => save.name))).length).toBe(1);

      // And when it will not again, that is news again.
      await lantern.e2e("fail-saves", { how: "storage" });
      await morning(page, 6);
      await expect.poll(() => refused(lantern)).toBe(4);
      await putAway(page);
      await expect(failed).toHaveText(WORDS[lang].storage);
      expect(lantern.pageErrors).toEqual([]);
    });

    test("is told when the host is busy too, with the plain words for a save that could not be made", async ({ lantern }) => {
      const page = lantern.page;
      await lantern.open(`${fake.TOWN}&autosave=on`, { menu: false });
      await lantern.waitForTick(300);
      if (lang === "zh") await lantern.setLang("zh");
      await lantern.e2e("fail-saves", { how: "busy" });
      await morning(page, 2);
      await putAway(page);
      await expect(page.getByTestId("save-failed")).toHaveText(WORDS[lang].other);
      await expect(page.getByTestId("save-failed")).toHaveAttribute("data-kind", "other");
    });
  });

  test.describe(`a save from the menu that cannot be made, in ${lang === "en" ? "English" : "Chinese"}`, () => {
    test("says so where the menu says what came of a save, and not over the map", async ({ lantern }) => {
      const page = lantern.page;
      await lantern.open(fake.TOWN);
      await lantern.waitForTick(300);
      if (lang === "zh") await lantern.setLang("zh");
      const notice = page.getByTestId("notice");

      await lantern.e2e("fail-saves", { how: "quota" });
      await page.getByTestId("btn-save").click();
      await expect(notice).toHaveText(WORDS[lang].full);
      await lantern.e2e("fail-saves", { how: "storage" });
      await page.getByTestId("btn-save").click();
      await expect(notice).toHaveText(WORDS[lang].storage);
      await lantern.e2e("fail-saves", { how: "busy" });
      await page.getByTestId("btn-save").click();
      await expect(notice).toHaveText(WORDS[lang].other);
      // The save did not happen, and nothing is said over the map: the menu has it.
      expect(await page.evaluate(() => window.__lantern.client.state.saves.length)).toBe(0);
      await expect(page.getByTestId("save-failed")).toHaveCount(0);

      // It is the same button when the browser lets the game write: the words of a save that was made.
      await lantern.e2e("fail-saves", { how: null });
      await page.getByTestId("btn-save").click();
      await expect(notice).toContainText(lang === "en" ? "saved #1" : "已存档 #1");
      expect(await page.evaluate(() => window.__lantern.client.state.saves.length)).toBe(1);
      expect(lantern.pageErrors).toEqual([]);
    });

    test("keeps the kind of the failure and makes its words when it is drawn: the language is switched right after it, and the words are the new language's", async ({ lantern }) => {
      const page = lantern.page;
      await lantern.open(fake.TOWN);
      await lantern.waitForTick(300);
      if (lang === "zh") await lantern.setLang("zh");
      const notice = page.getByTestId("notice");
      const other = lang === "en" ? "zh" : "en";
      await lantern.e2e("fail-saves", { how: "storage" });
      await page.getByTestId("btn-save").click();
      await expect(notice).toHaveText(WORDS[lang].storage);
      // The switch comes at once: no save is made between the failure and it.
      await lantern.setLang(other);
      await expect(notice).toHaveText(WORDS[other].storage);
      await lantern.setLang(lang);
      await expect(notice).toHaveText(WORDS[lang].storage);
      // What the menu says of a save that was made follows the language too.
      await lantern.e2e("fail-saves", { how: null });
      await page.getByTestId("btn-save").click();
      await expect(notice).toContainText(lang === "en" ? "saved #1" : "已存档 #1");
      await lantern.setLang(other);
      await expect(notice).toContainText(other === "en" ? "saved #1" : "已存档 #1");
      expect(lantern.pageErrors).toEqual([]);
    });
  });
}

test("the note of a save that could not be made waits behind the menu, the notebook and the ledger, which lie over its place, and is there when they are shut", async ({ lantern }) => {
  const page = lantern.page;
  await lantern.open(`${fake.TOWN}&autosave=on`, { menu: false });
  await lantern.waitForTick(300);
  await lantern.e2e("fail-saves", { how: "storage" });
  await morning(page, 2);
  await putAway(page);
  const failed = page.getByTestId("save-failed");
  await expect(failed).toBeVisible();
  await page.getByTestId("btn-menu").click();
  await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "true");
  await expect(failed).toHaveCount(0);
  await page.getByTestId("menu-close").click();
  await expect(failed).toBeVisible();
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  await expect(failed).toHaveCount(0);
  await page.getByTestId("notebook-close").click();
  await expect(failed).toBeVisible();
  await page.getByTestId("board-toggle").click();
  await expect(page.getByTestId("board")).toHaveAttribute("data-open", "true");
  await expect(failed).toHaveCount(0);
  await page.getByTestId("board-toggle").click();
  await expect(failed).toBeVisible();
});

test.describe("a kind of failure counts as told when its notice was on screen, and not before", () => {
  /** The player begins a new game from the menu, which is how the page is reset to a game that has no save yet, and lets the game that has begun stand still. */
  async function newGame(lantern: LanternPage): Promise<void> {
    const page = lantern.page;
    const frames = await page.evaluate(() => window.__lantern.client.state.frameCount);
    await page.getByTestId("btn-menu").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "true");
    await page.getByTestId("btn-new").click();
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    // The host has drawn a first picture of the game that began, and it is held there for the frames of the test.
    await page.waitForFunction((count) => window.__lantern.client.state.frameCount > count && window.__lantern.client.state.simTick < 300, frames);
    await page.evaluate(() => window.__lantern.client.pause());
  }

  test("a notice that waited behind the paper of the morning is not lost for good when the player begins a new game: the failure that comes back after it is told", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(`${fake.TOWN}&autosave=on`, { menu: false });
    await lantern.waitForTick(300);
    await lantern.e2e("fail-saves", { how: "storage" });
    const failed = page.getByTestId("save-failed");
    // The second morning: the save fails while the paper lies over the place of the notice, so the notice waits and nobody sees it.
    await morning(page, 2);
    await expect.poll(() => refused(lantern)).toBe(1);
    await expect(page.getByTestId("gazette")).toBeVisible();
    await expect(failed).toHaveCount(0);
    // The player begins a new game before any save was made, and the notice that waited goes with the game that was.
    await newGame(lantern);
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    // The morning of the game that has begun fails the same way, and this time the notice is told.
    await fake.feedFrame(page, { time: { day: 1, hour: 6, minute: 0, phase: "day" } });
    await morning(page, 2);
    await expect.poll(() => refused(lantern)).toBe(2);
    await putAway(page);
    await expect(failed).toHaveText(WORDS.en.storage);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a failure of a save from the menu that came back after the menu was shut told nobody: the failure of the page's own save that follows is told over the map", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(`${fake.TOWN}&autosave=on`);
    await lantern.waitForTick(300);
    // A host that is slow to refuse: the save is asked for with the menu open, and the failure comes back when it is shut.
    await page.evaluate(() => {
      const client = window.__lantern.client as unknown as { save: () => Promise<never> };
      client.save = () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("AbortError: the transaction was aborted"), { code: "host_error" })), 500));
    });
    await page.getByTestId("btn-save").click();
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("notice")).toHaveText(WORDS.en.storage);
    // The page's own save fails the same way at the next morning, and the notice comes over the map: nobody has read the words in the menu.
    await page.evaluate(() => {
      delete (window.__lantern.client as unknown as Record<string, unknown>).save;
    });
    await lantern.e2e("fail-saves", { how: "storage" });
    await morning(page, 2);
    await expect.poll(() => refused(lantern)).toBe(1);
    await putAway(page);
    await expect(page.getByTestId("save-failed")).toHaveText(WORDS.en.storage);
  });

  test("a failure said in the open menu counts as told: the same trouble of the page's own save is not told over the map again", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(`${fake.TOWN}&autosave=on`);
    await lantern.waitForTick(300);
    await lantern.e2e("fail-saves", { how: "storage" });
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toHaveText(WORDS.en.storage);
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    await morning(page, 2);
    await expect.poll(() => refused(lantern)).toBe(1);
    await putAway(page);
    await expect(page.getByTestId("save-failed")).toHaveCount(0);
  });
});

test.describe("a save from the menu on the server host", () => {
  test("says in plain words that the server keeps no saves, in both languages", async ({ page }) => {
    test.setTimeout(300_000);
    const server = await startServerHost("save-failed");
    try {
      await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
      await page.goto(`${server.origin}/?host=ws&map=off`);
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 90_000 });
      await page.getByTestId("opening-start").click();
      await expect(page.getByTestId("status")).toHaveText("running");
      await page.getByTestId("btn-menu").click();
      await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "true");
      await page.getByTestId("btn-save").click();
      await expect(page.getByTestId("notice")).toHaveText(WORDS.en.server);
      await page.getByTestId("lang-zh").click();
      await page.getByTestId("btn-save").click();
      await expect(page.getByTestId("notice")).toHaveText(WORDS.zh.server);
    } finally {
      expect(await server.stop()).toBe(0);
    }
  });
});
