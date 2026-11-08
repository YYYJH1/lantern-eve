import { useMemo } from "preact/hooks";
import { getLang, hasMessage, type MessageKey, t } from "../../i18n/index.ts";
import type { ModelCallRecord } from "../../shared/protocol.ts";
import { callTotals } from "../calls.ts";
import type { PageState } from "../client.ts";
import { readHud } from "../hud.ts";
import { microText } from "./format.ts";

/** A name from a table of the interface, or the code itself where the table has none. */
function named(prefix: string, id: string): string {
  const key = `${prefix}.${id}`;
  return hasMessage(key) ? t(key as MessageKey) : id;
}

function note(call: ModelCallRecord): string[] {
  const lines: string[] = [];
  if (call.asked !== call.tier && call.reason !== null) lines.push(named("calls.reason", call.reason));
  if (call.status === "error" && call.code !== null) lines.push(call.code);
  if (call.late) lines.push(t("calls.late"));
  if (call.voided !== null) lines.push(named("calls.voided", call.voided));
  return lines;
}

function Call({ call }: { call: ModelCallRecord }) {
  const moved = call.asked !== call.tier;
  const notes = note(call);
  const tokens = call.usage === null ? null : t("calls.tokens", { input: call.usage.input_tokens, output: call.usage.output_tokens });
  return (
    <li class="call" data-testid="call" data-id={call.id} data-status={call.status} data-tier={call.tier} data-asked={call.asked} data-category={call.category ?? ""} data-late={call.late}>
      <div class="call-head">
        <span class="call-category">{call.category === null ? t("calls.category.none") : named("calls.category", call.category)}</span>
        <span class="call-tiers" data-moved={moved}>
          {moved ? <span class="call-asked">{named("calls.tier", call.asked)}</span> : null}
          {moved ? <span class="call-arrow">{t("calls.became")}</span> : null}
          <span class="call-given">{named("calls.tier", call.tier)}</span>
        </span>
        <span class="call-status" data-status={call.status}>
          {named("calls.status", call.status)}
        </span>
      </div>
      <div class="call-meta mono">
        <span class="call-model">{call.model ?? t("calls.noModel")}</span>
        {call.latency_ms === null ? null : <span>{t("calls.latency", { ms: call.latency_ms })}</span>}
        {call.hold === null || call.hold === 0 ? null : <span class="call-hold">{t("calls.held", { amount: microText(call.hold) })}</span>}
        {call.cost === null ? null : <span class="call-cost">{t("calls.charged", { amount: microText(call.cost) })}</span>}
        {tokens === null ? null : <span>{tokens}</span>}
        <span class="call-tick">{t("calls.tick", { n: call.tick })}</span>
      </div>
      {notes.map((line) => (
        <p class="call-note" key={line}>
          {line}
        </p>
      ))}
    </li>
  );
}

function Fact({ id, label, children }: { id: string; label: string; children: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-testid={`calls-${id}`}>{children}</dd>
    </div>
  );
}

/** Every model call of the game: what was asked, what answered, how long it took, and what it cost. */
export function CallLog({ s, open }: { s: PageState; open: boolean }) {
  const log = s.calls;
  const totals = callTotals(log);
  const spent = readHud((s.frame?.hud as Record<string, unknown> | undefined) ?? {}).spentMicro;
  const earlier = totals.booked !== null && spent !== null && spent > totals.booked ? spent - totals.booked : 0;
  // The rows are many and the list changes with every call of the core, so they are made only when the drawer shows them.
  const rows = useMemo(
    () => (open ? log.list.map((call) => <Call key={call.id} call={call} />) : null),
    [open, log, log.version, getLang()],
  );
  return (
    <details class="menu-section" data-testid="calls" open>
      <summary class="menu-heading">
        {t("calls.title")}
        <span class="count" data-testid="calls-total">
          {totals.count}
        </span>
      </summary>
      {totals.count === 0 ? (
        <p class="calls-empty" data-testid="calls-empty">
          {t("calls.empty")}
        </p>
      ) : (
        <>
          <dl class="facts calls-facts" data-testid="calls-facts">
            <Fact id="count" label={t("calls.f.calls")}>
              {totals.count}
            </Fact>
            <Fact id="pending" label={t("calls.f.pending")}>
              {totals.pending}
            </Fact>
            <Fact id="lines" label={t("calls.f.lines")}>
              {totals.templated}
            </Fact>
            <Fact id="moved" label={t("calls.f.moved")}>
              {totals.moved}
            </Fact>
            {totals.booked === null ? null : (
              <Fact id="booked" label={t("calls.f.booked")}>
                {microText(totals.booked)}
              </Fact>
            )}
            {totals.booked === null ? null : (
              <Fact id="held" label={t("calls.f.held")}>
                {microText(totals.held)}
              </Fact>
            )}
            {spent === null || totals.booked === null ? null : (
              <Fact id="spent" label={t("calls.f.spent")}>
                {microText(spent)}
              </Fact>
            )}
            {earlier === 0 ? null : (
              <Fact id="earlier" label={t("calls.f.earlier")}>
                {microText(earlier)}
              </Fact>
            )}
          </dl>
          {log.dropped.count === 0 ? null : (
            <p class="calls-cap" data-testid="calls-cap">
              {t("calls.cap", { n: log.list.length })}
            </p>
          )}
          <ol class="calls" data-testid="calls-list" aria-label={t("calls.list")}>
            {rows}
          </ol>
        </>
      )}
    </details>
  );
}
