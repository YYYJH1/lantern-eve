import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { type Lang, type MessageKey, t } from "../../i18n/index.ts";
import { HostClient } from "../client.ts";
import { serverUrlFor } from "../ws-source.ts";
import type { MapView } from "../map/map-view.ts";
import type { NotebookEntry } from "../notebook.ts";
import { newestSave } from "../autosave.ts";
import { type LoadFailure, loadFailureOf } from "../load-failure.ts";
import { Play } from "../play.ts";
import { readFinished } from "../truths.ts";
import { type GalleryEntry, loadReplay, parseReplayHash, type ReplayLink, ReplayLoadError, refOf, replayHash } from "../replays.ts";
import type { ThemeChoice } from "../prefs.ts";
import type { Remembered } from "../storage.ts";
import { App } from "./app.tsx";
import { GalleryView } from "./gallery.tsx";
import { OpeningPage } from "./opening.tsx";
import { useClientState, useLang, useTheme } from "./hooks.ts";

/** The live game: the host client, the map and the player's side of it. */
export interface LiveGame {
  client: HostClient;
  view: MapView;
  play: Play;
}

/** A recording that is open: a host of its own plays it, in a worker of its own, and a map shows it. */
export interface OpenReplay {
  id: string;
  client: HostClient;
  view: MapView;
  play: Play;
}

export interface RootProps {
  live: LiveGame;
  remembered: Remembered | null;
  sampleNotebook: NotebookEntry[] | null;
  /** A worker for a host that plays a recording. */
  spawnWorker: () => Worker;
  makeView: () => MapView;
  /** Starts the live game. The page that was opened on a recording does not start it until it is let go of. */
  startLive: () => void;
  /** Whether the live game was started already, which is not so for a page that was opened on a link to a recording. */
  liveStarted: boolean;
  /** Whether the page begins with the opening page. The world is held behind it, and the page lets it go on `onBegin`. */
  intro?: boolean;
  /** The player pressed Start or Continue: the world is let go. */
  onBegin?: () => void;
  /** Called with the recording that is open, or null, for the test build to reach it. */
  onOpen?: (open: OpenReplay | null) => void;
}

/** What the player is told when a recording cannot be opened, as the key of the sentence. */
function failureKey(err: unknown): MessageKey {
  if (err instanceof ReplayLoadError) {
    const key = { not_found: "gallery.error.notFound", storage: "gallery.error.storage", network: "gallery.error.network", bad_link: "gallery.error.badLink" } as const;
    return key[err.code];
  }
  return "gallery.error.network";
}

function titleOf(open: OpenReplay, status: { seed: number } | null): string {
  const ref = refOf(open.id);
  if (ref?.source === "browser") return `#${ref.save}`;
  return status === null ? open.id : t("gallery.seed", { seed: status.seed });
}

/**
 * The page of a recording that is open: the page of a game with the controls of a recording, and the
 * address that follows it. It listens to the client of the recording, so that the page under it does not
 * draw again for each frame of the recording.
 */
function ReplayLayer({ open, onClose }: { open: OpenReplay; onClose: () => void }) {
  const s = useClientState(open.client);
  const status = s.replay;
  // The address names the moment a held recording is at, so that a link copied from it opens there.
  const holdTick = status !== null && status.phase === "ready" && !status.busy && !status.playing ? status.tick : null;
  useEffect(() => {
    if (holdTick === null || parseReplayHash(location.hash)?.id !== open.id) return;
    history.replaceState(null, "", replayHash(open.id, holdTick));
  }, [open, holdTick]);
  return (
    <div class="layer layer-replay" data-testid="replay-layer" data-id={open.id}>
      <App client={open.client} view={open.view} play={open.play} remembered={null} sampleNotebook={null} replay={{ title: titleOf(open, status), onClose }} />
    </div>
  );
}

/**
 * The opening page with what it reads of the host: whether the town is ready to be let go, and whether there are saves to pick up. It is
 * its own component so that the page listens to the host for as long as the opening page is up and not after.
 */
function OpeningGate({ client, lang, theme, failed, onStart, onContinue, onAnother, onGallery }: { client: HostClient; lang: Lang; theme: ThemeChoice; failed: LoadFailure | null; onStart: () => void; onContinue: () => void; onAnother: () => void; onGallery: () => void }) {
  const host = useClientState(client);
  // A server host has no saves, which is told from the address the page was opened on.
  const canContinue = serverUrlFor(location.search, location) === null;
  const ready = host.phase === "ready" && host.frame !== null && host.scene !== null;
  // The saves that Continue can pick up are listed once the host is there to ask.
  useEffect(() => {
    if (ready && canContinue) void client.refreshSaves().catch(() => undefined);
  }, [ready, canContinue, client]);
  // Another truth is offered to a viewer who has played a game to its end before, and only where the page began with a named game.
  const another = host.preset !== null && readFinished() !== null;
  return <OpeningPage s={host} lang={lang} theme={theme} canContinue={canContinue} ready={ready} failed={failed} another={another} onStart={onStart} onContinue={onContinue} onAnother={onAnother} onGallery={onGallery} />;
}

/**
 * The page: the live game, and over it, when the player asks, the gallery of recordings and the
 * recording that they watch. The live game is held for as long as either is on, and goes on after.
 * A recording has a client, a worker and a map of its own, so that the game under it is not touched.
 */
export function Root({ live, remembered, sampleNotebook, spawnWorker, makeView, startLive, liveStarted, intro: introFirst = false, onBegin, onOpen }: RootProps) {
  const lang = useLang();
  const theme = useTheme();
  const [gallery, setGallery] = useState(false);
  const [open, setOpen] = useState<OpenReplay | null>(null);
  // A page that is opened on a link to a recording is on its way to it from the first moment, and does not start the game.
  const [opening, setOpening] = useState<string | null>(() => parseReplayHash(location.hash)?.id ?? null);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  // The opening page is the first thing the player sees, and the world waits behind it.
  const [intro, setIntro] = useState(introFirst);
  const [continueFailed, setContinueFailed] = useState<LoadFailure | null>(null);
  const started = useRef(liveStarted);
  const heldByUs = useRef(false);
  const openNow = useRef<OpenReplay | null>(null);
  const liveRoot = useRef<HTMLDivElement>(null);
  const galleryRoot = useRef<HTMLDivElement>(null);
  openNow.current = open;

  const away = gallery || open !== null || opening !== null;

  // The game under a gallery or a recording is held, and goes on when the player is back, if it was going.
  useEffect(() => {
    if (away) {
      if (started.current && !live.client.state.paused) {
        live.client.pause();
        heldByUs.current = true;
      }
    } else if (!started.current) {
      started.current = true;
      startLive();
    } else if (heldByUs.current) {
      heldByUs.current = false;
      live.client.resume();
    }
  }, [away]);

  // What is under another page takes no click and no key.
  useEffect(() => {
    if (liveRoot.current !== null) liveRoot.current.inert = away || intro;
  }, [away, intro]);

  /** Start: a first game of the named game, with the tutorial for a player who has not been through it. */
  const start = useCallback((): void => {
    setIntro(false);
    live.play.guide.refreshPrefs();
    if (live.client.state.preset !== null && live.play.guide.tutorialWanted) live.play.guide.startTutorial();
    onBegin?.();
  }, [live, onBegin]);

  /** Another truth: a game of the rules of the first, at a seed and with a story of its own, not the story the viewer last saw told. */
  const another = useCallback((): void => {
    live.client.newGame(readFinished()?.variant ?? null);
    setIntro(false);
    live.play.guide.refreshPrefs();
    onBegin?.();
  }, [live, onBegin]);

  /** Continue: the newest save takes the place of the game behind the page, whether the player made it or the page did by itself. */
  const pickUp = useCallback(async (): Promise<void> => {
    const newest = newestSave(live.client.state.saves);
    if (newest === null) return;
    setContinueFailed(null);
    try {
      await live.client.load(newest.id);
    } catch (err) {
      setContinueFailed(loadFailureOf(err));
      return;
    }
    setIntro(false);
    live.play.guide.refreshPrefs();
    onBegin?.();
    // A game that is loaded is held for the player, who lets it go.
    live.client.resume();
  }, [live, onBegin]);
  useEffect(() => {
    if (galleryRoot.current !== null) galleryRoot.current.inert = open !== null;
  }, [open !== null]);

  const dispose = useCallback((session: OpenReplay): void => {
    session.client.dispose();
    session.view.destroy();
  }, []);

  /** Lets go of the recording that is open, if one is. */
  const closeReplay = useCallback((): void => {
    const session = openNow.current;
    if (session === null) return;
    openNow.current = null;
    setOpen(null);
    dispose(session);
    onOpen?.(null);
  }, [dispose, onOpen]);

  /** Opens a recording: reads it, and starts a host that plays it. A recording that cannot be read says why. */
  const openReplay = useCallback(
    async (id: string, tick: number | null, pushed: boolean): Promise<void> => {
      if (openNow.current?.id === id && tick === null) return;
      setOpening(id);
      setFailure(null);
      try {
        const replay = await loadReplay(id);
        closeReplay();
        const client = new HostClient(spawnWorker(), { allowServer: false });
        const play = new Play(client, true);
        const view = makeView();
        const header = (replay as { header?: { seed?: unknown; scenario?: unknown } } | null)?.header;
        client.start({
          mode: "replay",
          seed: Number.isSafeInteger(header?.seed) ? (header?.seed as number) : 0,
          scenario: typeof header?.scenario === "string" ? header.scenario : "bridge",
          hidden: document.visibilityState === "hidden",
        });
        // A link to a moment holds the recording there. A link to a recording, or a click in the gallery, plays it.
        client.openReplay(replay, { tick: tick ?? undefined, play: tick === null });
        const session: OpenReplay = { id, client, view, play };
        openNow.current = session;
        setOpen(session);
        onOpen?.(session);
        if (pushed) history.pushState(null, "", replayHash(id, tick));
      } catch (err) {
        setFailure(failureKey(err));
        setGallery(true);
        // A link that names nothing is not kept in the address.
        if (parseReplayHash(location.hash)?.id === id) history.replaceState(null, "", location.pathname + location.search);
      } finally {
        setOpening(null);
      }
    },
    [closeReplay, makeView, onOpen, spawnWorker],
  );

  // A page that is opened on a link to a recording shows it, and one whose address changes follows the address.
  useEffect(() => {
    const follow = (): void => {
      const link: ReplayLink | null = parseReplayHash(location.hash);
      const current = openNow.current;
      if (link === null) closeReplay();
      else if (current?.id !== link.id) void openReplay(link.id, link.tick, false);
      // The address of the recording that is open, changed to name another moment in it: go there.
      else if (link.tick !== null) current.client.seek(link.tick);
    };
    follow();
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, [closeReplay, openReplay]);

  // The recording is held while the page is hidden, as a game is.
  useEffect(() => {
    if (open === null) return;
    const sync = (): void => open.client.setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [open]);

  const back = useCallback((): void => {
    closeReplay();
    if (parseReplayHash(location.hash) !== null) history.replaceState(null, "", location.pathname + location.search);
  }, [closeReplay]);

  const watch = useCallback((entry: GalleryEntry): void => void openReplay(entry.id, null, true), [openReplay]);
  const leaveGallery = useCallback((): void => {
    setGallery(false);
    setFailure(null);
  }, []);

  return (
    <>
      {intro ? (
        <OpeningGate client={live.client} lang={lang} theme={theme} failed={continueFailed} onStart={start} onContinue={() => void pickUp()} onAnother={another} onGallery={() => setGallery(true)} />
      ) : null}
      <div class="live-root" ref={liveRoot}>
        <App client={live.client} view={live.view} play={live.play} remembered={remembered} sampleNotebook={sampleNotebook} onGallery={() => setGallery(true)} covered={away} />
      </div>
      {gallery ? (
        <div class="layer" ref={galleryRoot} data-testid="gallery-layer">
          <GalleryView lang={lang} theme={theme} opening={opening} failure={failure} onWatch={watch} onClose={leaveGallery} covered={open !== null} />
        </div>
      ) : null}
      {open === null ? null : <ReplayLayer open={open} onClose={back} />}
    </>
  );
}
