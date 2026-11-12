import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import type { OffReason } from "../hud.ts";
import type { MapView } from "../map/map-view.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { signalClass } from "./guide.tsx";
import { actState, type MapAct, offWords } from "./map-acts.ts";
import { thingName } from "./names.ts";

/** What a chip hangs from: a piece on the map, by the middle of it, the top of its head and the ground under its feet, in the pixels of the map. */
interface Anchor {
  x: number;
  head: number;
  foot: number;
}

/** Whether a box in the pixels of the page meets a thing of the page that has a size. */
const meets = (box: { left: number; right: number; top: number; bottom: number }, rect: DOMRect | undefined): rect is DOMRect =>
  rect !== undefined && rect.width > 0 && box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < rect.bottom;

/**
 * Where a chip stands: over the head of the piece it hangs from, where nothing of the page lies over it and it lies over nothing that has words on it.
 * `element` is the chip's box, whose stack hangs 12 px over its origin.
 * - The card of the person picked lies at the foot of the map over whoever stands there: where it would cover the chip, the chip stands beside it, on its right.
 * - The red slip, with its note, hangs over the middle of the map, and the manager begins under it: where the chip would lie on it, the chip stands under the feet
 *   of the piece, and where the piece is behind the slip altogether, under the slip, which is where the piece is.
 */
function place(element: HTMLElement, at: Anchor): { x: number; y: number } {
  const stack = element.firstElementChild;
  const base = element.parentElement?.getBoundingClientRect();
  if (base === undefined || !(stack instanceof HTMLElement)) return { x: at.x, y: at.head };
  const { offsetWidth: w, offsetHeight: h } = stack;
  const box = (x: number, top: number) => ({ left: base.left + x - w / 2, right: base.left + x + w / 2, top: base.top + top, bottom: base.top + top + h });
  let x = at.x;
  let top = at.head - 12 - h;
  const card = document.querySelector('[data-testid="person-card"]')?.getBoundingClientRect();
  if (meets(box(x, top), card)) x = card.right - base.left + 10 + w / 2;
  const slip = document.querySelector('[data-testid="task-card"]')?.getBoundingClientRect();
  if (meets(box(x, top), slip)) {
    top = at.foot + 6;
    if (meets(box(x, top), slip)) top = slip.bottom - base.top + 6;
  }
  return { x, y: top + h + 12 };
}

/**
 * Where a floating chip hangs: the map says where, and the chip follows as the map moves and as the thing it hangs from does. `where` is read afresh on every
 * frame, so it may use what the page knows now. The ref goes on the element.
 */
function useFollow(where: () => Anchor | null): preact.RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(where);
  latest.current = where;
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    let frame = 0;
    const follow = (): void => {
      const at = latest.current();
      if (at !== null) {
        const here = place(element, at);
        element.style.transform = `translate(${Math.round(here.x)}px, ${Math.round(here.y)}px)`;
      }
      element.style.visibility = at === null ? "hidden" : "visible";
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  });
  return box;
}

/** What a chip said when it could not do its act: the reason, in a line of its own for a few seconds. */
const SAID_MS = 4200;

export interface MapContextProps {
  view: MapView;
  scene: Scene | null;
  lang: Lang;
  play: Play;
  frame: ViewFrame | null;
  /** The person picked on the map. */
  selected: string | null;
  enabled: ReadonlySet<string>;
  off: ReadonlyMap<string, OffReason>;
}

/**
 * The acts that come to the thing the manager points at. A pair of people who talk, picked on the map, has "listen in" over them: the manager
 * walks up to them if they are too far, and hears them when near. A thing within reach has "look" over the manager's own piece, and so has speaking up
 * where there is a meeting to speak to. They show only where they apply, and they are the same acts as the strip at the foot of the map.
 */
export function MapContext({ view, scene, lang, play, frame, selected, enabled, off }: MapContextProps) {
  const [said, setSaid] = useState<{ act: MapAct; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const say = (act: MapAct, text: string): void => {
    setSaid({ act, text });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(null), SAID_MS);
  };

  const me = frame?.player ?? null;
  const playing = play.playing && play.state.talk === null && me !== null;
  const pair = playing && selected !== null && frame !== null && frame.talkers.includes(selected) ? selected : null;
  const things = playing ? (me?.look ?? []) : [];
  const lookOn = actState("look", enabled, off).on;
  // Where the manager may speak in public, speaking up is offered over their own piece: the list of what to say opens on the strip.
  const speakOn = playing && actState("speak", enabled, off).on;
  const stack = (lookOn && things.length > 0) || speakOn;
  const speak = (): void => {
    play.flows.state.suggest = { verb: "speak", npc: "", since: play.now, kind: null };
    play.touch();
  };

  /** What a piece hangs a chip from, or the cell where it stands when the map has not drawn it. */
  const anchorOf = (id: string, cell: { x: number; y: number } | null): Anchor | null => {
    const head = view.headPositionOf(id);
    const foot = view.screenPositionOf(id);
    if (head !== null && foot !== null) return { x: head.x, head: head.y, foot: foot.y };
    if (cell === null) return null;
    const at = view.cellToScreen(cell.x, cell.y);
    return { x: at.x, head: at.y, foot: at.y };
  };
  const pairBox = useFollow(() => (pair === null ? null : anchorOf(pair, null)));
  const thingBox = useFollow(() => (me === null ? null : anchorOf(scene?.player?.id ?? "", me)));

  const listen = actState("listen", enabled, off);
  const pressListen = (): void => {
    if (listen.on) {
      play.listen();
      return;
    }
    // Too far to hear: the manager walks up to the pair, and hears them when they are there.
    if (listen.reason === "far" && pair !== null) {
      const them = frame?.people.find((p) => p.id === pair);
      if (them !== undefined) {
        play.goTo({ x: them.x, y: them.y, place: null });
        return;
      }
    }
    say("listen", offWords("listen", listen.reason ?? "far"));
  };

  return (
    <div class="chip-layer">
      {pair === null ? null : (
        <div class="map-chip" ref={pairBox} data-testid="chip-listen" data-on={listen.on} data-for={pair}>
          <div class="chip-stack">
            <button type="button" class={`chip-act${listen.on || listen.reason === "far" ? "" : " is-off"}${signalClass(play, "verb-listen")}`} data-sig="verb-listen" aria-disabled={!listen.on && listen.reason !== "far"} onClick={pressListen}>
              {!listen.on && listen.reason === "far" ? t("act.listen.walk") : t("act.listen")}
            </button>
          </div>
        </div>
      )}
      {stack ? (
        <div class="map-chip" ref={thingBox} data-testid="chip-acts">
          <div class="chip-stack">
            {lookOn
              ? things.map((id) => (
                  <button key={id} type="button" class="chip-act" data-testid="chip-look-thing" data-id={id} onClick={() => play.look(id)}>
                    {t("act.look.thing", { what: thingName(scene, lang, id) })}
                  </button>
                ))
              : null}
            {speakOn ? (
              <button type="button" class={`chip-act${signalClass(play, "verb-speak")}`} data-sig="verb-speak" data-testid="chip-speak" onClick={() => speak()}>
                {t("act.speak")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {said === null ? null : (
        <p class="map-chip-said paper-slip" role="status" data-testid="chip-said" data-act={said.act}>
          {said.text}
        </p>
      )}
    </div>
  );
}
