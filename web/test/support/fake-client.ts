/**
 * A stand-in for the host client, for the unit tests of the player's side (Node, no browser): it keeps what the page asked of the host and
 * lets a test feed the page messages as the host would. The saves are a list in memory, numbered from 1, that `save` adds to and
 * `deleteSave` takes from, with the notes the page kept with each.
 */
import type { HostClient } from "../../src/page/client.ts";
import type { CoreEvent, Frame, HostToPage, PageNotes, SaveMeta } from "../../src/shared/protocol.ts";

export class FakeClient {
  readonly state = {
    scene: null as Record<string, unknown> | null,
    paused: false,
    rate: [1, 1] as [number, number],
    stats: null as { reasons: string[] } | null,
    saves: [] as SaveMeta[],
    preset: "slice" as string | null,
  };
  readonly sent: Array<Record<string, unknown>> = [];
  /** `pause` and `resume` as they were asked, with the reason. */
  readonly holds: string[] = [];
  /** The saves the page asked for: the name, and the notes it kept with the save. */
  readonly saved: Array<{ name: string | undefined; page: PageNotes | null }> = [];
  readonly deleted: number[] = [];
  /** Makes `save` fail while it is set, as a host that is busy or has no room does: with the error that is given (a `HostCallError`, say), else a plain one. */
  failSave: boolean | Error = false;
  touched = 0;
  pageNotes: (() => PageNotes | null) | null = null;
  private readonly taps: Array<(message: HostToPage) => void> = [];
  private nextSave = 1;
  private action = 0;

  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.push(listener);
    return () => undefined;
  }
  touch(): void {
    this.touched++;
  }
  pause(reason = "user"): void {
    this.holds.push(`pause:${reason}`);
    this.state.paused = true;
  }
  resume(reason = "user"): void {
    this.holds.push(`resume:${reason}`);
    this.state.paused = false;
  }
  newActionId(): string {
    return `a${++this.action}`;
  }
  player(body: Record<string, unknown>): string {
    const id = typeof body.action_id === "string" ? body.action_id : this.newActionId();
    this.sent.push({ ...body, action_id: id });
    return id;
  }
  call<T>(_call: Record<string, unknown>): Promise<T> {
    return new Promise<T>(() => undefined);
  }
  async save(name?: string, extra?: PageNotes): Promise<SaveMeta> {
    const notes = { ...(this.pageNotes?.() ?? {}), ...(extra ?? {}) };
    const page = Object.keys(notes).length === 0 ? null : notes;
    this.saved.push({ name, page });
    if (this.failSave) throw this.failSave instanceof Error ? this.failSave : new Error("busy");
    const meta: SaveMeta = { id: this.nextSave++, name: name ?? "", savedAt: "2026-11-05T00:00:00.000Z", tick: this.saved.length, hash: "0".repeat(64), ...(page === null ? {} : { page }) };
    this.state.saves = [meta, ...this.state.saves];
    return meta;
  }
  async deleteSave(id: number): Promise<void> {
    this.deleted.push(id);
    this.state.saves = this.state.saves.filter((save) => save.id !== id);
  }
  /** Puts a save in the list as the player's own, which the page did not make. */
  own(name: string): SaveMeta {
    const meta: SaveMeta = { id: this.nextSave++, name, savedAt: "2026-11-05T00:00:00.000Z", tick: 0, hash: "1".repeat(64) };
    this.state.saves = [meta, ...this.state.saves];
    return meta;
  }
  feed(message: HostToPage): void {
    for (const tap of this.taps) tap(message);
  }
  get last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1] ?? {};
  }
  /** The page-facing type of this stand-in. */
  get host(): HostClient {
    return this as unknown as HostClient;
  }
}

/** A frame with only what the page's player side reads, at this time of the game. */
export function frameAt(day: number, hour: number, minute = 0, over: Record<string, unknown> = {}, phase = "day"): Frame {
  return {
    npcs: [],
    time: { day, hour, minute, phase },
    weather: "clear",
    bubbles: [],
    dots: [],
    lanterns: [],
    hud: { verbs: ["move"] },
    player: { x: 10, y: 10, activity: "rest", talk: null, look: [] },
    notebook: [],
    ending: null,
    ...over,
  } as unknown as Frame;
}

let tickNo = 0;
/** The host sends a frame of the game with these events. */
export function feedFrame(client: FakeClient, frame: Frame, events: CoreEvent[] = []): void {
  tickNo++;
  client.feed({ type: "frame", tick: tickNo, advanced: true, frame, events, clock: { paused: false, rate: [1, 1] } });
}

export const resetTicks = (): void => {
  tickNo = 0;
};
