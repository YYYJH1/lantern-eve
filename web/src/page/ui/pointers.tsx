import { type Lang, t } from "../../i18n/index.ts";
import type { Scene } from "../scene.ts";
import { personName } from "./common.tsx";

export interface LinkedTextProps {
  text: string;
  /** The ids of the people the line sends the player to. */
  points: readonly string[];
  scene: Scene | null;
  lang: Lang;
  /** Called with the person a name was pressed for. */
  onPoint(npc: string): void;
}

interface Span {
  start: number;
  end: number;
  npc: string;
}

/**
 * A line of a reply where a person it sends the player to is named, with each name a button that brings that person into view.
 * A person the line sends to without a name the line shows (a "he", a nickname) gets a button after the line.
 */
export function LinkedText({ text, points, scene, lang, onPoint }: LinkedTextProps) {
  const known = points.filter((id, i) => points.indexOf(id) === i && scene?.cast.some((p) => p.id === id) === true);
  if (known.length === 0) return <>{text}</>;
  const spans: Span[] = [];
  const apart: string[] = [];
  for (const npc of known) {
    const name = personName(scene, lang, npc);
    const at = name === "" ? -1 : text.indexOf(name);
    if (at >= 0 && !spans.some((s) => at < s.end && at + name.length > s.start)) spans.push({ start: at, end: at + name.length, npc });
    else apart.push(npc);
  }
  spans.sort((a, b) => a.start - b.start);
  const parts: preact.ComponentChildren[] = [];
  let from = 0;
  for (const span of spans) {
    if (span.start > from) parts.push(text.slice(from, span.start));
    parts.push(<PointerButton key={`${span.npc}@${span.start}`} npc={span.npc} label={text.slice(span.start, span.end)} onPoint={onPoint} />);
    from = span.end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return (
    <>
      {parts}
      {apart.length === 0 ? null : (
        <span class="pointer-rest">
          {apart.map((npc) => (
            <PointerButton key={`rest-${npc}`} npc={npc} label={t("pointer.ask", { name: personName(scene, lang, npc) })} onPoint={onPoint} />
          ))}
        </span>
      )}
    </>
  );
}

function PointerButton({ npc, label, onPoint }: { npc: string; label: string; onPoint(npc: string): void }) {
  return (
    <button type="button" class="pointer" data-testid="pointer" data-npc={npc} title={t("pointer.hint")} onClick={() => onPoint(npc)}>
      {label}
    </button>
  );
}
