import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { getLang, type Lang, pick, t } from "../../i18n/index.ts";
import { pledgeName } from "../deals.ts";
import type { ViewFrame } from "../frame.ts";
import type { Play } from "../play.ts";
import { heartParts, type HeartChange, type HeartWhy, type Relation } from "../relations.ts";
import type { Scene } from "../scene.ts";
import { clockText, dayLabel, dueWords } from "./format.ts";
import { CloseCorner, InkAct } from "./ink.tsx";
import { TurnBar, useMoreBelow } from "./more-below.tsx";
import { count } from "./paper-text.ts";
import { deltaWords, heartsWords } from "./hearts-words.ts";

/**
 * The hearts: five, drawn with the brush, each whole, half or empty. They show how close a person stands to the manager and are no
 * threshold for anything. A whole heart is rouge, the red pen of the manager, and an empty one is only its outline.
 */

/** A heart, a little uneven as a brush leaves it, in a box of 24 by 22. */
const HEART = "M12.2 20.6C6 15.8 1.6 12 1.4 7.2C1.3 3.8 3.9 1.4 7.1 1.5C9.2 1.6 11 2.8 12 4.7C13.1 2.6 15.2 1.3 17.4 1.5C20.6 1.8 22.8 4.5 22.5 7.7C22.1 12.2 17.9 15.9 12.2 20.6Z";
/** The left half of it, to fill for half a heart. */
const HEART_LEFT = "M12 4.7C11 2.8 9.2 1.6 7.1 1.5C3.9 1.4 1.3 3.8 1.4 7.2C1.6 12 6 15.8 12.2 20.6Z";

type Fill = "full" | "half" | "empty";

function Heart({ fill }: { fill: Fill }) {
  return (
    <svg class={`heart is-${fill}`} viewBox="0 0 24 22" aria-hidden="true" focusable="false" data-fill={fill}>
      <path class="heart-line" d={HEART} />
      {fill === "full" ? <path class="heart-fill" d={HEART} /> : null}
      {fill === "half" ? <path class="heart-fill" d={HEART_LEFT} /> : null}
    </svg>
  );
}

export interface HeartsProps {
  /** 0 to 10, in half hearts. */
  value: number;
  size?: "s" | "m";
  /** Given, the hearts are a button that opens the card of the relation. */
  onOpen?: () => void;
}

/** The five hearts. With `onOpen` they can be pressed, and press open the card that says what they are made of. */
export function Hearts({ value, size = "m", onOpen }: HeartsProps) {
  const { whole, half } = heartParts(value);
  const label = t("hearts.label", { words: heartsWords(getLang(), value) });
  const fills: Fill[] = [0, 1, 2, 3, 4].map((i) => (i < whole ? "full" : i === whole && half ? "half" : "empty"));
  const body = fills.map((fill, i) => <Heart key={i} fill={fill} />);
  if (onOpen === undefined) {
    return (
      <span class={`hearts hearts-${size}`} role="img" aria-label={label} data-testid="hearts" data-value={value}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" class={`hearts hearts-${size} is-button`} aria-label={`${label}${getLang() === "zh" ? "。" : ". "}${t("hearts.open")}`} title={t("hearts.open")} data-testid="hearts" data-value={value} onClick={onOpen}>
      {body}
    </button>
  );
}

/** A change with its sign: "+half a heart", "−一颗心". The minus is the sign of arithmetic and not a hyphen. */
const signed = (delta: number, amount: string): string => `${delta > 0 ? "+" : "\u2212"}${amount}`;

/** A heart that has just moved: a small heart with the sign and the reason, which names the person whose heart it is. It stays a few seconds and is put away by the page. */
export function HeartPop({ delta, why, name }: { delta: number; why: HeartWhy; name: string }) {
  const lang = getLang();
  return (
    <span class={`heart-pop ${delta > 0 ? "is-up" : "is-down"}`} data-testid="heart-pop" data-delta={delta} data-why={why} role="status">
      <Heart fill={delta > 0 ? "full" : "empty"} />
      <span class="heart-pop-sign">{signed(delta, deltaWords(lang, delta))}</span>
      <span class="heart-pop-why">{t(`hearts.why.${why}`, { name })}</span>
    </span>
  );
}

// --- The card ----------------------------------------------------------------------------------------------

export interface HeartsCardProps {
  /** The relation with the person, from the `people` of the frame. */
  npc: Relation;
  /** The name of the person, in the language of the page. */
  name?: string;
  lang?: Lang;
  /** The game day, so that the days a promise falls due can be said as today or tomorrow. */
  today?: number | null;
  /** The name of a small thing by its id (tea, wine), for the tastes the manager has found out. */
  itemName?: (id: string) => string;
  /** Given, a gift can be given from the card. `giftOff` is the reason it cannot now, in words. */
  onGift?: () => void;
  giftOff?: string | null;
}

function when(lang: Lang, change: HeartChange): string {
  return `${dayLabel(lang, change.day)} ${clockText(change.hour, change.minute)}`;
}

/** The relation with one person, in plain words: whether they trust the manager, who owes whom, what is promised, what changed and how to get closer. */
export function HeartsCard({ npc, name = npc.id, lang = getLang(), today = null, itemName = (id) => id, onGift, giftOff = null }: HeartsCardProps) {
  const card = npc.card;
  const taste = (like: "like" | "dislike" | "neutral"): string[] => npc.likes.filter((row) => row.like === like).map((row) => itemName(row.item));
  return (
    <div class="hearts-card" data-testid="hearts-card" data-person={npc.id}>
      <div class="hearts-head">
        <Hearts value={npc.hearts} size="m" />
        <p class="hearts-trust" data-testid="hearts-trust" data-trust={card?.trust ?? "stranger"}>
          {t(`hearts.trust.${card?.trust ?? "stranger"}`, { name })}
        </p>
      </div>
      {card === null ? (
        <p class="hearts-unmet" data-testid="hearts-unmet">
          {t("hearts.unmet", { name })}
        </p>
      ) : (
        <>
          <p class="hearts-favours" data-testid="hearts-favours">
            {card.owesYou > 0
              ? t(card.owesYou === 1 ? "hearts.favour.owesYou.one" : "hearts.favour.owesYou", { name, n: count(lang, card.owesYou) })
              : card.youOwe > 0
                ? t(card.youOwe === 1 ? "hearts.favour.youOwe.one" : "hearts.favour.youOwe", { name, n: count(lang, card.youOwe) })
                : t("hearts.favour.none")}
          </p>
          {card.owesYou > 0 && card.youOwe > 0 ? (
            <p class="hearts-favours" data-testid="hearts-favours-back">
              {t(card.youOwe === 1 ? "hearts.favour.youOwe.one" : "hearts.favour.youOwe", { name, n: count(lang, card.youOwe) })}
            </p>
          ) : null}
          {card.youPromised.length === 0 ? null : (
            <section class="hearts-block" data-testid="hearts-you-promised">
              <h3 class="hearts-title">{t("hearts.you.title", { name })}</h3>
              <ul>
                {card.youPromised.map((p) => (
                  <li key={p.id} data-testid="hearts-promise" data-id={p.id}>
                    {p.due === null
                      ? pick(pledgeName(p.what, p.item, p.amount), lang)
                      : t("hearts.you.item", { what: pick(pledgeName(p.what, p.item, p.amount), lang), day: dayLabel(lang, p.due) })}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {card.promisedYou.length === 0 ? null : (
            <section class="hearts-block" data-testid="hearts-promised-you">
              <h3 class="hearts-title">{t("hearts.them.title", { name })}</h3>
              <ul>
                {card.promisedYou.map((p) => (
                  <li key={p.id} data-testid="hearts-owed" data-id={p.id} data-state={p.state}>
                    <span>{pick(p.what, lang)}</span>
                    {p.due === null ? null : <span class="hearts-due">{t("commit.due", { when: dueWords(lang, p.due, today) })}</span>}
                    <span class="hearts-state">{t(`commit.state.${p.state === "delivered" || p.state === "broken" || p.state === "withdrawn" ? p.state : "promised"}`)}</span>
                    {p.reason === null ? null : <span class="hearts-reason">{pick(p.reason, lang)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {card.joined ? (
            <p class="hearts-waiting" data-testid="hearts-joined">
              {t("hearts.waiting.done", { name })}
            </p>
          ) : card.waiting === null || card.waiting === 0 ? null : (
            <p class="hearts-waiting" data-testid="hearts-waiting" data-waiting={card.waiting}>
              {t("hearts.waiting", { n: count(lang, card.waiting) })}
            </p>
          )}
          <section class="hearts-block" data-testid="hearts-changes">
            <h3 class="hearts-title">{t("hearts.changes.title")}</h3>
            {card.changes.length === 0 ? (
              <p class="hearts-none">{t("hearts.changes.none")}</p>
            ) : (
              <ul>
                {card.changes.map((change) => (
                  <li key={change.tick} data-testid="hearts-change" data-delta={change.delta} data-why={change.why}>
                    <span class="hearts-delta">{signed(change.delta, deltaWords(lang, change.delta))}</span>
                    <span class="hearts-why">{t(`hearts.why.${change.why}`, { name })}</span>
                    <span class="hearts-when">{when(lang, change)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <section class="hearts-block" data-testid="hearts-closer">
        <h3 class="hearts-title">{t("hearts.closer.title")}</h3>
        <p data-testid="hearts-closer-text">{t("hearts.closer.all", { name })}</p>
        {npc.likes.length === 0 ? (
          <p class="hearts-likes" data-testid="hearts-likes">
            {t("hearts.likes.unknown", { name })}
          </p>
        ) : (
          <div class="hearts-likes" data-testid="hearts-likes">
            {taste("like").length === 0 ? null : <p>{t("hearts.likes.like", { items: taste("like").join(lang === "zh" ? "、" : ", ") })}</p>}
            {taste("dislike").length === 0 ? null : <p>{t("hearts.likes.dislike", { items: taste("dislike").join(lang === "zh" ? "、" : ", ") })}</p>}
            {taste("neutral").length === 0 ? null : <p>{t("hearts.likes.neutral", { items: taste("neutral").join(lang === "zh" ? "、" : ", ") })}</p>}
          </div>
        )}
        {onGift === undefined ? null : (
          <p class="hearts-gift">
            <InkAct seed="hearts-gift" data-testid="hearts-gift" aria-disabled={giftOff !== null} class={giftOff === null ? "" : "is-off"} onClick={onGift}>
              {t("hearts.gift")}
            </InkAct>
            {giftOff === null ? null : (
              <span class="hearts-gift-off" data-testid="hearts-gift-off">
                {giftOff}
              </span>
            )}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * The card as a sheet over the map, for the person the player pressed the hearts of (`Play.openHearts`): from the card of a person, from the
 * talk, from the people book. The world stands still while it is up. It closes with its corner, its word and Escape.
 */
export function HeartsSheet({ play, frame, scene, lang, itemName, onGift, giftOff }: { play: Play; frame: ViewFrame | null; scene: Scene | null; lang: Lang; itemName?: (id: string) => string; onGift?: (id: string) => void; giftOff?: (id: string) => string | null }) {
  const id = play.state.heartsOpen;
  const sheet = useRef<HTMLElement>(null);
  const { leaf, more } = useMoreBelow<HTMLDivElement>(id);
  const open = id !== null;
  useEffect(() => {
    play.hold.set("hearts", open);
    return () => play.hold.set("hearts", false);
  }, [play, open]);
  useLayoutEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>("[data-sheet-focus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      play.closeHearts();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, play]);
  if (id === null) return null;
  const row = frame?.relations.get(id);
  const person = scene?.cast.find((p) => p.id === id);
  const name = person === undefined ? id : pick(person.name, lang);
  return (
    <section ref={sheet} class="sheet paper-slip sheet-hearts" data-testid="hearts-sheet" data-person={id} role="dialog" aria-label={t("hearts.sheet.title", { name })}>
      <CloseCorner label={t("hearts.close")} testid="hearts-x" onClose={() => play.closeHearts()} />
      <header class="sheet-head">
        <h2 class="sheet-title">{t("hearts.sheet.title", { name })}</h2>
      </header>
      <div class="sheet-scroll" ref={leaf}>
        {row === undefined ? (
          <p data-testid="hearts-unmet">{t("hearts.unmet", { name })}</p>
        ) : (
          <HeartsCard npc={row} name={name} lang={lang} today={frame?.time.day ?? null} itemName={itemName} onGift={onGift === undefined ? undefined : () => onGift(id)} giftOff={giftOff === undefined ? null : giftOff(id)} />
        )}
        {more ? <TurnBar leaf={leaf} word={t("notebook.turn")} testId="hearts-turn" /> : null}
      </div>
      <div class="sheet-foot">
        <InkAct seed="hearts" data-testid="hearts-close" data-sheet-focus onClick={() => play.closeHearts()}>
          {t("hearts.close")}
        </InkAct>
      </div>
    </section>
  );
}
