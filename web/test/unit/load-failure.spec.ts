import { expect, test } from "@playwright/test";
import { translate } from "../../src/i18n/index.ts";
import { HostCallError } from "../../src/page/client.ts";
import { loadFailureOf } from "../../src/page/load-failure.ts";
import type { Replay } from "../../src/shared/protocol.ts";
import { VirtualHost } from "../support/virtual-env.ts";

// A save is a replay that the game rebuilds and checks against the hashes it was saved with. A save made by another version of the game (its
// content, or what the core keeps in its state, is not the same) does not come out the same, and the host refuses it with a code. The page tells
// the player what that means in plain words, on the opening page and in the menu, and keeps "could not be loaded" for the other causes.

test.describe("why a save could not be loaded", () => {
  test("is another version's where the host says the save does not replay here, and nothing else's", () => {
    for (const code of ["hash_mismatch", "unsupported_format", "replay_failed", "tick_mismatch"]) {
      expect(loadFailureOf(new HostCallError(code, "x")), code).toBe("version");
    }
    for (const code of ["not_found", "busy", "bad_replay", "bad_log", "host_error", "storage", "worker_error"]) {
      expect(loadFailureOf(new HostCallError(code, "x")), code).toBe("other");
    }
    // What is not a reply of the host: a plain error, a string, nothing.
    expect(loadFailureOf(new Error("hash_mismatch"))).toBe("other");
    expect(loadFailureOf("hash_mismatch")).toBe("other");
    expect(loadFailureOf(undefined)).toBe("other");
    // The code is what is read, whoever made the error (the page of a test throws a plain object with a code).
    expect(loadFailureOf(Object.assign(new Error("x"), { code: "hash_mismatch" }))).toBe("version");
  });

  test("has its words in both languages: the opening page says what to do, the menu, which has a game running, only what happened", () => {
    expect(translate("en", "opening.continue.version")).toBe("This save was made by another version of the game, which this one cannot read. Press Start for a new game.");
    expect(translate("zh", "opening.continue.version")).toBe("这份存档是另一个版本的游戏存的，这一版读不出来。点「开始」开一局新的。");
    expect(translate("en", "menu.load.version")).toBe("This save was made by another version of the game, which this one cannot read.");
    expect(translate("zh", "menu.load.version")).toBe("这份存档是另一个版本的游戏存的，这一版读不出来。");
    // The words for every other cause are what they were.
    expect(translate("en", "opening.continue.failed")).toBe("That save could not be loaded.");
    expect(translate("zh", "opening.continue.failed")).toBe("这份存档没能读出来。");
  });

  test("is another version's for a save that the host rebuilds to other hashes, with the core and the content that made it named in the error", async () => {
    const host = new VirtualHost();
    host.runtime.start(42, "m0", false);
    host.advance(900);
    const saved = await host.call({ type: "call", reqId: 1, call: { op: "save", name: "old" } });
    expect(saved.ok).toBe(true);
    const id = (saved as { result: { id: number } }).result.id;
    // The save was made by a core and a content that are not the ones that run now, and its hash cannot be reached.
    const stored = host.saves.rows.get(id)?.replay as Replay;
    stored.header.core_version = "0.0.0";
    stored.header.content_hash = "c0ffee00".repeat(8);
    stored.final.hash = "d".repeat(64);
    const reply = await host.call({ type: "call", reqId: 2, call: { op: "load", id } });
    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe("hash_mismatch");
    expect(reply.error.message).toContain("saved by core 0.0.0 / c0ffee00");
    // The page rebuilds the error from the reply as the client does, and reads the cause from the code.
    expect(loadFailureOf(new HostCallError(reply.error.code, reply.error.message))).toBe("version");
    // A save that is not there is not another version's.
    const missing = await host.call({ type: "call", reqId: 3, call: { op: "load", id: 99 } });
    expect(missing.ok === false && loadFailureOf(new HostCallError(missing.error.code, missing.error.message))).toBe("other");
  });
});
