import { type Lang, pick, t } from "../../i18n/index.ts";
import type { ViewFrame } from "../frame.ts";
import { TALK_RANGE } from "../play.ts";
import type { Play } from "../play.ts";
import type { Scene } from "../scene.ts";
import { buttonTasks, type CardNotes, commitmentsOf, type SliceFrame, tasksAbout, windowOf } from "../slice.ts";
import { placeName } from "./common.tsx";
import { agreedText, clockText, dayLabel, minutesText, roleText } from "./format.ts";
import { Hearts } from "./hearts.tsx";
import { count } from "./paper-text.ts";
import { whenWhere } from "./slip-text.ts";
import { InkAct } from "./ink.tsx";
import { actionLabel, CommitmentReason, CommitmentState } from "./taskcard.tsx";

/** What the card of a person lets the player do: talk to them, or walk up to them first. */
export interface TalkControl {
  /** Whether the player can start a talk now (they are free to walk, and not talking already). */
  can: boolean;
  /** Whether this is the person they are talking to. */
  talking: boolean;
  onTalk(id: string): void;
}

function Favours({ notes, lang, name }: { notes: CardNotes; lang: Lang; name: string }) {
  const n = notes.favours;
  if (n === null) return null;
  const text = n > 0 ? t("person.favours.owes", { n: count(lang, n) }) : n < 0 ? t("person.favours.owed", { name, n: count(lang, -n) }) : t("person.favours.none");
  return (
    <div data-testid="person-favours" data-favours={n}>
      <dt>{t("person.favours")}</dt>
      <dd>{text}</dd>
    </div>
  );
}

function Stance({ notes, lang }: { notes: CardNotes; lang: Lang }) {
  const stance = notes.stance;
  if (stance === null) return null;
  const when = `${dayLabel(lang, stance.at.day)} ${clockText(stance.at.hour, stance.at.minute)}`;
  return (
    <div data-testid="person-stance">
      <dt>{t("person.stance")}</dt>
      <dd>
        <span class="stance-text">{pick(stance.text, lang)}</span>
        <span class="stance-when" data-testid="person-stance-when">
          {stance.how === null ? t("person.stance.when", { when }) : t("person.stance.whenHow", { when, how: pick(stance.how, lang) })}
        </span>
      </dd>
    </div>
  );
}

/** What the person leans to, and the other account they were told and did not take in: only what they said to the player. */
function Lean({ notes, lang }: { notes: CardNotes | null; lang: Lang }) {
  const stance = notes?.stance ?? null;
  if (stance === null || stance.rival === null) return null;
  // The sentences end with their full stops: English words are set apart by a space and Chinese ones are not.
  const gap = lang === "zh" ? "" : " ";
  return (
    <p class="person-lean" data-testid="person-lean">
      <strong class="lean-label">{t("person.lean")}</strong>
      {gap}
      <span class="lean-held" data-testid="person-lean-held">
        {pick(stance.text, lang)}
      </span>
      {gap}
      <span class="lean-rival" data-testid="person-lean-rival">
        <span class="lean-by">{t("person.lean.rival", { who: pick(stance.rival.who, lang) })}</span>
        {gap}
        <span class="lean-account">{pick(stance.rival.text, lang)}</span>
      </span>
    </p>
  );
}

export interface PersonCardProps {
  id: string | null;
  frame: ViewFrame | null;
  scene: Scene | null;
  slice: SliceFrame;
  lang: Lang;
  play: Play;
  control: TalkControl | null;
}

/** The person the player picked on the map: who they are, where to find them, what they agreed, and what can be done with them. */
export function PersonCard({ id, frame, scene, slice, lang, play, control }: PersonCardProps) {
  const person = id === null ? undefined : scene?.cast.find((p) => p.id === id);
  if (scene === null || person === undefined) return null;
  const here = frame?.people.find((p) => p.id === person.id);
  const me = frame?.player ?? null;
  const near = me !== null && here !== undefined && Math.max(Math.abs(me.x - here.x), Math.abs(me.y - here.y)) <= TALK_RANGE;
  const activity = here === undefined || here.activity === "" ? undefined : scene.activities.get(here.activity);
  const family = person.family === null ? undefined : scene.families.get(person.family);
  const window = windowOf(slice, person.id);
  const notes = slice.cards?.get(person.id) ?? null;
  const agreed = commitmentsOf(slice, person.id);
  const today = frame?.time.day ?? null;
  const leaves = me?.talk?.npc === person.id ? me.talk.leavesAt : null;
  const bio = pick(person.bio, lang);
  const role = roleText(person, lang);
  const relation = frame?.relations.get(person.id);
  const rows: Array<[string, string | null]> = [
    [t("person.activity"), activity === undefined ? null : pick(activity, lang)],
    [t("person.family"), family === undefined ? null : pick(family, lang)],
    [t("person.home"), placeName(scene, lang, person.home)],
    [t("person.work"), placeName(scene, lang, person.work)],
  ];
  // The buttons of the tasks that are about this person are buttons for the next act, which a player who chose the brief guidance does not get.
  const tasks = play.guide.brief ? [] : buttonTasks(tasksAbout(slice, person.id).filter((task) => task.action !== null && task.action.verb !== "talk"));
  const talking = control?.talking === true;
  const facts = (
    <dl class="facts">
        {window === null ? null : (
          <div data-testid="person-find">
            <dt>{t("person.find")}</dt>
            <dd>{whenWhere(lang, window, placeName(scene, lang, window.place), today)}</dd>
          </div>
        )}
        {notes === null || notes.find === null || notes.find.length === 0 ? null : (
          <div data-testid="person-routine">
            <dt>{t("person.routine")}</dt>
            <dd>
              <ul class="routine-list">
                {notes.find.map((entry) => {
                  const act = scene.activities.get(entry.act);
                  const when = entry.now ? t("person.routine.now") : entry.tomorrow ? t("person.routine.tomorrow", { time: minutesText(entry.from) }) : minutesText(entry.from);
                  return (
                    <li key={`${entry.from}-${entry.place}`} data-testid="person-routine-entry" data-now={entry.now} data-from={entry.from} data-tomorrow={entry.tomorrow}>
                      <span class="routine-when">{when}</span>
                      <span class="routine-where">{placeName(scene, lang, entry.place) ?? entry.place}</span>
                      {act === undefined ? null : <em class="routine-act">{pick(act, lang)}</em>}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        )}
        {notes === null || notes.wants.length === 0 ? null : (
          <div data-testid="person-wants">
            <dt>{t("person.wants")}</dt>
            <dd>
              {notes.wants.map((want) => (
                <span key={want.id} class="want" data-testid="person-want" data-id={want.id}>
                  {pick(want.text, lang)}
                </span>
              ))}
            </dd>
          </div>
        )}
        {agreed.length === 0 ? null : (
          <div data-testid="person-agreed" class="facts-agreed">
            <dt>{t("person.agreed")}</dt>
            <dd>
              <ul class="agreed-list">
                {agreed.map((c) => (
                  <li key={c.id} data-testid="person-commitment" data-id={c.id} data-state={c.state}>
                    <span class="agreed-text" data-testid="person-commitment-text">
                      {agreedText(lang, c, today)}
                    </span>
                    <CommitmentState state={c.state} />
                    <CommitmentReason commitment={c} lang={lang} />
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {notes === null ? null : <Favours notes={notes} lang={lang} name={pick(person.name, lang)} />}
        {notes === null ? null : <Stance notes={notes} lang={lang} />}
        {rows
          .filter((row): row is [string, string] => row[1] !== null)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
    </dl>
  );
  return (
    <section class="person-note paper-slip" data-testid="person-card" data-person={person.id} data-family={person.family ?? ""}>
      <div class="person-head">
        <span class="surname-seal" data-family={person.family ?? ""} aria-hidden="true" lang={lang === "zh" ? "zh-CN" : "en"}>
          {person.token[lang]}
        </span>
        <div>
          <h2 class="person-name" data-testid="person-name">
            {pick(person.name, lang)}
          </h2>
          {role === null ? null : <p class="person-role">{role}</p>}
          {relation === undefined || !relation.known ? null : (
            <div class="person-hearts" data-testid="person-hearts">
              <Hearts value={relation.hearts} size="s" onOpen={() => play.openHearts(person.id)} />
            </div>
          )}
        </div>
      </div>
      {bio === "" ? null : talking ? (
        // In a talk the controls of the talk sit under the card, so what the town says is one line that opens on a click.
        <details class="person-bio person-bio-fold" data-testid="person-bio" data-folded="true">
          <summary class="person-subtitle" data-testid="person-bio-title">
            {t("person.bio")}
          </summary>
          <p class="person-bio-text" data-testid="person-bio-text">
            {bio}
          </p>
        </details>
      ) : (
        <div class="person-bio" data-testid="person-bio" data-folded="false">
          <h3 class="person-subtitle" data-testid="person-bio-title">
            {t("person.bio")}
          </h3>
          <p class="person-bio-text" data-testid="person-bio-text">
            {bio}
          </p>
        </div>
      )}
      <Lean notes={notes} lang={lang} />
      {leaves === null ? null : (
        <p class="person-leaves" data-testid="person-leaves" data-hour={leaves.hour} data-minute={leaves.minute}>
          <span>{t("person.leaves")}</span>
          <strong>{clockText(leaves.hour, leaves.minute)}</strong>
        </p>
      )}
      {talking ? (
        <details class="facts-fold" data-testid="person-facts">
          <summary>{t("person.details", { name: pick(person.name, lang) })}</summary>
          {facts}
        </details>
      ) : (
        facts
      )}
      {control === null ? null : (
        <div class="card-actions" data-testid="person-actions">
          <InkAct seed="card-talk" data-testid="card-talk" data-near={near} disabled={control.talking || !control.can} onClick={() => control.onTalk(person.id)}>
            {control.talking ? t("person.talking") : near ? t("person.talk") : t("person.walk")}
          </InkAct>
          {tasks.map((task) => (
            <InkAct key={task.id} seed={task.id} data-testid="person-task" data-id={task.id} data-verb={task.action?.verb} onClick={() => play.flows.run(task)}>
              {actionLabel(task, scene, lang)}
            </InkAct>
          ))}
        </div>
      )}
    </section>
  );
}
