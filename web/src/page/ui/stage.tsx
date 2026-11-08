import { useEffect, useRef, useState } from "preact/hooks";
import { hasMessage, type Lang, pick, t } from "../../i18n/index.ts";
import { autosaveWhen } from "../autosave.ts";
import type { PageState } from "../client.ts";
import type { MapView } from "../map/map-view.ts";
import type { Ping, Play } from "../play.ts";
import { failureText } from "../save-notice.ts";
import type { Scene } from "../scene.ts";
import { resolveValues } from "./common.tsx";
import { clockText, roleText } from "./format.ts";
import { signalClass } from "./guide.tsx";
import { CloseIcon, FitIcon, MinusIcon, PlusIcon } from "./icons.tsx";

export interface Hover {
  id: string;
}

/** The buttons for the camera, over the top right corner of the map. */
export function MapTools({ view }: { view: MapView }) {
  return (
    <div class="map-tools" role="group" aria-label={t("map.label")} title={t("map.hint")}>
      <button type="button" class="tool" data-testid="map-zoom-in" aria-label={t("map.zoomIn")} title={t("map.zoomIn")} onClick={() => view.zoomBy(1.4)}>
        <PlusIcon />
      </button>
      <button type="button" class="tool" data-testid="map-zoom-out" aria-label={t("map.zoomOut")} title={t("map.zoomOut")} onClick={() => view.zoomBy(1 / 1.4)}>
        <MinusIcon />
      </button>
      <button type="button" class="tool" data-testid="map-fit" aria-label={t("map.fit")} title={t("map.fit")} onClick={() => view.fit()}>
        <FitIcon />
      </button>
    </div>
  );
}

/** What the colours of the lights that travel over the map mean. */
export function MapLegend() {
  return (
    <div class="map-legend" data-testid="map-legend">
      <span class="legend-title">{t("legend.title")}</span>
      <span class="legend-item">
        <i class="dot dot-blame" />
        {t("legend.blame")}
      </span>
      <span class="legend-item">
        <i class="dot dot-clear" />
        {t("legend.clear")}
      </span>
      <span class="legend-item">
        <i class="dot dot-other" />
        {t("legend.other")}
      </span>
    </div>
  );
}

/** A small card over the person under the pointer. It follows the piece, not the pointer. */
export function PersonTooltip({ view, scene, hover, lang, state }: { view: MapView; scene: Scene | null; hover: Hover | null; lang: Lang; state: PageState }) {
  const box = useRef<HTMLDivElement>(null);
  const id = hover?.id ?? null;
  useEffect(() => {
    const element = box.current;
    if (element === null || id === null) return;
    let frame = 0;
    const follow = (): void => {
      // The card hangs from the top of the head, which the map says (the feet are for a click).
      const at = view.headPositionOf(id);
      if (at !== null) element.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id, view]);
  if (id === null || scene === null) return null;
  const person = scene.cast.find((p) => p.id === id);
  if (person === undefined) return null;
  const doing = state.frame?.npcs.find((n) => n.id === id) as { activity?: string } | undefined;
  const activity = doing?.activity === undefined ? undefined : scene.activities.get(doing.activity);
  const role = roleText(person, lang);
  return (
    <div class="tooltip" ref={box} data-testid="tooltip" role="tooltip">
      <div class="tooltip-card">
        <strong>{pick(person.name, lang)}</strong>
        {role === null ? null : <span>{role}</span>}
        {activity === undefined ? null : <em>{pick(activity, lang)}</em>}
      </div>
    </div>
  );
}

/**
 * The newest note of the host, the notes of the game (what the town answered), the line that says the game was saved by itself or that it could not
 * be, and the error that stopped it, at the top of the map. The note of a save that could not be made waits (`waits`: a sheet, the menu, the ledger or
 * the notebook lies over the place where it would be) behind what lies there, as the cards wait behind each other, and behind a card that holds the
 * world: the page saves at the paper of the morning, and the paper lies over that place. It is there when they are put away.
 */
export function Toasts({ s, play, lang, waits = false }: { s: PageState; play: Play; lang: Lang; waits?: boolean }) {
  const [dismissed, setDismissed] = useState<object | null>(null);
  const last = s.notices[s.notices.length - 1];
  const count = s.notices.length;
  const key = last === undefined ? "" : `notice.${last.code}`;
  // The kind of the failure whose notice is on screen now. It counts as told from then on, and not before: a notice that waits behind a card has told nobody.
  const failedShown = play.state.saveFailed === null || waits || play.guide.cardUp ? null : play.state.saveFailed;
  useEffect(() => {
    if (failedShown !== null) play.saveFailureTold(failedShown);
  }, [play, failedShown]);
  return (
    <div class="toasts">
      {play.state.notes.map((note) => (
        <p key={note.id} class={`toast toast-game toast-${note.kind}`} role="status" data-testid="game-note" data-kind={note.kind} data-reason={note.reason ?? ""}>
          <span>{t(note.key, resolveValues(note.values, lang))}</span>
          <button type="button" class="toast-close" aria-label={t("menu.close")} onClick={() => play.dismissNote(note.id)}>
            <CloseIcon />
          </button>
        </p>
      ))}
      {play.state.saved === null ? null : (
        <p class="toast toast-save" role="status" data-testid="autosave-note" data-kind={play.state.saved.kind}>
          <span>{t("autosave.done", { when: autosaveWhen(play.state.saved, lang) })}</span>
        </p>
      )}
      {failedShown === null ? null : (
        <p class="toast toast-bad" role="status" data-testid="save-failed" data-kind={failedShown}>
          <span>{failureText(failedShown)}</span>
          <button type="button" class="toast-close" data-testid="save-failed-close" aria-label={t("menu.close")} onClick={() => play.dismissSaveFailure()}>
            <CloseIcon />
          </button>
        </p>
      )}
      {s.error === null ? null : (
        <div class="toast toast-error" role="alert" data-testid="error">
          {s.error.code}: {s.error.message}
        </div>
      )}
      {last === undefined || dismissed === last ? null : (
        <p class="toast" role="status" data-testid="host-notice" data-count={count}>
          <span>{hasMessage(key) ? t(key) : last.message}</span>
          <button type="button" class="toast-close" aria-label={t("menu.close")} onClick={() => setDismissed(last)}>
            <CloseIcon />
          </button>
        </p>
      )}
    </div>
  );
}

/** Covers the map while the world starts, and says why when it cannot. */
export function Veil({ s, mapFailed, mapReady }: { s: PageState; mapFailed: boolean; mapReady: boolean }) {
  let text: string | null = null;
  if (s.phase === "failed") text = t("app.failed");
  else if (mapFailed) text = t("app.noWebgl");
  else if (s.phase === "boot") text = t("app.starting");
  else if (s.frame === null || s.scene === null || !mapReady) text = t("app.loading");
  if (text === null) return null;
  const failed = s.phase === "failed" || mapFailed;
  return (
    <div class={`veil${failed ? " veil-failed" : ""}`} data-testid="veil" role="status">
      {failed ? null : <span class="spinner" />}
      <span>{text}</span>
    </div>
  );
}

/** A ring that follows a person or a place on the map, with the name, for the few seconds the page wants the eye there. */
export function MapPing({ ping, view, scene, lang }: { ping: Ping | null; view: MapView; scene: Scene | null; lang: Lang }) {
  const box = useRef<HTMLDivElement>(null);
  const id = ping?.id ?? null;
  const kind = ping?.kind ?? "person";
  useEffect(() => {
    const element = box.current;
    if (element === null || id === null) return;
    let frame = 0;
    const follow = (): void => {
      let at: { x: number; y: number } | null = null;
      // The ring is round the person's body, which the map says (the feet are for a click, the head for a card).
      if (kind === "person") at = view.bodyPositionOf(id);
      else {
        const door = scene?.places.find((p) => p.id === id)?.door;
        at = door == null ? null : view.cellToScreen(door[0], door[1]);
      }
      if (at !== null) element.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id, kind, view, scene]);
  if (ping === null) return null;
  const name = kind === "person" ? scene?.cast.find((p) => p.id === id) : scene?.places.find((p) => p.id === id);
  return (
    <div class="ping" ref={box} data-testid="map-ping" data-id={ping.id} data-kind={ping.kind} aria-hidden="true">
      <i class="ping-ring" />
      {name === undefined ? null : <span class="ping-label">{pick(name.name, lang)}</span>}
    </div>
  );
}

/** A calm over the edges of the map while the player talks, to say that the world stands still. */
export function Calm({ on }: { on: boolean }) {
  return <div class="calm" data-testid="calm" data-on={on} aria-hidden="true" />;
}

/**
 * Who the player is talking to, that the world stands still meanwhile (or that time is passing while an act is paid for, and the
 * acts wait for it), and when the person has to go.
 */
export function TalkBadge({ play, scene, lang }: { play: Play; scene: Scene | null; lang: Lang }) {
  const talk = play.state.talk;
  if (talk === null) return null;
  const person = scene?.cast.find((p) => p.id === talk.npc);
  const leaves = talk.leavesAt;
  const paying = play.paying;
  return (
    <div class={`talk-badge${signalClass(play, "talk-badge")}`} data-sig="talk-badge" data-testid="talk-badge" data-npc={talk.npc} data-paying={paying}>
      <div class="talk-badge-text">
        <strong data-testid="talk-with">{t("talk.with", { name: person === undefined ? talk.npc : pick(person.name, lang) })}</strong>
        {paying ? <span data-testid="talk-passing">{t("talk.passing")}</span> : <span data-testid="talk-still">{t("talk.still")}</span>}
      </div>
      {leaves === null ? null : (
        <div class="talk-clock">
          <span data-testid="talk-leaves" data-hour={leaves.hour} data-minute={leaves.minute}>
            {t("talk.leaves", { time: clockText(leaves.hour, leaves.minute) })}
          </span>
        </div>
      )}
    </div>
  );
}

/** A way back to the ending page, once it has been put away to look at the town. */
export function EndingTab({ show, onShow }: { show: boolean; onShow: () => void }) {
  if (!show) return null;
  return (
    <button type="button" class="ink-frame ending-tab" data-testid="ending-tab" onClick={onShow}>
      {t("ending.show")}
    </button>
  );
}
