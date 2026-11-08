import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { openTheNote } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// The page with the real shapes of the frame on the first day: who will be there, when a person has to go, why a track was turned down,
// and a reply that sends the player to somebody. Fake frames follow the tables of the frame in the docstring of `lantern_core.world.bridge`; the host is the demo of the test build.
test.use({ map: true });

/** The id of the action that the page sent last. */
const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

test.describe("an occasion that people are expected at", () => {
  test("lists who will be there and from when to when, in both languages and both themes, and drops them once it is settled", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, fake.tasks("t_evening"));
    const row = page.getByTestId("task-expected");
    const words = {
      en: [["Teahouse Keeper", "17:00–19:00"], ["Zhou's Clerk", "18:36–19:00"], ["Granny Li", "17:30–19:00"]],
      zh: [["茶馆老板娘", "17:00–19:00"], ["周家伙计", "18:36–19:00"], ["李老太", "17:30–19:00"]],
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        await expect(row.locator(".note-lead")).toHaveText(lang === "en" ? "There then:" : "到时在场：");
        const people = row.getByTestId("task-expected-person");
        await expect(people).toHaveCount(3);
        for (const [i, [name, hours]] of words[lang].entries()) {
          await expect(people.nth(i).locator("strong")).toHaveText(name);
          await expect(people.nth(i).locator("span")).toHaveText(hours);
        }
        expect(await fake.contrast(page, '[data-testid="task-expected-person"] span'), `${theme} ${lang}`).toBeGreaterThan(4.5);
      }
    }
    await expect(people(page, 0)).toHaveAttribute("data-from", "1020");
    // Where the whole town is expected the first few are listed and the rest are behind a line that says how many.
    await lantern.setLang("en");
    const town = Array.from({ length: 7 }, (_, i) => ({ id: ["cha_laoban", "zhou_huoji", "li_laotai", "li_da", "zuzhang", "zhou_zhanggui", "old_he"][i], from: 1050 + i, to: 1140 }));
    const crowded = fake.tasks("t_evening") as { tasks: Array<Record<string, unknown>> };
    await fake.feedFrame(page, { ...crowded, tasks: crowded.tasks.map((task) => (task.id === "t_evening" ? { ...task, expected: town } : task)) });
    await expect(page.getByTestId("task-expected-person")).toHaveCount(7);
    await expect(page.locator("[data-testid='task-expected'] > .expected-list > li")).toHaveCount(5);
    await expect(page.getByTestId("task-expected-more").locator("summary")).toHaveText("and 2 more");
    await expect(page.getByTestId("task-expected-more").locator("li").first()).toBeHidden();
    await page.getByTestId("task-expected-more").locator("summary").click();
    await expect(page.getByTestId("task-expected-more").locator("li")).toHaveCount(2);
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-expected-more").locator("summary")).toHaveText("另有两人");
    await lantern.setLang("en");
    await fake.feedFrame(page, fake.tasks("t_evening"));
    // A task that is settled, or has lapsed, lists nobody.
    await fake.feedFrame(page, fake.tasks("t_evening", ["t_evening"]));
    await expect(row).toHaveCount(0);
    // Nor does a frame whose task has no `expected`.
    await fake.feedFrame(page, fake.tasks("t_source"));
    await expect(row).toHaveCount(0);
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });
});

const people = (page: Page, i: number) => page.getByTestId("task-expected-person").nth(i);

test.describe("when a person has to go", () => {
  test("is the hour on the badge and on the card, there is no countdown, and a frame that does not say shows neither", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const badge = page.getByTestId("talk-badge");
    await expect(badge).toBeVisible();
    await expect(badge.getByTestId("talk-still")).toHaveText("Time stands still while you talk");
    await expect(badge.getByTestId("talk-leaves")).toHaveText("Leaves at 15:30");
    await expect(badge.getByTestId("talk-leaves")).toHaveAttribute("data-hour", "15");
    await expect(page.getByTestId("person-leaves")).toHaveAttribute("data-minute", "30");
    // The core holds the clock in a talk, so nothing counts down and nothing is a meter.
    await expect(page.getByTestId("talk-left")).toHaveCount(0);
    await expect(badge.locator("progress")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(badge.getByTestId("talk-leaves")).toHaveText("15:30 要走");
    await lantern.setTheme("light");
    expect(await fake.contrast(page, '[data-testid="talk-leaves"]')).toBeGreaterThan(4.5);
    // The hour moves with the person's routine, as the core sends it.
    const base = await fake.playerOf(page);
    await fake.feedFrame(page, { player: { ...base, talk: { npc: "li_laotai", costs: fake.COSTS, leaves_at: { hour: 17, minute: 5 } } } });
    await expect(badge.getByTestId("talk-leaves")).toHaveText("17:05 要走");
    // A frame that sends no hour: the badge says who, and nothing about when.
    await fake.feedFrame(page, { player: { ...base, talk: { npc: "li_laotai" } } });
    await expect(badge.getByTestId("talk-with")).toBeVisible();
    await expect(badge.getByTestId("talk-leaves")).toHaveCount(0);
    await expect(page.getByTestId("person-leaves")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a task that cannot be followed", () => {
  test("is told in a line for each reason the core gives, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    const more = page.getByTestId("task-more");
    await more.locator("summary").click();
    for (const [reason, en, zh] of [
      ["unknown_task", "There is no such task.", "没有这件事。"],
      ["not_open", "That one is already settled or has lapsed, so there is nothing to follow.", "这件事已经办完，或者已经过期，没什么可追的了。"],
    ] as const) {
      await page.getByTestId("task-other").first().getByTestId("task-track").click();
      const id = await lastId(page);
      expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "track", task: "t_source" });
      await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 3, action_id: id, result: "rejected", reason }]);
      await expect(page.getByTestId("game-note").last()).toHaveText(en);
      await expect(page.getByTestId("game-note").last()).toHaveAttribute("data-reason", reason);
      await lantern.setLang("zh");
      await expect(page.getByTestId("game-note").last()).toHaveText(zh);
      await lantern.setLang("en");
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("tells why the followed task is the one it is, for a task that came of the last one finishing, and says nothing for the player's own pick", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const reason = { zh: "「李家不肯给竹料」办成了，接着追踪「李二那晚为什么在桥边？」", en: "“The Li family will not give bamboo” is done. Now following “Why was Li Er by the bridge that night?”" };
    await fake.feedFrame(page, fake.tasks("t_source"), [{ kind: "task_changed", tick: 7, from: "t_bamboo_first", to: "t_source", cause: "chosen", reason }]);
    await expect(page.getByTestId("task-changed")).toHaveCount(0);
    await fake.feedFrame(page, fake.tasks("t_source"), [{ kind: "task_changed", tick: 8, from: "t_bamboo_first", to: "t_source", cause: "done", reason }]);
    await expect(page.getByTestId("task-changed")).toHaveText(reason.en);
    await expect(page.getByTestId("task-changed")).toHaveAttribute("data-cause", "done");
    // The start of the game follows the first task, and there is nothing to tell about that.
    await fake.feedFrame(page, fake.tasks("t_source"), [{ kind: "task_changed", tick: 9, from: null, to: "t_source", cause: "new", reason: { zh: "有了新的事项：「x」", en: "A new task: “x”" } }]);
    await expect(page.getByTestId("task-changed")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a reply that sends the player to somebody", () => {
  const REPLY = { zh: "这事我不清楚，你去问问周家二郎。", en: "I know nothing of that. Ask Zhou Erlang." };

  /**
   * Asks Granny Li about Li Er and gives the page her answer. A person who knows nothing and sends the player on says whom in the
   * event `asked` (`pointer`, an id), as the core does, and the line says the name in words.
   */
  async function answered(page: Page, pointer: string | null, text = REPLY): Promise<void> {
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    const reply = { npc: "li_laotai", until: 999_999, text };
    const asked = { kind: "asked", tick: 2, npc: "li_laotai", topic: "li_er", answer: "ignorant", path: "", prop: null, source: null, entry: null, new: false, ...(pointer === null ? {} : { pointer }) };
    await fake.feedFrame(page, { bubbles: [reply] }, [asked, { kind: "action_ack", tick: 2, action_id: await lastId(page), result: "applied", reason: null }]);
  }

  test("makes the name a button that brings the person into view and keeps them as a lead", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await answered(page, "zhou_erlang");
    const line = page.getByTestId("talk-line").last();
    await expect(line).toHaveText(REPLY.en);
    const name = line.getByTestId("pointer");
    await expect(name).toHaveCount(1);
    await expect(name).toHaveText("Zhou Erlang");
    // Only the name is a button, and it is a button the size of a finger even though it sits in a line of words.
    const box = await name.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    await name.click();
    // The person is picked on the map and their card is shown, with a ring round them on the map, while the talk goes on.
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "zhou_erlang");
    await expect(page.getByTestId("map-ping")).toHaveAttribute("data-id", "zhou_erlang");
    await expect.poll(() => page.evaluate(() => window.__lantern.view.stats().people)).toBe(20);
    await expect(page.getByTestId("talk-area")).toBeVisible();
    // And it is a lead on the task card: who, who sent the player, and a button that goes there.
    const lead = page.getByTestId("lead");
    await expect(lead).toHaveCount(1);
    await expect(lead).toContainText("Zhou Erlang");
    await expect(lead).toContainText("Granny Li sent you");
    // The talk folded the note of the slip, and the player opens it to follow the lead.
    await openTheNote(page);
    await lead.getByTestId("lead-go").click();
    // The player is in a talk, so the walk waits: the button is the same as the card's, and does nothing a talk would refuse.
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-line").last().getByTestId("pointer")).toHaveText("周家二郎");
    await expect(lead).toContainText("李老太指的路");
    await expect(lead.getByTestId("lead-go")).toHaveText("去找这个人");
    // The same person pointed to again is the same lead.
    await page.getByTestId("talk-line").last().getByTestId("pointer").click();
    await expect(page.getByTestId("lead")).toHaveCount(1);
    // A lead can be dropped.
    await lead.getByTestId("lead-drop").click();
    await expect(page.getByTestId("lead")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("puts a button after the line for a person it sends to without naming them, and ignores a person the town does not have", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await answered(page, "zhou_erlang", { zh: "我不清楚，去问问那个后生。", en: "I do not know. Ask that young man." });
    const line = page.getByTestId("talk-line").last();
    await expect(line.getByTestId("pointer")).toHaveCount(1);
    await expect(line.getByTestId("pointer")).toHaveText("Ask Zhou Erlang");
    await expect(line).toContainText("I do not know. Ask that young man.");
    // A person the town does not have is no button.
    await answered(page, "nobody_here", { zh: "我不清楚，去问问那个后生。", en: "I do not know. Ask that young man." });
    await expect(page.getByTestId("talk-line").last().getByTestId("pointer")).toHaveCount(0);
    // A line that points nowhere is plain words, even if it names a person: a name in a line is only a name.
    await answered(page, null, { zh: "我不清楚，周家二郎或许知道。", en: "I do not know. Zhou Erlang might." });
    await expect(page.getByTestId("talk-line").last().getByTestId("pointer")).toHaveCount(0);
    await expect(page.getByTestId("talk-line").last()).toHaveText("I do not know. Zhou Erlang might.");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("walks up to the person from the lead once the talk is over, and the lead is gone when they have talked", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await answered(page, "zhou_erlang");
    await page.getByTestId("talk-line").last().getByTestId("pointer").click();
    await expect(page.getByTestId("lead")).toHaveCount(1);
    // The talk ends. The lead goes to the person, who is far, so the player walks up to them.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null, offers: {}, topics: [] }, hud: { verbs: fake.FREE_VERBS } }, [{ kind: "talk_end", tick: 4, npc: "li_laotai", reason: "left" }]);
    await page.getByTestId("lead").getByTestId("lead-go").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc)).toBe("zhou_erlang");
    // Talking to them is following the lead.
    await fake.feedFrame(page, {}, [{ kind: "talk_start", tick: 5, npc: "zhou_erlang", leaves_at: { hour: 15, minute: 30 } }]);
    await expect(page.getByTestId("lead")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
