/**
 * First meetings. A person is known to the player from the first talk (`people[].known` of the frame), and the frame says nothing of
 * which talk was the first, so the page keeps what it has seen: the people who were known when it first looked (a game that was
 * loaded), and the ones it has seen become known since. The one who becomes known in the frame that has the player talking with them
 * is met for the first time, for as long as that talk lasts.
 */
import type { Relation } from "./relations.ts";

export class Introductions {
  private seen: Set<string> | null = null;
  private current: string | null = null;

  /**
   * The person the player is meeting for the first time in the talk they are in, or null. `rows` is the `people` of the frame (null where the frame has
   * none), `partner` the person the frame has the player talking with. Called with the same frame again it says the same.
   */
  update(rows: readonly Relation[] | null, partner: string | null): string | null {
    if (rows === null) {
      this.seen = null;
      this.current = null;
      return null;
    }
    const known = rows.filter((row) => row.known).map((row) => row.id);
    // The first frame the page looks at: whoever is known already was met before, whatever the talk is.
    if (this.seen === null) this.seen = new Set(known);
    for (const id of known) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (id === partner) this.current = id;
    }
    // A game that was started over has none known: the people it meets are new again.
    if (known.length === 0) this.seen.clear();
    if (partner === null || this.current !== partner) this.current = null;
    return this.current;
  }
}
