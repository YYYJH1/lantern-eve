import type { Page } from "@playwright/test";
import { translate } from "../../src/i18n/index.ts";
import { refusalKey } from "../../src/page/deals.ts";
import { zhNumeral } from "../../src/page/ui/format.ts";
import { expect, test } from "../support/fixtures.ts";
import { atTheTeahouse, notes, talkToTheKeeper } from "../support/play.ts";
import { REASONS } from "../support/reasons.ts";

// This spec plays the town, and looks at the map in some of its tests.
test.use({ map: true });

// The bridge town of seed 7, held at tick 60 (06:10).
const TOWN = "scenario=bridge&seed=7&pace=40&until=60";

/** Gives the page a frame as the host would: the frame on screen with `extras` merged in, and these events. */
const feed = (page: Page, events: unknown[], extras: Record<string, unknown> = {}) =>
  page.evaluate(
    ([e, x]) => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const base = window.__lantern.client.state.frame as Record<string, unknown>;
      const more = x as Record<string, unknown>;
      const frame = { ...base, ...more, hud: { ...(base.hud as object), ...((more.hud as object | undefined) ?? {}) } };
      client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick + 1, advanced: false, frame, events: e, clock: { paused: true, rate: [1, 1] } });
    },
    [events, extras] as const,
  );

/**
 * The test holds the world at a tick of its own, so the minutes of an act are never paid, and the acts of a talk wait for them. This tells
 * the page that they are paid and the world holds again, as the host would once they were, without the time going by that would end the talk.
 */
const minutesPaid = (page: Page) => feed(page, []);

/** What the page sends is recorded here and not passed on, so that a test can answer it as it likes. */
const record = (page: Page) =>
  page.evaluate(() => {
    const sent: Array<Record<string, unknown>> = [];
    (window as unknown as { __sent: typeof sent }).__sent = sent;
    window.__lantern.client.player = (body) => {
      const id = `t${sent.length}`;
      sent.push({ ...body, action_id: id });
      return id;
    };
  });
const sentSoFar = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Array<Record<string, unknown>> }).__sent);

/** Says to the page that the town has refused the last action that it sent. */
async function refuseLast(page: Page, reason: string): Promise<void> {
  const last = (await sentSoFar(page)).at(-1);
  await feed(page, [{ kind: "action_ack", tick: 1, action_id: last?.action_id, result: "rejected", reason }]);
}

test.describe("the topic tags of a talk", () => {
  test("are what the core says can be asked about: the three that matter first, and the others by kind behind a word, in the language of the page, and not the person who is talked to", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await atTheTeahouse(lantern);
    await talkToTheKeeper(lantern);
    // One question first: its answer is an entry of the notebook, and the entries are topics too.
    await page.getByTestId("verb-ask").click();
    await page.getByTestId("ask-more").click();
    await page.locator('[data-testid="topic-chip"][data-id="t_he_boat"]').click();
    await expect(page.getByTestId("talk-line")).toHaveCount(2);
    await minutesPaid(page);
    const topics = await page.evaluate(() => (window.__lantern.client.state.frame?.player as { topics: Array<{ id: string; kind: string; label: { zh: string; en: string } }> }).topics);
    // The core also lists what a person likes (`taste`), and the others have a group for it.
    expect(new Set(topics.map((t) => t.kind))).toEqual(new Set(["entry", "thing", "place", "person", "taste"]));

    const chips = page.getByTestId("topic-chips");
    const headings = { en: ["What you have noted", "Things", "Places", "People", "Likes"], zh: ["记下的事", "物件", "地方", "人", "喜好"] } as const;
    const listed = topics.filter((t) => t.id !== "cha_laoban");
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      // The language switch is in the menu, and a press outside the list puts the list away: it is opened again, with the others.
      await page.getByTestId("verb-ask").click();
      await expect(chips).toBeVisible();
      await expect(chips.getByTestId("ask-top").getByTestId("topic-chip")).toHaveCount(3);
      await page.getByTestId("ask-more").click();
      // Each topic is there once, in the language of the page, and the person who is talked to is not.
      const shown = await chips.locator('[data-testid="topic-chip"]').evaluateAll((els) => els.map((el) => [el.getAttribute("data-id"), el.querySelector(".topic-chip-label")?.textContent]));
      expect(shown.map((row) => row[0]).sort(), lang).toEqual(listed.map((t) => t.id).sort());
      expect(Object.fromEntries(shown), lang).toEqual(Object.fromEntries(listed.map((t) => [t.id, t.label[lang]])));
      await expect(chips.locator('[data-testid="topic-chip"][data-id="cha_laoban"]')).toHaveCount(0);
      // The others are grouped by what they are: a line of the notebook, a thing, a place, a person and what a person likes.
      const groups = await chips.locator(".chip-group-label").allTextContents();
      expect(groups.every((g) => (headings[lang] as readonly string[]).includes(g)), `${lang}: ${groups.join(",")}`).toBe(true);
      await expect(chips.locator('.chip-group[data-kind="person"] .chip-group-label')).toHaveText(headings[lang][3]);
      // The line of the notebook says how it reached the player, in the words people use.
      const note = chips.locator('[data-kind="entry"] .topic-chip-note').first();
      if ((await chips.locator('[data-testid="topic-chip"][data-kind="entry"]').count()) > 0) {
        await expect(note).toHaveText(lang === "en" ? "Teahouse Keeper says they saw it" : "茶馆老板娘说，是亲眼看见的");
      }
      await page.getByTestId("verb-ask").click();
    }

    // A tag asks as the id the core gave it, and the talk says what was asked, in the language of the page.
    await lantern.setLang("en");
    await page.getByTestId("verb-ask").click();
    await page.getByTestId("ask-more").click();
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    await expect(page.getByTestId("talk-line")).toHaveCount(4);
    await expect(page.getByTestId("talk-line").nth(2)).toHaveText(`You ask about: ${topics.find((t) => t.id === "li_er")?.label.en}`);
    const asked = (await lantern.exportReplay()).records.filter((r) => r[2] === "player").map((r) => r[3]);
    expect(asked.at(-1)).toMatchObject({ type: "ask", topic: "li_er" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are what the frame lists and nothing of its own: a thing the page has never heard of is there, and one it knows of is not when the frame leaves it out", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    await record(page);
    const topic = (id: string, kind: string, zh: string, en: string) => ({ id, kind, label: { zh, en } });
    const player = () => page.evaluate(() => window.__lantern.client.state.frame?.player as object);
    await feed(page, [], {
      hud: { verbs: ["ask", "leave"], verbs_off: {} },
      player: { ...(await player()), talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } }, topics: [topic("n7", "entry", "老何在桥下。", "Boatman He was under the bridge."), topic("t_made_up", "thing", "一件新东西", "A new thing"), topic("li_er", "person", "李二", "Li Er")] },
    });
    await page.getByTestId("verb-ask").click();
    const chips = page.getByTestId("topic-chips");
    // All three are among the first three, a line of the notebook before a thing and a thing before a person.
    await expect(chips.getByTestId("topic-chip")).toHaveText(["Boatman He was under the bridge.", "A new thing", "Li Er"]);
    // The things of the scene that the frame does not list are not there, nor are the places.
    await expect(chips.locator('[data-testid="topic-chip"][data-id="t_rail"]')).toHaveCount(0);
    await expect(chips.getByText("Places")).toHaveCount(0);
    await expect(page.getByTestId("ask-more")).toHaveCount(0);
    await chips.locator('[data-testid="topic-chip"][data-id="t_made_up"]').click();
    expect(await sentSoFar(page)).toEqual([{ type: "ask", topic: "t_made_up", action_id: "t0" }]);

    await lantern.setLang("zh");
    await page.getByTestId("verb-ask").click();
    // What was asked goes after what was not.
    await expect(chips.getByTestId("topic-chip")).toHaveText(["老何在桥下。", "李二", "一件新东西"]);

    // With nothing listed there is nothing to ask, and the list says so. Without the verb the act is not on offer, and has no list.
    await feed(page, [], { player: { ...(await player()), topics: [] } });
    await expect(page.getByTestId("chips-empty")).toHaveText("还没有可问的。四处走走，听听看看，就有得问了。");
    await expect(chips.getByTestId("topic-chip")).toHaveCount(0);
    await feed(page, [], { hud: { verbs: ["leave"], verbs_off: {} } });
    await expect(chips).toHaveCount(0);
    await expect(page.getByTestId("verb-ask")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the acts of the player", () => {
  test("has speaking in public with the acts for outside a talk and not with those of a talk, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    // Outside a talk the frame lists the acts around the player, and the acts of a talk are not shown, whatever else is listed.
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["move", "listen", "look", "rally", "ask", "tell", "leave"] } }));
    for (const [lang, around, inTalk, speak] of [["en", "Around you", "In the talk", "Speak up"], ["zh", "身边", "说话中", "当众说"]] as const) {
      await lantern.setLang(lang);
      const outside = page.getByRole("group", { name: around });
      await expect(outside.locator("button")).toHaveCount(3);
      await expect(page.getByRole("group", { name: inTalk })).toHaveCount(0);
      for (const verb of ["ask", "tell", "leave"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
      // Speaking in public is not there until the core lists it, where the manager may speak and is free to.
      await expect(page.getByTestId("verb-speak")).toHaveCount(0);
      await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["move", "listen", "look", "rally", "speak", "speak_publicly"] } }));
      await expect(outside.getByTestId("verb-speak")).toContainText(speak);
      await expect(outside.locator("button")).toHaveCount(4);
      await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["move", "listen", "look", "rally", "ask", "tell", "leave"] } }));
    }
    // The core lists it where the manager may speak and is free to, and the button follows the list.
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["move", "speak", "speak_publicly"] } }));
    await expect(page.getByTestId("verb-speak")).toBeEnabled();
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("title", /傍晚的茶馆/);
    await lantern.setLang("en");
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("title", /teahouse in the evening/);
    // In a talk it is not offered, whatever else is, and the acts of the talk are in the talk.
    const base = (await page.evaluate(() => window.__lantern.client.state.frame?.player)) as object;
    await feed(page, [], { hud: { verbs: ["leave", "ask", "ask_source", "tell", "entrust", "promise", "speak"] }, player: { ...base, talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } } } });
    await expect(page.getByTestId("verb-speak")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Around you" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "In the talk" }).locator("button")).toHaveCount(4);
    await lantern.setLang("zh");
    await feed(page, [], {});
    await expect(page.getByRole("group", { name: "说话中" }).locator("button")).toHaveCount(4);
  });

  test("is lit at the teahouse in the evening with what the town offers to say, and the town's answer to it is told in the language of the page", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    // 17:40. The manager is at the bridge, and the world is held.
    await lantern.open("scenario=bridge&seed=7&pace=40&until=1400", { menu: false });
    await lantern.waitForTick(1400);
    // Not a place to speak in public: the act is there and grey, with the core's reason.
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("data-off", /^(far|not_yet)$/);
    await atTheTeahouse(lantern);
    expect((await page.evaluate(() => window.__lantern.client.state.frame?.time)) as { hour: number }).toMatchObject({ phase: "day" });
    await expect(page.getByTestId("verb-speak")).toBeEnabled();

    await page.getByTestId("verb-speak").click();
    const picker = page.getByTestId("picker-speak");
    await expect(picker).toHaveAttribute("aria-label", "Say what, in front of everyone?");
    const offered = await page.evaluate(() => (window.__lantern.client.state.frame?.player as { offers: { speak: Array<{ id: string; label: { zh: string; en: string } }> } }).offers.speak);
    expect(offered.map((o) => o.id)).toContain("meal");
    await expect(picker.getByTestId("picker-option")).toHaveText(offered.map((o) => o.label.en));
    await picker.locator('[data-testid="picker-option"][data-id="meal"]').click();
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);

    // Whatever the town made of it, the page says so in the words it has: a refusal by its reason, a table by its place. The note goes by itself some seconds after it comes, which a
    // slow machine can take between two calls of a test, so once it is the last one it is read in both languages in one call.
    const lastAck = (): Promise<{ result: string; reason: string | null } | undefined> =>
      page.evaluate(() => [...window.__lantern.client.state.events].reverse().find((e) => e.kind === "action_ack")) as unknown as Promise<{ result: string; reason: string | null } | undefined>;
    await expect.poll(lastAck).not.toBeUndefined();
    const ack = (await lastAck()) as { result: string; reason: string | null };
    if (ack.result === "rejected") {
      const key = refusalKey("speak", ack.reason ?? "");
      expect(key).not.toBe("ack.other");
      await expect(notes(page).last()).toHaveAttribute("data-reason", ack.reason ?? "");
      expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: translate("en", key), zh: translate("zh", key) });
    } else {
      await expect(notes(page).last()).toHaveText("You laid a table at the teahouse, and the two families sat down together.");
      expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: "You laid a table at the teahouse, and the two families sat down together.", zh: "你在茶馆摆了一桌，两家人坐到了一起。" });
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is refused at the bridge, and out of the evening at the teahouse, with the reason in the language of the page", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    // The button is dark there, so the action is sent from the page's own hook, as the keyboard of a later page might.
    await page.evaluate(() => window.__lantern.play.other("speak", { kind: "meal" }));
    await expect(notes(page).last()).toHaveAttribute("data-reason", "no_venue");
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({
      en: "Not here. Speak at the teahouse in the evening, or at the hall when the clan is called.",
      zh: "这里不是当众说话的地方。傍晚去茶馆，或族长召集族人时去祠堂。",
    });
    await atTheTeahouse(lantern);
    await page.evaluate(() => window.__lantern.play.other("speak", { kind: "meal" }));
    await expect(notes(page).last()).toHaveAttribute("data-reason", "not_evening");
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: "The teahouse only fills up after 17:00.", zh: "茶馆要到 17:00 以后才有人。" });
    expect(lantern.pageErrors).toEqual([]);
  });

});

test.describe("what the town says back to the dealings of the manager", () => {
  test("has a line in each language for every reason that the core gives, in a note that names the reason", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    await record(page);
    const send = (type: string) => page.evaluate((t) => (t === "rally" ? window.__lantern.play.rally() : window.__lantern.play.other(t, {})), type);
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const type of ["tell", "entrust", "promise", "speak", "rally"]) {
        for (const reason of REASONS[type] ?? []) {
          await send(type);
          await refuseLast(page, reason);
          const key = refusalKey(type, reason);
          expect(key, `${type}/${reason}`).not.toBe("ack.other");
          await expect(notes(page).last(), `${lang} ${type}/${reason}`).toHaveAttribute("data-reason", reason);
          await expect(notes(page).last(), `${lang} ${type}/${reason}`).toHaveText(translate(lang, key));
        }
      }
    }
    // A reason that the page does not know is shown as it came, in the general line.
    await send("entrust");
    await refuseLast(page, "gremlins");
    await expect(notes(page).last()).toHaveAttribute("data-reason", "gremlins");
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ zh: translate("zh", "ack.other", { reason: "gremlins" }), en: "That can't be done." });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says what came of a telling, an entrusting, a promise and a speech, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    const cha = { zh: "茶馆老板娘", en: "Teahouse Keeper" };
    const happen = (event: Record<string, unknown>) => feed(page, [{ tick: 1, ...event }]);
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ kind: "told", speaker: "player", listener: "cha_laoban", outcome: "took" }, `${cha.en} believes it.`, `${cha.zh}信了。`],
      [{ kind: "told", speaker: "player", listener: "cha_laoban", outcome: "knew" }, `${cha.en} knew that already.`, `${cha.zh}早就知道这事。`],
      [{ kind: "told", speaker: "player", listener: "cha_laoban", outcome: "doubted" }, `${cha.en} doubts it.`, `${cha.zh}不大信这话。`],
      [{ kind: "lie_caught", npc: "cha_laoban", prop: "p", trust: 2 }, `${cha.en} caught you in a lie.`, `${cha.zh}拆穿了你的谎话。`],
      [{ kind: "entrusted", npc: "cha_laoban", request: "lane", result: "agreed", pending: false }, `${cha.en} agrees.`, `${cha.zh}答应了。`],
      [{ kind: "entrusted", npc: "cha_laoban", request: "join", result: "agreed", pending: true }, `${cha.en} says yes and will see to it shortly.`, `${cha.zh}应下了，过一会儿就去办。`],
      [{ kind: "entrust_done", npc: "cha_laoban", request: "join", result: "done" }, `${cha.en} has done what you asked.`, `${cha.zh}把你托的事办了。`],
      [{ kind: "entrust_withdrawn", npc: "cha_laoban", request: "join" }, `${cha.en} has gone back on their word.`, `${cha.zh}说不办了。`],
      [{ kind: "testified", npc: "cha_laoban", items: ["e1"], entries: ["n1", "n2"] }, `${cha.en} told you what they saw. You noted down 2 things.`, `${cha.zh}把亲眼看见的跟你讲了。你记下了两条。`],
      [{ kind: "convened", invited: ["zuzhang"] }, "The elder is calling the clan to the hall.", "族长在叫族人去祠堂。"],
      [{ kind: "pledged", npc: "cha_laoban", pledge: "k1", what: "role", item: "lead_lanterns", amount: 0, due: 3 }, `You promised ${cha.en} leading the lantern parade, by day 3.`, `你答应最晚第三天给${cha.zh}领游灯的体面差事。`],
      [{ kind: "pledge_kept", npc: "cha_laoban", pledge: "k1", what: "role" }, `You did what you promised ${cha.en}.`, `你答应${cha.zh}的事，做到了。`],
      [{ kind: "pledge_broken", npc: "cha_laoban", pledge: "k1", what: "role" }, `You did not do what you promised ${cha.en} in time. ${cha.en} trusts you less.`, `你答应${cha.zh}的事没按时做到。${cha.zh}不那么信你了。`],
      [{ kind: "spoke", venue: "p_teahouse", named: 6, accepted: 4, percent: 66, elder: 0, complete: false, cleared: false }, "You showed your evidence at the teahouse, in front of everyone there.", "你在茶馆当众拿出了凭据，在场的人都听见了。"],
      [{ kind: "spoke", venue: "p_clan_hall", named: 9, accepted: 8, percent: 88, elder: 2, complete: true, cleared: true }, "You spoke at the ancestral hall, and the truth is out.", "你在祠堂当众把真相讲明白了。"],
      [{ kind: "feast", venue: "p_clan_hall", named: 6 }, "You laid a table at the ancestral hall, and the two families sat down together.", "你在祠堂摆了一桌，两家人坐到了一起。"],
      // A wage has its coins in the event itself.
      [{ kind: "pledged", npc: "cha_laoban", pledge: "k2", what: "wage", item: "", amount: 20, due: 3 }, `You promised ${cha.en} 20 coins in wages, by day 3.`, `你答应最晚第三天给${cha.zh}二十文工钱。`],
    ];
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const [event, english, chinese] of cases) {
        await happen(event);
        await expect(notes(page).last(), `${lang} ${String(event.kind)}`).toHaveText(lang === "en" ? english : chinese);
      }
    }
    // The bad news is marked, the rest is not, and the town's own tellings between neighbours make no note.
    await happen({ kind: "lie_caught", npc: "cha_laoban" });
    await expect(notes(page).last()).toHaveAttribute("data-kind", "bad");
    await happen({ kind: "pledge_kept", npc: "cha_laoban" });
    await expect(notes(page).last()).toHaveAttribute("data-kind", "info");
    const before = await notes(page).count();
    await happen({ kind: "told", speaker: "li_er", listener: "cha_laoban", outcome: "took" });
    await expect(notes(page)).toHaveCount(before);
    expect(lantern.pageErrors).toEqual([]);
  });
});

/** What the manager can still promise, as the frame on screen says. */
const resourcesOf = (page: Page) =>
  page.evaluate(() => (window.__lantern.client.state.frame?.hud as { resources: { stall_front: number; stall_back: number; roles: string[]; slots: string[]; purse: number } }).resources);

test.describe("the promises in the side column", () => {
  const cha = { zh: "茶馆老板娘", en: "Teahouse Keeper", id: "cha_laoban" };

  test("are the promises still open, with whom and by which day, and what the manager can still promise, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    // The bridge town sends both from the first frame: nothing open, and everything left to give. They are on the board, which is shut until it is opened.
    await expect(page.getByTestId("hud-pledges")).toBeHidden();
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("hud-pledges")).toBeVisible();
    await expect(page.getByTestId("pledge-none")).toHaveText("No promise to keep yet.");
    const given = await resourcesOf(page);
    expect(given.slots.length).toBeGreaterThan(0);
    await expect(page.getByTestId("left-stallFront").locator("dd")).toHaveText(String(given.stall_front));
    await expect(page.getByTestId("left-stallBack").locator("dd")).toHaveText(String(given.stall_back));
    await expect(page.getByTestId("left-roles").locator("dd")).toHaveText(String(given.roles.length));
    await expect(page.getByTestId("left-slots").locator("dd")).toHaveText(given.slots.join(", "));
    await expect(page.getByTestId("left-purse").locator("dd")).toHaveText(`${given.purse} coins`);

    await page.evaluate(
      (to) =>
        window.__lantern.inject({
          hud: {
            pledges: [
              { id: "k1", to, what: "stall", item: "front", amount: 0, due: 3 },
              { id: "k2", to: { zh: "老何", en: "Boatman He", id: "old_he" }, what: "wage", item: "", amount: 20, due: 4 },
              { id: "k3", to: { zh: "李二", en: "Li Er", id: "li_er" }, what: "role", item: "t_honor_light", amount: 0, due: 3 },
            ],
            resources: { stall_front: 1, stall_back: 4, roles: ["lead_lanterns", "stage_words"], slots: ["2", "3"], purse: 40 },
          },
        }),
      cha,
    );
    await expect(page.getByTestId("pledge")).toHaveCount(3);
    await expect(page.getByTestId("pledge").nth(0)).toHaveText("Teahouse Keepera front-row stallby day 3");
    await expect(page.getByTestId("pledge").nth(1)).toHaveText("Boatman He20 coins in wagesby day 4");
    await expect(page.getByTestId("pledge").nth(2)).toHaveText("Li Erthe honour of lighting the main lanternby day 3");
    await expect(page.getByTestId("pledge-none")).toHaveCount(0);
    await expect(page.getByTestId("left-stallFront")).toContainText("1");
    await expect(page.getByTestId("left-roles")).toContainText("2");
    await expect(page.getByTestId("left-role-names")).toHaveText("leading the lantern parade, speaking the blessings on stage");
    await expect(page.getByTestId("left-slots")).toContainText("2, 3");
    await expect(page.getByTestId("left-purse")).toContainText("40 coins");
    // What is gone is dim.
    await page.evaluate(() => window.__lantern.inject({ hud: { ...(window.__lantern.client.state.frame?.hud as object), resources: { stall_front: 0, stall_back: 4, roles: [], slots: [], purse: 40 } } }));
    await expect(page.getByTestId("left-stallFront")).toHaveAttribute("data-out", "true");
    await expect(page.getByTestId("left-roles")).toHaveAttribute("data-out", "true");
    await expect(page.getByTestId("left-slots")).toContainText("–");
    await expect(page.getByTestId("left-role-names")).toHaveCount(0);

    await lantern.setLang("zh");
    await expect(page.getByTestId("pledge").nth(0)).toHaveText("茶馆老板娘一个前排摊位最晚第三天");
    await expect(page.getByTestId("pledge").nth(1)).toHaveText("老何二十文工钱最晚第四天");
    await expect(page.getByTestId("pledge").nth(2)).toHaveText("李二点主灯的体面差事最晚第三天");
    await expect(page.getByTestId("left-purse")).toContainText("四十文");
    await expect(page.getByTestId("hud-pledges").locator(".lrow-left .lrow-label")).toHaveText("手里还能许的");
    // The reputation stars are as they were.
    await expect(page.getByTestId("stat-reputation")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are not on the page of the demo world, which has no promises to keep", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=m0&seed=3&pace=30&until=100", { menu: false, map: false });
    await lantern.waitForTick(100);
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("hud-you")).toBeVisible();
    await expect(page.getByTestId("hud-pledges")).toHaveCount(0);
  });

  test("follow a promise made to someone in a talk: made, listed, refused when it is empty, and gone from the list when it is kept", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await atTheTeahouse(lantern);
    await talkToTheKeeper(lantern);
    const before = await resourcesOf(page);
    const offer = await page.evaluate(() => (window.__lantern.client.state.frame?.player as { offers: { promise: Array<{ id: string; body: { due: number } }> } }).offers.promise.find((o) => o.id === "role:t_honor_light"));
    expect(offer, "the town offers the honour of lighting the main lantern").toBeDefined();
    const due = offer?.body.due ?? 0;
    // The promise is in the list of the others, with what can be asked: nothing was turned down, and the promise is there to make.
    await page.getByTestId("verb-entrust").click();
    const picker = page.getByTestId("picker-entrust");
    await expect(picker.locator('[data-group="give"] [data-testid="picker-option"]').first()).toBeVisible();
    await picker.locator('[data-group="give"] [data-id="role:t_honor_light"]').click();
    // The preview comes first: what the player gives, and what it costs. The promise is made when the player confirms it.
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("pledge")).toHaveCount(0);
    await page.getByTestId("request-confirm").click();
    // The note says what was promised, by which day: the one the town offered.
    await expect(notes(page).filter({ hasText: "You promised" }).last()).toHaveText(`You promised Teahouse Keeper the honour of lighting the main lantern, by day ${due}.`);
    // The promises are in the ledger, which is open for the look and shut again, since it lies over the talk.
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("pledge")).toHaveCount(1);
    await expect(page.getByTestId("pledge")).toHaveText(`Teahouse Keeperthe honour of lighting the main lanternby day ${due}`);
    await expect(page.getByTestId("left-roles").locator("dd")).toHaveText(String(before.roles.length - 1));
    await expect(page.getByTestId("left-role-names")).not.toContainText("lighting the main lantern");
    await page.getByTestId("board-toggle").click();
    // What was promised is not there to be promised again: the offer is gone, and asking for it is an empty promise.
    await minutesPaid(page);
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust").locator('[data-group="give"] [data-id="role:t_honor_light"]')).toHaveCount(0);
    await lantern.settled();
    await page.keyboard.press("Escape");
    await page.evaluate((day) => window.__lantern.play.other("promise", { op: "make", what: "role", item: "t_honor_light", due: day }), due);
    await expect(notes(page).last()).toHaveAttribute("data-reason", "empty");
    expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: "You have none of that left, so the promise would be empty words.", zh: "这样东西你手里已经没有了，许了也是空话。" });
    await lantern.setLang("zh");
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("pledge")).toHaveText(`茶馆老板娘点主灯的体面差事最晚第${zhNumeral(due)}天`);
    await page.getByTestId("board-toggle").click();
    await lantern.setLang("en");

    // Keeping it, in the same talk, is a deed that the town notes, and the promise is not open any more.
    await minutesPaid(page);
    // The promise that was made is put forward under the acts, to be kept now, before its day.
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "keep");
    await page.getByTestId("verb-context").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    await expect(notes(page).last()).toHaveText("You did what you promised Teahouse Keeper.");
    await expect(page.getByTestId("pledge")).toHaveCount(0);
    // The promises are in the ledger, which the player opens to look.
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("pledge-none")).toBeVisible();
    // The role is not free to promise again either: it was given.
    await expect(page.getByTestId("left-roles").locator("dd")).toHaveText(String(before.roles.length - 1));
    expect(lantern.pageErrors).toEqual([]);
    expect(lantern.consoleLines.filter((l) => /Refused to|Content Security Policy/i.test(l))).toEqual([]);
    expect((await lantern.snapshot()).cspViolations).toEqual([]);
  });

  test("has the real refusals of the core in the language of the page: something to tell that is not in the notebook, something to ask that nobody can give", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await atTheTeahouse(lantern);
    await talkToTheKeeper(lantern);
    // Each of these is refused by the core itself.
    const sendAndExpect = async (type: string, fields: Record<string, unknown>, reason: string, english: string, chinese: string) => {
      await page.evaluate(([t, f]) => window.__lantern.play.other(t as string, f as Record<string, unknown>), [type, fields] as const);
      await expect(notes(page).last()).toHaveAttribute("data-reason", reason);
      expect(await lantern.textsInBothLanguages("game-note")).toMatchObject({ en: english, zh: chinese });
    };
    await sendAndExpect("tell", { how: "fabricate", pred: "no_such_predicate", subject: "li_er" }, "bad_claim", "That cannot be said in those words.", "这话没法这样说。");
    await sendAndExpect("tell", { entry: "n99" }, "no_entry", "That note is not in your notebook.", "见闻簿里没有这一条。");
    await sendAndExpect("entrust", { kind: "lane" }, "cannot", "Teahouse Keeper cannot help with that.", "这个忙茶馆老板娘帮不上。");
    await sendAndExpect("entrust", { kind: "no_such_kind" }, "no_request", "That is not something you can ask of anyone.", "这件事没法托人去办。");
    await sendAndExpect("promise", { op: "keep", id: "k9" }, "no_pledge", "You made no such promise.", "你没有许过这样的诺。");
    // A person in a talk speaks over their head too, and the note says the same thing in the words of the page.
    await expect(page.getByTestId("dialogue-line")).toContainText("Teahouse Keeper");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a reply that is slow to come", () => {
  const notice = (page: Page, code = "thinking") =>
    page.evaluate((c) => (window.__lantern.client as unknown as { onMessage(message: unknown): void }).onMessage({ type: "notice", code: c, message: "a reply is taking a while (r3)" }), code);
  test("is a calm line over the talk, in both languages, and not a toast; the person speaking ends it", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    /** A frame in which the manager is in a talk with the keeper of the teahouse, and she has this to say, or nothing. */
    const frameWith = (said: { zh: string; en: string } | null, events: unknown[] = []) =>
      page.evaluate(
        ([line, happened]) => {
          const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
          const base = window.__lantern.client.state.frame as Record<string, unknown>;
          const frame = {
            ...base,
            player: { ...(base.player as object), activity: "chat", talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } } },
            bubbles: line === null ? [] : [{ npc: "cha_laoban", until: 99999, text: line }],
          };
          client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick + 1, advanced: false, frame, events: happened, clock: { paused: true, rate: [1, 1] } });
        },
        [said, events] as const,
      );
    await frameWith({ zh: "原来是这样，我记下了。", en: "I see. I will remember that." });
    const line = page.getByTestId("dialogue-line");
    await expect(line).toHaveText("Teahouse Keeper: “I see. I will remember that.”");
    await expect(line).toHaveAttribute("data-thinking", "false");

    await notice(page);
    await expect(line).toHaveText("Teahouse Keeper is thinking…");
    await expect(line).toHaveAttribute("data-thinking", "true");
    // It is a line of the talk and not a message of the host: no toast, and nothing in the list of what the host handled.
    await expect(page.getByTestId("host-notice")).toHaveCount(0);
    expect((await lantern.snapshot()).notices.map((n) => n.code)).not.toContain("thinking");
    await lantern.setLang("zh");
    await expect(line).toHaveText("茶馆老板娘在想……");
    await lantern.setLang("en");

    // The same line, said again, is not a new one: she is still thinking. A different one is her answer.
    await frameWith({ zh: "原来是这样，我记下了。", en: "I see. I will remember that." });
    await expect(line).toHaveText("Teahouse Keeper is thinking…");
    await frameWith({ zh: "这个我早就知道了。", en: "I knew that already." });
    await expect(line).toHaveText("Teahouse Keeper: “I knew that already.”");
    await expect(line).toHaveAttribute("data-thinking", "false");

    // The core says the reply has come: that ends the wait at once, though the line is the one said before.
    await notice(page);
    await expect(line).toHaveText("Teahouse Keeper is thinking…");
    await frameWith({ zh: "这个我早就知道了。", en: "I knew that already." }, [{ kind: "replied", tick: 7, npc: "cha_laoban" }]);
    await expect(line).toHaveText("Teahouse Keeper: “I knew that already.”");
    await expect(line).toHaveAttribute("data-thinking", "false");

    // Other notices of the host are toasts as before.
    await notice(page, "server_model");
    await expect(page.getByTestId("host-notice")).toBeVisible();
    await expect(line).toHaveText("Teahouse Keeper: “I knew that already.”");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("ends with the talk, and is not shown when nobody is talking", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false, map: false });
    await lantern.waitForTick(60);
    await notice(page);
    // Nobody is talking: there is no line at the bottom.
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    await page.evaluate(() => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const base = window.__lantern.client.state.frame as Record<string, unknown>;
      const frame = { ...base, player: { ...(base.player as object), activity: "chat", talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } } } };
      client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick + 1, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
    });
    await expect(page.getByTestId("dialogue-line")).toHaveText("Teahouse Keeper is listening. Ask about something.");
    await notice(page);
    await expect(page.getByTestId("dialogue-line")).toHaveText("Teahouse Keeper is thinking…");
    await feed(page, [{ kind: "talk_end", tick: 5, npc: "cha_laoban", reason: "leave" }], { player: { ...((await page.evaluate(() => window.__lantern.client.state.frame?.player)) as object), talk: null, activity: "rest" } });
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
