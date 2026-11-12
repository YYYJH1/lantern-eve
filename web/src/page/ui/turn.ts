/**
 * Where the phrase that turns a page begins (`more-below.tsx`), apart from the page: numbers in pixels, so that it can be worked out without a browser.
 */

/** Something written on a paper that must not be cut in half: a line of text, a control, a mark, a row. From its top to its bottom, in pixels from the head of the paper. */
export interface Part {
  top: number;
  bottom: number;
}

/** An edge that falls inside a part by this much or less does not cut it: the box of a line of text is a little taller than its ink. */
export const SLACK = 1;

/**
 * Where the phrase that turns the page begins, and where the page that it turns to begins.
 *
 * The phrase lies over the foot of the part of the paper that is in view (`foot` is the bottom of that part and `head` its top) and is `room` tall, the least it takes. Where its top edge
 * falls inside a part it cuts that part in half, so it begins at the top of that part instead, and so on until no part is cut: what the foot of the page would cut in half is under the
 * phrase, and everything above it is whole. `next` is where the first part under it begins, which is where the page that a turn brings in begins; it is null where there is no such
 * part, and where no part is whole above the phrase (one part is taller than the page: the phrase keeps its own height, and a turn goes by the height of the page).
 */
export function turnOf(parts: readonly Part[], foot: number, head: number, room: number): { top: number; next: number | null } {
  const natural = foot - room;
  let top = natural;
  for (;;) {
    let cut = Number.POSITIVE_INFINITY;
    for (const part of parts) if (part.top < top - SLACK && part.bottom > top + SLACK) cut = Math.min(cut, part.top);
    if (cut === Number.POSITIVE_INFINITY) break;
    top = cut;
  }
  if (!parts.some((part) => part.bottom <= top + SLACK && part.bottom > head + SLACK)) return { top: natural, next: null };
  let next = Number.POSITIVE_INFINITY;
  for (const part of parts) if (part.top >= top - SLACK) next = Math.min(next, part.top);
  return { top, next: next === Number.POSITIVE_INFINITY ? null : next };
}
