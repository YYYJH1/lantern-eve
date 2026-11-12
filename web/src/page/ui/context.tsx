import { type Lang, pick, t } from "../../i18n/index.ts";
import { type ContextItem, contextLabel } from "../context-items.ts";
import type { Offer } from "../frame.ts";
import type { Give, GiveWay, Keeping, Wants } from "../talk-frame.ts";
import { count } from "./paper-text.ts";
import { CloseCorner, InkAct, Underline } from "./ink.tsx";
import { Picker, type PickerGroup, type PickerOption } from "./picker.tsx";

export interface ContextRowProps {
  items: readonly ContextItem[];
  name: string;
  lang: Lang;
  /** The acts wait while one is paid for. */
  disabled: boolean;
  /** Whether the list of what is behind the first is open. */
  restOpen: boolean;
  onAccept(wants: Wants): void;
  onDecline(wants: Wants): void;
  onKeep(keep: Keeping): void;
  onGive(): void;
  onRest(): void;
  /** The class that lights an element of the talk while a hint or a step of the tutorial points at it (`signalClass`), by the key of the signal. */
  signal?: (key: string) => string;
}

/** The first item of the queue as a button, or as the question it is, and "N more" for the rest. */
export function ContextRow({ items, name, lang, disabled, restOpen, onAccept, onDecline, onKeep, onGive, onRest, signal = () => "" }: ContextRowProps) {
  const first = items[0];
  if (first === undefined) return null;
  const behind = items.length - 1;
  return (
    <div class="talk-context" data-testid="talk-context" data-kind={first.kind} data-count={items.length}>
      {first.kind === "answer" ? (
        <div class={`answer-line${signal("talk-answer")}`} data-sig="talk-answer" data-testid="answer-line" data-key={first.wants.key} data-token={first.wants.token}>
          <p class="answer-ask" data-testid="answer-ask">
            {t("answer.ask", { name })}
          </p>
          <p class="answer-offer" data-testid="answer-offer">
            {pick(first.wants.offer.name, lang)}
          </p>
          <p class="answer-for" data-testid="answer-for">
            {t("answer.for", { asks: pick(first.wants.asks, lang) })}
          </p>
          <div class="answer-buttons">
            <InkAct seed="answer-yes" data-testid="answer-yes" disabled={disabled} onClick={() => onAccept(first.wants)}>
              {t("answer.yes")}
            </InkAct>
            <InkAct seed="answer-no" data-testid="answer-no" disabled={disabled} onClick={() => onDecline(first.wants)}>
              {t("answer.no")}
            </InkAct>
          </div>
        </div>
      ) : (
        <button type="button" class={`verb ink-act context-button${signal("verb-context")}`} data-sig="verb-context" data-testid="verb-context" data-kind={first.kind} disabled={disabled} onClick={() => (first.kind === "keep" ? onKeep(first.keep) : onGive())}>
          <span>{contextLabel(first, name, lang)}</span>
          <Underline seed={`context-${first.kind}`} />
        </button>
      )}
      {behind === 0 ? null : (
        <button type="button" class={`ink-act context-more${restOpen ? " is-open" : ""}`} data-testid="context-more" aria-expanded={restOpen} onClick={onRest}>
          {t("context.more", { n: count(lang, behind) })}
        </button>
      )}
    </div>
  );
}

/** The list behind the first item: each can be done from there, and a promise kept before its day is kept early. */
export function RestPanel({ items, name, lang, onKeep, onGive, onAccept, onClose }: { items: readonly ContextItem[]; name: string; lang: Lang; onKeep(keep: Keeping): void; onGive(): void; onAccept(wants: Wants): void; onClose(): void }) {
  const rest = items.slice(1);
  const options: PickerOption[] = rest.map((item, i) => ({ id: `${item.kind}:${i}`, label: contextLabel(item, name, lang), name: { zh: contextLabel(item, name, "zh"), en: contextLabel(item, name, "en") } }));
  return (
    <Picker
      inline
      testId="picker-rest"
      title={t("context.rest.title")}
      groups={[{ id: "rest", title: "", options }]}
      empty={t("picker.other.empty")}
      onPick={(option) => {
        const item = rest[options.findIndex((o) => o.id === option.id)];
        if (item === undefined) return;
        if (item.kind === "keep") onKeep(item.keep);
        else if (item.kind === "give") onGive();
        else onAccept(item.wants);
      }}
      onClose={onClose}
    />
  );
}

const WAY_KEY: Readonly<Record<GiveWay, "give.way.clear_truth" | "give.way.gift" | "give.way.ask_others">> = {
  clear_truth: "give.way.clear_truth",
  gift: "give.way.gift",
  ask_others: "give.way.ask_others",
};

/**
 * What can be promised to the person: the one they want first, the others under "others", and, where there is nothing left to promise, the ways
 * that are left said in plain words.
 */
export function GivePanel({ give, name, lang, onPromise, onGift, onClose }: { give: Give; name: string; lang: Lang; onPromise(offer: Offer): void; onGift(): void; onClose(): void }) {
  const option = (offer: Offer): PickerOption => ({ id: offer.id, label: pick(offer.name, lang), name: offer.name, body: offer.body });
  const groups: PickerGroup[] = [];
  if (give.preferred !== null) groups.push({ id: "preferred", title: t("give.preferred", { name }), options: [option(give.preferred)] });
  if (give.more.length > 0) groups.push({ id: "more", title: t("give.more"), options: give.more.map(option) });
  if (groups.length === 0) {
    return (
      <section class="picker paper-slip give-ways" data-testid="picker-promise" role="dialog" aria-label={t("give.title", { name })}>
        <CloseCorner label={t("picker.close")} testid="picker-close" onClose={onClose} />
        <header class="picker-head">
          <h3 class="picker-title">{t("give.title", { name })}</h3>
        </header>
        <p class="picker-note" data-testid="give-none">
          {t("give.none", { name })}
        </p>
        <ul class="give-way-list" data-testid="give-ways">
          {give.ways.map((way) => (
            <li key={way} data-way={way}>
              <span>{t(WAY_KEY[way], { name })}</span>
              {way === "gift" ? (
                <InkAct seed="give-gift" data-testid="give-way-gift" onClick={onGift}>
                  {t("give.way.gift.do")}
                </InkAct>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <Picker
      inline
      testId="picker-promise"
      title={t("give.title", { name })}
      groups={groups}
      empty={t("picker.other.empty")}
      onPick={(picked) => {
        const found = [give.preferred, ...give.more].find((offer) => offer?.id === picked.id);
        if (found != null) onPromise(found);
      }}
      onClose={onClose}
    />
  );
}
