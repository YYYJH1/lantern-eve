/**
 * The hook of the festival night's show. The show calls these three and nothing else:
 *
 *   festival.start()          the drums, gongs, cymbals and the tune begin, and go round until stopped;
 *   festival.setDistance(d)   how loud they are, by how far the procession is from where the camera looks, in cells of
 *                             the town (0 is on top of it: full; 14 is about half; 40 is a murmur). `side` is -1 when the
 *                             procession is to the left of the camera and 1 when it is to the right;
 *   festival.stop()           they fade out.
 *
 * They do nothing while the sound is off, before the first press of Start or Continue, or in a page with no sound; the show does not
 * need to ask. The music volume of the menu is the loudest they get.
 */
export interface FestivalSound {
  start(): void;
  stop(): void;
  setDistance(distance: number, side?: number): void;
}

/** What the controller gives the hook to act on. */
export interface FestivalTarget {
  start(): void;
  stop(): void;
  setDistance(distance: number, side: number): void;
}

let target: FestivalTarget | null = null;

/** The controller takes the hook while it lives. Returns the function that gives it up. */
export function bindFestival(next: FestivalTarget): () => void {
  target = next;
  return () => {
    if (target === next) target = null;
  };
}

export const festival: FestivalSound = {
  start: () => target?.start(),
  stop: () => target?.stop(),
  setDistance: (distance, side = 0) => target?.setDistance(distance, side),
};
