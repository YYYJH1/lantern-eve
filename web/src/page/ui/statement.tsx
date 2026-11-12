import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import { refusalKey } from "../deals.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import type { StatementCard, StatementOption, StatementPartCard } from "../slice.ts";
import { elderText, truthLastText } from "./board-text.ts";
import { readPref, writePref } from "../storage.ts";
import { count } from "./paper-text.ts";
import { chosenOption, marksOf, partName, partsOf, stateButton, wrongLine } from "./statement-text.ts";
import { InkAct, Struck, Tally, Underline } from "./ink.tsx";

/**
 * One thing that can be said about a part: a line of words to choose, with the notes for it counted in the strokes of 正 and the notes against it
 * as a struck stroke and a number. The line that is chosen has the manager's own stroke of rouge under it. Under it the notes behind the counts, on demand.
 */
function OptionRow({ part, option, entries, lang, play, onUse }: { part: StatementPartCard; option: StatementOption; entries: readonly NotebookEntry[]; lang: Lang; play: Play; onUse: () => void }) {
  const marks = marksOf(option);
  const chosen = part.chosen === option.id;
  // Only the notes the notebook has can be shown: an id it does not know is left out.
  const behind = option.entries.flatMap((id) => entries.find((e) => e.id === id) ?? []);
  const counts = t("board.statement.counts", { support: count(lang, marks.support), against: count(lang, marks.against) });
  return (
    <li class={`stmt-option${chosen ? " is-chosen" : ""}`} data-testid="statement-option" data-id={option.id} data-chosen={chosen} data-support={marks.support} data-against={marks.against}>
      <button
        type="button"
        class="stmt-pick"
        data-testid="statement-pick"
        aria-pressed={chosen}
        onClick={() => {
          onUse();
          if (chosen) play.flows.clearPart(part.part);
          else play.flows.choose(part.part, option.id);
        }}
      >
        <span class="stmt-text">
          <span class="stmt-words">{pick(option.text, lang)}</span>
          {chosen ? <Underline seed={option.id} class="stmt-rouge" /> : null}
        </span>
        <span class="stmt-marks" role="img" aria-label={counts} title={counts} data-testid="statement-marks">
          <span class={`stmt-for${marks.support === 0 ? " is-zero" : ""}`} data-testid="statement-for" data-n={marks.support}>
            <Tally n={marks.support} />
          </span>
          <span class={`stmt-against${marks.against === 0 ? " is-zero" : ""}`} data-testid="statement-against" data-n={marks.against}>
            <Struck n={marks.against} />
          </span>
        </span>
        {chosen ? (
          <span class="stmt-stamp" data-testid="statement-chosen">
            {t("statement.chosen")}
          </span>
        ) : null}
      </button>
      {behind.length === 0 ? null : (
        <details class="stmt-notes" data-testid="statement-notes" onToggle={onUse}>
          <summary>{t("statement.notes", { n: count(lang, behind.length) })}</summary>
          <ul class="stmt-entries">
            {behind.map((entry) => (
              <li key={entry.id}>
                <button type="button" class="stmt-entry" data-testid="statement-entry" data-id={entry.id} title={t("statement.notes.open")} onClick={() => play.flows.pointAt(entry.id)}>
                  {pick(entry.text, lang)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** One of the three parts: its name, a way to take the choice back, a line where nothing held bears on it, and its options. */
function PartView({ part, entries, lang, play, onUse }: { part: StatementPartCard; entries: readonly NotebookEntry[]; lang: Lang; play: Play; onUse: () => void }) {
  const name = partName(part, lang);
  const filled = chosenOption(part);
  return (
    <section class="stmt-part" data-testid="statement-part" data-part={part.part} data-chosen={part.chosen ?? ""} data-gap={part.gap} aria-label={name}>
      <header class="stmt-part-head">
        {/* One line of the statement with a blank in it: the question, and what was chosen to fill it. */}
        <h4 class="stmt-part-title" data-testid="statement-part-title">
          <span class="stmt-ask">{name}</span>
          <span class="stmt-colon">{lang === "zh" ? "：" : ": "}</span>
          <span class={`stmt-blank${filled === undefined ? "" : " is-filled"}`} data-testid="statement-blank" data-filled={filled !== undefined}>
            {filled === undefined ? "" : pick(filled.text, lang)}
          </span>
        </h4>
        {part.chosen === null ? null : (
          <InkAct seed={`clear-${part.part}`} class="stmt-clear" data-testid="statement-clear" aria-label={t("statement.clear.part", { part: name })} onClick={() => play.flows.clearPart(part.part)}>
            {t("statement.clear")}
          </InkAct>
        )}
      </header>
      {part.gap ? (
        <p class="stmt-gap" data-testid="statement-gap">
          {t("statement.gap")}
        </p>
      ) : null}
      {part.options.length === 0 ? (
        part.gap ? null : (
          <p class="stmt-gap" data-testid="statement-no-options">
            {t("statement.noOptions")}
          </p>
        )
      ) : (
        <ul class="stmt-options">
          {part.options.map((option) => (
            <OptionRow key={option.id} part={part} option={option} entries={entries} lang={lang} play={play} onUse={onUse} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface BarProps {
  card: StatementCard;
  lang: Lang;
  play: Play;
}

/** The button that makes the full statement, what is said under it when it cannot be pressed, and the question that comes first when it can. */
function StateBar({ card, lang, play }: BarProps) {
  const flow = play.flows.state.statement;
  const waiting = flow.waiting !== null;
  const button = stateButton(card, waiting, lang);
  const notYet = useRef<HTMLButtonElement>(null);
  // The question takes the place of the button, so the keyboard goes to the safe answer.
  useEffect(() => {
    if (flow.confirming) notYet.current?.focus();
  }, [flow.confirming]);
  return (
    <div class="stmt-state" data-testid="statement-bar">
      {flow.confirming ? (
        <div class="stmt-confirm" role="group" aria-label={t("statement.confirm.title")} data-testid="statement-confirm-box">
          <h4 class="stmt-confirm-title">{t("statement.confirm.title")}</h4>
          <ul class="stmt-recap" data-testid="statement-recap">
            {partsOf(card).map((part) => (
              <li key={part.part} data-part={part.part} data-option={part.chosen ?? ""}>
                {t("statement.confirm.line", { part: partName(part, lang), option: pick(chosenOption(part)?.text, lang) || t("hud.none") })}
              </li>
            ))}
          </ul>
          <p class="stmt-confirm-body">{t("statement.confirm.body")}</p>
          <div class="stmt-buttons">
            <button type="button" class="ink-frame" data-testid="statement-confirm" onClick={() => play.flows.makeStatement()}>
              <span>{t("statement.confirm.yes")}</span>
            </button>
            <button type="button" class="ink-act" ref={notYet} data-testid="statement-cancel" onClick={() => play.flows.cancelStatement()}>
              {t("statement.confirm.no")}
              <Underline seed="statement-cancel" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" class="ink-frame" data-testid="statement-state" data-state={button.state} disabled={!button.enabled} aria-describedby={button.why === null ? undefined : "statement-why"} onClick={() => play.flows.askToState()}>
            <span>{waiting ? t("statement.sending") : t("statement.state")}</span>
          </button>
          {button.why === null ? null : (
            <p class="stmt-why" id="statement-why" data-testid="statement-why" data-state={button.state}>
              {button.why}
            </p>
          )}
        </>
      )}
      {flow.refused === null ? null : (
        <p class="stmt-no" role="status" data-testid="statement-no" data-reason={flow.refused.reason} data-type={flow.refused.type}>
          {t(refusalKey(flow.refused.type, flow.refused.reason), { reason: flow.refused.reason })}
        </p>
      )}
    </div>
  );
}

/** The statement made last: when and where, how many were there, the parts that did not hold and why. */
function LastView({ card, scene, lang }: { card: StatementCard; scene: Scene | null; lang: Lang }) {
  const last = card.last;
  if (last === null) return null;
  const elder = elderText(last);
  const wrong = wrongLine(card, last.wrong, lang);
  return (
    <div class="stmt-last" data-testid="statement-last" data-told={last.told} data-day={last.day} data-wrong={last.wrong.join(" ")}>
      <p class="stmt-last-title">{t("board.truth.last")}</p>
      <p data-testid="statement-last-line">
        {truthLastText(last, scene, lang)}
        {elder === null ? null : `${lang === "zh" ? "，" : ", "}${elder}`}
      </p>
      {wrong === null ? null : (
        <p class="stmt-wrong" data-testid="statement-wrong">
          {wrong}
        </p>
      )}
      {last.why === null ? null : (
        <p class="stmt-reason" data-testid="statement-reason">
          {t("statement.last.why", { why: pick(last.why, lang) })}
        </p>
      )}
    </div>
  );
}

export interface StatementCardProps {
  card: StatementCard;
  entries: readonly NotebookEntry[];
  scene: Scene | null;
  lang: Lang;
  play: Play;
  /** The game minutes of speaking in public (`player.costs.speak`), written on the button that makes the statement. */
}

/**
 * The statement card: the three parts, cause, course and how the rumour began, side by side where there is room and one under the other
 * where there is not. Each lists what could be said, with the notes for and against it, and the manager chooses one; under them the
 * button that makes the full statement, which can be pressed when the core says so, and the statement made last.
 */
export function StatementCardView({ card, entries, scene, lang, play }: StatementCardProps) {
  // The line that says what the strokes count is there until the player has used the card once.
  const [legend, setLegend] = useState(() => readPref("statement-legend") !== "seen");
  const used = (): void => {
    if (!legend) return;
    setLegend(false);
    writePref("statement-legend", "seen");
  };
  return (
    <section class="statement" data-testid="statement-card" data-can-state={card.canState} data-used={card.usedToday} aria-label={t("statement.title")}>
      <div class="stmt-parts">
        {partsOf(card).map((part) => (
          <PartView key={part.part} part={part} entries={entries} lang={lang} play={play} onUse={used} />
        ))}
      </div>
      <StateBar card={card} lang={lang} play={play} />
      <LastView card={card} scene={scene} lang={lang} />
      {legend ? (
        <p class="stmt-legend" data-testid="statement-intro" title={t("statement.intro")}>
          {t("statement.legend")}
        </p>
      ) : null}
    </section>
  );
}
