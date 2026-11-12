import { type Lang, pick, t } from "../../i18n/index.ts";
import type { NotebookEntry } from "../notebook.ts";
import type { Play } from "../play.ts";
import type { Like, Relation } from "../relations.ts";
import type { Person, Scene } from "../scene.ts";
import { roleText } from "./format.ts";
import { Hearts } from "./hearts.tsx";
import { count } from "./paper-text.ts";
import { itemsWords, knownPeople, roleNamesFamily, stampWords } from "./people-text.ts";
import { Portrait } from "./portrait.tsx";

export interface PeopleBookProps {
  rows: readonly Relation[] | null;
  play: Play;
  scene: Scene | null;
  /** The lines of the notebook: what each person told the player is read from them, with when and where. */
  entries: readonly NotebookEntry[];
  lang: Lang;
  /** Whether the page has the sprites to cut the portraits from. */
  sprites: boolean;
}

const LIKES: ReadonlyArray<{ like: Like; label: "people.likes" | "people.dislikes" | "people.neutral" }> = [
  { like: "like", label: "people.likes" },
  { like: "dislike", label: "people.dislikes" },
  { like: "neutral", label: "people.neutral" },
];

interface LineProps {
  row: Relation;
  person: Person | undefined;
  scene: Scene | null;
  told: readonly NotebookEntry[];
  lang: Lang;
  sprites: boolean;
  /** Opens the card of the hearts of the person, the one that the talk and the card of the person open too. */
  onHearts: () => void;
}

/** One person: the portrait, the name with who they are, the hearts, and what the player has learned of them, each only once learned. */
function PersonLine({ row, person, scene, told, lang, sprites, onHearts }: LineProps) {
  if (person === undefined) return null;
  const role = roleText(person, lang);
  const family = person.family === null ? undefined : scene?.families.get(person.family);
  const sayFamily = family !== undefined && !roleNamesFamily(`${person.role.zh} ${person.role.en}`, family);
  const name = pick(person.name, lang);
  return (
    <li class="people-line" data-testid="people-line" data-person={row.id} data-family={person.family ?? ""}>
      <Portrait person={person} size={58} sprites={sprites} />
      <div class="people-main">
        <h3 class="people-name">
          <strong data-testid="people-name">{name}</strong>
          {role === null ? null : (
            <span class="people-role" data-testid="people-role">
              {role}
            </span>
          )}
          {family === undefined || !sayFamily ? null : (
            <span class="people-family" data-testid="people-family">
              {pick(family, lang)}
            </span>
          )}
        </h3>
        <dl class="people-facts">
          {row.met.length === 0 ? null : (
            <div data-testid="people-met">
              <dt>{t("people.met")}</dt>
              <dd>
                <ul>
                  {row.met.map((stamp) => (
                    <li key={stamp.tick} data-testid="people-met-at" data-tick={stamp.tick} data-place={stamp.place ?? ""}>
                      {stampWords(scene, lang, stamp)}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {row.asked === null ? null : (
            <div data-testid="people-asked">
              <dt>{t("people.asked")}</dt>
              <dd>
                <span data-testid="people-asked-what">{pick(row.asked.what, lang)}</span>
                <small data-testid="people-asked-for">{t("people.asked.for", { request: pick(row.asked.forRequest, lang) })}</small>
              </dd>
            </div>
          )}
          {LIKES.map(({ like, label }) => {
            const items = row.likes.filter((taste) => taste.like === like).map((taste) => taste.item);
            return items.length === 0 ? null : (
              <div key={like} data-testid={`people-${like}`}>
                <dt>{t(label)}</dt>
                <dd>{itemsWords(scene, lang, items)}</dd>
              </div>
            );
          })}
          {told.length === 0 ? null : (
            <div data-testid="people-said">
              <dt>{t("people.said")}</dt>
              <dd>
                <ul>
                  {told.map((entry) => (
                    <li key={entry.id} data-testid="people-said-entry" data-entry={entry.id}>
                      <span>{pick(entry.text, lang)}</span>
                      {entry.at === null ? null : <small data-testid="people-said-at">{stampWords(scene, lang, entry.at)}</small>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div class="people-hearts">
        <Hearts value={row.hearts} size="s" onOpen={onHearts} />
      </div>
    </li>
  );
}

/**
 * The people book, a page of the notebook: a line for each person the player has talked with, with the portrait, the name, who they are and
 * their family, the hearts (which open the card of what stands behind them, as everywhere else), where and when they met, the return the person asked, what they
 * like, and what they told the player with when and where it was told. Every part is there only once the player has it, and none of it
 * comes from anywhere but the frame the player is shown.
 */
export function PeopleBook({ rows, play, scene, entries, lang, sprites }: PeopleBookProps) {
  const known = knownPeople(rows);
  const cast = new Map((scene?.cast ?? []).map((person) => [person.id, person]));
  const told = (id: string): NotebookEntry[] => entries.filter((entry) => entry.source.kind === "heard" && entry.source.whoId === id);
  return (
    <>
      <p class="leaf-count" data-testid="people-count">
        {t(known.length === 1 ? "people.count.one" : "people.count", { n: count(lang, known.length) })}
      </p>
      {known.length === 0 ? (
        <p class="paper-empty" data-testid="people-empty">
          {t("people.empty")}
        </p>
      ) : (
        <ul class="people-lines" data-testid="people-lines">
          {known.map((row) => (
            <PersonLine key={row.id} row={row} person={cast.get(row.id)} scene={scene} told={told(row.id)} lang={lang} sprites={sprites} onHearts={() => play.openHearts(row.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

