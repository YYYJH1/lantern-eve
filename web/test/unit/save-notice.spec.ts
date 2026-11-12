import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { HostCallError } from "../../src/page/client.ts";
import { Play } from "../../src/page/play.ts";
import { failureOf, failureText, SAVE_FAILURES, SaveNotices } from "../../src/page/save-notice.ts";
import { FakeClient, feedFrame, frameAt, resetTicks } from "../support/fake-client.ts";

// A save that cannot be made is told to the player: the page says so in its own words, for a save of its own and for one the player asked
// for, once for each kind of failure until a save is made again.

const STORE = new HostCallError("storage", "IndexedDB is not available: SecurityError: The operation is insecure.");
const WRITE = new HostCallError("host_error", "AbortError: The transaction was aborted, so the write could not be made.");
const QUOTA = new HostCallError("host_error", "QuotaExceededError: The current transaction exceeded its quota limitations.");
const SERVER = new HostCallError("unsupported", "save: saves belong to the browser host");
const BUSY = new HostCallError("busy", "a load is running");

test.describe("what kind of failure a save is", () => {
  test("is told from what the host answered and what the store threw", () => {
    expect(failureOf(STORE)).toBe("storage");
    expect(failureOf(WRITE)).toBe("storage");
    expect(failureOf(QUOTA)).toBe("full");
    expect(failureOf(SERVER)).toBe("server");
    // A host that is busy or has stopped on an error, a plain error, and what is not an error at all.
    expect(failureOf(BUSY)).toBe("other");
    expect(failureOf(new HostCallError("failed", "the session stopped on an error and cannot be saved"))).toBe("other");
    expect(failureOf(new HostCallError("host_error", "TypeError: x is undefined"))).toBe("other");
    expect(failureOf(new Error("busy"))).toBe("other");
    expect(failureOf("no room")).toBe("other");
    expect(failureOf(undefined)).toBe("other");
  });

  test("has its words in both languages, in the voice of the page: what happened, and what the player can do about it", () => {
    const words = new Set<string>();
    for (const lang of ["en", "zh"] as const) {
      setLang(lang);
      for (const kind of SAVE_FAILURES) {
        const text = failureText(kind);
        expect(text, `${lang} ${kind}`).toMatch(lang === "en" ? /^The game could not be saved/ : /^没能存档/);
        // No word of the host in them, no code and no stop of the machine's.
        expect(text, `${lang} ${kind}`).not.toMatch(/IndexedDB|Quota|HostError|host_error|unsupported|\{|\}/);
        // Where the player can try again or clear room, the words say where: the saves of the menu.
        if (kind !== "server") expect(text, `${lang} ${kind}`).toContain(lang === "en" ? "Saves in the menu" : "「存档」");
        words.add(`${lang}:${text}`);
      }
    }
    // Four kinds, two languages, eight different sentences.
    expect(words.size).toBe(8);
    setLang("en");
    expect(failureText("storage")).toBe("The game could not be saved: the browser did not let it write. You can try again from Saves in the menu.");
    setLang("zh");
    expect(failureText("storage")).toBe("没能存档，浏览器不让游戏写入。可以到菜单的「存档」里再存一次。");
    setLang("en");
  });

  test("is said once for a kind, until a save is made, and a kind counts as said only when its notice was on screen", () => {
    const notices = new SaveNotices();
    // A failure that nobody has been told of is news, however often it comes before the notice is on screen.
    expect(notices.due("storage")).toBe(true);
    expect(notices.due("storage")).toBe(true);
    notices.told("storage");
    expect(notices.due("storage")).toBe(false);
    expect(notices.due("full")).toBe(true);
    notices.told("full");
    expect(notices.due("full")).toBe(false);
    notices.made();
    expect(notices.due("storage")).toBe(true);
    expect(notices.due("full")).toBe(true);
  });
});

const DAY = (day: number, hour: number, minute = 0) => ({ day, hour, minute, phase: "day" });

/** Lets the saves that were asked for run: each is a few awaits of the stand-in host. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const setup = () => {
  resetTicks();
  setLang("en");
  const client = new FakeClient();
  const play = new Play(client.host);
  play.autosave.enabled = true;
  return { client, play };
};

const at = async (client: FakeClient, time: { day: number; hour: number; minute: number; phase: string }): Promise<void> => {
  feedFrame(client, frameAt(time.day, time.hour, time.minute, {}, time.phase));
  await settle();
};

test.describe("a save of the page's own that cannot be made", () => {
  test("is told over the map with the words of its kind, once, and a notice that was put away does not come back for the same kind", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    expect(play.state.saveFailed).toBeNull();
    client.failSave = STORE;
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toHaveLength(1);
    expect(play.state.saveFailed).toBe("storage");
    expect(play.state.saved).toBeNull();
    // The player puts it away. The next morning fails the same way, and says nothing more.
    play.dismissSaveFailure();
    expect(play.state.saveFailed).toBeNull();
    await at(client, DAY(3, 7, 1));
    expect(client.saved).toHaveLength(2);
    expect(play.state.saveFailed).toBeNull();
    // Another kind of trouble is news.
    client.failSave = QUOTA;
    await at(client, DAY(4, 7, 1));
    expect(client.saved).toHaveLength(3);
    expect(play.state.saveFailed).toBe("full");
  });

  test("is told again when it fails after a save was made, and the notice that is still up goes when a save is made", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = STORE;
    await at(client, DAY(2, 7, 1));
    expect(play.state.saveFailed).toBe("storage");
    // The trouble is over: the next morning is saved, and the notice that nobody put away goes with it.
    client.failSave = false;
    await at(client, DAY(3, 7, 1));
    expect(client.state.saves.map((save) => save.name)).toEqual(["Autosave, Day 3 07:00"]);
    expect(play.state.saveFailed).toBeNull();
    expect(play.state.saved?.kind).toBe("morning");
    // It comes back: the same kind is news again, because a save was made in between.
    client.failSave = STORE;
    await at(client, DAY(4, 7, 1));
    expect(play.state.saveFailed).toBe("storage");
  });

  test("is told for each of the other kinds too: a host that is busy, and the server host, which keeps none", async () => {
    for (const [error, kind] of [
      [BUSY, "other"],
      [SERVER, "server"],
      [WRITE, "storage"],
    ] as const) {
      const { client, play } = setup();
      await at(client, DAY(2, 6));
      client.failSave = error;
      await at(client, DAY(2, 7, 1));
      expect(play.state.saveFailed, kind).toBe(kind);
    }
  });

  test("goes with a new game, but what was on screen is not said again by it", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = STORE;
    await at(client, DAY(2, 7, 1));
    expect(play.state.saveFailed).toBe("storage");
    // The stage had the notice on screen: the player was told.
    play.saveFailureTold("storage");
    client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    expect(play.state.saveFailed).toBeNull();
    await at(client, DAY(2, 6));
    await at(client, DAY(2, 7, 1));
    // The browser is what refuses, and it still does.
    expect(client.saved).toHaveLength(2);
    expect(play.state.saveFailed).toBeNull();
  });

  test("is not counted as told while it waits behind a card: a new game, and a game that is loaded, do not lose it for good", async () => {
    for (const how of ["a new game", "a load"] as const) {
      const { client, play } = setup();
      await at(client, DAY(2, 6));
      client.failSave = STORE;
      // The paper of the morning lies over the place of the notice, so nothing puts it on screen.
      await at(client, DAY(2, 7, 1));
      expect(play.state.saveFailed, how).toBe("storage");
      // The player starts again before any save was made (a load is a reset and then the loaded game).
      client.feed({ type: "reset", seed: 1, scenario: "bridge" });
      if (how === "a load") client.feed({ type: "loaded", info: { id: 1, name: "x", tick: 1, hash: "", savedHash: "", match: true, hashesChecked: 0, reissued: 0, cancelledOpen: 0 } });
      expect(play.state.saveFailed, how).toBeNull();
      // The next morning of the game that was begun fails the same way, and this time the notice is told.
      await at(client, DAY(2, 6));
      await at(client, DAY(2, 7, 1));
      expect(client.saved, how).toHaveLength(2);
      expect(play.state.saveFailed, how).toBe("storage");
    }
  });

  test("changes nothing where saves work: no notice, the line that says it was saved, the old saves kept as before", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    await at(client, DAY(2, 7, 1));
    await at(client, DAY(3, 7, 1));
    expect(client.saved.map((save) => save.name)).toEqual(["Autosave, Day 2 07:00", "Autosave, Day 3 07:00"]);
    expect(play.state.saveFailed).toBeNull();
    expect(play.state.saved?.kind).toBe("morning");
  });
});

test.describe("a save the player makes from the menu", () => {
  test("is the page's save: what it made is told by the menu, and a failure is thrown for the menu to say where it says what came of a save", async () => {
    const { client, play } = setup();
    const meta = await play.saveByHand("before the bridge");
    expect(meta.name).toBe("before the bridge");
    expect(client.saved).toEqual([{ name: "before the bridge", page: null }]);
    client.failSave = QUOTA;
    await expect(play.saveByHand("again")).rejects.toBe(QUOTA);
    // Not over the map: the menu has it.
    expect(play.state.saveFailed).toBeNull();
    expect(failureOf(QUOTA)).toBe("full");
  });

  test("counts as telling the player once the open menu has said it: the same trouble of the page's own save is not told over the map again, until a save is made", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = STORE;
    await expect(play.saveByHand("x")).rejects.toBe(STORE);
    // The menu is open and shows the words of the failure: that is what it tells Play.
    play.saveFailureTold(failureOf(STORE));
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toHaveLength(2);
    expect(play.state.saveFailed).toBeNull();
    // A save from the menu that works ends the trouble. The next failure of the page's own is told.
    client.failSave = false;
    await play.saveByHand("y");
    client.failSave = STORE;
    await at(client, DAY(3, 7, 1));
    expect(play.state.saveFailed).toBe("storage");
  });

  test("does not count as telling the player while nobody saw the words: a failure that comes back after the menu was shut leaves the next failure of the page's own to be told", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = STORE;
    // The menu was shut when the failure came back, so it said nothing that anybody read, and told Play nothing.
    await expect(play.saveByHand("x")).rejects.toBe(STORE);
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toHaveLength(2);
    expect(play.state.saveFailed).toBe("storage");
  });

  test("ends the notice that is up when it is made", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = STORE;
    await at(client, DAY(2, 7, 1));
    expect(play.state.saveFailed).toBe("storage");
    client.failSave = false;
    await play.saveByHand("z");
    expect(play.state.saveFailed).toBeNull();
  });
});
