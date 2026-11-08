import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const openNotebook = async (page: Page): Promise<void> => {
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  // What was written since the player last looked flashes once; the page counts it as seen after a moment.
  await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
};

const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

test.describe("the notebook as a workspace", () => {
  test("has the words of each line and, under them, where they came from", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await openNotebook(page);
    const note = page.getByTestId("note").nth(1);
    await expect(note.getByTestId("note-words")).toContainText("Zhou's Clerk says he saw Li Er by the bridge that night.");
    await expect(note.getByTestId("note-words")).toContainText("What was said");
    await expect(note.getByTestId("note-source")).toContainText("Where it came from");
    await expect(note.getByTestId("note-source").getByTestId("source-badge")).toHaveText("Heard from Zhou's Clerk, 1st hand");
    const words = await note.getByTestId("note-words").boundingBox();
    const source = await note.getByTestId("note-source").boundingBox();
    if (words === null || source === null) throw new Error("no box");
    // The words are ruled first, and where they came from is written under them in a smaller hand.
    expect(source.y).toBeGreaterThanOrEqual(words.y + words.height - 2);
    expect(Math.abs(source.x - words.x)).toBeLessThan(4);
    await lantern.setLang("zh");
    await expect(note.getByTestId("note-words")).toContainText("原话");
    await expect(note.getByTestId("note-source")).toContainText("来源");
    await expect(note.getByTestId("note-source").getByTestId("source-badge")).toHaveText("听周家伙计说，第一手");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("folds the note of the red slip while it is open, as the ledger does, and opens it again when it is shut", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const slip = page.getByTestId("topbar-task");
    await expect(slip, "the note is open").toHaveAttribute("data-open", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(slip, "the note is folded while the notebook is open").toHaveAttribute("data-open", "false");
    // Nothing of the note shows over the sheet: the slip is its head and nothing else.
    const [head, card] = [await page.getByTestId("slip-head").boundingBox(), await slip.boundingBox()];
    if (head === null || card === null) throw new Error("no box");
    expect(card.y + card.height, "nothing of the note hangs below the head").toBeLessThanOrEqual(head.y + head.height + 12);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await expect(slip, "the note is open again when the notebook is shut").toHaveAttribute("data-open", "true");
    // A player who shut the note keeps it shut.
    await page.getByTestId("slip-head").click();
    await expect(slip).toHaveAttribute("data-open", "false");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(slip).toHaveAttribute("data-open", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("pairs two lines, takes a relation, sends the judgement, and shows that it holds or that two lines alone do not settle it, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    const pairing = page.getByTestId("pairing");
    await expect(page.getByTestId("pairing-hint")).toHaveText("Pick two lines with Compare, then say how they stand.");
    await expect(page.getByTestId("relations")).toHaveCount(0);
    const pick = (id: string) => page.locator(`[data-testid="note"][data-id="${id}"]`).getByTestId("note-pick");
    await expect(pick("n_clerk")).toHaveText("Compare");
    await pick("n_clerk").click();
    await expect(pick("n_clerk")).toHaveText("First");
    await expect(page.getByTestId("pair-first")).toContainText("Zhou's Clerk says he saw Li Er by the bridge that night.");
    await expect(page.getByTestId("pair-second")).toContainText("(not picked yet)");
    await expect(page.getByTestId("relations")).toHaveCount(0);
    await pick("n_broke").click();
    await expect(pick("n_broke")).toHaveText("Second");
    await expect(page.locator('[data-testid="note"][data-id="n_clerk"]')).toHaveAttribute("data-slot", "1");
    await expect(page.locator('[data-testid="note"][data-id="n_broke"]')).toHaveAttribute("data-slot", "2");
    await expect(pairing).toHaveAttribute("data-ready", "true");
    // The relation comes first. Judging waits for it.
    await expect(page.getByTestId("relations").getByRole("radio")).toHaveCount(3);
    await expect(page.getByTestId("pair-judge")).toBeDisabled();
    await page.getByTestId("rel-unsupported").click();
    await expect(page.getByTestId("rel-unsupported")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("pair-judge")).toBeEnabled();
    await page.getByTestId("pair-judge").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "judge", a: "n_clerk", b: "n_broke", relation: "unsupported" });
    await expect(pairing).toHaveAttribute("data-waiting", "true");
    await expect(page.getByTestId("pair-judge")).toBeDisabled();
    // The core says yes, and has it among the judgements.
    await fake.feedFrame(page, { judgments: [fake.JUDGMENT] }, [{ kind: "action_ack", tick: 8, action_id: await lastId(page), result: "applied", reason: null }]);
    const outcome = page.getByTestId("pair-outcome");
    await expect(outcome).toHaveAttribute("data-ok", "true");
    await expect(outcome).toHaveText("That holds. It is kept among your judgements.");
    await expect(page.getByTestId("judgment")).toHaveCount(1);
    await expect(page.getByTestId("judgment")).toContainText("The second goes beyond the first");
    await expect(page.getByTestId("judgment")).toContainText("“Zhou's Clerk says he saw Li Er by the bridge that night” and “Li Er broke the bridge”");
    // The rejection words of the other reason: a line that is not in the notebook.
    await page.locator('[data-testid="note"][data-id="n_scrape"]').getByTestId("note-pick").click();
    await page.getByTestId("rel-unsupported").click();
    await page.getByTestId("pair-judge").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 8, action_id: await lastId(page), result: "rejected", reason: "unknown_note" }]);
    await expect(outcome).toHaveText("That note is not in your notebook.");
    await page.locator('[data-testid="note"][data-id="n_scrape"]').getByTestId("note-pick").click();

    // Another pair, which the core does not take: it says so, and nothing else happens, in no note.
    await pick("n_boat").click();
    await expect(page.getByTestId("pair-outcome")).toHaveCount(0);
    await expect(pick("n_boat")).toHaveText("Second");
    await expect(pick("n_broke")).toHaveText("Compare");
    await page.getByTestId("rel-contradicts").click();
    await page.getByTestId("pair-judge").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "judge", a: "n_clerk", b: "n_boat", relation: "contradicts" });
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 9, action_id: await lastId(page), result: "rejected", reason: "not_shown" }]);
    await expect(outcome).toHaveAttribute("data-ok", "false");
    await expect(outcome).toHaveAttribute("data-reason", "not_shown");
    await expect(outcome).toHaveText("These two alone do not show it");
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await expect(page.getByTestId("judgment")).toHaveCount(1);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await page.getByTestId("btn-notebook").click().catch(() => undefined);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
        const sentence = lang === "en" ? "These two alone do not show it" : "单凭这两句看不出来";
        await expect(page.getByTestId("pair-outcome")).toHaveText(sentence);
        await expect(page.getByTestId("rel-unsupported")).toHaveText(lang === "en" ? "The second goes beyond the first" : "后一句超出了前一句的证据");
        await expect(page.getByTestId("rel-contradicts")).toHaveText(lang === "en" ? "They cannot both be true" : "两句不能同时为真");
        await expect(page.getByTestId("rel-mismatch")).toHaveText(lang === "en" ? "It does not match what the source said" : "转述和原话对不上");
        await expect(page.getByTestId("pair-hold")).toHaveText(lang === "en" ? "Leave it for now" : "先不下结论");
        await expect(page.getByTestId("pair-judge")).toHaveText(lang === "en" ? "Judge" : "就这么判");
        for (const selector of ['[data-testid="pair-outcome"]', '[data-testid="rel-unsupported"]', '[data-testid="note-text"], .note-text', '[data-testid="pair-first"]']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
      }
    }
    // Leaving it for now clears the pair.
    await lantern.setLang("en");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await page.getByTestId("pair-hold").click();
    await expect(page.getByTestId("pairing-hint")).toBeVisible();
    await expect(page.getByTestId("relations")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the controls of judging and of asking for a hint only where the frame lists the acts, and none of them greyed out", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: ["move"] } });
    await fake.recordSent(page);
    await openNotebook(page);
    // The notebook has four lines and the frame lists neither act: nothing to compare with, nothing to ask for.
    await expect(page.getByTestId("note")).toHaveCount(4);
    for (const id of ["pairing", "notebook-hint", "note-pick", "pair-judge"]) await expect(page.getByTestId(id)).toHaveCount(0);
    expect(await fake.sentSoFar(page)).toEqual([]);
    // Judging is listed alone: the pairing is there, and no hint.
    await fake.feedFrame(page, { hud: { verbs: ["move", "judge"] } });
    await expect(page.getByTestId("pairing")).toBeVisible();
    await expect(page.getByTestId("note-pick")).toHaveCount(4);
    await expect(page.getByTestId("notebook-hint")).toHaveCount(0);
    // Asking for a hint is listed alone: the hint is there, and no pairing.
    await fake.feedFrame(page, { hud: { verbs: ["move", "hint"] } });
    await expect(page.getByTestId("notebook-hint")).toBeVisible();
    await expect(page.getByTestId("pairing")).toHaveCount(0);
    await expect(page.getByTestId("note-pick")).toHaveCount(0);
    // Both, and the controls are there again.
    await fake.feedFrame(page, { hud: { verbs: ["move", "judge", "hint"] } });
    await expect(page.getByTestId("pairing")).toBeVisible();
    await expect(page.getByTestId("notebook-hint")).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("helps the player look: lights the pair the core names, says how they stand when asked again, and sets them side by side", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await expect(page.getByTestId("hint-line")).toHaveCount(0);
    await expect(page.getByTestId("notebook-hint")).toContainText("Help me look");
    await page.getByTestId("notebook-hint").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "hint" });
    // The core has not answered yet, so the notebook says nothing: not even that there is nothing to compare.
    await expect(page.getByTestId("hint-line")).toHaveCount(0);
    await expect(page.getByTestId("notebook-hint")).toBeDisabled();
    // The core has nothing worth comparing, and says so in no note.
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("hint-line")).toHaveText("Nothing worth comparing yet.");
    await expect(page.getByTestId("notebook-hint")).toBeEnabled();
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    // Asked again, it lights a pair.
    await page.getByTestId("notebook-hint").click();
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke" } }, [{ kind: "action_ack", tick: 6, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("hint-line")).toContainText("Compare these two:");
    await expect(page.getByTestId("hint-line")).toContainText("Zhou's Clerk says he saw Li Er by the bridge that night.");
    await expect(page.getByTestId("hint-line")).toHaveAttribute("data-a", "n_clerk");
    await expect(page.locator('[data-testid="note"][data-hinted="true"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="note"][data-id="n_boat"]')).toHaveAttribute("data-hinted", "false");
    await expect(page.getByTestId("notebook-hint")).toContainText("Tell me how they stand");
    await page.getByTestId("notebook-hint").click();
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "hint")).toHaveLength(3);
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke", relation: "unsupported" } }, [{ kind: "action_ack", tick: 7, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("hint-relation")).toHaveText("The second goes beyond the first");
    await expect(page.getByTestId("notebook-hint")).toContainText("Help me look");
    await lantern.setLang("zh");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("hint-relation")).toHaveText("后一句超出了前一句的证据");
    await expect(page.getByTestId("hint-line")).toContainText("对照这两句：");
    await expect(page.getByTestId("hint-use")).toHaveText("放到一起对照");
    // The pair the core lit is set side by side with one press, with the relation it said, and the player has only to judge.
    await page.getByTestId("hint-use").click();
    await expect(page.getByTestId("pair-first")).toHaveAttribute("data-id", "n_clerk");
    await expect(page.getByTestId("pair-second")).toHaveAttribute("data-id", "n_broke");
    await expect(page.getByTestId("rel-unsupported")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("pair-judge")).toBeEnabled();
    await expect(page.getByTestId("hint-use")).toHaveCount(0);
    // And a pair is picked with a click, as any two lines are.
    await page.locator('[data-testid="note"][data-id="n_clerk"]').getByTestId("note-pick").click();
    await expect(page.getByTestId("pair-first")).toHaveAttribute("data-id", "n_broke");
    await expect(page.getByTestId("notebook-hint")).toContainText("帮我看看");
  });

  test("has a button to use a judged pair to clear it up, with the half hour it takes, which waits for the teahouse in the evening and then sends the claim, what it rests on and the judgement", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { judgments: [fake.JUDGMENT, { a: "n_boat", b: "n_clerk", relation: "contradicts", made: 420 }] });
    await fake.recordSent(page);
    await openNotebook(page);
    await expect(page.getByTestId("judgment")).toHaveCount(2);
    // Every relation the player judged right can be said in public: the core decides whether it shows.
    for (const row of [0, 1]) await expect(page.getByTestId("judgment").nth(row).getByTestId("judgment-clarify")).toHaveCount(1);
    const button = page.getByTestId("judgment").first().getByTestId("judgment-clarify");
    await expect(button).toContainText("Use to clear it up");
    await expect(button.getByTestId("cost-clarify")).toHaveText("30 min");
    await expect(button.getByTestId("cost-clarify")).toHaveAttribute("data-minutes", "30");
    await expect(button).toBeDisabled();
    // It says where and when, and does not leave the player to guess.
    await expect(page.getByTestId("judgment-where").first()).toHaveText("You can clear it up at the teahouse from 17:00 to 21:00, or in the Ancestral Hall while the clan is called.");
    await fake.feedFrame(page, { hud: { verbs: ["move", "speak", "speak_publicly", "judge", "hint"] } });
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("judgment-where")).toHaveCount(0);
    await button.click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "clarify", claim: "n_broke", basis: ["n_clerk"], judgment: "unsupported" });
    // The other relation is said the same way, with its own relation.
    await page.getByTestId("judgment").nth(1).getByTestId("judgment-clarify").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "clarify", claim: "n_clerk", basis: ["n_boat"], judgment: "contradicts" });
    await lantern.setLang("zh");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await expect(button).toContainText("用于澄清");
    await expect(button.getByTestId("cost-clarify")).toHaveText("三十分钟");
    // Not at the venue, or in a talk: the same button waits, and in a talk it says what to do.
    await fake.feedFrame(page, { hud: { verbs: ["move", "judge", "hint"] } });
    await expect(page.getByTestId("judgment-where").first()).toHaveText("傍晚 17:00 到 21:00 在茶馆，或族长召集族人时在祠堂，才能当众澄清。");
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("judgment-where").first()).toHaveText("你正在谈话，先告辞吧。");
  });

  test("says in words why a speech in public was turned down, next to the pair it was about, for each reason the core gives", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { judgments: [fake.JUDGMENT], hud: { verbs: ["move", "speak", "speak_publicly", "judge", "hint"] } });
    await fake.recordSent(page);
    await openNotebook(page);
    const button = page.getByTestId("judgment-clarify");
    const words: Record<string, { en: string; zh: string }> = {
      no_entry: { en: "That note is not in your notebook.", zh: "见闻簿里没有这一条。" },
      not_shown: { en: "Those two lines alone do not show that.", zh: "单凭这两句，看不出这一点。" },
      overclaim: { en: "You said more than the lines show. Those who know better will remember it.", zh: "你说得比这几句话能证明的更多。知道底细的人会记着。" },
      no_witness: { en: "Nobody says they saw what you point to, so nobody can bear it out.", zh: "没有人说自己亲眼看见了你指的那件事，没人能为它作证。" },
      said_already: { en: "You said this here already, to the same people.", zh: "这些话你已经当着这些人说过了。" },
      no_venue: { en: "Not here. Speak at the teahouse in the evening, or at the hall when the clan is called.", zh: "这里不是当众说话的地方。傍晚去茶馆，或族长召集族人时去祠堂。" },
      not_evening: { en: "The teahouse only fills up from five in the evening.", zh: "茶馆要到傍晚五点以后才有人。" },
      no_meeting: { en: "The clan has not been called to the hall.", zh: "族人还没有被召到祠堂来。" },
      empty_room: { en: "There is nobody here to hear you.", zh: "这里没有人听你说。" },
    };
    let tick = 20;
    for (const [reason, w] of Object.entries(words)) {
      await button.click();
      await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: tick++, action_id: await lastId(page), result: "rejected", reason }]);
      const no = page.getByTestId("clarify-no");
      await expect(no).toHaveAttribute("data-reason", reason);
      await expect(no).toHaveText(w.en);
      // In no note over the map, and the button is there to say it again.
      await expect(page.getByTestId("game-note")).toHaveCount(0);
      await expect(button).toBeEnabled();
    }
    await lantern.setLang("zh");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("clarify-no")).toHaveText(words.empty_room?.zh ?? "");
    // The pair that was said again waits for the core and shows no old rejection.
    await button.click();
    await expect(page.getByTestId("clarify-no")).toHaveCount(0);
    await expect(button).toBeDisabled();
    // A speech the core took shows no rejection, and the sheet of what they made of it is the answer.
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 40, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("clarify-no")).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds the world while it is open and lets it go when it is shut, if it was going", async ({ lantern }) => {
    const page = lantern.page;
    // A world that is running.
    await lantern.open("scenario=bridge&seed=7&pace=20", { menu: false });
    await lantern.waitForTick(40);
    await expect(page.getByTestId("status")).toHaveText("running");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    expect(await page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual(["page"]);
    const held = await lantern.tick();
    await page.waitForTimeout(600);
    expect(await lantern.tick()).toBe(held);
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick(held + 5);
    // The player can let go of the world while the notebook holds it: resume runs it with the notebook open.
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick((await lantern.tick()) + 5);
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick((await lantern.tick()) + 5);
    // A world that the player had paused stays paused.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.getByTestId("btn-notebook").click();
    await page.getByTestId("notebook-close").click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("status")).toHaveText("paused");
  });
});

test.describe("what a clarification did", () => {
  test("shows the people who were there one by one, who changed their stand and the reason they gave, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    const view = page.getByTestId("clarify");
    await expect(view).toBeVisible();
    await expect(page.getByTestId("hearer")).toHaveCount(4);
    const words = {
      en: { claim: "You pointed out that this goes beyond the evidence: “Li Er broke the bridge.”", sum: "3 of 4 changed their stand.", names: ["Zhou's Clerk", "Granny Li", "Teahouse Keeper", "Shopkeeper Zhou"], change: ["blames, now accepts", "unsure, now accepts", "unsure, now accepts", "still blames"], reason: "I only saw him by the bridge. I did not see him touch it.", title: "What they made of it" },
      zh: { claim: "你指出这句超出了证据：「李二弄坏了桥。」", sum: "四人里有三人改了态度。", names: ["周家伙计", "李老太", "茶馆老板娘", "周掌柜"], change: ["由怪罪转为接受", "由拿不准转为接受", "由拿不准转为接受", "仍是怪罪"], reason: "我只看见他在桥边，没看见他碰桥。", title: "在场的人怎么想" },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = words[lang];
        await expect(view.locator(".sheet-title")).toHaveText(w.title);
        await expect(page.getByTestId("clarify-claim")).toHaveText(w.claim);
        await expect(page.getByTestId("clarify-sum")).toHaveText(w.sum);
        await expect(page.getByTestId("hearer").locator(".hearer-name")).toHaveText([...w.names]);
        await expect(page.getByTestId("hearer-change")).toHaveText([...w.change]);
        await expect(page.getByTestId("hearer-reason").first()).toHaveText(w.reason);
        expect(await fake.contrast(page, '[data-testid="hearer-reason"]'), `${theme} ${lang} reason`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="clarify-claim"]'), `${theme} ${lang} claim`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // Who changed and who did not is in the data of each row, for the eye and for the reader of the page.
    await expect(page.getByTestId("hearer").nth(0)).toHaveAttribute("data-changed", "true");
    await expect(page.getByTestId("hearer").nth(3)).toHaveAttribute("data-changed", "false");
    await expect(page.getByTestId("hearer").nth(1)).toHaveAttribute("data-before", "unsure");
    await expect(page.getByTestId("hearer").nth(1)).toHaveAttribute("data-after", "for");
    // Each stand is a word of its own, and the side it is on (against the clarification, unsure, or for it) is in its class.
    const chips = page.getByTestId("hearer").first();
    await expect(chips.getByTestId("stance-before")).toHaveAttribute("data-stance", "against");
    await expect(chips.getByTestId("stance-after")).toHaveAttribute("data-stance", "for");
    await expect(chips.getByTestId("stance-before")).toHaveClass(/tone-against/);
    await expect(chips.getByTestId("stance-after")).toHaveClass(/tone-for/);
    await expect(page.getByTestId("hearer").nth(1).getByTestId("stance-before")).toHaveClass(/tone-unsure/);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("brings in the people one after the other", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "light" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(page.getByTestId("clarify")).toBeVisible();
    // Each person comes a little after the one before.
    const delays = await page.getByTestId("hearer").evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).animationDelay)));
    expect(delays).toHaveLength(4);
    for (let i = 1; i < delays.length; i++) expect(delays[i] ?? 0, `person ${i}`).toBeGreaterThan(delays[i - 1] ?? 0);
  });

  test("is put away with its button or the Escape key, and says when nobody was there", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    const view = page.getByTestId("clarify");
    await expect(view).toBeVisible();
    await page.getByTestId("clarify-done").click();
    await expect(view).toHaveCount(0);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(view).toBeVisible();
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await fake.feedFrame(page, {}, [{ kind: "clarified", tick: 800, claim: "n_broke", audience: [] }]);
    await expect(page.getByTestId("clarify-empty")).toHaveText("Nobody was there to hear it.");
    await expect(page.getByTestId("hearer")).toHaveCount(0);
    await page.getByTestId("clarify-close").click();
    await expect(view).toHaveCount(0);
  });
});

test.describe("the recap of the morning", () => {
  test("is a card of at most three lines, in both languages and themes, that stays until the player puts it away and does not come back for the same lines", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900, lines: 3 }]);
    const card = page.getByTestId("recap");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("recap-line")).toHaveCount(3);
    // The core sends the recap in one frame. The frames after it have none, and the card is still there.
    await fake.feedFrame(page, { recap: null });
    await fake.feedFrame(page, { recap: null });
    await expect(card).toBeVisible();
    const words = {
      en: { title: "Yesterday in short", lines: ["The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.", "You said in public that the claim went too far, and Zhou's Clerk and Granny Li changed their minds.", "Li Da promised to bring 4 poles of bamboo."] },
      zh: { title: "昨日小结", lines: ["李大答应的四根竹料，已经送到石桥。", "你当众指出那句话说过了头，周家伙计和李老太听后改了口。", "李大答应送来四根竹料。"] },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        await expect(card.locator(".sheet-title")).toHaveText(words[lang].title);
        await expect(page.getByTestId("recap-line")).toHaveText([...words[lang].lines]);
        expect(await fake.contrast(page, '[data-testid="recap-line"]'), `${theme} ${lang}`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // Each line is about real events: the numbers the core gave, in the order it gave them.
    await expect(page.getByTestId("recap-line").first()).toHaveAttribute("data-events", "16,26");
    await expect(page.getByTestId("recap-line").nth(2)).toHaveAttribute("data-events", "16");
    await page.getByTestId("recap-done").click();
    await expect(card).toHaveCount(0);
    // The same lines in the next frames are not shown again.
    await fake.feedFrame(page, fake.recap());
    await fake.feedFrame(page, fake.recap());
    await expect(card).toHaveCount(0);
    // The core says the recap once more, and the card comes back.
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900 }]);
    await expect(card).toBeVisible();
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    // Other lines are a new recap, and a new one takes the place of one that is still on show.
    await lantern.setLang("en");
    await fake.feedFrame(page, { recap: [{ text: { zh: "第二天的小结。", en: "The summary of the second day." }, events: [] }] });
    await expect(page.getByTestId("recap-line")).toHaveText(["The summary of the second day."]);
    // A fourth line is not shown, and a frame without a recap does not take the card away.
    await fake.feedFrame(page, { recap: [1, 2, 3, 4].map((i) => ({ text: { zh: `第${i}句`, en: `Line ${i}` }, events: [i] })) });
    await expect(page.getByTestId("recap-line")).toHaveText(["Line 1", "Line 2", "Line 3"]);
    await fake.feedFrame(page, { recap: null });
    await expect(card).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("waits behind the sheet of a clarification and the ending, and is there when they are put away", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(page.getByTestId("clarify")).toBeVisible();
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900 }]);
    await fake.feedFrame(page, { recap: null });
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await page.getByTestId("clarify-close").click();
    await expect(page.getByTestId("recap")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is kept in a save: a save made with the recap on show brings it back when it is loaded, and one made after it was put away does not", async ({ lantern }) => {
    const page = lantern.page;
    // The saves are in the menu drawer, which a click on the sheet puts away.
    await lantern.open(fake.TOWN);
    await lantern.waitForTick(300);
    await fake.feedFrame(page, { ...fake.tasks(), ...fake.commitments("delivered"), weather: "clear", hud: { verbs: fake.FREE_VERBS } });
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 301, lines: 3 }]);
    await fake.feedFrame(page, { recap: null });
    await expect(page.getByTestId("recap")).toBeVisible();
    await lantern.openMenu();
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toContainText("saved #");
    await page.getByTestId("menu-close").click();
    // The player puts it away, and saves again.
    await page.getByTestId("recap-done").click();
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await lantern.openMenu();
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("select-saves").locator("option")).toHaveCount(2);
    const [newer, older] = await page.evaluate(() => window.__lantern.client.state.saves.map((save) => ({ id: save.id, page: save.page ?? null })));
    expect(older?.page).toMatchObject({ recap: { lines: [{ events: [16, 26] }, { events: [12] }, { events: [16] }] } });
    expect(newer?.page).toBeNull();
    // Loading the first brings the card back, with the words of the core in both languages.
    await page.getByTestId("select-saves").selectOption(String(older?.id));
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-match", "true");
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(page.getByTestId("recap-line").first()).toHaveText("The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("recap-line").first()).toHaveText("李大答应的四根竹料，已经送到石桥。");
    // Loading the second leaves it away.
    await page.getByTestId("recap-done").click();
    await lantern.openMenu();
    await page.getByTestId("select-saves").selectOption(String(newer?.id));
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-match", "true");
    await page.getByTestId("menu-close").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("recap")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

// The notebook lies over the corner at the bottom right. While the help is on the corner has the button of the hints, and the notebook ends a little above it, at
// every window that is not tall; while the help is off it ends where it always did, above the three things of the corner.

const BOOK_WINDOWS = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 760 },
];

const BOOK_LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

/** How far above the button of the hints the notebook ends, in pixels (`BOOK_GAP` of corner.tsx), with the little that a fractional layout can take away. */
const BOOK_ABOVE = 8;
const BOOK_SLACK = 1;

for (const size of BOOK_WINDOWS) {
  for (const look of BOOK_LOOKS) {
    test.describe(`the notebook and the corner, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      test("ends above the button of the hints while the help is on, which stays free of it, and is as tall as it was when the notebook is shut and opened again", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: fake.notebook(), commitments: [] }, fake.GUIDED);
        await fake.primeHelp(page);
        const hints = page.getByTestId("btn-hints");
        await expect(hints).toBeVisible();
        const read = (): Promise<{ book: { top: number; bottom: number }; hints: { top: number; bottom: number; left: number; right: number } }> =>
          page.evaluate(() => {
            const b = document.querySelector('[data-testid="notebook"]')?.getBoundingClientRect();
            const h = document.querySelector('[data-testid="btn-hints"]')?.getBoundingClientRect();
            if (b === undefined || h === undefined) throw new Error("no notebook or no button");
            return { book: { top: b.top, bottom: b.bottom }, hints: { top: h.top, bottom: h.bottom, left: h.left, right: h.right } };
          });
        await openNotebook(page);
        const open = await read();
        // The notebook ends above the button, with room between them, and ends there and not higher: the window is not tall enough for it to be at its full height.
        expect(open.book.bottom, "the notebook ends above the button of the hints").toBeLessThanOrEqual(open.hints.top - BOOK_ABOVE + BOOK_SLACK);
        expect(open.book.bottom, "and not higher than it has to").toBeGreaterThanOrEqual(open.hints.top - BOOK_ABOVE - 2);
        // What is on top at the middle of the button and near its corners is the button.
        const free = await page.evaluate(() => {
          const button = document.querySelector('[data-testid="btn-hints"]');
          if (button === null) return false;
          const r = button.getBoundingClientRect();
          return [
            [r.left + r.width / 2, r.top + r.height / 2],
            [r.left + 4, r.top + 4],
            [r.right - 4, r.bottom - 4],
          ].every(([x, y]) => button.contains(document.elementFromPoint(x as number, y as number)));
        });
        expect(free, "the button of the hints has nothing over it").toBe(true);
        // The button can be pressed with the notebook open.
        await hints.click();
        await expect(page.getByTestId("hint-log")).toBeVisible();
        await hints.click();
        await expect(page.getByTestId("hint-log")).toHaveCount(0);
        // Shut and opened again, the notebook is where it was.
        await page.getByTestId("btn-notebook").click();
        await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
        await page.getByTestId("btn-notebook").click();
        await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
        const again = await read();
        expect(again.book.bottom).toBeCloseTo(open.book.bottom, 0);
        expect(lantern.pageErrors).toEqual([]);
      });

      test("ends where it always did while the help is off, above the three things of the corner", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern);
        await expect(page.getByTestId("btn-hints")).toHaveCount(0);
        await openNotebook(page);
        const bottom = await page.evaluate(() => document.querySelector('[data-testid="notebook"]')?.getBoundingClientRect().bottom ?? 0);
        // 84 px from the top and 566 px tall at the most, or 112 px above the foot of the window where that is less.
        expect(bottom).toBeCloseTo(Math.min(84 + 566, size.height - 112), 0);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
