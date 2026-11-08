import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { t } from "../../i18n/index.ts";
import type { MapView } from "../map/map-view.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import type { Job } from "../shows.ts";
import type { SliceFrame } from "../slice.ts";
import { InkAct, Lantern } from "./ink.tsx";

/**
 * The card that says a job is done (the bridge is mended, the truth is told, the families are at peace): over the map, once for each in a game,
 * a title, a line, and one button to go on. It holds the world while it is up (the guide does), and Enter on the button or Escape anywhere puts it away.
 */
export function ShowCard({ play }: { play: Play }) {
  const guide = play.guide;
  const job = guide.shows.up;
  const sheet = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (job === null) return;
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") guide.closeShow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job, guide]);
  if (job === null) return null;
  return (
    <section ref={sheet} class="sheet paper-slip sheet-show" data-testid="show-card" data-job={job} role="dialog" aria-label={t(`show.${job}.title`)}>
      <Lantern />
      <h2 class="sheet-title show-title" data-testid="show-title">
        {t(`show.${job}.title`)}
      </h2>
      <div class="sheet-scroll">
        <p class="show-text" data-testid="show-text">
          {t(`show.${job}.text`)}
        </p>
      </div>
      <div class="sheet-foot">
        <InkAct seed={`show-${job}`} data-testid="show-close" data-sheet-focus onClick={() => guide.closeShow()}>
          {t("show.close")}
        </InkAct>
      </div>
    </section>
  );
}

/** What the light for a job is on: the bridge, the place the truth was told at (the teahouse, until the board says where), and the manager, who made the peace. */
export function glowAt(job: Job, scene: Scene | null, slice: SliceFrame): { kind: "place" | "person"; id: string } | null {
  if (job === "bridge") return { kind: "place", id: "p_bridge" };
  if (job === "truth") return { kind: "place", id: slice.board?.truth?.last?.venue ?? "p_teahouse" };
  return scene?.player == null ? null : { kind: "person", id: scene.player.id };
}

/** The cell a place is entered at, or the middle of it where it has no door. */
function cellOfPlace(scene: Scene | null, id: string): { x: number; y: number } | null {
  const place = scene?.places.find((p) => p.id === id);
  if (place === undefined) return null;
  if (place.door !== null) return { x: place.door[0], y: place.door[1] };
  const { x, y, w, h } = place.rect;
  return { x: x + w / 2 - 0.5, y: y + h / 2 - 0.5 };
}

/**
 * A small light on the map where the job was done, for as long as its card is up and a moment after: a warm glow that breathes, and a ring that goes out
 * from it. It follows the map when it is moved or zoomed, like the ring that the help puts round a person. A map with no scene, or that is not drawn (a test of
 * the host), has none.
 */
export function MapGlow({ play, view, scene, slice }: { play: Play; view: MapView; scene: Scene | null; slice: SliceFrame }) {
  const glow = play.guide.glow;
  const job = glow?.job ?? null;
  const target = job === null ? null : glowAt(job, scene, slice);
  const id = target?.id ?? null;
  const kind = target?.kind ?? "place";
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (element === null || id === null) return;
    let frame = 0;
    const follow = (): void => {
      let at: { x: number; y: number } | null = null;
      if (kind === "person") at = view.bodyPositionOf(id);
      else {
        const cell = cellOfPlace(scene, id);
        at = cell === null ? null : view.cellToScreen(cell.x, cell.y);
      }
      element.hidden = at === null;
      if (at !== null) element.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id, kind, view, scene]);
  if (glow === null || id === null) return null;
  return (
    <div class="show-glow" ref={box} data-testid="show-glow" data-job={glow.job} data-fading={glow.fading} data-at={id} aria-hidden="true">
      <i class="show-glow-core" />
      <i class="show-glow-ring" />
      <i class="show-glow-ring show-glow-ring-late" />
    </div>
  );
}
