/**
 * The engine: the audio context of the page and everything built on it, made on the first press of Start or Continue and not before.
 * It turns a mix (how loud each layer is) into gains, schedules the events that fall in the next moments (a bird, a drop, a strike of the
 * festival), plays the cues, and fades the whole thing out when the page is hidden or the sound is switched off.
 */
import { type CueId, playCue } from "./cues.ts";
import { makeRig, type Rig } from "./dsp.ts";
import { type Layer, type LayerId } from "./layer.ts";
import { makeLayers } from "./layers.ts";
import { buildMixer, type Mixer } from "./mixer.ts";
import type { Mix } from "./plan.ts";
import { Festival } from "./tune.ts";

/** How far ahead of the clock events are made, in seconds. A page that is busy for less than this does not drop a note. */
export const LOOKAHEAD = 0.9;

export interface Volumes {
  /** 0 or 1: the switch and the hidden page. */
  master: number;
  ambience: number;
  music: number;
  effects: number;
}

export interface EngineSnapshot {
  started: boolean;
  state: string;
  time: number;
  /** The level each layer was set to, and whether it has sources running. */
  layers: Partial<Record<LayerId, { level: number; active: boolean }>>;
  festival: boolean;
  cues: number;
  volumes: Volumes;
}

/** What the controller needs of the engine: the tests of the controller put a stand-in here. */
export interface EngineLike {
  /** Makes the context and the graph, or wakes them. Call it from a press, or after one. */
  start(): void;
  /** Whether the context is made and open. */
  readonly started: boolean;
  /** The state of the context: "running" when sound is coming out, "suspended" when the browser is still holding it back. */
  readonly state: string;
  setVolumes(volumes: Volumes, glide: number): void;
  apply(mix: Mix): void;
  cue(id: CueId): void;
  festivalStart(): void;
  festivalStop(): void;
  festivalPlace(distance: number, side: number): void;
  /** Stops the context from running (it costs nothing while stopped). */
  suspend(): void;
  resume(): void;
  dispose(): void;
  snapshot(): EngineSnapshot;
}

// Sounds that answer a click should not come late, so the context asks for the short buffer. The events are made a moment ahead, so a busy page does not make it stumble.
const defaultContext = (): AudioContext => new AudioContext({ latencyHint: "interactive" });

export class Engine implements EngineLike {
  private ctx: AudioContext | null = null;
  private rig: Rig | null = null;
  private mixer: Mixer | null = null;
  private layers: Layer[] = [];
  private festival: Festival | null = null;
  private cuesPlayed = 0;
  private volumes: Volumes = { master: 0, ambience: 0, music: 0, effects: 0 };
  private volumesSet = false;
  /** What the festival was asked for before the context was there. */
  private festivalWanted = false;
  private festivalAt = { distance: 0, side: 0 };

  constructor(private readonly make: () => AudioContext = defaultContext) {}

  get started(): boolean {
    return this.ctx !== null && this.ctx.state !== "closed";
  }

  get state(): string {
    return this.ctx?.state ?? "none";
  }

  start(): void {
    if (this.ctx !== null) {
      this.resume();
      return;
    }
    const ctx = this.make();
    const rig = makeRig(ctx, Math.floor(Math.random() * 2 ** 32));
    const mixer = buildMixer(rig);
    mixer.master.gain.value = 0;
    mixer.ambience.level.gain.value = 0;
    mixer.music.level.gain.value = 0;
    mixer.effects.level.gain.value = 0;
    this.ctx = ctx;
    this.rig = rig;
    this.mixer = mixer;
    this.layers = makeLayers(rig, mixer.ambience);
    this.festival = new Festival(rig, mixer.music);
    if (this.festivalWanted) this.festivalStart();
    this.setVolumes(this.volumes, 0);
    this.resume();
  }

  resume(): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state === "running") return;
    ctx.resume().catch(() => undefined);
  }

  suspend(): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== "running") return;
    ctx.suspend().catch(() => undefined);
  }

  setVolumes(volumes: Volumes, glide: number): void {
    const before = this.volumes;
    const same = (Object.keys(volumes) as Array<keyof Volumes>).every((key) => Math.abs(volumes[key] - before[key]) < 0.0005);
    this.volumes = { ...volumes };
    const mixer = this.mixer;
    const ctx = this.ctx;
    // The same volumes again are not set again (a world that has stood still for an hour would pile up events on a context that is not running).
    if (mixer === null || ctx === null || (same && this.volumesSet)) return;
    this.volumesSet = true;
    const t = ctx.currentTime;
    const set = (param: AudioParam, value: number): void => {
      if (glide <= 0) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, glide);
    };
    set(mixer.master.gain, volumes.master);
    set(mixer.ambience.level.gain, volumes.ambience);
    set(mixer.music.level.gain, volumes.music);
    set(mixer.effects.level.gain, volumes.effects);
  }

  apply(mix: Mix): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const t = ctx.currentTime;
    for (const layer of this.layers) {
      const wanted = mix[layer.id];
      layer.set(wanted.level, wanted.pan, t, 0.4);
      layer.schedule(t + LOOKAHEAD);
    }
    this.festival?.schedule(t + LOOKAHEAD);
  }

  cue(id: CueId): void {
    const { ctx, rig, mixer } = this;
    if (ctx === null || rig === null || mixer === null || ctx.state === "closed") return;
    this.cuesPlayed++;
    playCue(rig, mixer.effects, id, ctx.currentTime + 0.01);
  }

  festivalStart(): void {
    this.festivalWanted = true;
    const ctx = this.ctx;
    if (ctx === null || this.festival === null) return;
    this.festival.place(this.festivalAt.distance, this.festivalAt.side, ctx.currentTime, 0);
    this.festival.start(ctx.currentTime + 0.1);
  }

  festivalStop(): void {
    this.festivalWanted = false;
    const ctx = this.ctx;
    if (ctx === null || this.festival === null) return;
    this.festival.stop(ctx.currentTime);
  }

  festivalPlace(distance: number, side: number): void {
    this.festivalAt = { distance, side };
    const ctx = this.ctx;
    if (ctx === null || this.festival === null) return;
    this.festival.place(distance, side, ctx.currentTime);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.volumesSet = false;
    this.layers = [];
    this.festival = null;
    this.mixer = null;
    this.rig = null;
    if (ctx !== null && ctx.state !== "closed") ctx.close().catch(() => undefined);
  }

  snapshot(): EngineSnapshot {
    const layers: EngineSnapshot["layers"] = {};
    for (const layer of this.layers) layers[layer.id] = { level: layer.level, active: layer.active };
    return { started: this.started, state: this.state, time: this.ctx?.currentTime ?? 0, layers, festival: this.festival?.active ?? false, cues: this.cuesPlayed, volumes: { ...this.volumes } };
  }
}

