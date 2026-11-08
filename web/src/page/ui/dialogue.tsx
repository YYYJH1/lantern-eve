import type { Lang } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { currentLine } from "./strip.tsx";

export interface DialogueProps {
  lang: Lang;
  scene: Scene | null;
  frame: ViewFrame | null;
  play: Play;
  tick: number;
  selectedId: string | null;
}

/**
 * What somebody just said, outside a talk, for a reader that cannot see the map (the bubbles are drawn on it). It is not drawn on the page: the words are
 * over the head of the person already. There is nothing of it while nobody speaks, and in a talk the line is the strip's (`strip.tsx`).
 */
export function DialogueBar(props: DialogueProps) {
  const line = props.play.state.talk === null ? currentLine(props, null) : null;
  if (line === null) return null;
  return (
    <footer class="dialogue sr-only" data-testid="dialogue" data-talking="false">
      <p class="dialogue-line" data-testid="dialogue-line" data-thinking="false" aria-live="polite">
        <span>{line}</span>
      </p>
    </footer>
  );
}
