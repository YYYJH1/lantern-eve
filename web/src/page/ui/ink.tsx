import type { ComponentChildren } from "preact";
import type { Mark } from "./marks.ts";
import { CIRCLES, GLYPHS, pick, RULES, SEALS, STRIKES, tallies, TICKS, UNDERLINES, VERTICAL_RULES } from "./marks.ts";

/**
 * The brush marks of the page, drawn as inline SVG: filled outlines in the colour of the text round them (`currentColor`), so that the style sheet chooses ink,
 * rouge or the lamp. Nothing is fetched. Every mark is one `svg.brush` with the class of its kind (`tick`, `underline`, `circle`, `rule`, `stamp`, `glyph`,
 * `tally-mark`, `struck-mark`, `cross-a`, `cross-b`) and then the classes that the caller adds. The same key draws the same variant of a mark every time.
 */

const classes = (...names: Array<string | undefined>): string => names.filter((name) => name !== undefined && name !== "").join(" ");

interface BrushProps {
  mark: Mark;
  /** The size on the page. A mark has its natural size where none is given, and a mark that is stretched has the width that the style sheet gives it. */
  width?: number | string;
  height?: number | string;
  /** Stretched to the box it is given, for a rule, a strike or an underline of any length: the ratio of the mark is not kept. */
  stretch?: boolean;
  class?: string;
}

/** One mark of `marks.ts`, for a mark that has no component of its own (a strike through a line, a thread of the notebook). */
export function Brush({ mark, width, height, stretch = false, class: className }: BrushProps) {
  return (
    <svg
      class={classes("brush", className)}
      viewBox={`0 0 ${mark.w} ${mark.h}`}
      width={width ?? (stretch ? undefined : mark.w)}
      height={height ?? mark.h}
      fill="currentColor"
      fill-rule={mark.evenodd === true ? "evenodd" : undefined}
      preserveAspectRatio={stretch ? "none" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {mark.paths.map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
}

/** The tick of a line that is done. */
export function Tick({ seed, class: className }: { seed: string | number; class?: string }) {
  return <Brush mark={pick(TICKS, seed)} class={classes("tick", className)} />;
}

/** The underline of a word that can be acted on, as long as its box. */
export function Underline({ seed, class: className }: { seed: string | number; class?: string }) {
  return <Brush mark={pick(UNDERLINES, seed)} width="100%" height={8} stretch class={classes("underline", className)} />;
}

/** A ruled line of a ledger, level or plumb, stretched to its box. */
export function Rule({ seed, vertical = false, class: className }: { seed: string | number; vertical?: boolean; class?: string }) {
  return vertical ? (
    <Brush mark={pick(VERTICAL_RULES, seed)} width={5} height="100%" stretch class={classes("rule", "rule-v", className)} />
  ) : (
    <Brush mark={pick(RULES, seed)} width="100%" height={5} stretch class={classes("rule", className)} />
  );
}

/** A hand-drawn circle round a word, a phrase or a line: the manager's own mark in rouge. */
export function Circle({ kind = "wide", class: className }: { kind?: "round" | "wide" | "long"; class?: string }) {
  return <Brush mark={CIRCLES[kind]} stretch class={classes("circle", className)} />;
}

/** The seal of a job done (办妥) or a promise that came (送到): a block of rouge with the characters cut out of it. */
export function Stamp({ word, shape = "wide", class: className }: { word: "done" | "delivered"; shape?: "wide" | "square"; class?: string }) {
  return <Brush mark={SEALS[word][shape]} class={classes("stamp", `stamp-${word}`, className)} />;
}

/** The three small drawings of the top right: pause, play and the menu. */
export function Glyph({ name, class: className }: { name: "pause" | "play" | "menu"; class?: string }) {
  return <Brush mark={GLYPHS[name]} class={classes("glyph", className)} />;
}

/**
 * The tally of a number in the strokes of 正, a whole 正 for each five and the strokes that are left, written in the order of the strokes. Nothing for none. The
 * words say the number for those who do not see the strokes (`label`), and a tally with no label is for the eye alone.
 */
export function Tally({ n, label = "", class: className }: { n: number; label?: string; class?: string }) {
  const marks = tallies(n);
  if (marks.length === 0) return null;
  return (
    <span class={classes("tally", className)} role={label === "" ? undefined : "img"} aria-label={label === "" ? undefined : label} aria-hidden={label === "" ? "true" : undefined} data-n={n}>
      {marks.map((mark) => (
        <Brush mark={mark} class="tally-mark" />
      ))}
    </span>
  );
}

/** A short stroke that strikes a number out, and the number after it in Arabic figures (a stroke and a Chinese "一" are not to be mistaken). */
export function Struck({ n, label = "", class: className }: { n: number; label?: string; class?: string }) {
  if (n < 1) return null;
  return (
    <span class={classes("struck", className)} role={label === "" ? undefined : "img"} aria-label={label === "" ? undefined : label} data-n={n}>
      <Brush mark={pick(STRIKES, `s${n}`)} class="struck-mark" />
      <span class="struck-n" aria-hidden={label === "" ? undefined : "true"}>
        {n}
      </span>
    </span>
  );
}

/** A crossed pair of strokes, for the corner of a sheet that puts it away. */
export function Cross({ class: className }: { class?: string }) {
  return (
    <span class={classes("cross", className)} aria-hidden="true">
      <Brush mark={STRIKES[1] ?? STRIKES[0]} class="cross-a" />
      <Brush mark={STRIKES[2] ?? STRIKES[0]} class="cross-b" />
    </span>
  );
}

interface ActProps {
  children: ComponentChildren;
  /** Picks the underline: the same key draws the same stroke every time. */
  seed?: string | number;
  class?: string;
  [attribute: string]: unknown;
}

/**
 * An action in words with a stroke of the brush under it: the word of the thing to do, and nothing else round it. The attributes
 * (`data-testid`, `onClick`, `disabled`, `aria-*`) go on the button.
 */
export function InkAct({ children, seed = "act", class: className = "", ...attributes }: ActProps) {
  return (
    <button type="button" {...attributes} class={classes("ink-act", className)}>
      {children}
      <Underline seed={seed} />
    </button>
  );
}

/** The corner of a sheet that puts it away: two strokes crossed, and the words of what it does for those who do not see them. */
export function CloseCorner({ label, testid, onClose }: { label: string; testid: string; onClose: () => void }) {
  return (
    <button type="button" class="ink-close" data-testid={testid} aria-label={label} title={label} onClick={onClose}>
      <Cross />
    </button>
  );
}

/** A paper lantern lit, hung by its cord: for the card that says a job is done. The body is the colour of the lamp. */
export function Lantern({ class: className = "lantern" }: { class?: string }) {
  return (
    <svg class={className} viewBox="0 0 64 92" width="64" height="92" aria-hidden="true" focusable="false">
      <path class="lantern-cord" d="M32 0v14" />
      <path class="lantern-cap" d="M18 14h28l-3 8H21z" />
      <path class="lantern-body" d="M21 22h22c7 7 9 16 9 24s-2 17-9 24H21c-7-7-9-16-9-24s2-17 9-24z" />
      <path class="lantern-rib" d="M32 22v48M26 22c-6 7-8 16-8 24s2 17 8 24M38 22c6 7 8 16 8 24s-2 17-8 24" />
      <path class="lantern-cap" d="M21 70h22l3 8H18z" />
      <path class="lantern-tassel" d="M32 78v8M28 86l4 4 4-4" />
    </svg>
  );
}
