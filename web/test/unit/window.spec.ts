import { expect, test } from "@playwright/test";
import { MIN_WINDOW, tooSmall } from "../../src/page/ui/window.ts";

// The smallest window the page is laid out for: smaller in either dimension is too small, and the size itself is not.

test.describe("the smallest window", () => {
  test("is the size itself and anything larger, and is too small by one pixel in either dimension", () => {
    const { width, height } = MIN_WINDOW;
    expect(tooSmall(width, height)).toBe(false);
    expect(tooSmall(width + 1, height + 1)).toBe(false);
    expect(tooSmall(1920, 1080)).toBe(false);
    expect(tooSmall(width - 1, height)).toBe(true);
    expect(tooSmall(width, height - 1)).toBe(true);
    expect(tooSmall(width - 1, height - 1)).toBe(true);
  });

  test("is a laptop's browser window or larger, and more than a phone's", () => {
    expect(MIN_WINDOW.width).toBeGreaterThanOrEqual(1024);
    expect(MIN_WINDOW.height).toBeGreaterThanOrEqual(560);
    expect(tooSmall(390, 844)).toBe(true);
    expect(tooSmall(768, 1024)).toBe(true);
  });
});
