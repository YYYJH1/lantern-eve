import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { scaled } from "./time-scale.ts";

/**
 * How many frames of the page in a row the note of the slip must stand as it is before a test takes it to be settled. The page folds the note
 * in the second render after the frame that gives a talk, the ledger or the notebook the stage, and a render is a frame: on a page that draws two
 * or three frames a second that is a second after the test handed the frame over, and a test that looks for a fixed number of milliseconds looks
 * at no frame of the page at all.
 */
export const NOTE_STILL = 8;

/** Waits for the page to draw `count` frames of its own: the time that a page has, however slowly it draws, to answer what it was handed. */
export function pageFrames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/**
 * Opens the note of the slip where a talk, the ledger or the notebook folded it, for a test that reads what is in it. The page folds the note a
 * few frames after it was handed the frame that takes the stage, and the note is looked at again and again until it has stood as it is for
 * `NOTE_STILL` frames: the page has folded it by then, or it was never going to. A folded note is opened by its head, and has to stand open for
 * as many frames.
 */
export async function openTheNote(page: Page): Promise<void> {
  const head = page.getByTestId("slip-head");
  const settled = async (): Promise<string | null> => {
    let state = await head.getAttribute("aria-expanded");
    for (let still = 0; still < NOTE_STILL; ) {
      await pageFrames(page, 1);
      const now = await head.getAttribute("aria-expanded");
      still = now === state ? still + 1 : 0;
      state = now;
    }
    return state;
  };
  await expect(async () => {
    if ((await settled()) === "false") await head.click({ timeout: scaled(2_000) });
    expect(await settled()).toBe("true");
  }).toPass({ timeout: scaled(15_000) });
}
