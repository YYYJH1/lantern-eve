import { expect, test } from "../support/fixtures.ts";
import { mapDrawn } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const BLOCKER = {
  en: "The Li family will not give the bamboo",
  zh: "李家不肯给竹料",
};

test.describe("the task card", () => {
  test("says what the task is, why, what to do next, what is in the way and when and where, with a button that does it, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const card = page.getByTestId("task-card");
    const words = {
      en: { title: "Now", text: "Get the first load of bamboo from the Li family", why: "The town is saying Li Er broke the bridge. Granny Li is angry that you, the manager, have said nothing.", next: "Find out who started that talk.", when: "Li Family House, 08:00 to 17:00", button: "Talk to Granny Li", state: "blocked", job: "The bridge" },
      zh: { title: "眼下", text: "借到李家的第一批竹料", why: "镇上都在传李二毁了桥。李老太怪你这个总管一声不吭。", next: "问清这话是谁先说的。", when: "李家宅，辰时 08:00 到 17:00", button: "去找李老太说话", state: "卡住了", job: "修桥" },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = words[lang];
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute("aria-label", w.title);
        await expect(card.getByTestId("task-job")).toHaveText(w.job);
        await expect(card.getByTestId("task-text")).toHaveText(w.text);
        await expect(card.locator(".slip-head").getByTestId("task-state")).toHaveText(w.state);
        await expect(card.getByTestId("task-why")).toHaveText(w.why);
        await expect(card.getByTestId("task-next")).toHaveText(w.next);
        await expect(card.getByTestId("task-blocker")).toHaveText(`${lang === "zh" ? "卡住了，" : "In the way: "}${BLOCKER[lang]}`);
        await expect(card.getByTestId("task-window")).toHaveText(w.when);
        await expect(card.getByTestId("task-do")).toHaveText(w.button);
        for (const selector of ['[data-testid="task-text"]', '[data-testid="task-why"]', '[data-testid="task-do"]', '[data-testid="task-blocker"]']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does its action when the button is clicked: a walk to the person, a walk to the place, and the list of a talk after the walk", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    // Talk to Granny Li, who is far away: the page walks the player up to her first.
    await page.getByTestId("task-do").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc)).toBe("li_laotai");
    expect((await fake.sentSoFar(page))[0]).toMatchObject({ type: "move" });
    // The task of the evening goes to the teahouse, by the place.
    await fake.feedFrame(page, fake.tasks("t_evening"));
    await expect(page.getByTestId("task-do")).toHaveText("Go to Teahouse");
    await page.getByTestId("task-do").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "move", place: "p_teahouse" });
    // A task with no action has no button.
    const bare = fake.tasks("t_promise");
    (bare.tasks as Array<Record<string, unknown>>)[3] = { ...(bare.tasks as Array<Record<string, unknown>>)[3], action: null };
    await fake.feedFrame(page, bare);
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_promise");
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-why")).toHaveCount(0);
    await expect(page.getByTestId("task-window")).toHaveCount(0);
  });

  test("lists the other tasks, each with a button to follow it where the core lets the player, and tells the player what changed", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    const more = page.getByTestId("task-more");
    await expect(more).toBeVisible();
    await expect(more.locator("summary")).toHaveText("3 more");
    await expect(page.getByTestId("task-other").first()).toBeHidden();
    await more.locator("summary").click();
    await expect(page.getByTestId("task-other")).toHaveCount(3);
    await expect(page.getByTestId("task-other").first()).toContainText("Why was Li Er by the bridge that night?");
    await expect(page.getByTestId("task-other").first().getByTestId("task-state")).toHaveText("open");
    await page.getByTestId("task-other").first().getByTestId("task-track").click();
    expect(await fake.sentSoFar(page)).toEqual([{ type: "track", task: "t_source", action_id: "t0" }]);
    // The core follows it, says why in an event, and the page tells the player: the bar, the card and a note.
    await expect(page.getByTestId("task-changed")).toHaveCount(0);
    await fake.feedFrame(page, fake.tasks("t_source"), [{ kind: "task_changed", tick: 5, from: "t_bamboo_first", to: "t_source", cause: "done", reason: { zh: "李老太撤回了阻拦", en: "Granny Li dropped her objection" } }]);
    // The note goes by itself some seconds after it comes, which a slow machine can take between two calls of a test: it is read first, in both languages, in one call.
    await expect(page.getByTestId("game-note").last()).toBeVisible();
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: "Granny Li dropped her objection", zh: "李老太撤回了阻拦" });
    await expect(page.getByTestId("task-text")).toHaveText("Why was Li Er by the bridge that night?");
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Why was Li Er by the bridge that night?");
    // The line on the card says it in the words of the core, in the language of the page.
    await expect(page.getByTestId("task-changed")).toHaveText("Granny Li dropped her objection");
    await lantern.switchLang("zh");
    await expect(page.getByTestId("task-changed")).toHaveText("李老太撤回了阻拦");
    await expect(page.getByTestId("task-more").locator("summary")).toHaveText("还有三件");
    // Without the verb, the list is for reading.
    await fake.feedFrame(page, { hud: { verbs: ["move"] } });
    await expect(page.getByTestId("task-track")).toHaveCount(0);
    await expect(page.getByTestId("task-other")).toHaveCount(3);
  });

  test("shows the task the core follows, says that nothing is followed when the frame lists tasks and follows none", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(fake.TOWN, { menu: false });
    await lantern.waitForTick(300);
    await expect(page.getByTestId("task-card")).toBeVisible();
    // The core follows its first task from the start of the day.
    await expect(page.getByTestId("task-text")).toHaveText("Get the first load of bamboo from the Li family");
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await fake.feedFrame(page, fake.tasks(null));
    await expect(page.getByTestId("task-text")).toHaveText("Nothing chosen yet. Pick one of the tasks below.");
    await expect(page.getByTestId("task-more").locator("summary")).toHaveText("4 more");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-text")).toHaveText("还没选要办的事，从下面挑一件。");
  });
});

test.describe("what was promised to the player", () => {
  test("is a card for each promise, with who, what, by when and whether it came, and promised and delivered are never the same", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    // The promises are on the page of the bridge in the ledger.
    await page.getByTestId("board-toggle").click();
    const list = page.getByTestId("commitments");
    const card = page.getByTestId("commitment");
    await expect(list).toBeVisible();
    await expect(card).toHaveCount(1);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("en");
      // A promise is a line of the ledger: who, what, and by when, as one sentence. The first day, and the promise is for seven the next morning.
      await expect(card.locator(".commit-what")).toHaveText("Li Da agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning");
      await expect(card).toHaveAttribute("data-by", "li_da");
      await expect(card.getByTestId("commitment-state")).toHaveText("promised");
      await expect(card).toHaveAttribute("data-state", "promised");
      await expect(card.getByTestId("commitment-reason")).toHaveCount(0);
      expect(await fake.contrast(page, '[data-testid="commitment"] .commit-what'), `${theme} what`).toBeGreaterThan(4.5);
      await lantern.setLang("zh");
      await expect(card.locator(".commit-what")).toHaveText("李大答应明早07:00前把四根竹料送到石桥");
      await expect(card.getByTestId("commitment-state")).toHaveText("已答应");
    }
    await lantern.setLang("en");
    // The next morning it is at the bridge. The event of the errand has the id and the amount of the promise.
    await fake.feedFrame(page, fake.commitments("delivered"), [{ kind: "delivered", tick: 400, id: "c_li_da_bamboo", npc: "li_da", item: "bamboo", amount: 4, qty: 4, place: "p_bridge", task: 1 }]);
    await expect(card).toHaveAttribute("data-state", "delivered");
    await expect(card.getByTestId("commitment-state")).toHaveText("delivered");
    await expect(page.getByTestId("game-note").last()).toHaveText("4 poles of bamboo came to the Stone Bridge.");
    // An event that says `qty` and no `amount` has the amount as `qty`.
    await fake.feedFrame(page, {}, [{ kind: "delivered", tick: 401, item: "timber", qty: 3, place: "p_bridge" }]);
    await expect(page.getByTestId("game-note").last()).toHaveText("3 poles of timber came to the Stone Bridge.");
    // A promise that was not kept says why, in the words of the core, and so does one that was taken back.
    await fake.feedFrame(page, fake.commitmentEnded("broken", "rain"), [{ kind: "commitment", tick: 402, id: "c_li_da_bamboo", by: "li_da", state: "broken", item: "bamboo", amount: 4, reason: "rain" }]);
    // The note comes with the state of the card, from the same frame: once the card says so, the note is read, in both languages and in one call, for the reason given above.
    await expect(card.getByTestId("commitment-state")).toHaveText("not kept");
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({
      en: "Li Da did not keep a promise: Bring 4 poles of bamboo to the Stone Bridge. The heavy rain kept the goods off the road.",
      zh: "李大失约了，没把四根竹料送到石桥。下大雨，货运不出来。",
    });
    await expect(card).toHaveAttribute("data-state", "broken");
    await expect(card.getByTestId("commitment-reason")).toHaveText("The heavy rain kept the goods off the road");
    for (const theme of ["light", "dark"] as const) {
      await lantern.switchTheme(theme);
      expect(await fake.contrast(page, '[data-testid="commitment-reason"]'), `${theme} reason`).toBeGreaterThan(4.5);
    }
    await lantern.switchLang("zh");
    await expect(card.getByTestId("commitment-reason")).toHaveText("下大雨，货运不出来");
    await lantern.switchLang("en");
    await fake.feedFrame(page, fake.commitmentEnded("withdrawn", "taken_back"));
    await expect(card.getByTestId("commitment-state")).toHaveText("taken back");
    await expect(card.getByTestId("commitment-reason")).toHaveText("Word is they changed their mind");
    // A promise with no reason in the frame shows no line for it.
    await fake.feedFrame(page, fake.commitmentEnded("withdrawn", null));
    await expect(card.getByTestId("commitment-state")).toHaveText("taken back");
    await expect(card.getByTestId("commitment-reason")).toHaveCount(0);
    // Two days on, the promise is said with its day.
    await fake.feedFrame(page, { ...fake.commitments("delivered"), time: { day: 4, hour: 9, minute: 0, phase: "day" } });
    await expect(card.locator(".commit-what")).toContainText("by Day 2 07:00");
    await fake.feedFrame(page, { commitments: [] });
    await expect(list).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the preparation board of the first day", () => {
  test("is shut at first, with three bookmarks that say how the three jobs stand, and opens to the bridge, the truth and the peace", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const board = page.getByTestId("board");
    await expect(board).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("board-toggle")).toHaveAttribute("aria-expanded", "false");
    // A frame with no board: the bridge is what the hud has, and the other two bookmarks say nothing.
    await expect(page.getByTestId("board-toggle")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("board-tab-truth")).toHaveAttribute("data-state", "");
    await expect(page.getByTestId("board-tab-peace")).toHaveAttribute("data-state", "");
    await expect(page.getByTestId("board-bridge")).toBeHidden();
    await expect(page.getByTestId("board-statement")).toBeHidden();
    await expect(page.getByTestId("board-peace")).toBeHidden();

    await page.getByTestId("board-toggle").click();
    await expect(board).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("board-bridge")).toBeVisible();
    // The bridge: what is promised and what has come, by item; what lies at the bridge.
    const bamboo = page.getByTestId("board-material").first();
    await expect(bamboo).toHaveAttribute("data-item", "bamboo");
    await expect(bamboo).toHaveText(/Bamboo\s*promised 4\s*delivered 0/);
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "0");
    // What the manager can still promise and the stars are on the board too.
    await expect(page.getByTestId("hud-pledges")).toBeVisible();
    await expect(page.getByTestId("hud-festival")).toBeVisible();
    await expect(page.getByTestId("stat-reputation")).toBeVisible();

    // The load of the bamboo comes, and the board says so: promised and delivered are two numbers.
    await fake.feedFrame(page, fake.commitments("delivered"));
    await expect(bamboo).toHaveText(/Bamboo\s*promised 4\s*delivered 4/);
    await expect(bamboo).toHaveAttribute("data-delivered", "4");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "4");
    // Goods that came after the promise was broken lie at the bridge all the same, and the promise is a thing apart: not kept, not delivered.
    await fake.feedFrame(page, { ...fake.commitmentEnded("broken", "late"), site: { bamboo: 4, timber: 0 } });
    await expect(bamboo).toHaveText(/Bamboo\s*promised 0\s*delivered 0\s*not kept 4/);
    await expect(bamboo).toHaveAttribute("data-lost", "4");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "4");
  });

  test("says the same in Chinese, in both themes, and shows a dash for what the frame does not have", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await page.getByTestId("board-toggle").click();
    for (const theme of ["dark", "light"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("zh");
      await expect(page.getByTestId("board-material").first()).toHaveText(/竹料\s*答应四根\s*送到零根/);
      for (const selector of ['[data-testid="board-material"] .lcell', '[data-testid="board-toggle"] .mark-label']) {
        expect(await fake.contrast(page, selector), `${theme} ${selector}`).toBeGreaterThan(4.5);
      }
    }
    // A frame with none of the slice's keys: dashes, and the bridge as the core of today says it.
    await lantern.setLang("en");
    await fake.feedFrame(page, { commitments: undefined, site: undefined, board: undefined, people: undefined, tasks: undefined, judgments: undefined });
    await expect(page.getByTestId("board-materials-empty")).toContainText("–");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "");
    await expect(page.getByTestId("board-helpers")).toContainText("Have 0");
    await expect(page.getByTestId("board-window")).toHaveCount(0);
    // None of what only the days after have is there.
    for (const id of ["board-both", "board-hours", "board-stop", "board-deadline", "truth-state", "peace-state", "peace-witness"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // The way across, which the frame has from the state of the bridge, is still shown.
    await expect(page.getByTestId("stat-passage")).toBeVisible();
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("statement-empty")).toHaveText("–");
    await page.getByTestId("board-tab-peace").click();
    await expect(page.getByTestId("board-peace")).toContainText("–");
  });

  test("falls back to the next window at the bridge of a task of the bridge, and to the judged pairs for the statement", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { board: undefined, judgments: [fake.JUDGMENT] });
    await page.getByTestId("board-toggle").click();
    // The task of the bridge that is in the list has the window of Granny Li's house: where to find her, and no time at the bridge, so the ledger has no line for the next work.
    await expect(page.getByTestId("board-window")).toHaveCount(0);
    // A task of the bridge whose window is at the bridge, as a promise of the bamboo has, gives the time.
    const listed = fake.tasks().tasks as Array<Record<string, unknown>>;
    const atTheBridge = listed.map((task) => (task.id === "t_bamboo_first" ? { ...task, window: { day: 2, from: 6, to: 7, place: "p_bridge" } } : task));
    await fake.feedFrame(page, { tasks: atTheBridge });
    await expect(page.getByTestId("board-window")).toContainText("Day 2 06:00 to 07:00, Stone Bridge");
    // The pairs that were judged are on the page of the truth.
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("statement-empty")).toHaveText("Pairs compared so far: 1.");
  });
});

/**
 * Opens the card of a person as a pick of their piece on the map does: the page is asked to focus them. The spec is about what the card says, and the pick by a click is
 * tested where the map is (ui-person-lean, ui-sprites): on a slow machine the figure is still on its way when the point is read, and the click lands on the ground.
 */
async function pickOnMap(lantern: { page: import("@playwright/test").Page }, id: string): Promise<void> {
  const page = lantern.page;
  await mapDrawn(page);
  expect(await page.evaluate((who) => window.__lantern.view.bodyPositionOf(who), id), `there is no ${id} on the map`).not.toBeNull();
  await page.evaluate((who) => window.__lantern.play.onFocus?.(who), id);
  await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", id);
}

test.describe("the card of a person", () => {
  test("says who they are, where and when to find them, what they want, what they owe and what they think, and when and how that was learned, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await pickOnMap(lantern, "li_laotai");
    const card = page.getByTestId("person-card");
    const words = {
      en: { name: "Granny Li", find: "Li Family House, 08:00 to 17:00", wants: "Someone to set the talk that Li Er wrecked the bridge straight in public", favours: "None owed", stance: "Li Er broke the bridge railing last night.", when: "They told you themselves, Day 1 08:00", button: "Walk up and talk", routine: [["Now", "Li Family House", "Resting"], ["12:00", "Teahouse", "Having tea"], ["Tomorrow 06:00", "Li Family House", "Resting"]] },
      zh: { name: "李老太", find: "李家宅，辰时 08:00 到 17:00", wants: "有人出来把「李二毁桥」这话当众说清", favours: "互不相欠", stance: "李二昨晚把栏杆弄坏了。", when: "亲口告诉你的，第一天 08:00", button: "走过去说话", routine: [["现在", "李家宅", "歇着"], ["12:00", "茶馆", "喝茶"], ["明天 06:00", "李家宅", "歇着"]] },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = words[lang];
        await expect(card.getByTestId("person-name")).toHaveText(w.name);
        await expect(card.getByTestId("person-find").locator("dd")).toHaveText(w.find);
        await expect(card.getByTestId("person-wants").locator("dd")).toHaveText(w.wants);
        await expect(card.getByTestId("person-favours").locator("dd")).toHaveText(w.favours);
        await expect(card.getByTestId("person-stance").locator(".stance-text")).toHaveText(w.stance);
        await expect(card.getByTestId("person-stance-when")).toHaveText(w.when);
        await expect(card.getByTestId("card-talk")).toHaveText(w.button);
        // Where the routine puts her: the entry in force, then the ones after it.
        const rows = card.getByTestId("person-routine-entry");
        await expect(rows).toHaveCount(3);
        for (const [i, [when, where, act]] of w.routine.entries()) {
          await expect(rows.nth(i).locator(".routine-when")).toHaveText(when);
          await expect(rows.nth(i).locator(".routine-where")).toHaveText(where);
          await expect(rows.nth(i).locator(".routine-act")).toHaveText(act);
        }
        await expect(rows.nth(0)).toHaveAttribute("data-now", "true");
        await expect(rows.nth(2)).toHaveAttribute("data-tomorrow", "true");
        // She has promised nothing.
        await expect(card.getByTestId("person-agreed")).toHaveCount(0);
        // The family is on the token, so that the two are told apart at a glance.
        await expect(card.locator(".surname-seal")).toHaveAttribute("data-family", "fam_li");
        for (const selector of ['[data-testid="person-name"]', '[data-testid="person-find"] dd', '[data-testid="person-stance"] .stance-text']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lists what a person agreed in words, whether it was delivered and why not, and the favours that are owed", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await pickOnMap(lantern, "li_da");
    const card = page.getByTestId("person-card");
    const promise = card.getByTestId("person-commitment");
    await expect(card.getByTestId("person-name")).toHaveText("Li Da");
    await expect(promise).toHaveCount(1);
    await expect(promise.getByTestId("person-commitment-text")).toHaveText("Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning");
    await expect(card.getByTestId("person-agreed").locator("dt")).toHaveText("Promised you");
    await expect(promise).toHaveAttribute("data-state", "promised");
    await expect(promise.getByTestId("commitment-state")).toHaveText("promised");
    await expect(promise.getByTestId("commitment-reason")).toHaveCount(0);
    await expect(card.getByTestId("person-favours").locator("dd")).toHaveText("Owes you 1");
    // What nobody has told the player is not on the card.
    await expect(card.getByTestId("person-wants")).toHaveCount(0);
    await expect(card.getByTestId("person-stance")).toHaveCount(0);
    // On the morning it falls due it is "this morning", and on a later day the day is named.
    await fake.feedFrame(page, { time: { day: 2, hour: 6, minute: 30, phase: "day" } });
    await expect(promise.getByTestId("person-commitment-text")).toHaveText("Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 this morning");
    await fake.feedFrame(page, { time: { day: 1, hour: 8, minute: 30, phase: "day" } });
    await fake.feedFrame(page, fake.commitments("delivered"));
    await expect(promise).toHaveAttribute("data-state", "delivered");
    await expect(promise.getByTestId("commitment-state")).toHaveText("delivered");
    // A promise that was not kept says why.
    await fake.feedFrame(page, fake.commitmentEnded("broken", "rain"));
    await expect(promise).toHaveAttribute("data-state", "broken");
    await expect(promise.getByTestId("commitment-state")).toHaveText("not kept");
    await expect(promise.getByTestId("commitment-reason")).toHaveText("The heavy rain kept the goods off the road");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const selector of ['[data-testid="person-commitment-text"]', '[data-testid="person-commitment"] [data-testid="commitment-reason"]']) {
        expect(await fake.contrast(page, selector), `${theme} ${selector}`).toBeGreaterThan(4.5);
      }
    }
    await fake.feedFrame(page, { ...fake.commitments("delivered"), cards: [{ id: "li_da", met: false, find: null, favours: -2, wants: [], stance: null, agreed: ["c_li_da_bamboo"] }] });
    await expect(card.getByTestId("person-favours").locator("dd")).toHaveText("You owe Li Da 2");
    await lantern.setLang("zh");
    await expect(card.getByTestId("person-favours").locator("dd")).toHaveText("你欠李大两份人情");
    await expect(promise.getByTestId("person-commitment-text")).toHaveText("答应明早07:00前把四根竹料送到石桥");
    await expect(promise.getByTestId("commitment-state")).toHaveText("已送到");
    await expect(card.getByTestId("person-agreed").locator("dt")).toHaveText("答应你的");
    await fake.feedFrame(page, fake.commitmentEnded("broken", "rain"));
    await expect(promise.getByTestId("commitment-reason")).toHaveText("下大雨，货运不出来");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the actions the tasks name for the person, next to the button that talks to them, and shows only what the frame knows of someone it knows nothing about", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await pickOnMap(lantern, "zhou_huoji");
    const card = page.getByTestId("person-card");
    await expect(card.getByTestId("person-find").locator("dd")).toHaveText("Teahouse, 09:00 to 20:00");
    await expect(card.getByTestId("card-talk")).toBeVisible();
    await expect(card.getByTestId("person-task")).toHaveText("Ask Zhou's Clerk who told them");
    await expect(card.getByTestId("person-task")).toHaveAttribute("data-verb", "ask_source");
    await card.getByTestId("person-task").click();
    // The talk is asked for first: the player is far, and walks up.
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc)).toBe("zhou_huoji");
    await lantern.setLang("zh");
    await expect(card.getByTestId("person-task")).toHaveText("问周家伙计听谁说的");
    await lantern.setLang("en");
    // Li Er has no task, no promise and nothing learned: the card is what it was before the slice.
    await pickOnMap(lantern, "li_er");
    await expect(card.getByTestId("person-name")).toHaveText("Li Er");
    for (const id of ["person-find", "person-routine", "person-wants", "person-agreed", "person-favours", "person-stance", "person-task", "person-leaves"]) await expect(card.getByTestId(id)).toHaveCount(0);
    await expect(card.getByTestId("card-talk")).toBeVisible();
  });

  test("has one button for asking a person, when two tasks end in asking them, and a button for each other thing to do", async ({ lantern }) => {
    const page = lantern.page;
    // After Granny Li says no, the first load of bamboo is blocked and the talk that blames Li Er is open, and both say: ask Granny Li.
    const ask = { verb: "ask", npc: "li_laotai" };
    const task = (id: string, text: string, action: Record<string, unknown>): Record<string, unknown> => ({ id, kind: "lead", job: "truth", text: { zh: text, en: text }, state: "open", action });
    await fake.openFirstDay(lantern, {
      tracked: "t_bamboo_first",
      tasks: [task("t_bamboo_first", "Get the first load of bamboo from the Li family", ask), task("t_who_said", "Who started the talk", ask), task("t_where", "Where was Li Er", { verb: "ask_source", npc: "li_laotai" })],
    });
    await pickOnMap(lantern, "li_laotai");
    const card = page.getByTestId("person-card");
    await expect(card.getByTestId("person-task")).toHaveCount(2);
    await expect(card.getByTestId("person-task")).toHaveText(["Ask Granny Li", "Ask Granny Li who told them"]);
    await expect(card.getByTestId("person-task").first()).toHaveAttribute("data-id", "t_bamboo_first");
    // The one button does what the task says.
    await fake.recordSent(page);
    await card.getByTestId("person-task").first().click();
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc)).toBe("li_laotai");
    expect(lantern.pageErrors).toEqual([]);
  });
});
