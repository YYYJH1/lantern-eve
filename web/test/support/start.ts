import type { Page } from "@playwright/test";

/**
 * Presses Start on the opening page, as a player does. A player who is to have the tutorial then comes to the page of the first six people, and
 * goes on from it with its button: the helper does that too, so that what comes after Start is the first day either way.
 */
export async function pressStart(page: Page): Promise<void> {
  await page.getByTestId("opening-start").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="people-enter"]') !== null || document.querySelector('[data-testid="opening"]') === null, undefined, { timeout: 30_000 });
  const enter = page.getByTestId("people-enter");
  if ((await enter.count()) > 0) await enter.click();
}
