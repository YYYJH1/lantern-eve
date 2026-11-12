import type { Page } from "@playwright/test";

/**
 * Puts the map canvas in a layer of its own, for a picture. A headless browser that composes in software (SwiftShader draws the map) can leave a hole
 * in the canvas, a block of nothing or of the colour of the page, where an opaque box of the page lies over it (the ledger, the note of a person, a card),
 * even though the canvas itself is drawn right: `toDataURL` after a frame has no such block. A canvas with a filter of its own is composed in its own
 * pass, and the hole does not come. The page itself carries nothing for this. It is called before every picture that has the map under a box.
 */
export async function steady(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        for (const canvas of document.querySelectorAll<HTMLCanvasElement>("canvas.map-canvas")) canvas.style.setProperty("filter", "opacity(0.999)");
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
}
