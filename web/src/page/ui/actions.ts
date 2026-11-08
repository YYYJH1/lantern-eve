import { type Lang, type MessageKey, t } from "../../i18n/index.ts";
import type { Scene } from "../scene.ts";
import type { Task, TaskAction } from "../slice.ts";
import { itemInSentence, personName, placeName, thingName } from "./names.ts";

const DO_KEY: Readonly<Record<string, MessageKey>> = {
  talk: "task.do.talk",
  move: "task.do.move",
  go: "task.do.move",
  look: "task.do.look",
  listen: "task.do.listen",
  rally: "task.do.rally",
  ask: "task.do.ask",
  ask_source: "task.do.askSource",
  tell: "task.do.tell",
  entrust: "task.do.entrust",
  promise: "task.do.promise",
  speak: "task.do.speak",
  judge: "task.do.judge",
  state: "task.do.state",
};

/** The words of a request a task asks of a person with `entrust`, by the kind of request the core takes. */
const REQUEST_KEY: Readonly<Record<string, MessageKey>> = {
  material: "task.do.material",
  lend: "task.do.lend",
  lane: "task.do.lane",
  testify: "task.do.testify",
  join: "task.do.join",
  persuade: "task.do.persuade",
  convene: "task.do.convene",
};

/** The words of speaking in public, by the kind of speech. */
const SPEECH_KEY: Readonly<Record<string, MessageKey>> = {
  evidence: "task.do.evidence",
  meal: "task.do.meal",
  clarify: "task.do.clarify",
  statement: "task.do.statement",
};

/** Whether the words of a request have what they are about: the goods of a delivery or a loan, the person to be talked round. */
function requestKey(action: TaskAction): MessageKey | null {
  const key = action.request == null ? undefined : REQUEST_KEY[action.request];
  if (key === undefined) return null;
  if ((action.request === "material" || action.request === "lend") && action.item === null) return null;
  if (action.request === "persuade" && action.target == null) return null;
  return key;
}

/** What the button of a task says it does: "Talk to Granny Li", "Go to the Teahouse", "Ask Li Da to send a batch of bamboo". */
export function actionLabel(task: Task, scene: Scene | null, lang: Lang): string {
  const action = task.action;
  if (action === null) return "";
  const name = action.npc === null ? "" : personName(scene, lang, action.npc);
  if (action.verb === "entrust") {
    const key = requestKey(action);
    if (key !== null) return t(key, { name, what: action.item === null ? "" : itemInSentence(scene, lang, action.item), target: action.target == null ? "" : personName(scene, lang, action.target) });
  }
  if (action.verb === "promise" && action.kind === "keep") return t("task.do.keep", { name });
  if (action.verb === "speak" && action.kind != null) {
    const key = SPEECH_KEY[action.kind];
    if (key !== undefined) return t(key);
  }
  const key = DO_KEY[action.verb];
  if (key === undefined) return t("task.do.other");
  return t(key, {
    name,
    place: placeName(scene, lang, action.place) ?? "",
    what: action.item === null ? (placeName(scene, lang, action.place) ?? "") : thingName(scene, lang, action.item),
  });
}
