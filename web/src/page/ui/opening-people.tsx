import { type Lang, pick, t } from "../../i18n/index.ts";
import type { HostClient } from "../client.ts";
import { openingSix } from "../people.ts";
import type { ThemeChoice } from "../prefs.ts";
import type { Scene } from "../scene.ts";
import { useClientState, useScene } from "./hooks.ts";
import { Portrait } from "./portrait.tsx";
import { LanguageSwitch, ThemeSwitch } from "./topbar.tsx";

export interface OpeningPeopleProps {
  scene: Scene | null;
  lang: Lang;
  theme: ThemeChoice;
  /** Whether the page has the sprites to cut the portraits from. */
  sprites: boolean;
  onEnter(): void;
}

/**
 * The page between Start and the first day: six people drawn small, each with the line the town says of them, which says who they are, which
 * family and what they do, and under them that there are more to meet. It shows what anybody in town knows of them and nothing of the case, and
 * it is the same in every game.
 */
export function OpeningPeople({ scene, lang, theme, sprites, onEnter }: OpeningPeopleProps) {
  const six = openingSix(scene);
  return (
    <div class="opening opening-people" data-testid="opening-people" data-lang={lang}>
      <div class="opening-corner">
        <LanguageSwitch lang={lang} />
        <ThemeSwitch theme={theme} />
      </div>
      <main class="opening-card paper-page people-opening-card">
        <h1 class="people-opening-title" data-lang={lang} data-testid="people-opening-title">
          {t("people.opening.title")}
        </h1>
        <ul class="people-six" data-testid="people-six" aria-label={t("people.opening.list")}>
          {six.map((person) => (
            <li key={person.id} class="people-six-person" data-testid="people-six-person" data-person={person.id} data-family={person.family ?? ""}>
              <Portrait person={person} size={76} sprites={sprites} />
              <div class="people-six-text">
                <h2 class="people-six-name" data-testid="people-six-name">
                  {pick(person.name, lang)}
                </h2>
                <p class="people-six-intro" data-testid="people-six-intro">
                  {pick(person.intro, lang)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p class="people-more" data-testid="people-more">
          {t("people.opening.more")}
        </p>
        <button type="button" class="ink-frame opening-start" data-testid="people-enter" onClick={onEnter}>
          {t("people.opening.enter")}
        </button>
      </main>
    </div>
  );
}

/** The page with what it reads of the host: the scene of the game behind it, which names the six. */
export function PeopleGate({ client, lang, theme, sprites, onEnter }: { client: HostClient; lang: Lang; theme: ThemeChoice; sprites: boolean; onEnter: () => void }) {
  const host = useClientState(client);
  const scene = useScene(host);
  return <OpeningPeople scene={scene} lang={lang} theme={theme} sprites={sprites} onEnter={onEnter} />;
}
