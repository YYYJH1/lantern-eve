import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { NOTE_STILL, openTheNote } from "../support/note.ts";

/**
 * A page as far as openTheNote looks at it: the note of the slip is open, and the page folds it in the frame `foldAt` that it draws after the test
 * handed it the frame that takes the stage. Time passes in it only as the page draws frames, which is how a page that draws two frames a second
 * looks to a test that waits a quarter of a second: nothing has happened yet.
 */
class SlowPage {
  frame = 0;
  open = true;
  clicks = 0;
  constructor(private readonly foldAt: number) {}

  draw(count: number): void {
    for (let i = 0; i < count; i++) {
      this.frame += 1;
      if (this.frame === this.foldAt) this.open = false;
    }
  }

  private readonly head = {
    getAttribute: async (): Promise<string> => String(this.open),
    click: async (): Promise<void> => {
      this.clicks += 1;
      this.open = true;
    },
  };

  getByTestId(id: string): typeof this.head {
    if (id !== "slip-head") throw new Error(`no ${id}`);
    return this.head;
  }

  async evaluate(_fn: unknown, count: number): Promise<void> {
    this.draw(count);
  }

  async waitForTimeout(): Promise<void> {
    // a page that draws slowly has drawn nothing yet
  }
}

const asPage = (page: SlowPage): Page => page as unknown as Page;

test.describe("openTheNote", () => {
  test("opens the note that the page folds some frames after it was handed a talk, and the note stays open as the page goes on drawing", async () => {
    for (const foldAt of [1, 3, NOTE_STILL]) {
      const page = new SlowPage(foldAt);
      await openTheNote(asPage(page));
      page.draw(60);
      expect(page.open, `folded in frame ${foldAt}`).toBe(true);
      expect(page.clicks, `folded in frame ${foldAt}`).toBe(1);
    }
  });

  test("leaves a note that nothing folded as it is", async () => {
    const page = new SlowPage(Number.POSITIVE_INFINITY);
    await openTheNote(asPage(page));
    page.draw(60);
    expect(page.open).toBe(true);
    expect(page.clicks).toBe(0);
  });
});
