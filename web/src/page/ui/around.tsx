import { useCallback, useEffect, useState } from "preact/hooks";
import { type Lang, t } from "../../i18n/index.ts";
import { speechOffers } from "../flows.ts";
import type { ViewFrame } from "../frame.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { Cost } from "./common.tsx";
import { signalClass } from "./guide.tsx";
import { lookGroups, otherGroups, Picker, type PickerGroup, type PickerOption } from "./picker.tsx";
import { Underline } from "./ink.tsx";

/** What the player can do in the town outside a talk. Each is shown when the frame offers it, and left out when it does not. */
const AROUND = ["listen", "look", "rally", "speak"] as const;
type Around = (typeof AROUND)[number];

const LABEL = { listen: "verb.listen", look: "verb.look", rally: "verb.rally", speak: "verb.speak" } as const;
const HINT = { listen: "verb.listen.hint", look: "verb.look.hint", rally: "verb.rally.hint", speak: "verb.speak.hint" } as const;
const PICKER_TITLE = { look: "picker.look.title", speak: "picker.speak.title" } as const;

/** Which of the acts outside a talk the frame offers now. */
export function aroundVerbs(play: Play, enabled: ReadonlySet<string>): readonly Around[] {
  if (!play.playing || play.state.talk !== null) return [];
  return AROUND.filter((verb) => (verb === "speak" ? enabled.has("speak") || enabled.has("speak_publicly") : enabled.has(verb)));
}

export interface AroundProps {
  lang: Lang;
  scene: Scene | null;
  frame: ViewFrame | null;
  play: Play;
  enabled: ReadonlySet<string>;
  entries: readonly NotebookEntry[];
}

/** The few things the manager can do where they stand: listen in, look closely, call for helpers, speak up. */
export function AroundYou({ lang, scene, frame, play, enabled, entries }: AroundProps) {
  const [choosing, setChoosing] = useState<"look" | "speak" | null>(null);
  /** The kind of speech a task asked for (`evidence` or `meal`): the list of what to say is cut down to it. */
  const [only, setOnly] = useState<string | null>(null);
  const close = useCallback(() => setChoosing(null), []);
  const on = (verb: Around): boolean => aroundVerbs(play, enabled).includes(verb);
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

  const shown = AROUND.filter(on);
  if (shown.length === 0) return null;

  const press = (verb: Around): void => {
    if (verb === "look" || verb === "speak") {
      // The list the player opens themselves has all of it.
      setOnly(null);
      setChoosing((now) => (now === verb ? null : verb));
      return;
    }
    setChoosing(null);
    if (verb === "listen") play.listen();
    else play.rally();
  };

  const groups = (verb: "look" | "speak"): PickerGroup[] => {
    if (verb === "look") return lookGroups(scene, frame?.player ?? null, lang);
    return otherGroups(verb, frame?.player ?? null, entries, lang).map((group) => (group.id === "offered" ? { ...group, options: speechOffers(group.options, only) } : group));
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
        {shown.map((verb) => (
          <button
            key={verb}
            type="button"
            class={`verb ink-act${choosing === verb ? " is-open" : ""}${signalClass(play, `verb-${verb}`)}`}
            data-sig={`verb-${verb}`}
            data-testid={`verb-${verb}`}
            aria-haspopup={verb === "look" || verb === "speak" ? "dialog" : undefined}
            aria-expanded={verb === "look" || verb === "speak" ? choosing === verb : undefined}
            title={t(HINT[verb])}
            onClick={() => press(verb)}
          >
            <span>{t(LABEL[verb])}</span>
            {verb === "speak" ? <Cost minutes={frame?.player?.costs?.speak ?? null} id="speak" /> : null}
            <Underline seed={verb} />
          </button>
        ))}
      </div>
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
