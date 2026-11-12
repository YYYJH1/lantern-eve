import { useCallback, useEffect, useState } from "preact/hooks";
import { type Lang, t } from "../../i18n/index.ts";
import { speechOffers } from "../flows.ts";
import type { ViewFrame } from "../frame.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { type OffReason, readVerbsOff } from "../hud.ts";
import { signalClass } from "./guide.tsx";
import { actState, HINT, LABEL, MAP_ACTS, type MapAct, offWords } from "./map-acts.ts";
import { lookGroups, otherGroups, Picker, type PickerGroup, type PickerOption } from "./picker.tsx";
import { Underline } from "./ink.tsx";

/** Which of the acts outside a talk the frame offers now. */
export function aroundVerbs(play: Play, enabled: ReadonlySet<string>): readonly MapAct[] {
  if (!play.playing || play.state.talk !== null) return [];
  return MAP_ACTS.filter((act) => actState(act, enabled, new Map()).on);
}

const PICKER_TITLE = { look: "picker.look.title", speak: "picker.speak.title" } as const;

export interface AroundProps {
  lang: Lang;
  scene: Scene | null;
  frame: ViewFrame | null;
  play: Play;
  enabled: ReadonlySet<string>;
}

/** How long the reason an act cannot be done stays under the strip, in milliseconds. */
const WHY_MS = 4200;

/**
 * The few things the manager can do where they stand: listen in, look closely, call for helpers, speak up. All four are there from the start; one
 * that cannot be done now is grey, and its reason (the core's, `hud.verbs_off`) is its title and is said under the strip when it is pressed.
 * A frame that gives no reasons has only the acts it offers. No act shows its minutes.
 */
export function AroundYou({ lang, scene, frame, play, enabled }: AroundProps) {
  const [choosing, setChoosing] = useState<"look" | "speak" | null>(null);
  /** The kind of speech a task asked for (`evidence` or `meal`): the list of what to say is cut down to it. */
  const [only, setOnly] = useState<string | null>(null);
  /** The reason an act that was pressed cannot be done, for a few seconds. */
  const [why, setWhy] = useState<{ act: MapAct; reason: OffReason } | null>(null);
  const close = useCallback(() => setChoosing(null), []);
  const off = readVerbsOff(frame?.hud ?? {});
  const free = play.playing && play.state.talk === null;
  const states = new Map(MAP_ACTS.map((act) => [act, actState(act, enabled, off)] as const));
  const on = (act: MapAct): boolean => free && states.get(act)?.on === true;
  // A task's button asked to speak up: open the list when the player may, with the kind of speech it asked for. The wish is kept for a
  // little while (see `Flows.afterFrame`), so a player who is not where they may speak yet gets the list when they are.
  const wish = play.flows.state.suggest?.verb === "speak" ? "speak" : null;
  const may = wish !== null && on("speak");
  useEffect(() => {
    if (!may) return;
    setOnly(play.flows.state.suggest?.kind ?? null);
    play.flows.takeSuggestion(null);
    setChoosing("speak");
  }, [wish, may]);
  const stillOn = choosing === null || on(choosing);
  useEffect(() => {
    if (!stillOn) setChoosing(null);
  }, [stillOn]);
  // The reason is said for a few seconds, and goes when the act can be done after all.
  useEffect(() => {
    if (why === null) return;
    const timer = setTimeout(() => setWhy(null), WHY_MS);
    return () => clearTimeout(timer);
  }, [why]);
  useEffect(() => {
    if (why !== null && on(why.act)) setWhy(null);
  }, [why !== null && on(why.act)]);

  // An act is shown if the frame offers it, or says why it does not.
  const shown = free ? MAP_ACTS.filter((act) => states.get(act)?.on === true || states.get(act)?.reason !== null) : [];
  if (shown.length === 0) return null;

  const press = (act: MapAct): void => {
    const state = states.get(act);
    if (state?.on !== true) {
      setChoosing(null);
      if (state?.reason != null) setWhy({ act, reason: state.reason });
      return;
    }
    setWhy(null);
    if (act === "look" || act === "speak") {
      // The list the player opens themselves has all of it.
      setOnly(null);
      setChoosing((now) => (now === act ? null : act));
      return;
    }
    setChoosing(null);
    if (act === "listen") play.listen();
    else play.rally();
  };

  const groups = (verb: "look" | "speak"): PickerGroup[] => {
    if (verb === "look") return lookGroups(scene, frame?.player ?? null, lang);
    return otherGroups(verb, frame?.player ?? null, lang).map((group) => (group.id === "offered" ? { ...group, options: speechOffers(group.options, only) } : group));
  };

  const choose = (verb: "look" | "speak", option: PickerOption, group: PickerGroup): void => {
    setChoosing(null);
    if (verb === "look") play.look(option.id);
    // The full statement is made on the statement card, where the manager is asked first and sees the three choices.
    else if (option.body?.kind === "statement") play.flows.onCard?.();
    else if (option.body != null) play.other("speak", option.body, option.name);
    else play.other("speak", group.id === "notebook" ? { entry: option.id } : { choice: option.id }, option.name);
  };

  return (
    <div class="around" data-testid="around">
      <div class="verbs" role="group" aria-label={t("dialogue.around")}>
        {shown.map((act) => {
          const state = states.get(act);
          const grey = state?.on !== true;
          return (
            <button
              key={act}
              type="button"
              class={`verb ink-act${choosing === act ? " is-open" : ""}${grey ? " is-off" : ""}${signalClass(play, `verb-${act}`)}`}
              data-sig={`verb-${act}`}
              data-testid={`verb-${act}`}
              data-off={state?.reason ?? ""}
              aria-disabled={grey}
              aria-haspopup={!grey && (act === "look" || act === "speak") ? "dialog" : undefined}
              aria-expanded={!grey && (act === "look" || act === "speak") ? choosing === act : undefined}
              title={grey && state?.reason != null ? offWords(act, state.reason) : t(HINT[act])}
              onClick={() => press(act)}
            >
              <span>{t(LABEL[act])}</span>
              <Underline seed={act} />
            </button>
          );
        })}
      </div>
      {why === null ? null : (
        <p class="around-why" role="status" data-testid="around-why" data-act={why.act} data-reason={why.reason}>
          {offWords(why.act, why.reason)}
        </p>
      )}
      {choosing === null ? null : (
        <div class="slips">
          <Picker
            inline
            testId={`picker-${choosing}`}
            title={t(PICKER_TITLE[choosing])}
            groups={groups(choosing)}
            empty={choosing === "look" ? t("picker.look.empty") : t("picker.other.empty")}
            onPick={(option, group) => choose(choosing, option, group)}
            onClose={close}
          />
        </div>
      )}
    </div>
  );
}
