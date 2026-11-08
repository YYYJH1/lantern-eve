import { getLang, hasMessage, type Lang, pick, t } from "../../i18n/index.ts";
import type { NoteValues } from "../play.ts";
import type { Name, Scene } from "../scene.ts";
import { count } from "./paper-text.ts";

/** What a value shows until the core has one. */
export const Dash = () => (
  <span class="dash" data-empty="true">
    {t("hud.none")}
  </span>
);

/** The name of a kind of weather, from the scene when it names it, else from the page's own table. */
export function weatherName(scene: Scene | null, lang: Lang, id: string): string {
  const named = scene?.weather.get(id);
  if (named !== undefined) return pick(named, lang);
  const key = `weather.${id}`;
  return hasMessage(key) ? t(key) : id;
}

// The names of places and people are in names.ts, which the unit tests can read; the views take them from here.
export { personName, placeName } from "./names.ts";

/** The names in the values of a note, in the language of the page. */
export const resolveValues = (values: NoteValues, lang: Lang): Record<string, string | number> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "object" ? pick(value as Name, lang) : value]));

/** A minute count on a button: "10 min", "十分钟". */
export function Cost({ minutes, id }: { minutes: number | null; id: string }) {
  if (minutes === null) return null;
  return (
    <span class="verb-cost" data-testid={`cost-${id}`} data-minutes={minutes}>
      {t("talk.cost", { n: count(getLang(), minutes) })}
    </span>
  );
}
