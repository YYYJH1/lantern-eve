/**
 * The sound of the game, all of it made in the browser with Web Audio: no recording is played and none is loaded. `Soundscape` is the
 * controller the page makes once (main.tsx); `festival` is the hook of the festival night's show.
 */
import type { HostClient } from "../client.ts";
import { Engine } from "./engine.ts";
import { listenerOf, type Lookout } from "./listener.ts";
import { type SoundSession, Soundscape } from "./soundscape.ts";

export { festival, type FestivalSound } from "./festival.ts";
export { soundPrefs } from "./settings.ts";
export { type SoundSession, Soundscape, type SoundscapeSnapshot } from "./soundscape.ts";

/** A game or a recording to be heard: it is the client that is listened to, and the camera of its map says where the ear is. */
export function sessionOf(client: HostClient, view: Lookout): SoundSession {
  return { host: client, listener: () => listenerOf(view) };
}

/** The soundscape of the page. It hears the live game until it is pointed at a recording (`Soundscape.follow`). */
export function createSoundscape(client: HostClient, view: Lookout): Soundscape {
  const live = sessionOf(client, view);
  return new Soundscape({ host: live.host, engine: new Engine(), listener: live.listener });
}
