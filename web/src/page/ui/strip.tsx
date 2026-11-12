import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { MeetingNote, useFirstMeeting } from "./meeting.tsx";
import { TalkBadge } from "./stage.tsx";

export interface TalkStripProps {
  lang: Lang;
  scene: Scene | null;
  frame: ViewFrame | null;
  play: Play;
  tick: number;
  /** The person picked on the map, who is not the partner of a talk until the player talks to them. */
  selectedId: string | null;
  /** The note of the picked person, which the strip lays beside itself where there is room and above itself where there is not. */
  person: ComponentChildren;
  /** The talk (`TalkArea`): what has been said, what can be said, and the lists that open above the strip. */
  children?: ComponentChildren;
}

function nameOf(scene: Scene | null, id: string, lang: Lang): string {
  const person = scene?.cast.find((p) => p.id === id);
  return person === undefined ? id : pick(person.name, lang);
}

/**
 * The line of the page. In a talk it is the strip's: what the person just said, or that they are listening. Out of one it is what somebody
 * just said, the person picked first, and nothing when nobody is speaking: the next step is on the slip, and who is picked is on the note of
 * the person.
 */
export function currentLine(props: Omit<TalkStripProps, "person" | "children">, partner: string | null): string | null {
  const { scene, frame, tick, selectedId, lang } = props;
  // What the page has somebody say over the map (a verse, a rumour) is a line of the town for a reader who cannot see it, outside a talk.
  const live = [...(frame?.bubbles ?? []), ...(partner === null ? props.play.eggs.lines : [])].filter((b) => tick < b.until);
  if (partner !== null) {
    const name = nameOf(scene, partner, lang);
    const mine = [...live].reverse().find((b) => b.npc === partner);
    return mine === undefined ? t("talk.prompt", { name }) : t("dialogue.says", { name, text: pick(mine.text, lang) });
  }
  const mine = selectedId === null ? undefined : [...live].reverse().find((b) => b.npc === selectedId);
  const said = mine ?? live[live.length - 1];
  return said === undefined ? null : t("dialogue.says", { name: nameOf(scene, said.npc, lang), text: pick(said.text, lang) });
}

/**
 * The talk as a strip of paper at the bottom of the map: the seal of the surname of the person talked to, what has been said, and the
 * things that can be said as words with a stroke under them. It is there while the player talks. The note of a picked person lies beside it.
 */
export function TalkStrip(props: TalkStripProps) {
  const { lang, scene, play, person, children, frame } = props;
  const talk = play.state.talk;
  const partner = talk?.npc ?? null;
  // Nothing has been said yet: the strip has the line that says the person is listening, and not the log.
  const empty = talk !== null && talk.lines.length === 0 && talk.opening === undefined;
  // A reply that is slow to come: the person is thinking, and the line says so in place of what they said before.
  const thinking = partner !== null && play.state.thinking?.npc === partner;
  const who = partner === null ? undefined : scene?.cast.find((p) => p.id === partner);
  const talking = partner !== null;
  // The first time the player talks with somebody, who they are is written beside the seal.
  const met = useFirstMeeting(frame, frame?.player?.talk?.npc ?? null).meeting;
  // The strip is there while the player talks.
  const open = talking;
  const line = thinking && partner !== null ? t("talk.thinking", { name: nameOf(scene, partner, lang) }) : currentLine(props, partner);
  // The slips above the strip are as tall as the room over it: where the strip is tall, they are short and scroll.
  const dock = useRef<HTMLDivElement>(null);
  const measure = (): void => {
    const element = dock.current;
    const strip = element?.querySelector<HTMLElement>(".talk-strip") ?? null;
    const stage = element?.offsetParent ?? null;
    if (element === null || strip === null || stage === null) return;
    const top = strip.getBoundingClientRect().top;
    // The lists stop under the placard, the clock and the slip (its note too, when it is open).
    const bottomOf = (selector: string): number => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0;
    const ceiling = Math.max(stage.getBoundingClientRect().top, bottomOf(".placard") + 8, bottomOf(".slip") + 8, bottomOf('[data-testid="hud-time"]') + 8);
    element.style.setProperty("--slips-room", `${Math.max(120, Math.floor(top - ceiling - 24))}px`);
    // The strip of the acts around the manager lies where the note of a picked person does: the note stands over it.
    const side = document.querySelector<HTMLElement>("aside.side");
    element.style.setProperty("--side-h", `${side === null || side.offsetParent === null ? 0 : Math.ceil(side.getBoundingClientRect().height) + 12}px`);
  };
  useLayoutEffect(measure);
  // The slip opens and shuts its note without the page being drawn again: the lists are measured again when it changes its size.
  useEffect(() => {
    const slip = document.querySelector(".slip");
    if (slip === null) return;
    const watch = new ResizeObserver(measure);
    watch.observe(slip);
    return () => watch.disconnect();
  }, []);
  return (
    <div class="talk-dock" data-testid="talk-dock" data-open={open} ref={dock}>
      {person}
      <section class={`talk-strip${open ? " paper-slip" : ""}`} data-testid="talk-strip" data-open={open} data-talking={talking} data-empty={empty} data-npc={partner ?? ""} aria-label={partner === null ? undefined : t("talk.with", { name: nameOf(scene, partner, lang) })}>
        {talking ? (
          <>
            <span class="surname-seal" data-family={who?.family ?? ""} data-testid="surname-seal" aria-hidden="true" lang={lang === "zh" ? "zh-CN" : "en"}>
              {who?.token[lang] ?? "?"}
            </span>
            <TalkBadge play={play} scene={scene} lang={lang} />
            {met !== null && who !== undefined && met === who.id ? <MeetingNote person={who} lang={lang} /> : null}
            <p class="dialogue-line" data-testid="dialogue-line" data-thinking={thinking} aria-live="polite">
              {line}
            </p>
          </>
        ) : null}
        {children}
      </section>
    </div>
  );
}
