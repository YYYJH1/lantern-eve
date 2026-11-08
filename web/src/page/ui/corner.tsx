import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { type Lang, t } from "../../i18n/index.ts";
import { loadSheetData, type SheetData } from "../map/atlas.ts";
import { frameRect, type SpriteDef } from "../map/manifest.ts";
import type { Play } from "../play.ts";
import type { SkipState } from "../skip.ts";
import { HelpBar, signalClass } from "./guide.tsx";
import { skipLabel } from "./skip-text.ts";

/**
 * The three things the manager keeps in the corner of the page, drawn from the atlas of the sprite kit like the people and the props of
 * the map: the clan elder's seal (ask the elder), the thread-bound notebook, and the incense burner, which is the way to skip ahead.
 * The burner is always there. It is lit, with its thread of smoke, only while there is something to skip to.
 *
 * The page draws a frame of the atlas into a canvas of its own, from the pictures the map has decoded already (they are fetched and
 * decoded once for the page, at the scale the screen needs). A page without the atlas, or without a map, shows
 * the name of the thing on a square of paper instead.
 */

/** The sheet of the sprite kit, once it is there. Undefined while it is on its way, null where the page has none. */
function useSheet(enabled: boolean): SheetData | null | undefined {
  const [sheet, setSheet] = useState<SheetData | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadSheetData(Math.min(window.devicePixelRatio || 1, 2)).then((data) => {
      if (live) setSheet(data);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return sheet;
}

/** The size of a thing before its sprite is known, in pixels: the frame of the one that is largest. */
const SIZES: Record<string, { w: number; h: number }> = {
  "prop.elder_seal": { w: 58, h: 68 },
  "prop.notebook": { w: 66, h: 67 },
  "prop.incense_unlit": { w: 72, h: 71 },
  "prop.incense_lit": { w: 72, h: 71 },
};

interface ThingProps {
  /** The sprites this thing is drawn from, which stand on the one point: the first of them is drawn unless `show` names another. */
  sprites: readonly string[];
  show?: string;
  sheet: SheetData | null | undefined;
  /** The words shown when there is no picture. */
  fallback: string;
}

/** One thing of the corner: a canvas that the frame of its sprite is drawn into, on the ground line that the sprites share. */
function Thing({ sprites, show, sheet, fallback }: ThingProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const defs = sheet === undefined || sheet === null ? [] : sprites.map((id) => sheet.manifest.sprites.get(id)).filter((d): d is SpriteDef => d !== undefined);
  const ready = sheet !== undefined && sheet !== null && defs.length === sprites.length;
  // The box that holds all of the sprites with the anchors on one point.
  const left = Math.max(0, ...defs.map((d) => d.ax));
  const top = Math.max(0, ...defs.map((d) => d.ay));
  const width = Math.ceil(left + Math.max(0, ...defs.map((d) => d.w - d.ax)));
  const height = Math.ceil(top + Math.max(0, ...defs.map((d) => d.h - d.ay)));
  const wanted = show ?? sprites[0] ?? "";
  useEffect(() => {
    const element = canvas.current;
    if (!ready || element === null || sheet === undefined || sheet === null) return;
    const context = element.getContext("2d");
    const def = sheet.manifest.sprites.get(wanted);
    if (context === null || def === undefined) return;
    const rect = frameRect(def, sheet.scale, 0);
    const page = rect === null ? undefined : sheet.pages[rect.page];
    context.clearRect(0, 0, element.width, element.height);
    if (rect === null || page === undefined) return;
    context.drawImage(page, rect.x, rect.y, rect.w, rect.h, (left - def.ax) * sheet.scale, (top - def.ay) * sheet.scale, rect.w, rect.h);
  }, [ready, sheet, wanted, left, top, width, height]);
  const guess = SIZES[wanted] ?? { w: 64, h: 64 };
  const scale = ready ? sheet.scale : 1;
  return (
    <span class="thing-art" style={{ width: `${ready ? width : guess.w}px`, height: `${ready ? height : guess.h}px` }}>
      {ready ? <canvas ref={canvas} width={width * scale} height={height * scale} style={{ width: `${width}px`, height: `${height}px` }} aria-hidden="true" /> : <span class="thing-fallback">{fallback}</span>}
    </span>
  );
}

export interface CornerProps {
  play: Play;
  lang: Lang;
  skip: SkipState;
  onSkip: () => void;
  /** Whether the page draws the map, and with it the pictures of the atlas. */
  drawn: boolean;
  onNotebook: () => void;
  notebookOpen: boolean;
  /** How many entries the notebook holds, and how many of them were written since the player last looked. */
  entries: number;
  fresh: number;
}

/** How far above the button of the hints the notebook ends, in pixels. */
const BOOK_GAP = 8;

/**
 * Keeps `--book-foot` of the page at the height where the notebook has to end, which is `BOOK_GAP` above the button of the hints, the top of the corner while the
 * help is on. The notebook lies over the corner (it is part of what is laid over the map), and would cover that button where the window is not tall. The height is
 * measured as the page runs, and the property is not there while the help is off, which has no button. The ref goes on the corner.
 */
function useBookFoot(): preact.RefObject<HTMLElement | null> {
  const corner = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = corner.current;
    const shell = element?.closest<HTMLElement>(".shell") ?? null;
    if (element === null || shell === null) return;
    const measure = (): void => {
      const bar = element.querySelector<HTMLElement>(".help-bar");
      if (bar === null) shell.style.removeProperty("--book-foot");
      else shell.style.setProperty("--book-foot", `${Math.floor(bar.getBoundingClientRect().top) - BOOK_GAP}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
      shell.style.removeProperty("--book-foot");
    };
  }, []);
  return corner;
}

/** The corner at the bottom right: the elder's seal, the notebook and the incense burner. */
export function Corner({ play, lang, skip, onSkip, drawn, onNotebook, notebookOpen, entries, fresh }: CornerProps) {
  const sheet = useSheet(drawn);
  const root = useBookFoot();
  const guide = play.guide;
  const offered = skip.offer !== null || skip.running;
  const skipWords = skipLabel(lang, skip);
  const elderWords = t("elder.ask");
  const bookWords = t("notebook.open");
  return (
    <aside class="corner" data-testid="corner" ref={root}>
      <HelpBar play={play} lang={lang} />
      <div class="things">
        {guide.active ? (
          <button type="button" class="thing thing-seal" data-testid="btn-elder" aria-label={elderWords} disabled={guide.tutorial.card !== null || guide.endUp || guide.showUp} onClick={() => guide.askElder()}>
            <Thing sprites={["prop.elder_seal"]} sheet={sheet} fallback="族" />
            <span class="thing-tag">{elderWords}</span>
          </button>
        ) : null}
        <button
          type="button"
          class={`thing thing-book${signalClass(play, "btn-notebook")}`}
          data-sig="btn-notebook"
          data-testid="btn-notebook"
          data-fresh={fresh}
          aria-expanded={notebookOpen}
          aria-controls="notebook"
          aria-label={bookWords}
          onClick={onNotebook}
        >
          <Thing sprites={["prop.notebook"]} sheet={sheet} fallback={bookWords} />
          <span class={`thing-count${fresh > 0 ? " is-fresh" : ""}`} data-testid="notebook-count">
            {entries}
          </span>
          {fresh > 0 ? (
            <span class="thing-dots" aria-hidden="true">
              {Array.from({ length: Math.min(fresh, 3) }, () => (
                <i />
              ))}
            </span>
          ) : null}
          <span class="thing-tag">{bookWords}</span>
        </button>
        {offered ? (
          <button
            type="button"
            class={`thing thing-incense${skip.running ? " is-running" : ""}`}
            data-testid="btn-skip"
            data-running={skip.running}
            data-day={skip.offer?.until?.day ?? ""}
            data-hour={skip.offer?.until?.hour ?? ""}
            disabled={!skip.enabled}
            aria-label={skipWords}
            onClick={onSkip}
          >
            <Thing sprites={["prop.incense_unlit", "prop.incense_lit"]} show="prop.incense_lit" sheet={sheet} fallback={skipWords} />
            <span class="thing-tag" data-testid="skip-words">
              {skipWords}
            </span>
          </button>
        ) : (
          <span class="thing thing-incense" data-testid="incense" aria-hidden="true">
            <Thing sprites={["prop.incense_unlit", "prop.incense_lit"]} show="prop.incense_unlit" sheet={sheet} fallback="" />
          </span>
        )}
      </div>
    </aside>
  );
}
