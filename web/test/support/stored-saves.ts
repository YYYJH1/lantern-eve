import type { Replay } from "../../src/shared/protocol.ts";
import type { LanternPage } from "./fixtures.ts";

/** Reads one saved replay out of IndexedDB. */
export async function readSaved(lantern: LanternPage, id: number): Promise<Replay> {
  return lantern.page.evaluate(
    (key) =>
      new Promise<Replay>((resolve, reject) => {
        const open = indexedDB.open("lantern-eve");
        open.onsuccess = () => {
          const req = open.result.transaction("replays").objectStore("replays").get(key);
          req.onsuccess = () => {
            open.result.close();
            resolve((req.result as { replay: Replay }).replay);
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    id,
  );
}

/** Writes a replay back over a saved one, as a player with devtools could. */
export async function writeSaved(lantern: LanternPage, id: number, replay: Replay): Promise<void> {
  await lantern.page.evaluate(
    ([key, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("lantern-eve");
        open.onsuccess = () => {
          const tx = open.result.transaction("replays", "readwrite");
          tx.objectStore("replays").put({ id: key, replay: value });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    [id, replay] as const,
  );
}

export async function tamper(lantern: LanternPage, id: number, change: (replay: Replay) => void): Promise<void> {
  const replay = await readSaved(lantern, id);
  change(replay);
  await writeSaved(lantern, id, replay);
}

/**
 * Makes a save look as if another version of the game had made it: another core and another content, and an end hash that this game cannot reach.
 * Loading it ends in `hash_mismatch`, as a save from before a change of content or of the words the core keeps in its state does.
 */
export const byAnotherVersion = (replay: Replay): void => {
  replay.header.core_version = "0.0.0";
  replay.header.content_hash = "c0ffee00".repeat(8);
  replay.final.hash = "0".repeat(64);
};
