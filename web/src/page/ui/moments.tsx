import { type Lang, pick, t } from "../../i18n/index.ts";
import type { MomentCard } from "../moments.ts";
import type { Scene } from "../scene.ts";
import { clockText, dayLabel } from "./format.ts";

/** The words of a moment, as the show of it said them: an echo names who brought the story back. */
export function momentWords(card: MomentCard, scene: Scene | null, lang: Lang): string {
  if (card.kind !== "echo") return t(`moment.${card.kind}`);
  const person = card.from === null ? undefined : scene?.cast.find((p) => p.id === card.from);
  if (card.from === null) return t("moment.echoPlain");
  return t("moment.echo", { from: person === undefined ? card.from : pick(person.name, lang) });
}

/** Where and when a moment was: "石桥，第三天 09:10". */
export function momentWhere(card: MomentCard, scene: Scene | null, lang: Lang): string {
  const place = scene?.places.find((p) => p.id === card.place);
  return t("moments.where", { place: place === undefined ? card.place : pick(place.name, lang), when: `${dayLabel(lang, card.time.day)} ${clockText(card.time.hour, card.time.minute)}` });
}

/**
 * The moments of the game at the foot of the ending page, one small picture for each in the order they happened, with the words of the moment and where
 * and when it was. A moment the page has no picture of (a game that was loaded without them) is a small paper card with the same words.
 */
export function MomentsRow({ cards, scene, lang }: { cards: readonly MomentCard[]; scene: Scene | null; lang: Lang }) {
  if (cards.length === 0) return null;
  return (
    <section class="ending-card ending-wide ending-moments" data-testid="ending-moments" aria-labelledby="ending-moments-title">
      <h3 class="ending-card-title" id="ending-moments-title">
        {t("moments.title")}
      </h3>
      <ol class="moments-row">
        {cards.map((card) => {
          const words = momentWords(card, scene, lang);
          const where = momentWhere(card, scene, lang);
          return (
            <li key={card.kind} class="moment" data-testid="moment" data-kind={card.kind} data-tick={card.tick} data-picture={card.picture !== null}>
              {card.picture === null ? (
                <div class="paper-slip moment-card" data-testid="moment-card">
                  <p class="moment-words" data-testid="moment-words">
                    {words}
                  </p>
                  <p class="moment-where" data-testid="moment-where">
                    {where}
                  </p>
                </div>
              ) : (
                <>
                  <img class="moment-picture" data-testid="moment-picture" src={card.picture} alt={t("moments.pictureOf", { words })} width="216" height="135" />
                  <p class="moment-words" data-testid="moment-words">
                    {words}
                  </p>
                  <p class="moment-where" data-testid="moment-where">
                    {where}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
