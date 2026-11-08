import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Underline } from "./ink.tsx";

/**
 * Whether a piece of paper that scrolls runs past its foot. The paper is as long as what is written on it and does not grow: where it is longer, a
 * phrase at the foot turns it, and the next screen begins where the last line in view ends. A paper starts at its head again when `key` changes.
 * A paper that is squeezed to less than `room` pixels (a list that the request under it has left a few lines) has no phrase: the phrase lies over the last
 * lines in view, and over so few lines it would cover the tags.
 */
export function useMoreBelow<E extends HTMLElement>(key: unknown, room = 0): { leaf: preact.RefObject<E | null>; more: boolean } {
  const leaf = useRef<E>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = leaf.current;
    if (element === null) return;
    element.scrollTop = 0;
    const look = (): void => setMore(element.clientHeight >= room && element.scrollHeight - element.scrollTop - element.clientHeight > 4);
    look();
    element.addEventListener("scroll", look, { passive: true });
    const watch = new ResizeObserver(look);
    watch.observe(element);
    for (const child of Array.from(element.children)) watch.observe(child);
    return () => {
      element.removeEventListener("scroll", look);
      watch.disconnect();
    };
  }, [key]);
  return { leaf, more };
}

/**
 * The phrase at the foot of a paper that runs on. It takes no room of its own (`.turn` in layout.css) and lies over the last lines that are in view.
 * It turns the paper by the height of the screen less a line or two, unless `to` says where the next screen begins (from the head of what is written, in pixels).
 */
export function TurnBar({ leaf, word, testId, to }: { leaf: preact.RefObject<HTMLElement | null>; word: string; testId: string; to?: (leaf: HTMLElement) => number }) {
  const turn = (): void => {
    const element = leaf.current;
    if (element === null) return;
    if (to === undefined) element.scrollBy({ top: Math.max(120, element.clientHeight - 90), behavior: "smooth" });
    else element.scrollTo({ top: to(element), behavior: "smooth" });
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
