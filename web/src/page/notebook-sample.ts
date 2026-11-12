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
      text: name("渡船上有新刮痕。", "The boat has fresh scratches."),
      source: { kind: "seen" },
      at: null,
      marks: [],
      chain: [],
    },
    {
      id: "n2",
      text: name("李二昨晚在桥边。", "Li Er was at the bridge last night."),
      source: { kind: "heard", who: name("周家伙计", "Zhou's Clerk"), whoId: "zhou_huoji", how: "heard", via: name("更夫", "Night Watchman") },
      at: null,
      marks: ["unconfirmed"],
      chain: [name("周家伙计", "Zhou's Clerk"), name("更夫", "Night Watchman"), null],
    },
    {
      id: "n3",
      text: name("李二昨晚把栏杆弄坏了。", "Li Er broke the bridge railing last night."),
      source: { kind: "heard", who: name("周掌柜", "Shopkeeper Zhou"), whoId: "zhou_zhanggui", how: "unsure", via: null },
      at: null,
      marks: ["unsupported", "sourceMismatch"],
      chain: [name("周掌柜", "Shopkeeper Zhou"), name("周家伙计", "Zhou's Clerk"), null],
    },
    {
      id: "n4",
      text: name("船夫老何昨晚在家。", "Boatman He was at home last night."),
      source: { kind: "heard", who: name("老何", "Boatman He"), whoId: "old_he", how: "saw", via: null },
      at: null,
      marks: ["contradicts"],
      chain: [name("老何", "Boatman He")],
    },
    {
      id: "n5",
      text: name("船夫老何昨晚在桥下。", "Boatman He was at the river under the bridge last night."),
      source: { kind: "heard", who: name("茶馆老板娘", "Teahouse Keeper"), whoId: "cha_laoban", how: "heard", via: name("周家伙计", "Zhou's Clerk") },
      at: null,
      marks: ["contradicts", "unconfirmed"],
      chain: [name("茶馆老板娘", "Teahouse Keeper"), null],
    },
  ];
}
