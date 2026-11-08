/**
 * A few notebook entries written for the purpose, for the panel to show before the core sends any.
 * The test build loads them behind `?notebook=sample`; the production bundle does not contain them.
 */
import type { NotebookEntry } from "./notebook.ts";
import type { Name } from "./scene.ts";

const name = (zh: string, en: string): Name => ({ zh, en });

/** A few entries for the notebook to show before the real ones exist. */
export function sampleNotebook(): NotebookEntry[] {
  return [
    {
      id: "n1",
      text: name("桥墩上有新的刮痕。", "There are fresh scrapes on the bridge pier."),
      source: { kind: "seen" },
      marks: [],
      chain: [],
    },
    {
      id: "n2",
      text: name("李二那晚在桥边。", "Li Er was at the bridge that night."),
      source: { kind: "heard", who: name("周家伙计", "Zhou's Clerk"), hand: 2 },
      marks: ["unconfirmed"],
      chain: [name("周家伙计", "Zhou's Clerk"), name("更夫", "Night Watchman"), null],
    },
    {
      id: "n3",
      text: name("李二弄坏了桥。", "Li Er wrecked the bridge."),
      source: { kind: "heard", who: name("周掌柜", "Shopkeeper Zhou"), hand: 3 },
      marks: ["unsupported", "sourceMismatch"],
      chain: [name("周掌柜", "Shopkeeper Zhou"), name("周家伙计", "Zhou's Clerk"), null],
    },
    {
      id: "n4",
      text: name("老何那晚在家。", "Old He was at home that night."),
      source: { kind: "heard", who: name("老何", "Boatman He"), hand: 1 },
      marks: ["contradicts"],
      chain: [name("老何", "Boatman He")],
    },
    {
      id: "n5",
      text: name("老何那晚在桥下撑船。", "Old He was poling his boat under the bridge that night."),
      source: { kind: "heard", who: name("茶馆老板娘", "Teahouse Keeper"), hand: 2 },
      marks: ["contradicts", "unconfirmed"],
      chain: [name("茶馆老板娘", "Teahouse Keeper"), null],
    },
  ];
}
