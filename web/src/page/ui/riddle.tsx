import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { riddleOf, riddleWords, RIDDLES } from "../eggs.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { dayLabel } from "./format.ts";
import { CloseCorner, InkAct, Tick } from "./ink.tsx";

/** The person whose lantern it is, and whose line the slip says after a guess. */
const MAKER = "zhadeng_shifu";

/** An answer as it is set on its own line: English answers are written to follow "It was" and start with a capital here. */
const alone = (lang: Lang, answer: string): string => (lang === "en" ? `${answer.charAt(0).toUpperCase()}${answer.slice(1)}` : answer);

/**
 * The slip of the riddle lantern at the door of the workshop: the riddle of the game day with three answers to pick from. A day has one guess. A right one is
 * answered with the line of the lantern maker, a wrong one kindly, with the answer and the word that a new riddle comes tomorrow (not on the last day). Nothing is
 * lost either way. The world stands still while the slip is up, and it is put away with its corner, its word and Escape.
 */
export function RiddleSheet({ play, scene, lang }: { play: Play; scene: Scene | null; lang: Lang }) {
  const eggs = play.eggs;
  const open = eggs.riddleOpen;
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    play.hold.set("riddle", open);
    return () => play.hold.set("riddle", false);
  }, [play, open]);
  useLayoutEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      eggs.closeRiddle();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, eggs]);
  if (!open) return null;
  const day = eggs.day;
  const riddle = riddleOf(day);
  const words = riddleWords(riddle, lang);
  const picked = eggs.riddles.pickOf(day);
  const right = eggs.riddles.rightOn(day);
  const maker = pick(scene?.cast.find((p) => p.id === MAKER)?.name, lang);
  const last = riddle === RIDDLES - 1;
  return (
    <section ref={sheet} class="sheet paper-slip sheet-riddle" data-testid="riddle-sheet" data-day={day} data-riddle={riddle + 1} data-state={picked === null ? "open" : right ? "right" : "wrong"} role="dialog" aria-label={t("egg.riddle.title")}>
      <CloseCorner label={t("egg.riddle.close")} testid="riddle-x" onClose={() => eggs.closeRiddle()} />
      <header class="sheet-head">
        <h2 class="sheet-title">{t("egg.riddle.title")}</h2>
        <span class="riddle-day" data-testid="riddle-day">
          {dayLabel(lang, day)}
        </span>
      </header>
      <div class="sheet-scroll">
        <p class="riddle-text" data-testid="riddle-text" lang={lang === "zh" ? "zh-CN" : "en"}>
          {words.question}
        </p>
        <ul class="riddle-answers" data-testid="riddle-answers">
          {words.answers.map((answer, i) => (
            <li key={i} class={picked === i ? "is-picked" : ""} data-picked={picked === i}>
              <InkAct seed={`riddle-${riddle}-${i}`} data-testid={`riddle-answer-${i}`} data-sheet-focus={i === 0 && picked === null ? true : undefined} disabled={picked !== null} aria-pressed={picked === i} onClick={() => eggs.guess(i)}>
                {alone(lang, answer)}
              </InkAct>
              {picked === i && right ? <Tick seed={`riddle-tick-${riddle}`} /> : null}
            </li>
          ))}
        </ul>
        {picked === null ? (
          <p class="riddle-hint" data-testid="riddle-hint">
            {t("egg.riddle.hint")}
          </p>
        ) : (
          <p class="riddle-said" data-testid="riddle-said">
            {maker === "" ? null : <strong class="riddle-maker">{maker}</strong>}
            <span data-testid="riddle-line">{right ? t("egg.riddle.right") : t(last ? "egg.riddle.wrong.last" : "egg.riddle.wrong", { answer: words.right })}</span>
          </p>
        )}
      </div>
      <div class="sheet-foot">
        <InkAct seed="riddle-close" data-testid="riddle-close" data-sheet-focus={picked === null ? undefined : true} onClick={() => eggs.closeRiddle()}>
          {t("egg.riddle.close")}
        </InkAct>
      </div>
    </section>
  );
}
