import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { pick } from "../../i18n/index.ts";
import type { HostClient } from "../client.ts";
import { readFrame } from "../frame.ts";
import { readVerbs } from "../hud.ts";
import type { MapView } from "../map/map-view.ts";
import { type NotebookEntry, readNotebook } from "../notebook.ts";
import type { Play } from "../play.ts";
import { readPref, type Remembered, writePref } from "../storage.ts";
import { readSlice } from "../slice.ts";
import { writeFinished } from "../truths.ts";
import { stoppedBy, worldWord } from "../world-state.ts";
import { AroundYou } from "./around.tsx";
import { type LedgerPage, PrepBoard } from "./board.tsx";
import { Corner } from "./corner.tsx";
import { DialogueBar } from "./dialogue.tsx";
import { EndingPage } from "./ending.tsx";
import { useClientState, useLang, useScene, useTheme } from "./hooks.ts";
import { MenuDrawer } from "./menu.tsx";
import { ElderSheet, EndCard, GuideDock } from "./guide.tsx";
import { ClarifyView, GazetteCard, NightCard, RecapCard } from "./overlays.tsx";
import { MapGlow, ShowCard } from "./show.tsx";
import { PersonCard, type TalkControl } from "./person.tsx";
import { ReplayBar } from "./replay-bar.tsx";
import { Calm, EndingTab, type Hover, MapLegend, MapPing, MapTools, PersonTooltip, Toasts, Veil } from "./stage.tsx";
import { TalkStrip } from "./strip.tsx";
import { TalkArea } from "./talk.tsx";
import { todayLine } from "./today.ts";
import { type SpeedChoice, SPEEDS, TopBar } from "./topbar.tsx";
import { NotebookWorkspace } from "./workspace.tsx";

/** What makes an App the page of a recording: the way back, and what the recording is called. */
export interface ReplayPage {
  title: string;
  onClose: () => void;
}

export interface AppProps {
  client: HostClient;
  view: MapView;
  play: Play;
  remembered: Remembered | null;
  /** Entries written for the notebook, shown in place of the real ones when the page asks for them (test builds). */
  sampleNotebook: NotebookEntry[] | null;
  /** Set for the page of a recording: the dialogue bar is the controls of the recording, and there is no menu. */
  replay?: ReplayPage | null;
  /** Opens the gallery of recordings. Without it the menu has no button for it. */
  onGallery?: () => void;
  /** Another page is over this one: it answers no key. */
  covered?: boolean;
}

/** How long the notebook stays open before what is new in it counts as seen, which is a little longer than its flash. */
const SEEN_AFTER_MS = 2800;
/** A second click on the picked person counts as a wish to talk only if it is not half of a double click. */
const DOUBLE_CLICK_MS = 450;

/** The speed the viewer chose last time, else the common one. */
function initialSpeed(): SpeedChoice {
  const stored = readPref("speed");
  return SPEEDS.find((s) => s === stored) ?? "normal";
}

/** The notebook is open at its notes or at its statement card; while it is shut there is no page. */
type BookPage = "notebook" | "statement";

export function App({ client, view, play, remembered, sampleNotebook: sample, replay = null, onGallery, covered = false }: AppProps) {
  const s = useClientState(client);
  const lang = useLang();
  const theme = useTheme();
  const scene = useScene(s);
  const frame = useMemo(() => (s.frame === null ? null : readFrame(s.frame)), [s.frame, s.frameCount]);
  const slice = useMemo(() => readSlice(s.frame), [s.frame, s.frameCount]);

  const [menuOpen, setMenuOpen] = useState(false);
  /** The page the notebook is open at, or null while it is shut. */
  const [book, setBook] = useState<BookPage | null>(null);
  /** The page the ledger is open at, or null while it is shut. */
  const [ledger, setLedger] = useState<LedgerPage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [speed, setSpeed] = useState<SpeedChoice>(initialSpeed);
  const stage = useRef<HTMLElement>(null);
  const selectedNow = useRef<string | null>(null);
  const pickedAt = useRef(0);
  selectedNow.current = selected;

  const ending = play.state.ending;
  const endingOpen = ending !== null && play.state.endingOpen;
  const talkingWith = play.state.talk?.npc ?? null;
  const destination = play.state.destination;
  const fresh = play.state.fresh;
  // The notebook has two pages, the notes and the statement card, which the frame has where the core sends one.
  const cardInFrame = slice.statement !== null;
  const workspaceOpen = book !== null;
  const notebookOpen = book === "notebook";
  const statementOpen = book === "statement" && cardInFrame;

  const stated = play.flows.state.stated;
  // What the people said of a full statement is the panel of a clarification, so a clarification does not lie under it.
  const clarified = stated === null ? play.flows.state.clarified : null;
  const elderOpen = play.guide.elder.open;
  const endUp = play.guide.endUp;
  // Two sheets would lie over each other: what the elder says, then what the people said, and the recap waits behind them. The card that says
  // the first day is done waits behind the recap, so the two are not up together. The summary of the night waits behind the paper of the morning.
  const sheetsFree = !endingOpen && clarified === null && stated === null && !elderOpen && !endUp;
  const recap = play.flows.state.recap !== null && sheetsFree ? play.flows.state.recap : null;
  const night = play.flows.state.night !== null && sheetsFree && recap === null ? play.flows.state.night.night : null;
  const sheetOpen = recap !== null || night !== null || clarified !== null || stated !== null || elderOpen || endUp || play.guide.showUp;

  // The map is drawn by PixiJS into the stage. It reports what is under the pointer, what is picked and where the ground was clicked.
  useEffect(() => {
    const element = stage.current;
    if (element === null) return;
    view.events = {
      hover: (id) => setHover((previous) => (previous?.id === id || (previous === null && id === null) ? previous : id === null ? null : { id })),
      select: (id) => {
        const now = performance.now();
        // The person who is picked already, clicked again, is one the player wants to talk to.
        if (id !== null && id === selectedNow.current && now - pickedAt.current > DOUBLE_CLICK_MS) play.talkOrWalk(id);
        pickedAt.current = now;
        // The partner of a talk stays picked until the talk is over.
        if (id === null && play.state.talk !== null) return;
        setSelected(id);
      },
      ground: (hit) => play.goTo(hit),
    };
    view.mount(element, client).then(
      () => setMapReady(true),
      (err: unknown) => {
        // The map needs WebGL. Without it the host still runs and the panel still works.
        console.warn(`map unavailable: ${err instanceof Error ? err.message : String(err)}`);
        setMapFailed(true);
      },
    );
  }, [view, client, play]);

  useEffect(() => view.setLang(lang), [view, lang]);
  // A reply that sends the player to somebody brings them into view: picked on the map, with their card.
  useEffect(() => {
    if (replay !== null) return;
    play.onFocus = (id) => {
      setSelected(id);
    };
    return () => {
      play.onFocus = null;
    };
  }, [play, replay === null]);
  useEffect(() => view.select(selected), [view, selected]);
  useEffect(() => view.setDestination(destination === null ? null : { x: destination.x, y: destination.y }), [view, destination?.x, destination?.y]);
  useEffect(() => {
    view.setTalking(talkingWith);
    if (talkingWith !== null) {
      setLedger(null);
      setSelected(talkingWith);
    }
  }, [view, talkingWith]);

  // A new game has other people in it.
  useEffect(() => {
    if (selected !== null && scene !== null && !scene.cast.some((p) => p.id === selected)) setSelected(null);
  }, [scene, selected]);

  useEffect(() => {
    if (covered) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || sheetOpen) return;
      if (book !== null) setBook(null);
      else if (ledger !== null) setLedger(null);
      else if (menuOpen) setMenuOpen(false);
      else if (endingOpen) play.showEnding(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, book, ledger, menuOpen, endingOpen, covered, sheetOpen]);

  // The ledger and the notebook take the same place on the page: the one that is opened puts the other away.
  useEffect(() => {
    if (workspaceOpen) setLedger(null);
  }, [workspaceOpen]);

  // What was written since the player last looked counts as seen once the notebook has been open a moment.
  useEffect(() => {
    if (!notebookOpen || fresh.length === 0) return;
    const timer = setTimeout(() => play.markSeen(), SEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [play, notebookOpen, fresh.join(",")]);

  // The world stands still while the notebook is open, at either page, and goes on when it is shut, if it was going. A card of the help holds it too.
  useEffect(() => {
    if (replay !== null) return;
    play.hold.set("notebook", workspaceOpen);
  }, [play, workspaceOpen, replay === null]);
  // The tutorial opens the notebook for the step that is about it, and a line of the statement card or a task opens it at the page it names.
  useEffect(() => {
    if (replay !== null) return;
    play.guide.onNotebook = (open) => setBook(open ? "notebook" : null);
    play.flows.onCard = () => setBook("statement");
    return () => {
      play.guide.onNotebook = null;
      play.flows.onCard = null;
    };
  }, [play, replay === null]);

  // The speed of the day is a choice of the viewer, and the host runs the clock by it, except while a skip to the next thing is going.
  useEffect(() => {
    if (replay === null) play.skip.choose(speed === "slow" ? 0.75 : 1);
  }, [play, speed, replay === null]);
  const chooseSpeed = (next: SpeedChoice): void => {
    setSpeed(next);
    writePref("speed", next);
  };

  const entries = useMemo(() => {
    if (sample !== null) return { list: sample, sample: true };
    return { list: s.frame === null ? [] : (readNotebook(s.frame) ?? []), sample: false };
  }, [s.frame, s.frameCount, sample]);

  // A game played to its end is noted for this viewer, with the story it told once the reveal is in: the opening page offers another
  // truth from then on, and the story that was just played is not the one it picks.
  const told = ending?.reveal?.truth?.variant ?? null;
  useEffect(() => {
    if (replay === null && ending !== null) writeFinished(told);
  }, [replay === null, ending?.id, told]);

  // The page held the world at the ending, so a game that is started from there is let go at once. It is another case of the rules
  // and not the same game again, with a story other than the one the ending has just told.
  const newGame = (): void => {
    client.newGame(told);
    client.resume();
  };
  const verbs = useMemo(() => readVerbs(frame?.hud ?? {}), [frame]);
  const sceneName = scene === null ? "" : pick(scene.name, lang);
  const control: TalkControl | null = play.playing
    ? { can: verbs.has("move") && talkingWith === null, talking: talkingWith !== null && talkingWith === selected, onTalk: (id: string) => play.talkOrWalk(id) }
    : null;

  const person = <PersonCard id={selected} frame={frame} scene={scene} slice={slice} lang={lang} play={play} control={control} />;
  const talk = <TalkArea lang={lang} scene={scene} frame={frame} play={play} enabled={verbs} entries={entries.list} />;
  const workspace = (
    <NotebookWorkspace
      open={workspaceOpen}
      part={statementOpen ? "statement" : "notes"}
      onPart={(page) => setBook(page === "statement" ? "statement" : "notebook")}
      scene={scene}
      entries={entries.list}
      sample={entries.sample}
      lang={lang}
      fresh={fresh}
      play={play}
      slice={slice}
      verbs={verbs}
      talking={talkingWith !== null}
      speakCost={frame?.player?.costs?.speak ?? null}
      onClose={() => setBook(null)}
    />
  );
  const toggleNotebook = (): void => setBook((now) => (now === null ? "notebook" : null));

  return (
    <div class="shell" data-menu={menuOpen} data-notebook={workspaceOpen} data-page={workspaceOpen ? (statementOpen ? "statement" : "notes") : ""} data-replay={replay !== null} data-talking={talkingWith !== null} data-ledger={ledger ?? ""} data-ending={endingOpen} data-picked={selected !== null || talkingWith !== null}>
      <TopBar
        s={s}
        lang={lang}
        theme={theme}
        sceneName={sceneName}
        scene={scene}
        frame={frame}
        slice={slice}
        play={play}
        verbs={verbs}
        ended={ending !== null}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((open) => !open)}
        onPause={() => {
          if (worldWord(s, talkingWith !== null) !== "paused") return client.pause();
          // A world that only the page holds (the notebook is open, and the talk is over) is let go by the player's resume too.
          if (stoppedBy(s) === "page") play.hold.letGo();
          client.resume();
        }}
        talking={talkingWith !== null}
        held={play.guide.cardUp}
        yielded={ledger !== null || workspaceOpen || talkingWith !== null || replay !== null}
        replay={replay}
      />

      <main class="stage" id="stage" ref={stage} aria-label={sceneName}>
        <div class="map-ui" data-talk={talkingWith !== null}>
          <Calm on={talkingWith !== null && !play.paying} />
          <MapTools view={view} />
          {scene === null || scene.plain ? null : <MapLegend />}
          <PersonTooltip view={view} scene={scene} hover={hover} lang={lang} state={s} />
          <MapPing ping={play.state.ping} view={view} scene={scene} lang={lang} />
          {replay === null ? <MapGlow play={play} view={view} scene={scene} slice={slice} /> : null}
          <TalkStrip lang={lang} scene={scene} frame={frame} play={play} tick={s.frameTick ?? 0} selectedId={selected} person={person}>
            {talk}
          </TalkStrip>
          {replay === null ? workspace : null}
          <Toasts s={s} play={play} lang={lang} waits={sheetOpen || endingOpen || menuOpen || ledger !== null || workspaceOpen} />
          {replay === null ? <GuideDock play={play} scene={scene} lang={lang} slice={slice} verbs={verbs} /> : null}
          {replay === null ? <ElderSheet play={play} scene={scene} lang={lang} slice={slice} entries={entries.list} /> : null}
          {replay === null ? <EndCard play={play} /> : null}
          {replay === null ? <ShowCard play={play} /> : null}
          <EndingTab show={ending !== null && !endingOpen} onShow={() => play.showEnding(true)} />
          {recap === null ? null : recap.gazette !== null ? (
            <GazetteCard gazette={recap.gazette} scene={scene} lang={lang} onClose={() => play.flows.dismissRecap()} />
          ) : (
            <RecapCard lines={recap.lines} lang={lang} today={todayLine(slice, scene, lang)} onClose={() => play.flows.dismissRecap()} />
          )}
          {night === null ? null : <NightCard night={night} scene={scene} lang={lang} onClose={() => play.flows.dismissNight()} />}
          {clarified === null ? null : <ClarifyView clarified={clarified} entries={entries.list} scene={scene} lang={lang} onClose={() => play.flows.dismissClarified()} />}
          {stated === null ? null : <ClarifyView clarified={stated.heard} statement={{ card: slice.statement, last: stated.last }} entries={entries.list} scene={scene} lang={lang} onClose={() => play.flows.dismissStated()} />}
          <Veil s={s} mapFailed={mapFailed} mapReady={mapReady} />
        </div>
      </main>

      <PrepBoard
        frame={frame}
        scene={scene}
        slice={slice}
        lang={lang}
        play={play}
        page={ledger}
        onPage={(page) => {
          setLedger(page);
          if (page !== null) setBook(null);
        }}
        onStatement={() => setBook("statement")}
      />

      <aside class="side" aria-label={sceneName} data-testid="side">
        <AroundYou lang={lang} scene={scene} frame={frame} play={play} enabled={verbs} entries={entries.list} />
        {replay !== null ? <ReplayBar client={client} s={s} /> : null}
      </aside>
      {replay !== null ? null : <DialogueBar lang={lang} scene={scene} frame={frame} play={play} tick={s.frameTick ?? 0} selectedId={selected} />}

      {replay !== null ? null : <Corner play={play} lang={lang} skip={play.skip.state} onSkip={() => play.skip.press()} drawn={view.drawn} onNotebook={toggleNotebook} notebookOpen={workspaceOpen} entries={entries.list.length} fresh={fresh.length} />}

      {endingOpen && ending !== null ? (
        <EndingPage
          ending={ending}
          scene={scene}
          lang={lang}
          onNew={replay === null ? newGame : replay.onClose}
          onBack={() => play.showEnding(false)}
          newLabel={replay !== null ? "replay.back" : s.preset !== null ? "ending.another" : "ending.new"}
        />
      ) : null}
      {replay === null ? (
        <>
          <MenuDrawer
            client={client}
            play={play}
            s={s}
            lang={lang}
            theme={theme}
            frame={frame}
            speed={{ value: speed, onChange: chooseSpeed, disabled: s.phase !== "ready" }}
            remembered={remembered}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onReplays={
              onGallery === undefined
                ? undefined
                : () => {
                    setMenuOpen(false);
                    onGallery();
                  }
            }
          />
        </>
      ) : null}
    </div>
  );
}
