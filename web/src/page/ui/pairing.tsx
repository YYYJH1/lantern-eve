import { useEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import { RELATIONS } from "../slice.ts";
import { bare } from "./format.ts";
import { signalClass } from "./guide.tsx";
import { InkAct } from "./ink.tsx";
import { ANSWER_KEY, EXAMPLE_KEY, pairingStep, RIGHT_KEY } from "./pairing-text.ts";

/** What a line of the notebook says, without the full stop it ends in, for a sentence that quotes it. */
const quoted = (entry: NotebookEntry, lang: Lang): string => bare(pick(entry.text, lang));

/**
 * The button on a line of the notebook, which is for what the pairing waits for: before there is a claim it takes this line as the claim,
 * after it it shows this line against the claim. The claim itself says so, and a press on it takes it back.
 */
export function PairButton({ entry, play }: { entry: NotebookEntry; play: Play }) {
  const { pair } = play.flows.state;
  if (pair.b === null) {
    return (
      <InkAct seed={`claim-${entry.id}`} data-testid="note-claim" onClick={() => play.flows.claim(entry.id)}>
        {t("pairing.pickClaim")}
      </InkAct>
    );
  }
  if (pair.b === entry.id) {
    return (
      <InkAct seed={`claim-${entry.id}`} class="is-on" data-testid="note-claim" aria-pressed={true} onClick={() => play.flows.claim(entry.id)}>
        {t("pairing.claimed")}
      </InkAct>
    );
  }
  const shown = pair.a === entry.id;
  return (
    <InkAct seed={`show-${entry.id}`} class={shown ? "is-on" : ""} data-testid="note-show" aria-pressed={shown} onClick={() => play.flows.present(entry.id)}>
      {shown ? t("pairing.shown") : t("pairing.show")}
    </InkAct>
  );
}

/**
 * Shows the pairing from the head of the page of the book that holds it, or, where the page is too short for the three answers to lie whole under the head of the pairing (clear of the
 * phrase that turns the page by as much as a control that is scrolled to is kept clear of it: `scroll-padding-bottom`), from the head of the first of its parts (its title, its hint,
 * the two lines, the answers) for which they do. The page then begins at the head of a part and not in the middle of a line or a sentence, and the answers, which are what the player presses,
 * are seen from the first. Where the player has just answered (`told`) what was said of the answer lies at the foot of the pairing and is in view as well: it is the foot of the pairing that
 * has to lie whole above the foot of the page.
 */
function showFromHead(leaf: HTMLElement, section: HTMLElement, answers: HTMLElement, told: boolean): void {
  const origin = leaf.getBoundingClientRect().top + leaf.clientTop - leaf.scrollTop;
  const topOf = (el: Element): number => el.getBoundingClientRect().top - origin;
  const foot = (told ? section : answers).getBoundingClientRect().bottom - origin;
  // the parts of the pairing from its title to the answers: the two lines are the rows of a list
  const heads = Array.from(section.children)
    .flatMap((child) => (child.matches(".pairing-cards") ? Array.from(child.children) : [child]))
    .map(topOf)
    .filter((top) => top <= topOf(answers) + 1)
    .sort((a, b) => a - b);
  const room = leaf.clientHeight - (Number.parseFloat(getComputedStyle(leaf).scrollPaddingBottom) || 0);
  leaf.scrollTop = heads.find((top) => foot - top <= room) ?? topOf(answers);
}

/** Brings the pairing into view on its page of the book (`showFromHead`), and what was said of the answer where the player has just answered (`told`). */
function bringIn(section: HTMLElement | null, told: boolean): void {
  if (section === null) return;
  const leaf = section.closest<HTMLElement>(".leaf");
  const answers = section.querySelector<HTMLElement>(".answers");
  if (leaf === null || answers === null) section.scrollIntoView?.({ block: "nearest" });
  else showFromHead(leaf, section, answers, told);
}

/**
 * The notebook's pairing: take a claim, show a line against it, and say in one of three plain answers how the two stand. Each answer has
 * its small example. A wrong answer says "think again" and is not written down; "look at another pair" sends nothing. The core takes the
 * relation and its direction as ever (`judge`): the line shown is its `a`, the claim its `b`.
 */
export function Pairing({ entries, play, lang, open }: { entries: readonly NotebookEntry[]; play: Play; lang: Lang; open: boolean }) {
  const { pair } = play.flows.state;
  const section = useRef<HTMLElement>(null);
  // The tutorial lights the pair and the answer: the sheet is scrolled to it. The entries that are new scroll themselves into view as the
  // sheet opens, so this waits for the next frame, which is after they have.
  const lit = open && play.guide.signal("pairing");
  useEffect(() => {
    if (!lit) return;
    const frame = requestAnimationFrame(() => bringIn(section.current, false));
    return () => cancelAnimationFrame(frame);
  }, [lit]);
  const find = (id: string | null): NotebookEntry | undefined => (id === null ? undefined : entries.find((e) => e.id === id));
  const claim = find(pair.b);
  const shown = find(pair.a);
  const step = pairingStep({ a: shown === undefined ? null : pair.a, b: claim === undefined ? null : pair.b });
  const outcome = pair.outcome;
  const here = outcome !== null && outcome.a === pair.a && outcome.b === pair.b ? outcome : null;
  // The answers are asked, and later what came of the answer is told, over the lines of the notebook, and the player pressed on one of them, which may lie far
  // under the pairing in a window that is not tall: the pairing comes into view.
  const told = here === null ? "" : `${here.relation}-${here.ok}`;
  useEffect(() => {
    if (!open || (step !== "answer" && told === "")) return;
    const frame = requestAnimationFrame(() => bringIn(section.current, told !== ""));
    return () => cancelAnimationFrame(frame);
  }, [step, told, open]);
  const waiting = pair.waiting !== null;
  return (
    <section ref={section} class={`pairing${signalClass(play, "pairing")}`} data-sig="pairing" data-testid="pairing" data-step={step} data-waiting={waiting}>
      <h3 class="pairing-title">{t("pairing.title")}</h3>
      <p class="pairing-hint" data-testid="pairing-hint">
        {t(step === "claim" ? "pairing.step.claim" : step === "show" ? "pairing.step.show" : "pairing.step.answer")}
      </p>
      {claim === undefined ? null : (
        <ol class="pairing-cards">
          <li data-testid="pair-claim" data-id={claim.id}>
            <span class="slot">{t("pairing.claim")}</span>
            <span class="slot-text">{pick(claim.text, lang)}</span>
          </li>
          <li data-testid="pair-shown" data-id={shown?.id ?? ""}>
            <span class="slot">{t("pairing.shownLabel")}</span>
            <span class="slot-text">{shown === undefined ? t("pairing.shown.empty") : pick(shown.text, lang)}</span>
          </li>
        </ol>
      )}
      {step === "answer" ? (
        <div class="answers" role="group" aria-label={t("pairing.step.answer")} data-testid="answers">
          {RELATIONS.map((relation) => (
            <button
              key={relation}
              type="button"
              class={`answer${signalClass(play, `pair-${relation}`)}${here !== null && !here.ok && here.relation === relation ? " is-tried" : ""}`}
              data-sig={`pair-${relation}`}
              data-testid={`ans-${relation}`}
              data-tried={here !== null && !here.ok && here.relation === relation}
              disabled={waiting}
              onClick={() => play.flows.answer(relation)}
            >
              <span class="answer-name">{t(ANSWER_KEY[relation])}</span>
              <span class="answer-eg">{t(EXAMPLE_KEY[relation])}</span>
            </button>
          ))}
        </div>
      ) : null}
      {claim === undefined ? null : (
        <div class="pairing-buttons">
          <InkAct seed="pair-swap" data-testid="pair-swap" onClick={() => play.flows.clear()}>
            {t("pairing.swap")}
          </InkAct>
        </div>
      )}
      {here === null ? null : (
        <p class={`pairing-outcome ${here.ok ? "is-ok" : "is-no"}`} data-testid="pair-outcome" data-ok={here.ok} data-reason={here.reason ?? ""} role="status">
          {here.ok && claim !== undefined && shown !== undefined
            ? t(RIGHT_KEY[here.relation], { a: quoted(shown, lang), b: quoted(claim, lang) })
            : here.reason === "not_shown"
              ? t("pairing.wrong")
              : t(refusalKey("judge", here.reason ?? "unknown"), { reason: here.reason ?? "" })}
        </p>
      )}
    </section>
  );
}
