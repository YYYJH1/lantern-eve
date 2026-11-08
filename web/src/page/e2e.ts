import type { HostClient } from "./client.ts";
import type { MapView } from "./map/map-view.ts";
import type { Play } from "./play.ts";

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
  /**
   * Adds keys to the frame on screen, as the core does for bubbles, dots, lanterns, the
   * numbers of the side panel and the notebook, and tells the page. A world that is held
   * sends no frame after it, so what is put in stays.
   */
  inject(extras: Record<string, unknown>): void;
}

export function installE2E(client: HostClient, view: MapView, play: Play): LanternHandle {
  const handle: LanternHandle = {
    client,
    view,
    play,
    replay: null,
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
