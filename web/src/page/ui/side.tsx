import type { ComponentChildren } from "preact";
import { getLang, hasMessage, type Lang, pick, t } from "../../i18n/index.ts";
import { budgetNotes, CLOUD_OFF_PERCENT, readBudget, STRONG_OFF_PERCENT } from "../budget.ts";
import { type CallLog, callTotals } from "../calls.ts";
import { pledgeName } from "../deals.ts";
import type { ViewFrame } from "../frame.ts";
import { type HudValues, passageOf, readHud } from "../hud.ts";
import { Dash } from "./common.tsx";
import { moneyText, zhNumeral } from "./format.ts";
import { count } from "./paper-text.ts";
import { CoinIcon } from "./icons.tsx";
import { Tick } from "./ink.tsx";

export function Stat({ id, icon, label, children, sub, extra }: { id: string; icon: ComponentChildren; label: string; children: ComponentChildren; sub?: ComponentChildren; extra?: ComponentChildren }) {
  return (
    <div class="stat" data-testid={`stat-${id}`}>
      <dt>
        {icon === null ? null : <span class="stat-icon">{icon}</span>}
        {label}
      </dt>
      <dd>
        <span class="stat-value">{children}</span>
        {sub === undefined || sub === null ? null : <span class="stat-sub">{sub}</span>}
      </dd>
      {extra === undefined || extra === null ? null : extra}
    </div>
  );
}

/** What the cost stands against: the cap of the game, and how far the budget gate has cut the models down. */
function costSub(cap: number | null, stage: number | null): string | null {
  const parts: string[] = [];
  if (cap !== null) parts.push(t("hud.cap", { amount: moneyText(cap) }));
  const key = `hud.stage.${stage}`;
  if (stage !== null && hasMessage(key)) parts.push(t(key));
  return parts.length === 0 ? null : parts.join(getLang() === "zh" ? "，" : ", ");
}

/**
 * How much of the budget is gone and what that does to the models: a gauge with the two places where
 * the gate switches the strong model off and the cloud off, and in words what answers in their place.
 */
function Budget({ hud, calls }: { hud: HudValues; calls: CallLog | null }) {
  const view = readBudget(hud);
  if (view === null) return null;
  const used = Math.round(view.spentPercent + view.heldPercent);
  const notes = budgetNotes(view);
  // What the gate has done so far, from the `downgrade` events that the list of calls holds.
  const totals = calls === null ? null : callTotals(calls);
  return (
    <div class="budget" data-testid="budget" data-stage={view.stage} data-cloud={view.cloud} data-local={view.local}>
      <div class="budget-gauge" role="img" aria-label={t("budget.gauge", { percent: used })} data-testid="budget-gauge" data-used={used}>
        <span class="budget-spent" style={{ width: `${view.spentPercent}%` }} />
        <span class="budget-held" style={{ left: `${view.spentPercent}%`, width: `${view.heldPercent}%` }} />
        <i class="budget-mark" style={{ left: `${STRONG_OFF_PERCENT}%` }} />
        <i class="budget-mark" style={{ left: `${CLOUD_OFF_PERCENT}%` }} />
      </div>
      <div class="budget-scale" aria-hidden="true">
        <span style={{ left: `${STRONG_OFF_PERCENT}%` }}>{STRONG_OFF_PERCENT}%</span>
        <span style={{ left: `${CLOUD_OFF_PERCENT}%` }}>{CLOUD_OFF_PERCENT}%</span>
      </div>
      <div class="budget-notes" data-testid="budget-notes" aria-live="polite">
        {notes.map((key) => (
          <p key={key} class="budget-note" data-note={key}>
            {t(key)}
          </p>
        ))}
        {totals === null || totals.moved === 0 ? null : (
          <p class="budget-moved" data-testid="budget-moved" data-moved={totals.moved} data-lines={totals.templated}>
            {t("budget.moved", { moved: totals.moved, lines: totals.templated })}
          </p>
        )}
      </div>
    </div>
  );
}

/** The promises that are open, with whom and by when, and what the manager can still promise. Left out until the frame says either. */
export function PledgesCard({ hud, lang }: { hud: HudValues; lang: Lang }) {
  const { pledges, resources } = hud;
  if (pledges === null && resources === null) return null;
  const day = (value: number): string => (lang === "zh" ? zhNumeral(value) : String(value));
  const roles = resources === null ? [] : resources.roles.map((role) => pick(pledgeName("role", role, 0), lang));
  const left = resources === null ? [] : ([
    ["stallFront", t("hud.resources.stallFront"), count(lang, resources.stallFront), resources.stallFront === 0],
    ["stallBack", t("hud.resources.stallBack"), count(lang, resources.stallBack), resources.stallBack === 0],
    ["roles", t("hud.resources.roles"), count(lang, resources.roles.length), resources.roles.length === 0],
    ["slots", t("hud.resources.slots"), resources.slots.length === 0 ? t("hud.none") : resources.slots.map((slot) => (lang === "zh" && /^\d+$/.test(slot) ? zhNumeral(Number(slot)) : slot)).join(lang === "zh" ? "、" : ", "), resources.slots.length === 0],
    ["purse", t("hud.resources.purse"), t("unit.coins", { n: count(lang, resources.purse) }), resources.purse === 0],
  ] as const);
  return (
    <div class="pledges-block" data-testid="hud-pledges">
      {pledges === null ? null : pledges.length === 0 ? (
        <p class="pledge-none" data-testid="pledge-none">
          {t("hud.pledges.none")}
        </p>
      ) : (
        <ul class="pledges" data-testid="pledges">
          {pledges.map((pledge) => (
            <li key={pledge.id} data-testid="pledge" data-id={pledge.id} data-due={pledge.due}>
              <span class="pledge-who">{pick(pledge.to, lang)}</span>
              <span class="pledge-what">{pick(pledgeName(pledge.what, pledge.item, pledge.amount), lang)}</span>
              <span class="pledge-due">{t("hud.pledges.due", { n: day(pledge.due) })}</span>
            </li>
          ))}
        </ul>
      )}
      {resources === null ? null : (
        <div class="lrow lrow-block lrow-left">
          <span class="lrow-label">{t("hud.resources.title")}</span>
          <div class="lrow-body">
            <dl class="left" data-testid="resources">
              {left.map(([id, label, value, out]) => (
                <div key={id} class={out ? "is-out" : undefined} data-testid={`left-${id}`} data-out={out}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {roles.length === 0 ? null : (
              <p class="left-roles" data-testid="left-role-names">
                {roles.join(lang === "zh" ? "、" : ", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The festival's own numbers: the households that promised, the expected turnout and the way across. The helpers and the work hours of the bridge are
 * the bridge's, and are on the ledger above them. A dash stands for what the core has not sent.
 */
export function FestivalCard({ frame, lang }: { frame: ViewFrame | null; lang: Lang }) {
  const hud = readHud(frame?.hud ?? {});
  const passage = passageOf(hud.bridge?.state ?? null);
  return (
    <div class="lrow lrow-block" data-testid="hud-festival">
      <span class="lrow-label">{t("hud.festival")}</span>
      <dl class="stats lrow-body">
        <Stat id="promised" icon={null} label={t("hud.promised")}>
          {hud.promised === null ? <Dash /> : t("unit.households", { n: count(lang, hud.promised) })}
        </Stat>
        <Stat id="turnout" icon={null} label={t("hud.turnout")}>
          {hud.turnout === null ? <Dash /> : t("unit.people", { n: count(lang, hud.turnout) })}
        </Stat>
        <Stat id="passage" icon={null} label={t("hud.passage")}>
          {passage === null ? (
            <Dash />
          ) : (
            <span data-testid="passage" data-passage={passage}>
              {t(`hud.passage.${passage}`)}
            </span>
          )}
        </Stat>
      </dl>
    </div>
  );
}

/** How the town sees the manager: one tick for each of the three stars. */
export function ReputationPart({ frame }: { frame: ViewFrame | null }) {
  const hud = readHud(frame?.hud ?? {});
  const stars = hud.reputation;
  return (
    <div class="lrow lrow-block" data-testid="hud-you">
      <span class="lrow-label">{t("hud.you")}</span>
      <dl class="stats lrow-body">
        <Stat id="reputation" icon={null} label={t("hud.reputation")}>
          {stars === null ? (
            <Dash />
          ) : (
            <span class="stars" role="img" aria-label={t("unit.stars", { n: stars })} data-stars={stars}>
              {[1, 2, 3].map((i) => (
                <span key={i} class={i <= stars ? "star is-on" : "star"}>
                  {i <= stars ? <Tick seed={`star${i}`} /> : null}
                </span>
              ))}
            </span>
          )}
        </Stat>
      </dl>
    </div>
  );
}

/** What the game has cost so far and the budget against its cap, which sits in the menu with the model. */
export function CostCard({ frame, calls = null }: { frame: ViewFrame | null; calls?: CallLog | null }) {
  const hud = readHud(frame?.hud ?? {});
  return (
    <section class="menu-section" data-testid="hud-cost">
      <h3 class="menu-heading">{t("hud.cost")}</h3>
      <dl class="stats">
        <Stat id="cost" icon={<CoinIcon />} label={t("hud.cost")} sub={costSub(hud.cap, hud.stage)} extra={<Budget hud={hud} calls={calls} />}>
          {hud.cost === null ? <Dash /> : moneyText(hud.cost)}
        </Stat>
      </dl>
    </section>
  );
}
