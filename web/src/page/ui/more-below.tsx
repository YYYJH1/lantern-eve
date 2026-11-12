import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Underline } from "./ink.tsx";
import { type Part, turnOf } from "./turn.ts";

/** The parts of a paper that its phrase for turning the page keeps whole, as boxes counted from the head of what is written on the paper (not from the part that is in view). */
export type PartsOf = (paper: HTMLElement) => Part[];

/** The least a turn brings the paper on, in pixels, so that a phrase pressed over a line or two does not seem to do nothing. */
const LEAST_TURN = 40;

/** The tallest button that is a part of its own: a line with its padding or its frame. A taller one (an option of a list that runs to several lines, the box of an answer) is kept whole by its lines. */
const MOST_BUTTON = 48;

/**
 * Every line of text on a paper, and its marks and the controls that are a line tall: each box is a part. A paper whose parts are bigger than a line (a list of choices,
 * whose rows are kept whole) has a `PartsOf` of its own.
 */
export function linesOf(paper: HTMLElement): Part[] {
  const origin = paper.getBoundingClientRect().top + paper.clientTop - paper.scrollTop;
  const parts: Part[] = [];
  const add = (box: { top: number; bottom: number; width: number; height: number }): void => {
    if (box.width >= 1 && box.height >= 1) parts.push({ top: box.top - origin, bottom: box.bottom - origin });
  };
  const range = document.createRange();
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (parent === null || node.data.trim() === "" || parent.closest(".turn") !== null) continue;
    // words that are there for a reader of the screen only have a box of a pixel
    const frame = parent.getBoundingClientRect();
    if (frame.width < 2 || frame.height < 2) continue;
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects())) add(box);
  }
  for (const control of Array.from(paper.querySelectorAll("button, summary, input, select, textarea, img, canvas, svg"))) {
    // a mark inside a control is a part of the control, and the phrase itself is not a part of what it turns
    if (control.closest(".turn") !== null || (control.tagName === "svg" && (control.parentElement?.closest("button, summary") ?? null) !== null)) continue;
    const box = control.getBoundingClientRect();
    if (box.height <= MOST_BUTTON || !control.matches("button, summary")) add(box);
  }
  return parts;
}

/** The least height of the phrase: its own line, the rule above it and the air round them. */
function roomOf(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const line = bar.firstElementChild?.getBoundingClientRect().height ?? 0;
  return line + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
}

/** Where the phrase on `paper` ends and begins and where the page that it turns to begins, from the parts of the paper; null where the phrase is not up. */
function turnAt(paper: HTMLElement, partsOf: PartsOf): { foot: number; top: number; next: number | null } | null {
  const bar = paper.querySelector<HTMLElement>(".turn-bar");
  if (bar === null) return null;
  const origin = paper.getBoundingClientRect().top + paper.clientTop - paper.scrollTop;
  const foot = bar.getBoundingClientRect().bottom - origin;
  return { foot, ...turnOf(partsOf(paper), foot, paper.scrollTop, roomOf(bar)) };
}

/**
 * Makes the phrase at the foot of `paper` as tall as it must be to begin above the first line that its own top edge would cut in half (`--turn-h`, which layout.css gives the
 * phrase as its least height), so that what the foot of the page would cut is under it. It is measured where the phrase is, which is the foot of the page and, in the last few
 * pixels of a paper, a little above it.
 */
function seatTurn(paper: HTMLElement, partsOf: PartsOf): void {
  const at = turnAt(paper, partsOf);
  if (at === null) {
    paper.style.removeProperty("--turn-h");
    return;
  }
  const height = `${(at.foot - at.top).toFixed(2)}px`;
  if (paper.style.getPropertyValue("--turn-h") !== height) paper.style.setProperty("--turn-h", height);
}

/**
 * Whether a piece of paper that scrolls runs past its foot. The paper is as long as what is written on it and does not grow: where it is longer, a
 * phrase at the foot turns it, and the next screen begins where the last line in view ends. A paper starts at its head again when `key` changes.
 * A paper that is squeezed to less than `room` pixels (a list that the request under it has left a few lines) has no phrase: the phrase lies over the last
 * lines in view, and over so few lines it would cover the tags. The phrase lies over no line in the middle: `partsOf` gives the parts that it keeps whole,
 * and they are measured again as the paper scrolls and whenever what is on it changes, in what it holds or in the room that it has.
 */
export function useMoreBelow<E extends HTMLElement>(key: unknown, room = 0, partsOf: PartsOf = linesOf): { leaf: preact.RefObject<E | null>; more: boolean } {
  const leaf = useRef<E>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = leaf.current;
    if (element === null) return;
    element.scrollTop = 0;
    const sized = new Set<Element>();
    const resized = new ResizeObserver(() => look());
    const look = (): void => {
      setMore(element.clientHeight >= room && element.scrollHeight - element.scrollTop - element.clientHeight > 4);
      seatTurn(element, partsOf);
      // what the paper holds can come after the paper does (a list that was empty has its lines, a card its parts), so the parts it holds are watched as they come
      for (const child of Array.from(element.children)) {
        if (sized.has(child)) continue;
        sized.add(child);
        resized.observe(child);
      }
    };
    // the phrase comes and goes, and so do the lines under it, with what the paper holds; the height the phrase is given is a style of the paper, which is not watched
    const changed = new MutationObserver(look);
    changed.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "open", "hidden"] });
    resized.observe(element);
    look();
    element.addEventListener("scroll", look, { passive: true });
    return () => {
      element.removeEventListener("scroll", look);
      changed.disconnect();
      resized.disconnect();
    };
  }, [key]);
  return { leaf, more };
}

/**
 * The phrase at the foot of a paper that runs on. It takes no room of its own (`.turn` in layout.css) and lies over the last lines that are in view, reaching up to the
 * first line that its own top edge would cut in half (`useMoreBelow`). It turns the paper to where the first part under it begins, so that the page that comes in begins at
 * a whole line, or by the height of the screen less a line or two where no part is whole above it.
 */
export function TurnBar({ leaf, word, testId, partsOf = linesOf }: { leaf: preact.RefObject<HTMLElement | null>; word: string; testId: string; partsOf?: PartsOf }) {
  const turn = (): void => {
    const element = leaf.current;
    if (element === null) return;
    const next = turnAt(element, partsOf)?.next ?? null;
    const top = next === null ? element.scrollTop + Math.max(120, element.clientHeight - 90) : Math.max(next, element.scrollTop + LEAST_TURN);
    element.scrollTo({ top, behavior: "smooth" });
  };
  return (
    <div class="turn">
      <div class="turn-bar" data-testid={testId}>
        <button type="button" class="ink-act" onClick={turn}>
          {word}
          <Underline seed="turn" />
        </button>
      </div>
    </div>
  );
}
