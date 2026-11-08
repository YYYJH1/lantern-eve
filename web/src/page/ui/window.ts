/**
 * The smallest window that the page is laid out for. The game is played in a computer's browser: below this size, in either dimension, the opening page says so
 * and offers to open the game anyway. The sizes are in CSS pixels, the size of the window the page is drawn in.
 */
export const MIN_WINDOW = { width: 1200, height: 600 } as const;

/** Whether a window of this size is smaller than the page is laid out for, in either dimension. */
export function tooSmall(width: number, height: number): boolean {
  return width < MIN_WINDOW.width || height < MIN_WINDOW.height;
}
