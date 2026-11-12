import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

const TOWN = "scenario=bridge&seed=7&pace=60&until=300";
const SAMPLE = `${TOWN}&notebook=sample`;

test.describe("the notebook", () => {
  test("is a sheet of paper with a line for how each thing reached the player and a word for each mark", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(SAMPLE, { menu: false });
    await lantern.waitForTick(300);
    await expect(page.getByTestId("notebook-count")).toHaveText("5");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("note")).toHaveCount(5);
    await expect(page.getByTestId("note").first()).toBeHidden();
    await expect(page.getByTestId("person-card")).toHaveCount(0);

    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("notebook-sample")).toBeVisible();
    await expect(page.getByTestId("notebook-entries")).toHaveText("5 entries");
    // The placard and the slip stay on the roof line while the notebook is open, and the ledger gives the place up to it.
    await expect(page.getByTestId("task-card")).toBeVisible();
    await expect(page.getByTestId("hud-time")).toBeVisible();
    await expect(page.getByTestId("board")).toBeHidden();

    const notes = page.getByTestId("note");
    await expect(notes.first()).toBeVisible();
    await expect(notes.nth(0).getByTestId("source-badge")).toHaveText("You saw it");
    await expect(notes.nth(0).getByTestId("source-badge")).toHaveAttribute("data-source", "seen");
    await expect(notes.nth(1).getByTestId("source-badge")).toHaveText("Zhou's Clerk says they heard it from Night Watchman");
    await expect(notes.nth(2).getByTestId("source-badge")).toHaveText("Shopkeeper Zhou cannot say who told them");
    await expect(notes.nth(0).getByTestId("seal-contradicts")).toHaveCount(0);

    // Every mark has a seal of its own, in the language of the page, with what it means to hover on.
    const seals = {
      contradicts: ["Says the opposite", "Another note says the opposite. They cannot both be right."],
      unsupported: ["No grounds", "What you know does not show this to be true yet."],
      sourceMismatch: ["Changed on the way", "The teller names who they heard it from, but that person said something else."],
      unconfirmed: ["Nobody saw it", "Nobody has said they saw it with their own eyes."],
    } as const;
    for (const [mark, [label, hint]] of Object.entries(seals)) {
      const seal = page.getByTestId(`seal-${mark}`).first();
      await expect(seal).toBeVisible();
      await expect(seal).toHaveText(label);
      await expect(seal).toHaveAttribute("title", hint);
    }
    await expect(notes.nth(2).getByTestId("seal-unsupported")).toBeVisible();
    await expect(notes.nth(2).getByTestId("seal-sourceMismatch")).toBeVisible();
    await expect(notes.nth(3).getByTestId("seal-contradicts")).toBeVisible();
    await expect(notes.nth(1).getByTestId("seal-unconfirmed")).toBeVisible();

    // Chinese: the same marks under their Chinese names.
    await lantern.setLang("zh");
    for (const [mark, label] of [["contradicts", "说法相反"], ["unsupported", "没有根据"], ["sourceMismatch", "传走样了"], ["unconfirmed", "没人亲眼看见"]] as const) {
      await expect(page.getByTestId(`seal-${mark}`).first()).toHaveText(label);
    }
    await expect(notes.nth(0).getByTestId("source-badge")).toHaveText("你亲眼看见的");
    await expect(notes.nth(1).getByTestId("source-badge")).toHaveText("周家伙计说，是听更夫说的");
    await expect(page.getByTestId("notebook-entries")).toHaveText("五条");

    // How a thing reached the player, hop by hop, with the hops not asked yet marked.
    const chain = notes.nth(2).getByTestId("chain");
    await expect(chain.locator("li")).toHaveCount(4);
    await expect(chain.locator("li").first()).toBeHidden();
    await chain.locator("summary").click();
    await expect(chain.locator("li")).toHaveText(["你", "周掌柜", "周家伙计", "?"]);

    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("task-card")).toBeVisible();
    await page.getByTestId("btn-notebook").click();
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is empty, and says so, until the core has notes; then it shows what the core sends", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await expect(page.getByTestId("notebook-count")).toHaveText("0");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook-empty")).toHaveText("Nothing written yet. What you hear and see goes in here.");
    await expect(page.getByTestId("notebook-sample")).toHaveCount(0);

    await page.evaluate(() =>
      window.__lantern.inject({
        notebook: [
          { id: "k1", text: { zh: "老何在桥下。", en: "Boatman He is under the bridge." }, source: { kind: "heard", who: { zh: "更夫", en: "Night Watchman", id: "gengfu" }, how: "saw" }, marks: ["unconfirmed"], chain: [{ zh: "更夫", en: "Night Watchman" }] },
        ],
      }),
    );
    await expect(page.getByTestId("notebook-count")).toHaveText("1");
    await expect(page.getByTestId("note")).toHaveCount(1);
    await expect(page.getByTestId("note")).toContainText("Boatman He is under the bridge.");
    await expect(page.getByTestId("seal-unconfirmed")).toBeVisible();
    await expect(page.getByTestId("notebook-empty")).toHaveCount(0);
  });
});

test.describe("the bar under the page and the acts of the player", () => {
  test("has one line and the way to the notebook, and where the world gives no reasons no act that is greyed out: an act is there when the world offers it", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    const verbs = ["talk", "listen", "look", "rally", "ask", "askSource", "tell", "entrust", "promise", "speak", "leave"] as const;
    // Whatever the world has people saying, the line has it; with nobody talking there is nothing to say.
    await page.evaluate(() => window.__lantern.inject({ bubbles: [], hud: {}, tasks: [], tracked: null }));
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    await expect(page.getByTestId("btn-notebook")).toBeVisible();
    // The world offers nothing: there is no button to press, and none that is dark.
    for (const verb of verbs) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await expect(page.locator(".verb:disabled")).toHaveCount(0);
    await expect(page.getByTestId("dialogue-input")).toHaveCount(0);

    // Outside a talk the frame can offer listening, looking, calling for helpers and speaking up. Those that it lists are there.
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["listen", "look", "rally", "speak"] } }));
    const words = { en: { listen: "Listen in", look: "Look closely", rally: "Call for helpers", speak: "Speak up" }, zh: { listen: "凑近听", look: "细看", rally: "召集帮手", speak: "当众说" } } as const;
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const verb of ["listen", "look", "rally", "speak"] as const) {
        // The words of the act, and after them the minutes it takes where the frame says (speaking up does, as `player.costs`).
        await expect(page.getByTestId(`verb-${verb}`)).toContainText(words[lang][verb]);
        await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
        await expect(page.getByTestId(`verb-${verb}`)).toHaveAttribute("title", /.+/);
      }
    }
    await lantern.setLang("en");
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["listen"] } }));
    await expect(page.getByTestId("verb-listen")).toBeVisible();
    for (const verb of ["look", "rally", "speak"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    // The core's own name for speaking in public is read as the page's.
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["speak_publicly"] } }));
    await expect(page.getByTestId("verb-speak")).toBeEnabled();
    // The acts of a talk are for a talk.
    for (const verb of ["talk", "ask", "askSource", "tell", "entrust", "promise", "leave"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
  });

  test("has the acts of a talk in the talk, the frame deciding which are on offer, and an act that is off greyed, with the reason", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    await fake.startTalk(page, "li_laotai", {}, ["leave", "ask", "tell", "promise"]);
    const words = { en: { ask: "Ask around", entrust: "Ask a favour", tell: "Tell", leave: "Take your leave" }, zh: { ask: "打听", entrust: "请帮忙", tell: "说", leave: "告辞" } } as const;
    for (const verb of ["ask", "tell", "leave"] as const) {
      await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
      await expect(page.getByTestId(`verb-${verb}`)).toHaveAttribute("title", /.+/);
    }
    // Asking is an act of the row, which opens the list of topics, there when the frame lists `ask`. The source is asked after an answer.
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await expect(page.getByTestId("verb-askSource")).toHaveCount(0);
    // The request is not on offer: the act is there, greyed, and its title says why.
    await expect(page.getByTestId("verb-entrust")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("verb-entrust")).toHaveAttribute("title", "Not yet.");
    await fake.feedFrame(page, { hud: { verbs: ["leave", "ask_source", "entrust"], verbs_off: fake.offReasons(["leave", "ask_source", "entrust"]) } });
    await expect(page.getByTestId("verb-entrust")).toBeEnabled();
    await expect(page.getByTestId("verb-ask")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("verb-tell")).toHaveAttribute("aria-disabled", "true");
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const verb of ["ask", "tell", "leave"] as const) await expect(page.getByTestId(`verb-${verb}`)).toContainText(words[lang][verb]);
    }
    // A talk of the older shape has no request on its button, which says the plain words.
    const player = await fake.playerOf(page);
    const talk = player.talk as Record<string, unknown>;
    await fake.feedFrame(page, { player: { ...player, talk: { npc: talk.npc, costs: talk.costs, leaves_at: talk.leaves_at } } });
    await expect(page.getByTestId("verb-entrust")).toHaveText(words.zh.entrust);
    // An act that the frame does not list and gives no reason for is not drawn.
    await fake.feedFrame(page, { hud: { verbs: ["leave"], verbs_off: {} } });
    for (const verb of ["ask", "tell", "entrust"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
  });

  test("offers nothing in the demo world, whatever the frame lists", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("scenario=m0&seed=3&pace=30&until=100", { menu: false });
    await lantern.waitForTick(100);
    await page.evaluate(() => window.__lantern.inject({ hud: { verbs: ["ask", "move", "listen", "look", "rally"] } }));
    for (const verb of ["talk", "ask", "rally", "look", "listen"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
  });
});

test.describe("the menu", () => {
  test("holds the game's own controls in a drawer that opens from the top bar and closes by itself", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(300);
    const menu = page.getByTestId("menu");
    await expect(menu).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("btn-save")).toBeHidden();

    await page.getByTestId("btn-menu").click();
    await expect(menu).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("btn-save")).toBeVisible();
    await expect(page.getByTestId("btn-export")).toBeVisible();
    await expect(page.getByTestId("select-provider")).toBeVisible();
    // The pause button stays in reach of the pointer while the drawer is open.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");

    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("btn-save")).toBeHidden();
    await page.getByTestId("btn-menu").click();
    await page.getByTestId("menu-close").click();
    await expect(menu).toHaveAttribute("data-open", "false");
    await page.getByTestId("btn-menu").click();
    await page.mouse.click(300, 300);
    await expect(menu).toHaveAttribute("data-open", "false");

    await page.getByTestId("btn-menu").click();
    await lantern.setLang("zh");
    await expect(page.getByTestId("btn-save")).toHaveText("存档");
    await expect(page.getByTestId("btn-new")).toHaveText("新游戏");
    await expect(page.getByTestId("btn-export")).toHaveText("导出录像");
    await expect(page.getByTestId("select-provider").locator("option").first()).toHaveText("离线，不用模型");
  });
});

