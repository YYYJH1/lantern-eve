import { getLang, hasMessage, pick, t } from "../../i18n/index.ts";
import type { Caption } from "../director.ts";
import type { Play } from "../play.ts";

/** The values of a caption: the plain ones, the names of the game and the words of the game in quotation marks, in the language of the page. */
function valuesOf(caption: Caption): Record<string, string | number> {
  const values: Record<string, string | number> = { ...caption.values };
  for (const [key, name] of Object.entries(caption.names ?? {})) values[key] = pick(name, getLang());
  for (const [key, words] of Object.entries(caption.quotes ?? {})) values[key] = t("ending.quote", { words: pick(words, getLang()) });
  return values;
}

/**
 * What a show puts over the map (`director.ts`): a veil that keeps the map and the page under it from the pointer while the show plays, the
 * words of the stop that is on, on a slip of paper, and for the festival night the button in the corner that skips it. A moment goes on at a click
 * on the veil (which is a button, so that Enter does it too) or at Esc; the festival night only at its button or Esc.
 */
export function DirectorLayer({ play }: { play: Play }) {
  const director = play.director;
  const now = director.current;
  if (now === null) return null;
  const caption = now.caption;
  const text = caption !== null && hasMessage(caption.key) ? t(caption.key, valuesOf(caption)) : null;
  const skippable = now.show.skippable;
  return (
    <div class="director" data-testid="director" data-show={now.show.id} data-stop={now.stop} data-skippable={skippable}>
      {skippable ? (
        <div class="director-veil" data-testid="director-veil" role="presentation" />
      ) : (
        <button type="button" class="director-veil" data-testid="director-veil" aria-label={t("director.go")} onClick={() => director.skip()} />
      )}
      {text === null ? null : (
        <p class={caption?.style === "title" ? "director-title" : "paper-slip director-caption"} data-testid="director-caption" data-style={caption?.style ?? "slip"} role="status">
          {text}
        </p>
      )}
      {skippable ? (
        <button type="button" class="ink-frame director-skip" data-testid="director-skip" onClick={() => director.skip()}>
          {t("director.skip")}
        </button>
      ) : null}
    </div>
  );
}
