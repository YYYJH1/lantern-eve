import { useRef } from "preact/hooks";
import { type Lang, pick, t } from "../../i18n/index.ts";
import type { Relation } from "../relations.ts";
import type { GiftHud } from "../talk-frame.ts";
import { CloseCorner, Underline } from "./ink.tsx";
import { useDismiss } from "./picker.tsx";

export interface GiftPanelProps {
  gift: GiftHud;
  /** What the manager has found out the person likes. */
  relation: Relation | undefined;
  name: string;
  lang: Lang;
  /** An act is being paid for: the gift waits. */
  disabled: boolean;
  onGive(item: { id: string; name: { zh: string; en: string } }): void;
  onClose(): void;
}

/**
 * The four small things of the day, one of which can be given to the person. What the manager already knows of the person's tastes is said
 * beside each. A gift raises their trust a little, more for what they like, and is never a way past a condition.
 */
export function GiftPanel({ gift, relation, name, lang, disabled, onGive, onClose }: GiftPanelProps) {
  const taste = (id: string): "like" | "dislike" | "neutral" | null => relation?.likes.find((row) => row.item === id)?.like ?? null;
  const box = useRef<HTMLElement>(null);
  useDismiss(box, onClose);
  return (
    <section ref={box} class="picker paper-slip gift-panel" data-testid="gift-panel" role="dialog" aria-label={t("gift.title", { name })}>
      <CloseCorner label={t("picker.close")} testid="picker-close" onClose={onClose} />
      <header class="picker-head">
        <h3 class="picker-title">{t("gift.title", { name })}</h3>
      </header>
      <p class="picker-note" data-testid="gift-note">
        {t("gift.note")}
      </p>
      <ul class="picker-list">
        {gift.items.map((item) => {
          const known = taste(item.id);
          return (
            <li key={item.id}>
              <button type="button" class="picker-option ink-act" data-testid="gift-item" data-id={item.id} data-taste={known ?? ""} disabled={disabled} onClick={() => onGive(item)}>
                <span class="picker-label">{pick(item.name, lang)}</span>
                {known === null ? null : <span class="picker-badge">{t(`gift.taste.${known}`, { name })}</span>}
                <Underline seed={item.id} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
