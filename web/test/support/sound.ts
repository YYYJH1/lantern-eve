/**
 * Stand-ins for the tests of the sound (Node, no browser): an engine that only keeps what it was asked, a host that lets a test feed
 * frames, and a document with the few things the soundscape asks of it.
 */
import type { EngineLike, EngineSnapshot, Volumes } from "../../src/page/audio/engine.ts";
import type { CueId } from "../../src/page/audio/cues.ts";
import type { Mix } from "../../src/page/audio/plan.ts";
import type { SoundHost, SoundPage } from "../../src/page/audio/soundscape.ts";
import type { CoreEvent, Frame, HostToPage } from "../../src/shared/protocol.ts";
import { frameAt } from "./fake-client.ts";

export class FakeEngine implements EngineLike {
  started = false;
  state = "none";
  starts = 0;
  suspends = 0;
  resumes = 0;
  disposed = false;
  volumes: Volumes | null = null;
  volumeCalls: Volumes[] = [];
  mixes: Mix[] = [];
  cues: CueId[] = [];
  festival: string[] = [];
  festivalAt: Array<[number, number]> = [];

  start(): void {
    this.starts++;
    this.started = true;
    this.state = "running";
  }
  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    this.volumeCalls.push(volumes);
  }
  apply(mix: Mix): void {
    this.mixes.push(mix);
  }
  cue(id: CueId): void {
    this.cues.push(id);
  }
  festivalStart(): void {
    this.festival.push("start");
  }
  festivalStop(): void {
    this.festival.push("stop");
  }
  festivalPlace(distance: number, side: number): void {
    this.festivalAt.push([distance, side]);
  }
  suspend(): void {
    this.suspends++;
    this.state = "suspended";
  }
  resume(): void {
    this.resumes++;
    this.state = "running";
  }
  dispose(): void {
    this.disposed = true;
    this.started = false;
  }
  snapshot(): EngineSnapshot {
    return { started: this.started, state: this.state, time: 0, layers: {}, festival: false, cues: this.cues.length, volumes: this.volumes ?? { master: 0, ambience: 0, music: 0, effects: 0 } };
  }
  get lastMix(): Mix | undefined {
    return this.mixes[this.mixes.length - 1];
  }
}

/** A host that keeps nothing but the few things the soundscape reads, and sends a frame when a test says so. */
export class FakeHost {
  readonly state = { paused: false, stats: null as { reasons: string[] } | null, scene: null as Record<string, unknown> | null, sceneVersion: 0, frame: null as Frame | null };
  private readonly taps = new Set<(message: HostToPage) => void>();
  private tick = 0;

  get host(): SoundHost {
    return this as unknown as SoundHost;
  }
  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.add(listener);
    return () => this.taps.delete(listener);
  }
  feed(message: HostToPage): void {
    for (const tap of [...this.taps]) tap(message);
  }
  /** The host sends a frame at this time of the game, with these events. */
  frame(hour: number, minute = 0, over: Record<string, unknown> = {}, events: CoreEvent[] = []): void {
    this.tick++;
    const frame: Frame = frameAt(1, hour, minute, over, hour >= 21 || hour < 6 ? "night" : "day");
    this.state.frame = frame;
    this.feed({ type: "frame", tick: this.tick, advanced: true, frame, events, clock: { paused: this.state.paused, rate: [1, 1] } });
  }
  /** The player pauses the world, the page holds it for a sheet, the tab is hidden, or it runs. */
  stop(reasons: string[] | null): void {
    this.state.paused = reasons !== null;
    this.state.stats = reasons === null ? null : { reasons };
  }
  get listening(): number {
    return this.taps.size;
  }
}

/** A document: a visibility state, and the listeners that were put on it. */
export class FakePage implements SoundPage {
  visibilityState = "visible";
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: Partial<Event> & { target?: unknown } = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as Event);
  }
  hide(): void {
    this.visibilityState = "hidden";
    this.dispatch("visibilitychange");
  }
  show(): void {
    this.visibilityState = "visible";
    this.dispatch("visibilitychange");
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** An element that knows which selectors it matches, for the sound of a click. */
export function element(matches: string[]): Element {
  return { closest: (selector: string) => (matches.includes(selector) ? ({} as Element) : null) } as unknown as Element;
}

/** localStorage that keeps what it is given, for the tests of what is remembered. Returns the store and a function that puts back what was there. */
export function withStorage(options: { blocked?: boolean } = {}): { store: Map<string, string>; restore: () => void } {
  const store = new Map<string, string>();
  const real = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = options.blocked
    ? {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      }
    : { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  return { store, restore: () => ((globalThis as { localStorage?: unknown }).localStorage = real) };
}
