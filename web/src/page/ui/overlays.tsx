import { useLayoutEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Scene } from "../scene.ts";
import { changed, type Clarified, type Gazette, type Hearer, type Night, type PaperTask, type RecapLine, type Stance, type StatementCard, type StatementLast } from "../slice.ts";
import { elderText, truthLastText } from "./board-text.ts";
import { fill } from "./fill.tsx";
import { personName } from "./common.tsx";
import { dayLabel } from "./format.ts";
import { placeName } from "./names.ts";
import { count, endsInStop, marks } from "./paper-text.ts";
import { whenWhere } from "./slip-text.ts";
import { wrongLine } from "./statement-text.ts";
import { CloseCorner, InkAct, Stamp } from "./ink.tsx";

/** Takes the keyboard to the sheet when it opens, and puts the sheet away with Escape. */
function useSheetKeys(sheet: { current: HTMLElement | null }, onClose: () => void): void {
  // Set up before the sheet is painted, so that a key pressed the moment it opens is heard.
  useLayoutEffect(() => {
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, onClose]);
}

/** What a person thinks of the accusation, in the word for it. A stand the page cannot read is a dash. */
function StanceWord({ stance, which }: { stance: Stance | null; which: "before" | "after" }) {
  if (stance === null) {
    return (
      <span class="tone tone-none" data-testid={`stance-${which}`} data-stance="">
        {t("hud.none")}
      </span>
    );
  }
  return (
    <span class={`tone tone-${stance}`} data-testid={`stance-${which}`} data-stance={stance}>
      {t(`tone.${stance}`)}
    </span>
  );
}

function Hearer({ hearer, scene, lang }: { hearer: Hearer; scene: Scene | null; lang: Lang }) {
  const moved = changed(hearer);
  return (
    <li class="hearer" data-testid="hearer" data-npc={hearer.npc} data-before={hearer.before ?? ""} data-after={hearer.after ?? ""} data-changed={moved}>
      <p class="hearer-line">
        <strong class="hearer-name">{personName(scene, lang, hearer.npc)}</strong>
        <span class="hearer-change" data-testid="hearer-change">
          {moved
            ? fill(t("hearer.changed"), { before: <StanceWord stance={hearer.before} which="before" />, after: <StanceWord stance={hearer.after} which="after" /> })
            : fill(t("hearer.still"), { stance: <StanceWord stance={hearer.before} which="before" /> })}
        </span>
      </p>
      {hearer.reason === null ? null : (
        <p class="hearer-reason" data-testid="hearer-reason">
          {pick(hearer.reason, lang)}
        </p>
      )}
    </li>
  );
}

/** What the manager's full statement did, when the panel shows one: the card for the names of the parts, and the statement as the frame has it. */
export interface StatedVerdict {
  card: StatementCard | null;
  last: StatementLast | null;
}

export interface ClarifyViewProps {
  clarified: Clarified;
  entries: readonly NotebookEntry[];
  scene: Scene | null;
  lang: Lang;
  onClose: () => void;
  /** Given for the full statement of the card: the panel is the same, with the verdict above the people. */
  statement?: StatedVerdict;
}

/** The verdict of a full statement, above the people: whether it carried, the parts that did not hold, why in the core's words, and who was there. */
function Verdict({ verdict, scene, lang }: { verdict: StatedVerdict; scene: Scene | null; lang: Lang }) {
  const last = verdict.last;
  if (last === null) return null;
  const wrong = wrongLine(verdict.card, last.wrong, lang);
  const elder = elderText(last);
  return (
    <div class="stated-verdict" data-testid="stated-verdict" data-told={last.told} data-wrong={last.wrong.join(" ")}>
      <p class={`stated-result ${last.told ? "is-told" : "is-not"}`} data-testid="stated-result">
        {t(last.told ? "stated.told" : "stated.notTold")}
      </p>
      {last.told ? <Stamp word="done" class="stated-stamp" /> : null}
      {wrong === null ? null : (
        <p class="stated-wrong" data-testid="stated-wrong">
          {wrong}
        </p>
      )}
      {last.why === null ? null : (
        <p class="stated-why" data-testid="stated-why">
          {t("statement.last.why", { why: pick(last.why, lang) })}
        </p>
      )}
      <p class="stated-line" data-testid="stated-line" data-named={last.named} data-accepted={last.accepted} data-percent={last.percent} data-elder={last.elder ?? ""}>
        {truthLastText(last, scene, lang)}
        {elder === null ? null : `${lang === "zh" ? "，" : ", "}${elder}`}
      </p>
    </div>
  );
}

/**
 * What the people who were there made of it, one by one: who changed their stand, and the reason they can give in public. The same
 * panel shows the full statement of the card, with whether it carried, the parts that did not hold and why above the people.
 */
export function ClarifyView({ clarified, entries, scene, lang, onClose, statement }: ClarifyViewProps) {
  const sheet = useRef<HTMLElement>(null);
  useSheetKeys(sheet, onClose);
  const claim = clarified.claim === null ? undefined : entries.find((e) => e.id === clarified.claim);
  const moved = clarified.audience.filter(changed).length;
  const title = t(statement === undefined ? "clarify.title" : "stated.title");
  return (
    <section ref={sheet} class={`sheet paper-slip sheet-clarify${statement === undefined ? "" : " sheet-stated"}`} data-testid="clarify" data-kind={statement === undefined ? "clarify" : "statement"} data-key={clarified.key} role="dialog" aria-label={title}>
      <CloseCorner label={t("menu.close")} testid="clarify-close" onClose={onClose} />
      <header class="sheet-head">
        <h2 class="sheet-title">{title}</h2>
      </header>
      <div class="sheet-scroll">
        {statement === undefined ? null : <Verdict verdict={statement} scene={scene} lang={lang} />}
        {claim === undefined ? null : (
          <p class="clarify-claim" data-testid="clarify-claim">
            {t("clarify.claim", { claim: pick(claim.text, lang) })}
          </p>
        )}
        {clarified.audience.length === 0 ? (
          statement === undefined ? (
            <p class="clarify-empty" data-testid="clarify-empty">
              {t("clarify.empty")}
            </p>
          ) : null
        ) : (
          <>
            {statement === undefined ? null : <h3 class="stated-who">{t("stated.who")}</h3>}
            <ol class="hearers" data-testid="hearers">
              {clarified.audience.map((hearer) => (
                <Hearer key={hearer.npc} hearer={hearer} scene={scene} lang={lang} />
              ))}
            </ol>
            <p class="clarify-sum" data-testid="clarify-sum">
              {t("clarify.sum", { changed: count(lang, moved), n: count(lang, clarified.audience.length) })}
            </p>
          </>
        )}
        <p class="clarify-only">{t("clarify.only")}</p>
      </div>
      <div class="sheet-foot">
        <InkAct seed="clarify" data-testid="clarify-done" data-sheet-focus onClick={onClose}>
          {t("sheet.done")}
        </InkAct>
      </div>
    </section>
  );
}

export interface RecapCardProps {
  lines: readonly RecapLine[];
  lang: Lang;
  onClose: () => void;
  /** The line that ends the card, what is to be done today (`todayLine`). Null where the frame has no task to name. */
  today?: string | null;
}

/** The morning card: at most three lines about what the manager did yesterday and what came of it, and one about today. */
export function RecapCard({ lines, lang, onClose, today = null }: RecapCardProps) {
  const sheet = useRef<HTMLElement>(null);
  useSheetKeys(sheet, onClose);
  return (
    <section ref={sheet} class="sheet paper-slip sheet-recap" data-testid="recap" role="dialog" aria-label={t("recap.title")}>
      <CloseCorner label={t("menu.close")} testid="recap-close" onClose={onClose} />
      <header class="sheet-head">
        <h2 class="sheet-title">{t("recap.title")}</h2>
      </header>
      <div class="sheet-scroll">
        <ol class="recap-lines" data-testid="recap-lines">
          {lines.slice(0, 3).map((line, i) => (
            <li key={i} data-testid="recap-line" data-events={line.events.join(",")}>
              {pick(line.text, lang)}
            </li>
          ))}
        </ol>
        {today === null ? null : (
          <p class="recap-today" data-testid="recap-today">
            {today}
          </p>
        )}
      </div>
      <div class="sheet-foot">
        <InkAct seed="recap" data-testid="recap-done" data-sheet-focus onClick={onClose}>
          {t("sheet.done")}
        </InkAct>
      </div>
    </section>
  );
}

export interface GazetteCardProps {
  gazette: Gazette;
  scene: Scene | null;
  lang: Lang;
  onClose: () => void;
}

/** A task as the paper names it: its title, and where and when it is, if it says. */
function PaperChance({ task, scene, lang, today, testid }: { task: PaperTask; scene: Scene | null; lang: Lang; today: number; testid: string }) {
  const when = task.window === null ? null : whenWhere(lang, task.window, placeName(scene, lang, task.window.place), today);
  return (
    <li class="gazette-chance" data-testid={testid} data-id={task.id}>
      <strong class="gazette-task" data-testid={`${testid}-task`}>
        {pick(task.text, lang)}
      </strong>
      {when === null ? null : (
        <>
          {marks(lang).comma}
          <span class="gazette-when" data-testid={`${testid}-when`}>
            {when}
          </span>
        </>
      )}
    </li>
  );
}

/**
 * The morning card when the core has the paper: the town gazette of the schoolmaster, a printed sheet with a double rule round it. A headline,
 * up to two short items, what the street says, and at the foot what is on today with its time and place. It holds the world until the player puts
 * it away, like the card of the first day.
 */
export function GazetteCard({ gazette, scene, lang, onClose }: GazetteCardProps) {
  const sheet = useRef<HTMLElement>(null);
  useSheetKeys(sheet, onClose);
  const today = gazette.today;
  const when = today === null || today.window === null ? null : whenWhere(lang, today.window, placeName(scene, lang, today.window.place), gazette.day);
  return (
    <section ref={sheet} class="sheet sheet-gazette" data-testid="gazette" data-day={gazette.day} role="dialog" aria-label={t("gazette.title")}>
      <CloseCorner label={t("menu.close")} testid="gazette-close" onClose={onClose} />
      <header class="gazette-mast">
        <h2 class="gazette-title" data-testid="gazette-title">
          {t("gazette.title")}
        </h2>
        <p class="gazette-issue" data-testid="gazette-issue">
          <span>{t("gazette.issue", { day: dayLabel(lang, gazette.day) })}</span>
          <span class="gazette-press">{t("gazette.press")}</span>
        </p>
      </header>
      <div class="sheet-scroll gazette-body">
        <section class="gazette-part gazette-front">
          <p class="gazette-label" data-testid="gazette-head-label">
            {t("gazette.head")}
          </p>
          <h3 class="gazette-head" data-testid="gazette-head" data-kind={gazette.head.kind}>
            {pick(gazette.head.text, lang)}
          </h3>
        </section>
        {gazette.news.length === 0 ? null : (
          <section class="gazette-part">
            <p class="gazette-label">{t("gazette.news")}</p>
            <ul class="gazette-news" data-testid="gazette-news">
              {gazette.news.map((item, i) => (
                <li key={i} data-testid="gazette-item" data-kind={item.kind}>
                  {pick(item.text, lang)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {gazette.talk.length === 0 ? null : (
          <section class="gazette-part">
            <p class="gazette-label">{t("gazette.talk")}</p>
            <ul class="gazette-talk" data-testid="gazette-talk">
              {gazette.talk.map((item, i) => (
                <li key={i} data-testid="gazette-talk-line" data-kind={item.kind}>
                  {pick(item.text, lang)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section class="gazette-today" data-testid="gazette-today" data-id={today?.id ?? ""}>
          {today === null ? (
            <p class="gazette-none" data-testid="gazette-today-none">
              {t("gazette.today.none")}
            </p>
          ) : (
            <p class="gazette-today-line">
              <span class="gazette-lead">{t("gazette.today")}</span>
              <strong class="gazette-task" data-testid="gazette-today-task">
                {pick(today.text, lang)}
              </strong>
              {when === null ? null : (
                <>
                  {marks(lang).comma}
                  <span class="gazette-when" data-testid="gazette-today-when">
                    {when}
                  </span>
                </>
              )}
              {today.next === null ? (
                marks(lang).end
              ) : (
                <>
                  {marks(lang).stop}
                  <span class="gazette-next" data-testid="gazette-today-next">
                    {t("gazette.next", { step: pick(today.next, lang) })}
                  </span>
                  {endsInStop(pick(today.next, lang)) ? null : marks(lang).end}
                </>
              )}
            </p>
          )}
          {gazette.more.length === 0 ? null : (
            <div class="gazette-also">
              <span class="gazette-lead">{t("gazette.more")}</span>
              <ul class="gazette-more" data-testid="gazette-more">
                {gazette.more.map((task) => (
                  <PaperChance key={task.id} task={task} scene={scene} lang={lang} today={gazette.day} testid="gazette-chance" />
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div class="sheet-foot">
        <InkAct seed="gazette" data-testid="gazette-done" data-sheet-focus onClick={onClose}>
          {t("sheet.done")}
        </InkAct>
      </div>
    </section>
  );
}

export interface NightCardProps {
  night: Night;
  scene: Scene | null;
  lang: Lang;
  onClose: () => void;
}

/**
 * The note at nightfall, on paper under a lamp: one thing that changed today, one obstacle that still stands, and one step for tomorrow. It holds
 * the world until the player puts it away, and the menu can turn it off.
 */
export function NightCard({ night, scene, lang, onClose }: NightCardProps) {
  const sheet = useRef<HTMLElement>(null);
  useSheetKeys(sheet, onClose);
  const step = night.step;
  const when = step === null || step.window === null ? null : whenWhere(lang, step.window, placeName(scene, lang, step.window.place), night.day + 1);
  return (
    <section ref={sheet} class="sheet paper-slip is-lamp sheet-night" data-testid="night" data-day={night.day} role="dialog" aria-label={t("night.title")}>
      <CloseCorner label={t("menu.close")} testid="night-close" onClose={onClose} />
      <header class="sheet-head">
        <h2 class="sheet-title">{t("night.title")}</h2>
        <p class="night-issue" data-testid="night-issue">
          {t("night.issue", { day: dayLabel(lang, night.day) })}
        </p>
      </header>
      <div class="sheet-scroll">
        <ol class="night-lines" data-testid="night-lines">
          <li data-testid="night-changed" data-kind={night.changed.kind}>
            <span class="night-label">{t("night.changed")}</span>
            <p class="night-text" data-testid="night-changed-text">
              {pick(night.changed.text, lang)}
            </p>
          </li>
          <li data-testid="night-blocked" data-id={night.blocked?.id ?? ""}>
            <span class="night-label">{t("night.blocked")}</span>
            {night.blocked === null ? (
              <p class="night-text night-none" data-testid="night-blocked-text">
                {t("night.blocked.none")}
              </p>
            ) : (
              <p class="night-text" data-testid="night-blocked-text">
                <strong>{pick(night.blocked.text, lang)}</strong>
                {night.blocked.blocker === null ? null : (
                  <>
                    {marks(lang).comma}
                    <span class="night-why">{pick(night.blocked.blocker, lang)}</span>
                    {marks(lang).end}
                  </>
                )}
              </p>
            )}
          </li>
          <li data-testid="night-step" data-id={step?.id ?? ""}>
            <span class="night-label">{t("night.step")}</span>
            {step === null ? (
              <p class="night-text night-none" data-testid="night-step-text">
                {t("night.step.none")}
              </p>
            ) : (
              <p class="night-text" data-testid="night-step-text">
                <strong>{pick(step.text, lang)}</strong>
                {when === null ? null : (
                  <>
                    {marks(lang).comma}
                    <span class="night-why" data-testid="night-step-when">
                      {when}
                    </span>
                    {marks(lang).end}
                  </>
                )}
              </p>
            )}
          </li>
        </ol>
      </div>
      <div class="sheet-foot">
        <InkAct seed="night" data-testid="night-done" data-sheet-focus onClick={onClose}>
          {t("night.done")}
        </InkAct>
      </div>
    </section>
  );
}
