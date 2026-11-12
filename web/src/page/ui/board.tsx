import { useLayoutEffect, useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import { readHud } from "../hud.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { type Board, type SliceFrame, STATEMENT_PARTS } from "../slice.ts";
import { elderText, familyName, helperTotal, materialsOf, nextWindow, truthLastText, truthNeeds, witnessText } from "./board-text.ts";
import { chosenCount, PART_TOTAL } from "./statement-text.ts";
import { Dash, placeName } from "./common.tsx";
import { clockText, dayLabel, dueText, partLabel, zhNumeral } from "./format.ts";
import { Brush, Rule, Stamp, Tally, Tick } from "./ink.tsx";
import { STRIKES } from "./marks.ts";
import { thingName } from "./names.ts";
import { FestivalCard, PledgesCard, ReputationPart } from "./side.tsx";
import { count } from "./paper-text.ts";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { crewShortfall, ledgerWhen, shortfallWords } from "./slip-text.ts";
import { stitchPath } from "./stitch.ts";
import { Commitments } from "./taskcard.tsx";

/** The three pages of the ledger, which are the three jobs: mend the bridge, set the matter straight, make the peace. */
export type LedgerPage = "bridge" | "truth" | "peace";
export const LEDGER_PAGES: readonly LedgerPage[] = ["bridge", "truth", "peace"];

/** A number of the town as the town says it before a measure word: a Chinese numeral in Chinese (两 for two), digits in English. */
const say = count;

/** One ruled line of the ledger: the name of the thing on the left, then what it takes, what it has, and the mark. */
function Row({ label, testId, attrs, children, mark, wide = false, k }: { label: string; testId?: string; attrs?: Record<string, string | number | boolean>; children: preact.ComponentChildren; mark?: preact.ComponentChildren; wide?: boolean; k: string }) {
  return (
    <div class={`lrow${wide ? " is-wide" : ""}`} data-testid={testId} {...attrs}>
      <span class="lrow-label">{label}</span>
      <span class="lrow-cells">{children}</span>
      <span class="lrow-mark">{mark}</span>
      <Rule seed={k} class="lrow-rule" />
    </div>
  );
}

/** The bridge: what the work takes and what has come, item by item; the helpers; the hours; when work is done next; why the last time did none; the deadline. */
function BridgePart({ frame, scene, slice, lang, play, today }: { frame: ViewFrame | null; scene: Scene | null; slice: SliceFrame; lang: Lang; play: Play; today: number | null }) {
  const hud = readHud(frame?.hud ?? {});
  const board: Board | null = slice.board;
  const materials = materialsOf(slice);
  const window = nextWindow(slice, board);
  const need = board?.need ?? hud.bridge?.need ?? null;
  const helpers = board?.helpers ?? null;
  const total = helperTotal(board, hud.bridge?.done ?? null);
  const mended = (hud.bridge?.percent ?? 0) >= 100;
  const enough = total !== null && need !== null && total >= need && board?.both !== false;
  const lack = mended ? null : crewShortfall(hud.bridge);
  return (
    <section class="board-part" data-testid="board-bridge" data-state={mended ? "done" : "open"}>
      <div class="lrows">
        {slice.commitments === null && slice.site === null ? (
          <Row label={t("board.materials")} testId="board-materials-empty" k="empty">
            <Dash />
          </Row>
        ) : (
          <div class="materials" data-testid="board-materials">
            {materials.map((m) => {
              const needs = board?.needs?.[m.item] ?? null;
              const here = m.site;
              const ok = needs !== null && here !== null && here >= needs;
              return (
                <Row
                  key={m.item}
                  k={m.item}
                  label={thingName(scene, lang, m.item)}
                  testId="board-material"
                  attrs={{ "data-item": m.item, "data-promised": m.promised, "data-delivered": m.delivered, "data-lost": m.lost, "data-need": needs ?? "", "data-site": here ?? "" }}
                  mark={ok ? <Tick seed={m.item} /> : null}
                >
                  {needs !== null && here !== null ? (
                    <>
                      <span class="lcell">{t("ledger.need", { what: t("ledger.pole", { n: say(lang, needs) }) })}</span>
                      <span class="lcell">{t("ledger.arrived", { what: t("ledger.pole", { n: say(lang, here) }) })}</span>
                    </>
                  ) : (
                    <>
                      <span class="lcell">{t("board.promised", { n: t("ledger.pole", { n: say(lang, m.promised) }) })}</span>
                      <span class="lcell">{t("board.delivered", { n: t("ledger.pole", { n: say(lang, m.delivered) }) })}</span>
                    </>
                  )}
                  {m.lost === 0 ? null : (
                    <span class="lcell lcell-lost" data-testid="board-material-lost">
                      {t("board.lost", { n: t("ledger.pole", { n: say(lang, m.lost) }) })}
                    </span>
                  )}
                </Row>
              );
            })}
            {materials.length === 0 ? (
              <Row label={t("board.materials")} k="none" wide>
                <span class="lcell">{t("board.materials.none")}</span>
              </Row>
            ) : null}
          </div>
        )}
        <span class="sr-only" data-testid="board-site" data-bamboo={slice.site?.bamboo ?? ""} data-timber={slice.site?.timber ?? ""} />
        <Row label={t("board.helpers")} testId="board-helpers" k="helpers" mark={enough ? <Tick seed="helpers" /> : null}>
          {total === null ? (
            <Dash />
          ) : (
            <>
              {need === null ? null : <span class="lcell">{t("ledger.need", { what: t("ledger.person", { n: say(lang, need) }) })}</span>}
              <span class="lcell">
                <span class="helper-total" data-total={total} data-need={need ?? ""}>
                  {t("ledger.present", { what: t("ledger.person", { n: say(lang, total) }) })}
                </span>
                {helpers === null || helpers.length === 0
                  ? null
                  : helpers.map((h) => (
                      <span key={h.family ?? "none"} class="helper" data-testid="board-helper" data-family={h.family ?? ""} data-count={h.count}>
                        {t("ledger.family", { family: familyName(scene, lang, h.family), what: t("ledger.person", { n: say(lang, h.count) }) })}
                      </span>
                    ))}
              </span>
            </>
          )}
          {lack === null ? null : (
            <p class="board-short" data-testid="board-short" data-short={lack.short} data-families={lack.families.join(" ")} role="note">
              {shortfallWords(lang, scene, lack)}
            </p>
          )}
        </Row>
        {board?.both === false ? (
          <p class="board-warn" data-testid="board-both" role="note">
            {t("board.helpers.both")}
          </p>
        ) : null}
        {board?.hours == null ? null : (
          <Row label={t("board.hours")} testId="board-hours" attrs={{ "data-done": board.hours.done, "data-need": board.hours.need }} k="hours" mark={board.hours.done >= board.hours.need && board.hours.need > 0 ? <Tick seed="hours" /> : null}>
            <span class="lcell">{t("ledger.need", { what: t("ledger.hours", { n: say(lang, board.hours.need) }) })}</span>
            <span class="lcell lcell-tally">
              {t("ledger.made")}
              <Tally n={board.hours.done} />
              <span class="lnum">{lang === "zh" ? zhNumeral(board.hours.done) : board.hours.done}</span>
            </span>
          </Row>
        )}
        {mended || window === null ? null : (
          <Row label={t("ledger.nextWork")} testId="board-window" attrs={{ "data-day": window.day, "data-from": window.from, "data-to": window.to }} k="window" wide>
            <span class="lcell">{ledgerWhen(lang, window, placeName(scene, lang, window.place))}</span>
          </Row>
        )}
        {board?.stop == null ? null : (
          <Row label={t("board.stop")} testId="board-stop" k="stop" wide>
            <span class="lcell">{pick(board.stop, lang)}</span>
          </Row>
        )}
        {mended || board?.deadline == null ? null : (
          <Row label={t("ledger.deadline")} testId="board-deadline" attrs={{ "data-day": board.deadline.day, "data-hour": board.deadline.hour }} k="deadline" wide>
            <span class="lcell">{dueText(lang, board.deadline)}</span>
          </Row>
        )}
      </div>
      <div class="lrows lrows-favours">
        <div class="lrow lrow-block">
          <span class="lrow-label">{t("ledger.favours")}</span>
          <div class="lrow-body">
            <Commitments slice={slice} scene={scene} lang={lang} play={play} today={today} />
            <PledgesCard hud={hud} lang={lang} />
          </div>
        </div>
        <FestivalCard frame={frame} lang={lang} />
        <ReputationPart frame={frame} />
      </div>
    </section>
  );
}

/** The truth: set straight in public or not, what that takes, and how the last statement stood against it. */
function TruthView({ board, scene, lang }: { board: Board; scene: Scene | null; lang: Lang }) {
  const truth = board.truth;
  if (truth === null) return null;
  if (truth.state === "done") {
    return (
      <p class="board-state is-done" data-testid="truth-state" data-state="done">
        <Tick seed="truth" />
        <span>{t("board.truth.done")}</span>
      </p>
    );
  }
  const last = truth.last;
  const elder = last === null ? null : elderText(last);
  return (
    <>
      <p class="board-state is-open" data-testid="truth-state" data-state="open">
        {t("board.truth.open")}
      </p>
      <p class="note-lead truth-needs-title">{t("board.truth.needs")}</p>
      <ul class="truth-needs" data-testid="truth-needs">
        {truthNeeds(lang, last).map((need) => (
          <li key={need.id} data-testid="truth-need" data-need={need.id} data-met={need.met === null ? "" : String(need.met)}>
            <span class="act-mark" aria-hidden="true">
              {need.met === true ? <Tick seed={need.id} /> : null}
            </span>
            {need.text}
          </li>
        ))}
      </ul>
      {last === null ? null : (
        <div class="truth-last" data-testid="truth-last" data-day={last.day} data-named={last.named} data-accepted={last.accepted} data-percent={last.percent} data-elder={last.elder ?? ""}>
          <p>
            {truthLastText(last, scene, lang)}
            {elder === null ? null : `${lang === "zh" ? "，" : ", "}${elder}`}
          </p>
          {last.why === null ? null : (
            <p class="truth-missed" data-testid="truth-missed">
              {t("board.truth.missed", { why: pick(last.why, lang) })}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The statement of the truth: the three columns, each with what supports it (a tally of 正), what goes against it (a stroke and the
 * number) and whether something is missing, where the frame has them, and under them whether the matter is set straight in public, what that
 * takes and how the last statement stood against it. Until the frame has the columns, the last three alone. A dash only where the frame has
 * neither. Where the frame has the statement card, each column says whether a choice is made for it, and a phrase opens the card.
 */
function StatementPart({ slice, scene = null, lang, onOpen }: { slice: SliceFrame; scene?: Scene | null; lang: Lang; onOpen?: () => void }) {
  const board = slice.board;
  const columns = board?.statement ?? null;
  const judged = slice.judgments?.length ?? null;
  const truthShown = columns === null && board?.truth != null;
  const card = slice.statement;
  return (
    <section class="board-part" data-testid="board-statement" data-view={columns !== null ? "columns" : truthShown ? "truth" : "none"}>
      {columns !== null ? (
        <>
          <ul class="statement-columns" data-testid="statement-columns">
            {STATEMENT_PARTS.map((part) => {
              const column = columns.find((c) => c.part === part);
              const chosen = card?.parts.find((p) => p.part === part)?.chosen != null;
              return (
                <li key={part} data-testid="statement-column" data-part={part} data-gap={column?.gap ?? true} data-chosen={chosen} data-support={column?.support ?? ""} data-against={column?.against ?? ""}>
                  <span class="statement-name">{t(`board.statement.${part}`)}</span>
                  {column === undefined ? (
                    <Dash />
                  ) : (
                    <span class="statement-counts">
                      <span class="tally-cell" data-testid="statement-support" aria-label={t("ledger.support", { n: say(lang, column.support) })}>
                        <Tally n={column.support} />
                        <span class="lnum">{column.support}</span>
                      </span>
                      <span class="strike-cell" data-testid="statement-against" aria-label={t("ledger.against", { n: say(lang, column.against) })}>
                        <Brush mark={STRIKES[0]} class="strike-mark" />
                        <span class="lnum">{column.against}</span>
                      </span>
                      {column.gap ? <em class="statement-gap-mark">{t("board.statement.gap")}</em> : null}
                    </span>
                  )}
                  {chosen ? <Tick seed={part} class="statement-picked" /> : null}
                </li>
              );
            })}
          </ul>
          <p class="ledger-legend">{t("ledger.legend")}</p>
          {board !== null && board.truth !== null ? <TruthView board={board} scene={scene} lang={lang} /> : null}
        </>
      ) : board !== null && truthShown ? (
        <TruthView board={board} scene={scene} lang={lang} />
      ) : (
        <p class="board-line" data-testid="statement-empty">
          {judged === null ? <Dash /> : t("board.statement.judged", { n: say(lang, judged) })}
        </p>
      )}
      {card === null || onOpen === undefined ? null : (
        <button type="button" class="phrase statement-open" data-testid="statement-open" data-chosen={chosenCount(card)} data-total={PART_TOTAL} onClick={onOpen}>
          {t("board.statement.open")}
        </button>
      )}
    </section>
  );
}

/** The peace between the families: made, or how much of the grudge is left (an incense stick that burns down), what moves it, and whether anybody saw. */
function PeacePart({ slice, lang }: { slice: SliceFrame; lang: Lang }) {
  const peace = slice.board?.peace ?? null;
  const witness = witnessText(peace?.witnessed ?? null);
  return (
    <section class="board-part" data-testid="board-peace" data-state={peace?.state ?? ""}>
      {peace === null ? (
        <p class="board-line">
          <Dash />
        </p>
      ) : peace.state === "done" ? (
        <p class="board-state is-done" data-testid="peace-state" data-state="done">
          <Tick seed="peace" />
          <span>{t("board.peace.done")}</span>
        </p>
      ) : (
        <>
          {peace.grudge === null ? null : (
            <div class="peace-grudge">
              <progress class="incense" max={100} value={peace.grudge} aria-label={t("board.peace.grudge")} data-testid="peace-meter" />
              <span class="peace-caption" data-testid="peace-grudge">
                {t("ledger.grudge", { n: peace.grudge })}
              </span>
            </div>
          )}
          <ul class="peace-acts" data-testid="peace-acts">
            {peace.acts.map((act) => (
              <li key={act.id} data-testid="peace-act" data-done={act.done}>
                <span class="act-mark" aria-hidden="true">
                  {act.done ? <Tick seed={act.id} /> : null}
                </span>
                {pick(act.text, lang)}
              </li>
            ))}
          </ul>
          {witness === null ? null : (
            <p class={`peace-witness${peace.witnessed === true ? " is-met" : ""}`} data-testid="peace-witness" data-witnessed={peace.witnessed === true}>
              {witness}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Whether a job of the ledger is done, from what the frame says of it. Null where the frame says nothing yet. */
export function jobDone(page: LedgerPage, frame: ViewFrame | null, slice: SliceFrame): boolean | null {
  if (page === "bridge") {
    const percent = readHud(frame?.hud ?? {}).bridge?.percent ?? null;
    return percent === null ? null : percent >= 100;
  }
  const state = page === "truth" ? slice.board?.truth?.state : slice.board?.peace?.state;
  return state === undefined || state === null ? null : state === "done";
}

export interface BoardProps {
  frame: ViewFrame | null;
  scene: Scene | null;
  slice: SliceFrame;
  lang: Lang;
  play: Play;
  /** The page the ledger is open at, or null while it is shut. */
  page: LedgerPage | null;
  onPage: (page: LedgerPage | null) => void;
  /** Opens the statement card, where the frame has one. */
  onStatement?: () => void;
}

/** The date at the head of a page: "第四天 辰时". */
function Dated({ frame, lang }: { frame: ViewFrame | null; lang: Lang }) {
  const time = frame?.time;
  return (
    <span class="ledger-date" data-testid="ledger-date">
      {time === undefined ? <Dash /> : `${dayLabel(lang, time.day)} ${lang === "zh" ? partLabel(lang, time.hour) : clockText(time.hour, time.minute)}`}
    </span>
  );
}

/**
 * The stitch of a bookmark: a dashed line that follows the outline of the cloth, `--sew` pixels inside it (the style sheet says how far and how deep the V in
 * the foot of the cloth is). The cloth is a different size when its page is open, so the line is drawn to the size that the page has measured:
 * when the page is opened or shut in the same commit that widens the cloth (`on`), and when the window is turned or resized, as the browser lays it out again.
 */
function Stitch({ on }: { on: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const element = svg.current;
    if (element === null) return;
    const draw = (): void => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const sew = Number.parseFloat(style.getPropertyValue("--sew"));
      const cut = Number.parseFloat(style.getPropertyValue("--cut"));
      if (box.width === 0 || box.height === 0 || Number.isNaN(sew) || Number.isNaN(cut)) return;
      element.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      element.firstElementChild?.setAttribute("d", stitchPath(box.width, box.height, cut, sew));
    };
    draw();
    const watch = new ResizeObserver(draw);
    watch.observe(element);
    return () => watch.disconnect();
  }, [on]);
  return (
    <svg class="mark-stitch" ref={svg} aria-hidden="true" focusable="false">
      <path />
    </svg>
  );
}

/**
 * The ledger of the three jobs: three bookmarks at the right edge of the page, and under the one that is pressed, the book opened at its
 * page, ruled in tile blue, and written in ink. A bookmark is a ribbon of cloth with a stitch round the inside of it and a title slip of
 * paper on it with the name of the job; a job that is done has its seal on the cloth under the slip.
 */
export function PrepBoard({ frame, scene, slice, lang, play, page, onPage, onStatement }: BoardProps) {
  const open = page !== null;
  const today = frame?.time.day ?? null;
  const { leaf, more } = useMoreBelow<HTMLDivElement>(page);
  return (
    <>
      <nav class="marks" data-testid="board-tabs" aria-label={t("board.title")}>
        {LEDGER_PAGES.map((id) => {
          const done = jobDone(id, frame, slice);
          const on = page === id;
          return (
            <button
              key={id}
              type="button"
              class={`mark${on ? " is-on" : ""}`}
              data-testid={id === "bridge" ? "board-toggle" : `board-tab-${id}`}
              data-tab={id}
              data-state={done === null ? "" : done ? "done" : "open"}
              aria-expanded={on}
              aria-controls="ledger"
              onClick={() => onPage(on ? null : id)}
            >
              <span class="mark-cloth" aria-hidden="true" />
              <Stitch on={on} />
              <span class="mark-label">
                <span class="mark-name">{t(`ledger.mark.${id}`)}</span>
              </span>
              {done === true ? <Stamp word="done" shape="square" class="mark-seal" /> : null}
            </button>
          );
        })}
      </nav>
      <section class="ledger" id="ledger" data-testid="board" data-open={open} data-page={page ?? ""} hidden={!open} aria-label={t("board.title")}>
        <div class="ledger-cover" aria-hidden="true" />
        <div class="ledger-leaf" ref={leaf}>
          <header class="ledger-head">
            <h2 class="ledger-title" data-testid="ledger-title">
              {page === null ? "" : t(`task.job.${page}`)}
            </h2>
            {/* A job that is done has its seal stamped at the head of its page, where it is in view however long the page is. */}
            {page !== null && jobDone(page, frame, slice) === true ? <Stamp word="done" shape="wide" class="ledger-seal" /> : null}
            <Dated frame={frame} lang={lang} />
          </header>
          <Rule seed="head" class="ledger-rule" />
          <div class="ledger-body">
            {page === "bridge" ? <BridgePart frame={frame} scene={scene} slice={slice} lang={lang} play={play} today={today} /> : null}
            {page === "truth" ? <StatementPart slice={slice} scene={scene} lang={lang} onOpen={onStatement} /> : null}
            {page === "peace" ? <PeacePart slice={slice} lang={lang} /> : null}
          </div>
          {more ? <TurnBar leaf={leaf} word={t("ledger.turn")} testId="ledger-turn" /> : null}
        </div>
      </section>
    </>
  );
}
