import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import { arrive, atTheTeahouse, canvasData, clickCell, clickMap, hold, mapDrawn, notes, riverCell, run } from "../support/play.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

// The bridge town of seed 7, held (paused) at tick 60 (06:10), so that what the player does is applied at once.
const TOWN = "scenario=bridge&seed=7&pace=40&until=60";
// The same town held at tick 240 (08:00). The keeper of the teahouse is at work until noon, so a talk with the keeper has room for every act of a test.
const MORNING = "scenario=bridge&seed=7&pace=40&until=240";

/** The minutes since midnight that a clock reads, such as "08:17". */
const minutesOf = (text: string | null): number => {
  const [hour, minute] = (text ?? "").split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

test.describe("the player on the map", () => {
  test("is a piece of their own at the start, and a click on the ground walks them there, with a marker on the way and a glide between the cells", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await expect.poll(() => page.evaluate(() => window.__lantern.view.stats().people)).toBe(20);
    // The player is not one of the twenty people, and stands where the scene says.
    const start = await page.evaluate(() => window.__lantern.play.scene?.player?.start);
    expect((await canvasData(page)).player).toBe(`${start?.[0]},${start?.[1]}`);
    expect((await canvasData(page)).dots).toBe("20");
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");

    // A street cell four cells along. The marker is there at once, and the world is held.
    await clickCell(page, (start?.[0] ?? 0) + 4, start?.[1] ?? 0);
    await expect.poll(async () => (await canvasData(page)).destination).toBe(`${(start?.[0] ?? 0) + 4},${start?.[1] ?? 0}`);
    expect(await page.evaluate(() => window.__lantern.play.state.destination?.walking)).toBe(true);
    const before = await page.evaluate(() => window.__lantern.view.screenPositionOf("player"));
    await page.evaluate(() => {
      const seen: Array<{ x: number; y: number }> = [];
      (window as unknown as { __walk: typeof seen }).__walk = seen;
      const sample = (): void => {
        const at = window.__lantern.view.screenPositionOf("player");
        if (at !== null) seen.push(at);
        if (seen.length < 120) requestAnimationFrame(sample);
      };
      sample();
    });
    await run(page);
    await arrive(page, (start?.[0] ?? 0) + 4, start?.[1] ?? 0);
    await expect.poll(async () => (await canvasData(page)).destination).toBe("");
    await expect.poll(async () => (await canvasData(page)).player).toBe(`${(start?.[0] ?? 0) + 4},${start?.[1] ?? 0}`);

    // The piece slides over the cells and does not jump: some frame has it between where it was and where it ends up.
    await page.waitForFunction(() => (window as unknown as { __walk: unknown[] }).__walk.length >= 120);
    const walked = await page.evaluate(() => (window as unknown as { __walk: Array<{ x: number; y: number }> }).__walk);
    const end = walked[walked.length - 1] ?? before;
    const span = Math.hypot((end?.x ?? 0) - (before?.x ?? 0), (end?.y ?? 0) - (before?.y ?? 0));
    expect(span).toBeGreaterThan(20);
    const between = walked.filter((p) => Math.hypot(p.x - (before?.x ?? 0), p.y - (before?.y ?? 0)) > 4 && Math.hypot(p.x - (end?.x ?? 0), p.y - (end?.y ?? 0)) > 4);
    expect(between.length).toBeGreaterThan(1);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes to the door of a place when a building is clicked", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    const building = await page.evaluate(() => window.__lantern.play.scene?.buildings.find((b) => b.place === "p_teahouse"));
    const door = await page.evaluate(() => window.__lantern.play.scene?.places.find((p) => p.id === "p_teahouse")?.door);
    if (building === undefined || door == null) throw new Error("no teahouse");
    await clickCell(page, building.x + 1, building.y + 1);
    await expect.poll(async () => (await canvasData(page)).destination).toBe(`${door[0]},${door[1]}`);
    expect(await page.evaluate(() => window.__lantern.play.state.destination?.place)).toBe("p_teahouse");
    await run(page);
    await arrive(page, door[0], door[1]);
    await expect.poll(async () => (await canvasData(page)).destination).toBe("");
    // The action that went to the core named the place, not a cell of the roof.
    const replay = await lantern.exportReplay();
    const moves = replay.records.filter((r) => r[2] === "player").map((r) => r[3]);
    expect(moves[0]).toMatchObject({ type: "move", place: "p_teahouse" });
  });

  test("says why when the town will not let the player go there, in the language of the page, and the note goes by itself", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    const river = await riverCell(page);
    await clickCell(page, river.x, river.y);
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page)).toHaveAttribute("data-reason", "blocked");
    await expect(notes(page)).toHaveAttribute("data-kind", "refused");
    await expect(notes(page)).toHaveText("You cannot walk onto that spot.");
    expect((await canvasData(page)).destination).toBe("");
    await lantern.setLang("zh");
    await expect(notes(page)).toHaveText("走不到那里去。");
    await lantern.setLang("en");
    // Outside the map is another reason, with a text of its own, and the player stays where they were.
    const stays = (await canvasData(page)).player;
    await page.evaluate(() => window.__lantern.play.goTo({ x: 9999, y: 9999, place: null }));
    await expect(notes(page).last()).toHaveText("That spot is off the map.");
    expect((await canvasData(page)).player).toBe(stays);
    // The notes stay a few seconds and are gone.
    await expect(notes(page)).toHaveCount(0, { timeout: 12_000 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a talk", () => {
  test("starts from the card of a person, holds the world with a calm and a badge, answers questions for the minutes they cost, and ends with a leave", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(MORNING, { menu: false });
    await lantern.waitForTick(240);
    await atTheTeahouse(lantern);

    // Pick the keeper of the teahouse. The card has a button, and it says talk because she is within reach.
    await mapDrawn(page);
    const spot = await page.evaluate(() => window.__lantern.view.screenPositionOf("cha_laoban"));
    if (spot === null) throw new Error("no keeper");
    await clickMap(page, spot);
    await expect(page.getByTestId("person-name")).toHaveText("Teahouse Keeper");
    await expect(page.getByTestId("card-talk")).toHaveText("Talk");
    await expect(page.getByTestId("card-talk")).toHaveAttribute("data-near", "true");
    // Until then there is no talk, no calm, and the verbs of a talk are off.
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "false");
    await expect(page.getByTestId("talk-badge")).toHaveCount(0);
    for (const verb of ["ask", "askSource", "leave"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("card-talk")).toBeEnabled();

    // A second click on the person who is picked, after a moment so that it is not half of a double click, is a wish to talk to them.
    await page.waitForTimeout(600);
    await clickMap(page, spot);
    await expect(page.getByTestId("talk-badge")).toBeVisible();
    await expect(page.getByTestId("talk-with")).toHaveText("Talking with Teahouse Keeper");
    // The world stands still, and the page says so: the core's clock is paused at the normal rate, the badge says when the madam has to go (the frame has it as a time of day), a calm lies over the map, and a halo is round the madam.
    expect(await page.evaluate(() => window.__lantern.client.state.rate)).toEqual([1, 1]);
    await expect(page.getByTestId("talk-still")).toHaveText("Time stands still while you talk");
    expect(await page.evaluate(() => (window.__lantern.client.state.frame?.player as { talk: { leaves_at: unknown } }).talk.leaves_at)).toEqual({ hour: 12, minute: 5 });
    await expect(page.getByTestId("talk-leaves")).toHaveText("Leaves at 12:05");
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    expect((await canvasData(page)).talking).toBe("cha_laoban");
    await expect(page.getByTestId("card-talk")).toHaveText("Talking now");
    await expect(page.getByTestId("card-talk")).toBeDisabled();
    // The madam greets the manager as the talk opens, and her greeting is the line of the bar until she answers something (the core chose it by the state of the game: a first meeting).
    await expect(page.getByTestId("dialogue-line")).toHaveText("Teahouse Keeper: “Oh my! You're the new Manager! Sit, sit, have some tea!”");
    await expect(page.getByTestId("talk-area")).toBeVisible();
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await expect(page.getByTestId("verb-ask")).toHaveCount(0);
    await expect(page.getByTestId("verb-leave")).toBeEnabled();
    // A verb that the town offers for a choice is there when the frame lists it, and not otherwise. Speaking in public is not an act of a talk.
    const listed = await page.evaluate(() => (window.__lantern.client.state.frame?.hud as { verbs: string[] }).verbs);
    for (const verb of ["tell", "entrust", "promise"]) {
      if (listed.includes(verb)) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
      else await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("verb-speak")).toHaveCount(0);

    // So far the test's own pause held the world. Let go of it, and the talk holds the world by itself: the bar says that the time is held and not that the player paused, and the button still offers a pause.
    await run(page);
    await expect(page.getByTestId("status")).toHaveText("time held");
    await expect(page.getByTestId("btn-pause")).toHaveText("Pause");
    expect(await page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual([]);
    expect(await page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    const held = (await lantern.tickAt()).tick;
    const clock = (await page.getByTestId("hud-clock").textContent()) ?? "";
    await page.waitForTimeout(800);
    expect((await lantern.tickAt()).tick).toBe(held);
    await expect(page.getByTestId("hud-clock")).toHaveText(clock);
    // The player's pause is another thing: it shows as a pause, and the button then offers to resume. Resuming goes back to the held talk.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("time held");
    await expect(page.getByTestId("btn-pause")).toHaveText("Pause");

    // The notebook holds the world on top of the core's hold. That is the page's pause and not the player's: the bar still says that the time is held.
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual(["page"]);
    await expect(page.getByTestId("status")).toHaveText("time held");
    await expect(page.getByTestId("btn-pause")).toHaveText("Pause");
    // The player's pause on top of both is a pause, and its resume goes back to the hold of the page and the core.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("time held");
    await page.getByTestId("notebook-close").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual([]);
    await expect(page.getByTestId("status")).toHaveText("time held");
    await expect(page.getByTestId("btn-pause")).toHaveText("Pause");

    // A walk is refused in a talk, with the reason of the core. (The strip of the talk lies over the left of the map, where the cell is, so the page is asked for the walk as a click on the map would ask.)
    await page.evaluate(() => window.__lantern.play.goTo({ x: 20, y: 10, place: null }));
    await expect(notes(page).last()).toHaveText("You are in the middle of a talk. Leave it first.");
    // The partner stays picked while the talk lasts.
    await expect(page.getByTestId("person-name")).toHaveText("Teahouse Keeper");

    // Ask about a thing of the story with a tag. The line over the tags says what a question costs, and the world runs that long.
    const chips = page.getByTestId("topic-chips");
    await expect(page.getByTestId("chips-note")).toContainText("Each question takes 10 min.");
    const asked = minutesOf(await page.getByTestId("hud-clock").textContent());
    await expect(chips.getByText("Things", { exact: true })).toBeVisible();
    await expect(chips.getByText("Places", { exact: true })).toBeVisible();
    await expect(chips.getByText("People", { exact: true })).toBeVisible();
    await expect(chips.getByTestId("topic-chip").filter({ hasText: "Shopkeeper Zhou" })).toHaveCount(1);
    // The one she is talking to is not among the tags.
    await expect(chips.getByTestId("topic-chip").filter({ hasText: "Teahouse Keeper" })).toHaveCount(0);
    await chips.locator('[data-testid="topic-chip"][data-id="t_he_boat"]').click();
    await expect(page.getByTestId("talk-line")).toHaveCount(2);
    await expect(page.getByTestId("talk-line").first()).toHaveText("You ask about: The Ferry Boat");
    // The ten minutes are paid for, and the talk holds the world again: the badge stayed, and the bar says that the time is held.
    // The world is held before the answer lands too, so the test waits for the clock on the page to show the ten minutes first.
    await expect.poll(async () => minutesOf(await page.getByTestId("hud-clock").textContent())).toBe(asked + 10);
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await expect(page.getByTestId("talk-badge")).toBeVisible();
    await expect(page.getByTestId("status")).toHaveText("time held");
    await expect(page.getByTestId("btn-pause")).toHaveText("Pause");
    // Her answer is on the map as a bubble and in the bar, twice: as the line on top and as the last line of the talk.
    const answer = (await page.getByTestId("talk-line").last().textContent()) ?? "";
    expect(answer.length).toBeGreaterThan(5);
    await expect(page.getByTestId("dialogue-line")).toContainText(answer);
    await expect.poll(() => page.evaluate(() => window.__lantern.view.texts().bubbles)).toContain(answer);

    // The answer went into the notebook, and the button for it shows that something is new.
    await expect(page.getByTestId("notebook-count")).toHaveText("1");
    await expect(page.getByTestId("notebook-count")).toHaveClass(/is-fresh/);
    const note = page.getByTestId("note").first();
    await expect(note).toHaveAttribute("data-fresh", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(note).toBeVisible();
    await expect(note.getByTestId("source-badge")).toHaveText("Heard from Teahouse Keeper, 1st hand");
    // Nobody has seen it with their own eyes, and the notebook has put no mark on it: it marks what the player has judged, and nothing else.
    expect((await note.getAttribute("data-marks")) ?? "").toBe("");
    await expect(note.getByTestId("note-ask-source")).toBeVisible();
    // It flashes once, and what was new is not new after a few seconds.
    await expect(note).toHaveAttribute("data-fresh", "false", { timeout: 8_000 });
    await expect(page.getByTestId("notebook-count")).not.toHaveClass(/is-fresh/);

    // Ask where it came from, from the notebook itself.
    await note.getByTestId("note-ask-source").click();
    await expect(page.getByTestId("talk-line")).toHaveCount(4);
    await expect(page.getByTestId("talk-line").nth(2)).toContainText("You ask who told them: ");
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");

    // And from the picker of the bar: the entries heard from someone.
    await page.getByTestId("verb-askSource").click();
    await expect(page.getByTestId("picker-askSource").getByTestId("picker-option")).toHaveCount(1);
    await expect(page.getByTestId("picker-askSource").getByTestId("picker-option").first()).toContainText("Heard from Teahouse Keeper, 1st hand");
    await page.getByTestId("picker-askSource").getByTestId("picker-option").first().click();
    await expect(page.getByTestId("talk-line")).toHaveCount(6);
    // Asking the same again writes no second entry.
    await expect(page.getByTestId("notebook-count")).toHaveText("1");

    // A second entry, about something she only heard of. Asking where it came from reaches the end of what she knows.
    await page.locator('[data-testid="topic-chip"][data-id="t_rail"]').click();
    await expect(page.getByTestId("notebook-count")).toHaveText("2");
    await page.getByTestId("btn-notebook").click();
    const second = page.getByTestId("note").nth(1);
    await expect(second.getByTestId("seal-unconfirmed")).toHaveCount(0);
    await second.getByTestId("note-ask-source").click();
    await expect(second.getByTestId("chain")).toBeVisible();
    await second.getByTestId("chain").locator("summary").click();
    await expect(second.getByTestId("chain").locator("li").first()).toHaveText("you");
    await lantern.settled();
    await page.keyboard.press("Escape");

    // The words of the talk follow the language, like everything else.
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-with")).toHaveText("正与茶馆老板娘交谈");
    await expect(page.getByTestId("talk-still")).toHaveText("谈话时世界停着");
    await expect(page.getByTestId("talk-leaves")).toHaveText("12:05 要走");
    await expect(page.getByTestId("talk-line").first()).toHaveText("你问：老何的船");
    await expect(page.getByTestId("verb-leave")).toHaveText("告辞");
    await expect(page.getByTestId("verb-promise")).toHaveText("许二十分钟");
    await expect(page.getByTestId("chips-note")).toContainText("每问一次花十分钟");
    await expect(page.getByTestId("card-talk")).toHaveText("正在交谈");
    await expect(page.getByTestId("topic-chips")).toHaveAttribute("aria-label", "问什么");
    await expect(page.getByTestId("topic-chips").getByText("物件", { exact: true })).toBeVisible();
    await lantern.setLang("en");

    // Leaving lets the world run at its pace, takes the calm away, and the verbs of the talk go dark.
    const stood = (await lantern.tickAt()).tick;
    await page.getByTestId("verb-leave").click();
    await expect(page.getByTestId("talk-badge")).toHaveCount(0);
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "false");
    expect((await canvasData(page)).talking).toBe("");
    expect(await page.evaluate(() => window.__lantern.client.state.rate)).toEqual([1, 1]);
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick(stood + 20);
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("talk-log")).toHaveCount(0);
    // Leaving again is refused, with a reason.
    await page.evaluate(() => window.__lantern.play.leave());
    await expect(notes(page).last()).toHaveText("You are not talking to anyone.");
    expect((await lantern.snapshot()).error).toBeNull();
    expect(lantern.pageErrors).toEqual([]);
    // The calm, the badge, the lists and the notebook are placed by classes and attributes, which the policy allows.
    expect(lantern.consoleLines.filter((l) => /Refused to|Content Security Policy/i.test(l))).toEqual([]);
  });

  test("starts from the walk of the card when the person is far away, and again from the button of the card", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await mapDrawn(page);
    const spot = await page.evaluate(() => window.__lantern.view.screenPositionOf("cha_laoban"));
    if (spot === null) throw new Error("no keeper");
    await clickMap(page, spot);
    // The player is at the bridge, a good way off.
    await expect(page.getByTestId("card-talk")).toHaveText("Walk up and talk");
    await expect(page.getByTestId("card-talk")).toHaveAttribute("data-near", "false");
    await page.getByTestId("card-talk").click();
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc)).toBe("cha_laoban");
    await expect.poll(async () => (await canvasData(page)).destination).not.toBe("");
    // The world runs for the walk and the talk holds it, so that the talk is still there when the test gets to it.
    await run(page);
    await expect(page.getByTestId("talk-badge")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("talk-with")).toHaveText("Talking with Teahouse Keeper");
    expect(await page.evaluate(() => window.__lantern.play.state.approach)).toBeNull();
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    expect(await page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual([]);
    await page.getByTestId("verb-leave").click();
    await expect(page.getByTestId("talk-badge")).toHaveCount(0);

    // With her still picked, the button of the card starts the talk again.
    await hold(page);
    await expect(page.getByTestId("card-talk")).toBeEnabled();
    await page.getByTestId("card-talk").click();
    await expect(page.getByTestId("talk-badge")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("listening, looking and calling for helpers", () => {
  test("listen takes in what two people said nearby, and the notebook has it", async ({ lantern }) => {
    const page = lantern.page;
    // Seed 0 has two people telling each other something within earshot of the bridge at tick 155.
    await lantern.open("scenario=bridge&seed=0&pace=40&until=160", { menu: false });
    await lantern.waitForTick(160);
    await expect(page.getByTestId("verb-listen")).toBeEnabled();
    await expect(page.getByTestId("verb-look")).toBeEnabled();
    await expect(page.getByTestId("notebook-count")).toHaveText("0");
    await page.getByTestId("verb-listen").click();
    await expect(notes(page).first()).toContainText("You overheard");
    await expect(notes(page).first()).toContainText("It is in your notebook.");
    await expect(page.getByTestId("notebook-count")).toHaveText("1");
    await expect(page.getByTestId("notebook-count")).toHaveClass(/is-fresh/);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "true");
    await expect(page.getByTestId("note").first().getByTestId("source-badge")).toContainText("Heard from");
    // What was heard is not offered again, and asking for it is refused with a reason.
    await page.evaluate(() => window.__lantern.play.listen());
    await expect(notes(page).last()).toHaveText(/Nobody nearby is saying anything new\.|You overheard/);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("look offers what is within reach, is refused out of hours, and writes down what it finds", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    // 06:10: the railing is not open to a look before seven.
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    await page.getByTestId("verb-look").click();
    await expect(page.getByTestId("picker-look").getByTestId("picker-option")).toHaveText(["Stone Bridge Railing"]);
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    await expect(notes(page).last()).toHaveText("It is not open to you at this hour.");
    await expect(notes(page).last()).toHaveAttribute("data-reason", "closed");
    await lantern.setLang("zh");
    await expect(notes(page).last()).toHaveText("这个时辰看不了。");
    await lantern.setLang("en");

    // 09:20.
    await lantern.open("scenario=bridge&seed=7&pace=40&until=400", { menu: false });
    await lantern.waitForTick(400);
    await page.getByTestId("verb-look").click();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    await expect(notes(page).last()).toHaveText("Looking at Stone Bridge Railing…");
    // The player is busy for the while it takes, and the core does not offer the act meanwhile.
    await expect(page.getByTestId("verb-look")).toHaveCount(0);
    await run(page);
    await expect(notes(page).filter({ hasText: /You wrote|You found nothing/ })).toHaveCount(1, { timeout: 30_000 });
    // What the core says it wrote is what the notebook holds.
    const written = await page.evaluate(() => {
      const found = window.__lantern.client.state.events.filter((e) => e.kind === "inspected");
      return { count: found.length, entries: (found[found.length - 1]?.entries as string[] | undefined)?.length ?? -1 };
    });
    expect(written.count).toBe(1);
    expect(written.entries).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("notebook-count")).toHaveText(String(written.entries));
    if (written.entries > 0) {
      await expect(notes(page).last()).toHaveText(`You wrote ${written.entries} new things in your notebook.`);
      await page.getByTestId("btn-notebook").click();
      await expect(page.getByTestId("note").first().getByTestId("source-badge")).toHaveText("Seen myself");
      await lantern.settled();
      await page.keyboard.press("Escape");
    }

    // Once looked at, it is not offered again.
    await hold(page);
    await expect(page.getByTestId("verb-look")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("rally calls for helpers once, and the festival board answers", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(`${TOWN}&config=dev_actions:1`, { menu: false });
    await lantern.waitForTick(60);
    await expect(page.getByTestId("verb-rally")).toBeEnabled();
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("stat-promised")).toContainText("0 households");
    // The festival part has the festival's own numbers: the way across is not there yet. The helpers and the work hours are the bridge's, and are on the board.
    await expect(page.getByTestId("stat-passage")).toContainText("No way across yet");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("Have 0");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveAttribute("data-need", "5");
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "0");
    await expect(page.getByTestId("board-hours")).toContainText("Needs 10 hours");
    await expect(page.getByTestId("hud-festival").getByTestId("stat-bridge")).toHaveCount(0);
    await expect(page.getByTestId("hud-festival").locator("progress")).toHaveCount(0);
    await page.getByTestId("verb-rally").click();
    await expect(notes(page).first()).toHaveText("You called for helpers.");
    // It can be done once.
    await expect(page.getByTestId("verb-rally")).toHaveCount(0);
    await page.evaluate(() => window.__lantern.play.rally());
    await expect(notes(page).last()).toHaveText("You have already called for helpers.");

    // Three people agree, by the test action that stands in for persuasion. Their households hang a lantern.
    await page.evaluate(() => {
      for (const npc of ["li_da", "zhou_dalang", "mujiang"]) window.__lantern.client.player({ type: "dev_goal", op: "join", npc });
    });
    // Somebody may join at the call itself, so wait for the numbers that the three joined make and not for the first note.
    await page.waitForFunction(() => {
      const now = window.__lantern.client.state.frame?.hud as { promised: number; bridge: { done: number } };
      return now.promised >= 2 && now.bridge.done >= 3;
    });
    await expect(notes(page).filter({ hasText: "will help." })).not.toHaveCount(0);
    const hud = await page.evaluate(() => window.__lantern.client.state.frame?.hud as { promised: number; turnout: number; bridge: { done: number; need: number } });
    expect(hud.promised).toBeGreaterThanOrEqual(2);
    expect(hud.bridge.done).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("stat-promised")).toContainText(`${hud.promised} households`);
    await expect.poll(async () => (await canvasData(page)).lanterns).toBe(String(hud.promised));
    // The helpers are on the board, in all, which can be more than the bridge takes.
    const board = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { board: { helpers: Array<{ count: number }>; need: number } }).board);
    const helpers = board.helpers.reduce((sum, family) => sum + family.count, 0);
    expect(helpers).toBeGreaterThanOrEqual(hud.bridge.done);
    // With more than the work takes the total says that there are enough, and what it takes.
    const enough = helpers > board.need;
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText(`Have ${helpers}`);
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveAttribute("data-need", String(board.need));
    await expect(page.getByTestId("board-helpers").locator(".lrow-mark svg")).toHaveCount(enough || helpers >= board.need ? 1 : 0);
    await expect(page.getByTestId("stat-turnout")).toContainText(`${hud.turnout.toLocaleString("en-US")} people`);
    await lantern.setLang("zh");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText(/^有.+人$/);
    await expect(page.getByTestId("board-hours")).toContainText("要十个钟头");
    await expect(page.getByTestId("stat-passage")).toContainText("还没有路可走");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("tell, request, promise and speak up are there when the frame lists them, and send what the core offers, a request and a promise after their preview", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    // Nothing is listed, so there is no act to press, in a talk or out of one.
    for (const verb of ["tell", "entrust", "promise", "speak"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    // What the page sends is recorded here and not passed on, so that the test is about the page and not about what the core makes of the choices.
    await page.evaluate(() => {
      const sent: Array<Record<string, unknown>> = [];
      (window as unknown as { __sent: typeof sent }).__sent = sent;
      window.__lantern.client.player = (body) => {
        sent.push(body);
        return "recorded";
      };
    });
    const player = () => page.evaluate(() => window.__lantern.client.state.frame?.player as Record<string, unknown>);
    // In a talk the frame offers them, with choices of its own for one of them.
    await fake.feedFrame(page, {
      hud: { verbs: ["leave", "tell", "entrust", "promise"] },
      player: {
        ...(await player()),
        talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } },
        offers: { promise: [{ id: "stall", zh: "一个摊位", en: "A market stall", body: { thing: "stall" } }, { id: "role", zh: "点主灯", en: "Lighting the main lantern" }] },
      },
    });
    for (const verb of ["tell", "entrust", "promise"]) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
    // Speaking in public is not an act of a talk.
    await expect(page.getByTestId("verb-speak")).toHaveCount(0);
    const sent = () => page.evaluate(() => (window as unknown as { __sent: Array<Record<string, unknown>> }).__sent);

    // A promise is not sent when the choice is made: the player sees its preview, and sends it by confirming.
    await page.getByTestId("verb-promise").click();
    await expect(page.getByTestId("picker-promise")).toHaveAttribute("aria-label", "Promise…");
    await expect(page.getByTestId("picker-promise").getByTestId("picker-option")).toHaveText(["A market stall", "Lighting the main lantern"]);
    await page.getByTestId("picker-option").first().click();
    await expect(page.getByTestId("picker-promise")).toHaveCount(0);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await sent()).toEqual([]);
    await page.getByTestId("request-confirm").click();
    // A choice that comes with the fields of its action sends them; one that does not sends its id. The version of the preview goes with it.
    expect((await sent())[0]).toMatchObject({ thing: "stall", type: "promise", version: expect.any(Number) });
    await page.getByTestId("verb-promise").click();
    await page.getByTestId("picker-option").last().click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    expect((await sent())[1]).toMatchObject({ choice: "role", type: "promise", version: expect.any(Number) });

    // With nothing written and nothing offered, there is nothing to tell. The list says so, and Escape closes it.
    await page.getByTestId("verb-tell").click();
    await expect(page.getByTestId("picker-tell").getByTestId("picker-empty")).toHaveText("There is nothing to choose from yet.");
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("picker-tell")).toHaveCount(0);
    // With an entry in the notebook, telling it as it stands is a choice. The ways the town offers are in the submenu, each with its risk.
    const withEntry = {
      notebook: [{ id: "n7", text: { zh: "老何在桥下。", en: "Old He was under the bridge." }, source: { kind: "seen" }, marks: [], chain: [] }],
      player: {
        ...(await player()),
        offers: {
          ...((await player()) as { offers: object }).offers,
          tell: [{ id: "n7:sharpen", label: { zh: "添油加醋：老何在桥下。", en: "Heavier: Old He was under the bridge." }, body: { entry: "n7", how: "sharpen" } }],
          speak: [{ id: "meal", label: { zh: "摆一桌和解饭", en: "Lay a table for peace" }, body: { kind: "meal" } }],
        },
      },
    };
    await fake.feedFrame(page, withEntry);
    await page.getByTestId("verb-tell").click();
    await expect(page.getByTestId("picker-tell").getByTestId("picker-option")).toHaveText(["Old He was under the bridge.Seen myself"]);
    await page.getByTestId("picker-tell").getByTestId("picker-option").last().click();
    expect((await sent())[2]).toEqual({ entry: "n7", type: "tell" });
    await page.getByTestId("verb-tellOther").click();
    await expect(page.getByTestId("picker-tellOther").getByTestId("picker-option")).toHaveText(["Heavier: Old He was under the bridge."]);
    await page.getByTestId("picker-tellOther").getByTestId("picker-option").first().click();
    expect((await sent())[3]).toEqual({ entry: "n7", how: "sharpen", type: "tell" });

    // Out of the talk, speaking in public has what the town offers and no entries of the notebook.
    await fake.feedFrame(page, { hud: { verbs: ["move", "speak"] }, player: { ...(await player()), talk: null } }, [{ kind: "talk_end", tick: 9, npc: "cha_laoban", reason: "left" }]);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await page.getByTestId("verb-speak").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Lay a table for peace"]);
    await page.getByTestId("picker-option").click();
    expect((await sent())[4]).toEqual({ kind: "meal", type: "speak" });

    await lantern.setLang("zh");
    await expect(page.getByTestId("verb-speak")).toContainText("当众说");
    await fake.feedFrame(page, { hud: { verbs: ["leave", "entrust", "promise"] }, player: { ...(await player()), talk: { npc: "cha_laoban", leaves_at: { hour: 12, minute: 5 } } } });
    await expect(page.getByTestId("verb-entrust")).toHaveText("求");
    await page.getByTestId("verb-promise").click();
    await expect(page.getByTestId("picker-promise").getByTestId("picker-option")).toHaveText(["一个摊位", "点主灯"]);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the ending", () => {
  test("comes when the last night does: the label, the numbers, the truth and the rumours as trees, in both languages, and a new game", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    // A game of one day, with the test actions that stand in for persuasion.
    await lantern.open("scenario=bridge&seed=7&pace=80&config=days:1,dev_actions:1", { menu: false });
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 120_000 });

    // The world is held at the ending, and the page shows it over the map.
    await expect(page.getByTestId("status")).toHaveText("paused");
    const ending = page.getByTestId("ending");
    await expect(ending).toBeVisible();
    const id = await ending.getAttribute("data-ending");
    expect(id).toMatch(/^(ending_full|ending_barely|ending_split)$/);
    const event = await page.evaluate(() => window.__lantern.client.state.events.find((e) => e.kind === "ending"));
    const label = event?.label as { zh: string; en: string };
    await expect(page.getByTestId("ending-title")).toHaveText(label.en);
    await expect(page.getByTestId("ending-promised")).toContainText("household");
    await expect(page.getByTestId("ending-turnout")).toContainText("people");
    // What became of the ten people who carry the days, in the order of the cast, as the event says it, in the language of the page.
    const epilogue = event?.epilogue as Array<{ npc: string; id: string; text: { zh: string; en: string } }>;
    expect(epilogue.map((line) => line.npc)).toEqual(["li_laotai", "li_da", "li_er", "zhou_zhanggui", "zhou_dalang", "zhou_huoji", "cha_laoban", "old_he", "zuzhang", "gengfu"]);
    await expect(page.getByTestId("epilogue-line")).toHaveCount(10);
    await expect(page.locator('[data-testid="epilogue-line"] .epilogue-text')).toHaveText(epilogue.map((line) => line.text.en));
    await expect(page.getByTestId("reveal-epilogue")).not.toContainText(/[一-鿿]/);
    const inputs = event?.inputs as Record<string, boolean>;
    await expect(page.getByTestId("ending-checks").locator("li")).toHaveCount(Object.keys(inputs).length);
    for (const [name, done] of Object.entries(inputs)) await expect(page.locator(`[data-input="${name}"]`)).toHaveAttribute("data-done", String(done));
    // The ending page is laid over the map under the top bar, which stays.
    const bar = await page.locator("header.topbar").boundingBox();
    const endingBox = await ending.boundingBox();
    expect(endingBox?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0) - 2);
    expect(endingBox?.x ?? 1).toBeLessThan(2);

    // What really happened, in the language of the page, as the core says it and not as the page would.
    await expect(page.getByTestId("reveal-truth")).toBeVisible();
    const variant = await page.getByTestId("reveal-truth").getAttribute("data-variant");
    expect(variant).toMatch(/^v_/);
    await expect(page.getByTestId("reveal-truth")).not.toContainText(/[一-鿿]/);
    const reveal = event?.reveal as { truth: { label: { zh: string; en: string } }; chains: Array<{ label: { zh: string; en: string }; texts: Record<string, { zh: string; en: string }>; told: Array<[string, string, string, string, string, number]> }> };
    await expect(page.getByTestId("reveal-truth").locator(".ending-truth")).toHaveText(reveal.truth.label.en);
    await expect(page.getByTestId("reveal-chain").first().getByRole("heading")).toHaveText(reveal.chains[0]?.label.en ?? "");
    // The rumours: a tree for each chain that reached anyone, with a flag where a story changed.
    await expect(page.getByTestId("reveal-chain")).not.toHaveCount(0);
    const nodes = await page.getByTestId("tree-node").count();
    const edges = await page.getByTestId("tree-edge").count();
    expect(nodes).toBeGreaterThan(2);
    // A tree has one line for each person but the one at its root.
    expect(edges).toBe(nodes - (await page.locator('[data-testid="tree-node"].is-first').count()));
    const flags = await page.getByTestId("tree-flag").count();
    expect(flags).toBeGreaterThan(0);
    await expect(page.getByTestId("tree-change")).toHaveCount(flags);
    expect(await page.locator('[data-testid="tree-edge"][data-changed="true"]').count()).toBe(flags);
    await expect(page.getByTestId("tree-change").first()).toContainText(" to ");
    // What each person said is written under their name, in the words of the chain, and in the list of changes.
    const chain = reveal.chains[0];
    const words = (lang: "zh" | "en") => page.getByTestId("reveal-chain").first().getByTestId("tree-words").evaluateAll((els, l) => els.map((el) => [el.getAttribute("data-prop"), el.getAttribute("data-words"), el.getAttribute("data-said"), l]), lang);
    const written = await words("en");
    expect(written.length).toBeGreaterThan(2);
    for (const [prop, text] of written) expect(text).toBe(chain?.texts[prop ?? ""]?.en);
    // Somebody told it on, and somebody was only told.
    expect(written.some(([, , said]) => said === "true")).toBe(true);
    expect(written.some(([, , said]) => said === "false")).toBe(true);
    const changed = chain?.told.filter((row) => row[4] !== "") ?? [];
    // The tree draws each person once, where they first heard the story, so a change told to someone
    // already in it is listed in the data but not drawn again. Every change that is drawn quotes its version.
    const drawn = await page
      .getByTestId("reveal-chain")
      .first()
      .getByTestId("tree-change")
      .evaluateAll((els) => els.map((el) => [el.getAttribute("data-prop") ?? "", el.querySelector('[data-testid="tree-quote"]')?.textContent ?? ""]));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(changed.length);
    for (const [prop, quote] of drawn) {
      expect(changed.map((row) => row[3])).toContain(prop);
      expect(quote).toContain(`“${chain?.texts[prop ?? ""]?.en}”`);
    }
    // Who believed what, and how much was told.
    await expect(page.getByTestId("reveal-believers")).toBeVisible();
    await expect(page.getByTestId("reveal-told")).toContainText("tellings in all");
    // The people in the tree have the names of the language of the page.
    const english = await page.getByTestId("tree-node").first().textContent();
    expect(english).not.toMatch(/[一-鿿]/);

    await lantern.setLang("zh");
    await expect(page.getByTestId("ending-title")).toHaveText(label.zh);
    await expect(page.locator('[data-testid="epilogue-line"] .epilogue-text')).toHaveText(epilogue.map((line) => line.text.zh));
    await expect(page.getByTestId("reveal-truth")).toContainText(/[一-鿿]/);
    await expect(page.getByTestId("reveal-told")).toContainText("一共传了");
    await expect(page.getByTestId("tree-node").first()).toHaveText(/[一-鿿]/);
    await expect(page.getByTestId("tree-change").first()).toContainText("说给");
    await expect(page.getByTestId("reveal-truth").locator(".ending-truth")).toHaveText(reveal.truth.label.zh);
    await expect(page.getByTestId("reveal-chain").first().getByRole("heading")).toHaveText(reveal.chains[0]?.label.zh ?? "");
    for (const [prop, text] of await words("zh")) expect(text).toBe(chain?.texts[prop ?? ""]?.zh);
    await expect(page.getByTestId("reveal-chain").first().getByTestId("tree-change").first()).toContainText(`「${chain?.texts[changed[0]?.[3] ?? ""]?.zh}」`);
    await lantern.setLang("en");
    await expect(page.getByTestId("ending-title")).toHaveText(label.en);

    // Put away to look at the town, and brought back.
    await page.getByTestId("ending-back").click();
    await expect(ending).toHaveCount(0);
    await expect(page.getByTestId("ending-tab")).toHaveText("Show the ending");
    // The tab hangs in the middle of the foot of the map, inside the window and clear of the roof line and the placard at the top left.
    const tab = await page.getByTestId("ending-tab").boundingBox();
    const viewport = page.viewportSize();
    if (tab === null || viewport === null) throw new Error("no box");
    expect(Math.abs(tab.x + tab.width / 2 - viewport.width / 2), "the tab is in the middle").toBeLessThanOrEqual(2);
    expect(tab.y, "the tab is clear of the placard").toBeGreaterThan(200);
    expect(tab.y + tab.height, "the tab is inside the window").toBeLessThanOrEqual(viewport.height);
    await page.getByTestId("ending-tab").click();
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("ending-tab")).toHaveCount(0);
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await page.getByTestId("ending-tab").click();

    // A new game takes the page away and starts the town again, on the same terms as this one (the test config).
    await page.getByTestId("ending-new").click();
    // The world was held at the ending, and a new game from there runs.
    await expect(page.getByTestId("status")).toHaveText("running");
    await hold(page);
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await expect(page.getByTestId("ending-tab")).toHaveCount(0);
    expect(await lantern.tick()).toBeLessThan(1800);
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");
    expect((await lantern.snapshot()).error).toBeNull();
    expect(lantern.pageErrors).toEqual([]);
    // The trees are drawn with attributes of the picture, and the policy refuses no style.
    expect(lantern.consoleLines.filter((l) => /Refused to|Content Security Policy/i.test(l))).toEqual([]);
    expect((await lantern.snapshot()).cspViolations).toEqual([]);
  });

  test("is read from the frame alone, with the core's own labels, what each person said in the tree and the list, and the manager's part, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    const words = {
      p1: { zh: "李二昨夜在石桥找灯笼。", en: "Li Er was looking for his lantern at the bridge." },
      p2: { zh: "李二昨夜在石桥。", en: "Li Er was at the bridge last night." },
      p3: { zh: "李二昨夜弄坏了石桥栏杆。", en: "Li Er broke the railing last night." },
      fab: { zh: "李家昨夜弄坏了石桥栏杆。", en: "The Li family broke the railing last night." },
    };
    const ending = {
      kind: "ending",
      tick: 1800,
      ending: "ending_barely",
      label: { zh: "灯下勉强", en: "Barely, by lantern light" },
      hidden: [{ id: "hidden_legend_of_lie", label: { zh: "谎话成了灯会传说", en: "The lie became a festival legend" } }],
      inputs: { bridge_fixed: true, detour_done: false, reconciled: false, truth_told: false },
      passage: "mended",
      promised: 9,
      turnout: 1500,
      epilogue: [
        { npc: "li_laotai", id: "bridge", text: { zh: "李老太站在桥头，看灯一盏盏过去。老人家没有过桥。", en: "Granny Li stood at the head of the bridge and watched the lanterns go by. The old woman did not cross." } },
        { npc: "old_he", id: "idle", text: { zh: "桥通了，渡船冷清了。老何还守在渡口，天黑才收桨。", en: "With the bridge open the ferry was quiet. Boatman He still sat at the landing and shipped the oars only at dark." } },
      ],
      reveal: {
        truth: { variant: "v_flood", label: { zh: "这回真是秋汛冲垮的栏杆。", en: "The autumn flood really did take the railing." }, props: [] },
        chains: [
          {
            id: "ch_made_up_for_the_test",
            label: { zh: "从「找灯笼」传成「弄坏栏杆」", en: "From “looking for a lantern” to “broke the railing”" },
            texts: { p1: words.p1, p2: words.p2, p3: words.p3 },
            planted: [["p1", null, null]],
            true: ["p1"],
            told: [
              ["c1", "li_er", "li_laotai", "p1", "", 18],
              ["c2", "li_laotai", "zhou_zhanggui", "p2", "level", 27],
              ["c3", "zhou_zhanggui", "zhou_niangzi", "p3", "sharpen", 43],
              ["c4", "player", "cha_laoban", "p3", "", 80],
            ],
            held: [],
            reached: ["li_laotai", "zhou_zhanggui", "zhou_niangzi", "cha_laoban"],
          },
        ],
        believers: { false: ["zhou_niangzi"], true: [], none: ["li_er"] },
        told: { total: 4, mutated: 2 },
        player: {
          spoke: {
            tellings: 2,
            lies: 1,
            ways: { faithful: 1, fabricate: 1 },
            told: [["c4", "cha_laoban", "p3", "faithful", 0, 80], ["c9", "zhou_niangzi", "fab", "fabricate", 1, 100]],
            reached: ["cha_laoban", "zhou_niangzi"],
            retold: 1,
            furthest: 2,
            caught: [["fab", "zhou_niangzi", 150]],
          },
          said_of_me: [["c12", "zhou_niangzi", "cha_laoban", "p3", 200]],
          texts: { p3: words.p3, fab: words.fab },
        },
      },
    };
    // The frame carries the ending and no event comes with it: a game that was loaded, or that the page came back to.
    await page.evaluate(
      (e) => {
        const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
        const frame = { ...(window.__lantern.client.state.frame as object), hud: { ...(window.__lantern.client.state.frame?.hud as object), ending: "ending_barely", promised: 9, turnout: 1500 }, ending: e };
        client.onMessage({ type: "frame", tick: 61, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
      },
      ending,
    );
    const names = await page.evaluate(() => Object.fromEntries([...(window.__lantern.play.scene?.cast ?? []), { id: "player", name: window.__lantern.play.scene?.player?.name }].map((p) => [p.id, p.name])));
    const word = (prop: keyof typeof words, lang: "zh" | "en") => words[prop][lang];

    await expect(page.getByTestId("ending")).toBeVisible();
    // Every label is the core's own, and not the page's text for the same ending, truth or chain.
    await expect(page.getByTestId("ending-title")).toHaveText("Barely, by lantern light");
    await expect(page.getByTestId("ending-tag")).toHaveText(["The lie became a festival legend"]);
    // What became of the people who carry the days stands under the name of the ending, before the numbers and the reveal.
    const epilogue = page.getByTestId("reveal-epilogue");
    await expect(epilogue.getByRole("heading")).toHaveText("Afterwards");
    await expect(epilogue.getByTestId("epilogue-line")).toHaveCount(2);
    await expect(epilogue.locator(".epilogue-name")).toHaveText([names.li_laotai?.en ?? "", names.old_he?.en ?? ""]);
    await expect(epilogue.locator(".epilogue-text")).toHaveText([
      "Granny Li stood at the head of the bridge and watched the lanterns go by. The old woman did not cross.",
      "With the bridge open the ferry was quiet. Boatman He still sat at the landing and shipped the oars only at dark.",
    ]);
    await expect(epilogue.getByTestId("epilogue-line").first()).toHaveAttribute("data-npc", "li_laotai");
    expect((await epilogue.boundingBox())?.y ?? 0).toBeLessThan((await page.getByTestId("ending-numbers").boundingBox())?.y ?? 0);
    expect((await epilogue.boundingBox())?.y ?? 0).toBeLessThan((await page.getByTestId("reveal-truth").boundingBox())?.y ?? 0);
    await expect(page.getByTestId("reveal-truth").locator(".ending-truth")).toHaveText("The autumn flood really did take the railing.");
    await expect(page.getByTestId("reveal-chain").getByRole("heading")).toHaveText("From “looking for a lantern” to “broke the railing”");
    // Under each person: what they said, or what they were told if they told nobody.
    const tree = page.getByTestId("reveal-chain");
    await expect(tree.getByTestId("tree-node")).toHaveCount(6);
    const under = async (person: string) => {
      const node = tree.locator(`[data-testid="tree-node"][data-person="${person}"]`);
      return [await node.getByTestId("tree-words").getAttribute("data-prop"), await node.getByTestId("tree-words").getAttribute("data-said"), await node.getByTestId("tree-words").getAttribute("data-words")];
    };
    expect(await under("li_er")).toEqual(["p1", "true", word("p1", "en")]);
    expect(await under("li_laotai")).toEqual(["p2", "true", word("p2", "en")]);
    expect(await under("zhou_zhanggui")).toEqual(["p3", "true", word("p3", "en")]);
    expect(await under("zhou_niangzi")).toEqual(["p3", "false", word("p3", "en")]);
    expect(await under("cha_laoban")).toEqual(["p3", "false", word("p3", "en")]);
    // The manager told it too, and stands in the tree under their own name.
    expect(await under("player")).toEqual(["p3", "true", word("p3", "en")]);
    await expect(tree.locator('[data-testid="tree-node"][data-person="player"] text').first()).toHaveText(names.player?.en ?? "");
    // A version that is not true is a red line, and the list has the words of each change.
    await expect(tree.locator('[data-testid="tree-edge"][data-untrue="true"]')).toHaveCount(3);
    await expect(tree.getByTestId("tree-change")).toHaveCount(2);
    await expect(tree.getByTestId("tree-quote")).toHaveText([`“${word("p2", "en")}”`, `“${word("p3", "en")}”`]);
    // The manager's part: how far their words went, what they told and what was said of them.
    await expect(page.getByTestId("spoke-tellings")).toHaveText("2, 1 of them untrue");
    await expect(page.getByTestId("spoke-reached-names").locator("li")).toHaveText([names.cha_laoban?.en ?? "", names.zhou_niangzi?.en ?? ""]);
    await expect(page.getByTestId("told-line")).toHaveText([
      `To ${names.cha_laoban?.en}: “${word("p3", "en")}” (as it was)`,
      `To ${names.zhou_niangzi?.en}: “${word("fab", "en")}” (made up, caught)`,
    ]);
    await expect(page.getByTestId("said-line")).toHaveText([`${names.zhou_niangzi?.en} to ${names.cha_laoban?.en}: ${word("p3", "en")}`]);

    await lantern.setLang("zh");
    await expect(page.getByTestId("ending-title")).toHaveText("灯下勉强");
    await expect(page.getByTestId("ending-tag")).toHaveText(["谎话成了灯会传说"]);
    await expect(epilogue.getByRole("heading")).toHaveText("后来");
    await expect(epilogue.locator(".epilogue-name")).toHaveText([names.li_laotai?.zh ?? "", names.old_he?.zh ?? ""]);
    await expect(epilogue.locator(".epilogue-text")).toHaveText(["李老太站在桥头，看灯一盏盏过去。老人家没有过桥。", "桥通了，渡船冷清了。老何还守在渡口，天黑才收桨。"]);
    await expect(page.getByTestId("reveal-truth").locator(".ending-truth")).toHaveText("这回真是秋汛冲垮的栏杆。");
    await expect(page.getByTestId("reveal-chain").getByRole("heading")).toHaveText("从「找灯笼」传成「弄坏栏杆」");
    expect(await under("zhou_zhanggui")).toEqual(["p3", "true", word("p3", "zh")]);
    expect(await under("zhou_niangzi")).toEqual(["p3", "false", word("p3", "zh")]);
    await expect(tree.locator('[data-testid="tree-node"][data-person="player"] text').first()).toHaveText(names.player?.zh ?? "");
    await expect(tree.getByTestId("tree-quote")).toHaveText([`「${word("p2", "zh")}」`, `「${word("p3", "zh")}」`]);
    await expect(page.getByTestId("told-line")).toHaveText([
      `对${names.cha_laoban?.zh}说：「${word("p3", "zh")}」（照实说）`,
      `对${names.zhou_niangzi?.zh}说：「${word("fab", "zh")}」（编的，被拆穿）`,
    ]);
    await expect(page.getByTestId("said-line")).toHaveText([`${names.zhou_niangzi?.zh}对${names.cha_laoban?.zh}说：${word("p3", "zh")}`]);
    expect(lantern.pageErrors).toEqual([]);
    // The words in the tree are lines of a picture and classes, and the policy refuses nothing.
    expect(lantern.consoleLines.filter((l) => /Refused to|Content Security Policy/i.test(l))).toEqual([]);
    expect((await lantern.snapshot()).cspViolations).toEqual([]);
  });

  test("shows again after a save of the game that is over is loaded: the host sends the whole ending, and no event comes with it", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=80&config=days:1,dev_actions:1", { menu: false });
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 120_000 });
    const ending = page.getByTestId("ending");
    await expect(ending).toBeVisible();
    const title = await page.getByTestId("ending-title").textContent();
    const trees = await page.getByTestId("tree-node").count();
    expect(trees).toBeGreaterThan(2);
    const saved = await page.evaluate(() => window.__lantern.client.save("the last night"));

    // Another game takes the page away from the ending.
    await page.getByTestId("ending-new").click();
    await expect(ending).toHaveCount(0);
    await hold(page);
    await expect(page.getByTestId("hud-day")).toHaveText("Day 1");
    expect(await page.evaluate(() => window.__lantern.play.state.ending)).toBeNull();

    // The loaded game is over, and so the page says so, with all that the reveal has: the host sends the whole ending
    // with the game, since the frames of a game that is over leave the reveal out.
    const loaded = await page.evaluate((id) => window.__lantern.client.load(id), saved.id);
    expect(loaded.match).toBe(true);
    await expect(ending).toBeVisible();
    await expect(page.getByTestId("ending-title")).toHaveText(title ?? "");
    await expect(page.getByTestId("tree-node")).toHaveCount(trees);
    await expect(page.getByTestId("tree-words").first()).toBeVisible();
    expect(await page.evaluate(() => window.__lantern.client.state.events.some((e) => e.kind === "ending"))).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("asks the host for the whole ending when a frame is all the page has: the frames of a game that is over leave the reveal out", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=80&config=days:1,dev_actions:1", { menu: false });
    await page.waitForFunction(() => window.__lantern.play.state.ending !== null, undefined, { timeout: 120_000 });
    const trees = await page.getByTestId("tree-node").count();
    expect(trees).toBeGreaterThan(2);
    // A page that opens on a game that is over has the frame and no event. The frame has the compact ending.
    await page.evaluate(() => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const event = window.__lantern.client.state.events.find((e) => e.kind === "ending") as Record<string, unknown>;
      const { reveal: _reveal, ...compact } = event;
      const play = window.__lantern.play;
      play.state.ending = null;
      play.state.endingOpen = false;
      const frame = { ...(window.__lantern.client.state.frame as object), ending: compact };
      client.onMessage({ type: "frame", tick: window.__lantern.client.state.simTick, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
    });
    // It shows what the compact ending says, and the host's answer brings the rest.
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("tree-node")).toHaveCount(trees);
    await expect(page.getByTestId("reveal-missing")).toHaveCount(0);
    expect(await page.evaluate(() => window.__lantern.play.state.ending?.reveal !== null)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("shows a hidden ending, a reveal that is in one language, one with sections of its own, and one that is only a number", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open(TOWN, { menu: false });
    await lantern.waitForTick(60);
    const feed = (event: Record<string, unknown>, hud: Record<string, unknown>) =>
      page.evaluate(
        ([e, h]) => {
          const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
          const frame = { ...(window.__lantern.client.state.frame as object), hud: { ...(window.__lantern.client.state.frame?.hud as object), ...(h as object) } };
          client.onMessage({ type: "frame", tick: 61, advanced: false, frame, events: e === null ? [] : [e], clock: { paused: true, rate: [1, 1] } });
        },
        [event, hud] as const,
      );

    await feed(
      {
        kind: "ending",
        tick: 61,
        ending: "ending_barely",
        label: { zh: "勉强", en: "Just enough" },
        hidden: [{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }],
        inputs: { bridge_fixed: false, detour_done: true, reconciled: false, truth_told: false, a_new_input: true },
        passage: "detour",
        promised: 12,
        turnout: 1960,
        reveal: {
          truth: { variant: "v_flood", label: "真是秋汛冲的", props: [] },
          chains: [
            {
              id: "a_chain_the_page_has_no_name_for",
              label: "从甲到乙",
              planted: [["p1", null, null], ["p2", "li_er", "li_da"]],
              true: ["p1"],
              told: [["c1", "li_er", "li_da", "p2", "sharpen", 5], ["c2", "li_da", "li_xiaomei", "p2", "", 9]],
              held: [],
              reached: ["li_da", "li_xiaomei"],
            },
          ],
          believers: { false: ["li_er"], true: [], none: ["old_he"] },
          told: { total: 5, mutated: 1 },
          player: {
            spoke: { tellings: 3, lies: 1, ways: {}, told: [], reached: ["li_da", "old_he"], retold: 2, furthest: 2, caught: [] },
            said_of_me: [["c7", "li_da", "li_xiaomei", "px", 9]],
            texts: { px: { zh: "总管偏袒李家。", en: "The manager sides with the Li family." } },
          },
          something_new: { the_page: "keeps it" },
        },
      },
      { ending: "ending_barely", promised: 12, turnout: 1960 },
    );
    const names = await page.evaluate(() => Object.fromEntries((window.__lantern.play.scene?.cast ?? []).map((p) => [p.id, p.name])));
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("ending-title")).toHaveText("Just enough");
    await expect(page.getByTestId("ending-tag")).toHaveText(["The lie became a legend"]);
    await expect(page.getByTestId("ending-promised")).toHaveText("12 households");
    await expect(page.getByTestId("ending-turnout")).toHaveText("1,960 people");
    await expect(page.getByTestId("ending-passage")).toHaveText("The detour was ready");
    // An input the page has no name for is shown by its id.
    await expect(page.locator('[data-input="a_new_input"]')).toContainText("a_new_input");
    await expect(page.locator('[data-input="detour_done"]')).toContainText("The detour was ready");
    // The truth is a text the core gives in Chinese only: the page has its own for the variant.
    await expect(page.getByTestId("reveal-truth")).toHaveText(/It really was the autumn flood\./);
    // A chain with a label in Chinese only and no text of the page's own is shown as the core gave it.
    await expect(page.getByTestId("reveal-chain").getByRole("heading")).toHaveText("从甲到乙");
    await expect(page.getByTestId("tree-node")).toHaveCount(3);
    await expect(page.getByTestId("tree-flag")).toHaveCount(1);
    await expect(page.getByTestId("tree-change")).toHaveText(/ to .*: made it heavier/);
    // How far the manager's words went, and what was said of them.
    await expect(page.getByTestId("spoke-tellings")).toHaveText("3, 1 of them untrue");
    await expect(page.getByTestId("spoke-reached")).toHaveText("2");
    await expect(page.getByTestId("spoke-furthest")).toHaveText("2nd hand");
    await expect(page.getByTestId("said-line")).toHaveText([`${names.li_da?.en} to ${names.li_xiaomei?.en}: The manager sides with the Li family.`]);
    await expect(page.getByTestId("reveal-believers").locator('[data-side="false"]')).toContainText(names.li_er?.en ?? "");
    await expect(page.getByTestId("reveal-believers").locator('[data-side="none"] li')).toHaveText([names.old_he?.en ?? ""]);

    await lantern.setLang("zh");
    await expect(page.getByTestId("ending-title")).toHaveText("勉强");
    await expect(page.getByTestId("ending-tag")).toHaveText(["谎话成了传说"]);
    await expect(page.getByTestId("reveal-truth")).toContainText("真是秋汛冲的");
    await expect(page.getByTestId("tree-change")).toHaveText(/说给.*：说得更重了/);
    await expect(page.getByTestId("spoke-furthest")).toHaveText("第二手");
    await expect(page.getByTestId("said-line")).toHaveText([`${names.li_da?.zh}对${names.li_xiaomei?.zh}说：总管偏袒李家。`]);
    await lantern.setLang("en");

    // A game that was over before the page came to it: the numbers are in the frame, and nothing else.
    await page.getByTestId("ending-new").click();
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await lantern.waitForTick(1);
    await hold(page);
    await page.evaluate(() => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const frame = { ...(window.__lantern.client.state.frame as object), hud: { ...(window.__lantern.client.state.frame?.hud as object), ending: "ending_full", promised: 31, turnout: 4100 } };
      client.onMessage({ type: "frame", tick: 70, advanced: false, frame, events: [], clock: { paused: true, rate: [1, 1] } });
    });
    await expect(page.getByTestId("ending-title")).toHaveText("A perfect night");
    await expect(page.getByTestId("ending-promised")).toHaveText("31 households");
    await expect(page.getByTestId("reveal-missing")).toBeVisible();
    await expect(page.getByTestId("reveal-chain")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
