import { Birds, Market } from "./day.ts";
import type { Rig } from "./dsp.ts";
import type { Layer } from "./layer.ts";
import type { Bus } from "./mixer.ts";
import { Insects, Watch } from "./night.ts";
import { Rain, River } from "./water.ts";

/** The layers of the ambience, all of them, on one bus. The game and the renderings that are made for listening make them the same way. */
export function makeLayers(rig: Rig, bus: Bus): Layer[] {
  return [new River(rig, bus), new Market(rig, bus), new Birds(rig, bus), new Insects(rig, bus), new Rain(rig, bus), new Watch(rig, bus)];
}
