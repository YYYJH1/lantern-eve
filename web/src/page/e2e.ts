import type { FestivalSound } from "./audio/festival.ts";
import type { renderClip } from "./audio/render.ts";
import type { Soundscape } from "./audio/soundscape.ts";
import type { HostClient } from "./client.ts";
import { registerEndingShow } from "./director.ts";
import { festivalShow, festivalStats, setFestivalSound } from "./festival/show.ts";
import type { MapView } from "./map/map-view.ts";
import type { Play } from "./play.ts";
import type { ShowClock } from "./show-clock.ts";

/**
 * Handles for the browser tests, on window.__lantern. This module is imported only when the bundle
 * is built with `--mode e2e`; the production bundle does not contain it.
 */
export interface LanternHandle {
  client: HostClient;
  view: MapView;
  play: Play;
  /** The recording that is open over the game, with its own client, map and player's side, or null. */
  replay: { id: string; client: HostClient; view: MapView; play: Play } | null;
  /** The sound of the game, to read what it does. */
  sound: Soundscape | null;
  /** Renders one of the sounds on an offline context (`audio/render.ts`), to look at what the synthesis makes. */
  renderSound: typeof renderClip | null;
  /** The hook of the festival night's show into the sound (`audio/festival.ts`), for a test to play the part of the show. */
  festivalSound: FestivalSound | null;
  /**
   * Adds keys to the frame on screen, as the core does for bubbles, dots, lanterns, the
   * numbers of the side panel and the notebook, and tells the page. A world that is held
   * sends no frame after it, so what is put in stays.
   */
  inject(extras: Record<string, unknown>): void;
  /** Registers a maker of the show that plays before the ending page (`director.ts`), as the festival night does. Returns what takes it away again. */
  registerEndingShow: typeof registerEndingShow;
  /** The festival night: the maker of its show (to register in a page that did not ask for it with ?festival=on), what the last night drew and how long its updates took, and the sound it tells of the parade. */
  festival: { show: typeof festivalShow; stats: typeof festivalStats; setSound: typeof setFestivalSound };
  /** The clock the shows play on where the page was opened with `?showclock=manual`: it only moves when it is advanced. Null otherwise. */
  showClock: ShowClock | null;
}

export function installE2E(client: HostClient, view: MapView, play: Play, showClock: ShowClock | null = null): LanternHandle {
  const handle: LanternHandle = {
    client,
    view,
    play,
    replay: null,
    sound: null,
    renderSound: null,
    festivalSound: null,
    registerEndingShow,
    festival: { show: festivalShow, stats: festivalStats, setSound: setFestivalSound },
    showClock,
    inject(extras) {
      const frame = client.state.frame;
      if (frame === null) throw new Error("there is no frame to add to yet");
      Object.assign(frame, extras);
      client.state.frameCount++;
      (client as unknown as { changed(): void }).changed();
    },
  };
  (window as unknown as { __lantern: LanternHandle }).__lantern = handle;
  return handle;
}
