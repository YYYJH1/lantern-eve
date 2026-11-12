import { render } from "preact";
import { createSoundscape, festival } from "./audio/index.ts";
import { HostClient } from "./client.ts";
import { MapView } from "./map/map-view.ts";
import { Play } from "./play.ts";
import { registerFestivalShow, setFestivalSound } from "./festival/show.ts";
import { bindLanguage, bindTheme } from "./prefs.ts";
import type { LanternHandle } from "./e2e.ts";
import { parseReplayHash } from "./replays.ts";
import { loadRemembered } from "./storage.ts";
import { Root } from "./ui/root.tsx";
import { serverUrlFor } from "./ws-source.ts";
import "./style/fonts.css";
import "./style/tokens.css";
import "./style/base.css";
import "./style/layout.css";
import "./style/cards.css";
import "./style/hearts.css";
import "./style/notebook.css";
import "./style/menu.css";
import "./style/calls.css";
import "./style/budget.css";
import "./style/play.css";
import "./style/slice.css";
import "./style/statement.css";
import "./style/guide.css";
import "./style/director.css";
import "./style/festival.css";
import "./style/moments.css";
import "./style/replays.css";
import "./style/paper.css";
import "./style/sheets.css";
import "./style/talk.css";
import "./style/ending.css";
import "./style/opening.css";
import "./style/people.css";
import "./style/sound.css";
import "./style/eggs.css";

const params = new URLSearchParams(location.search);
// ?seed=, ?pace=, ?until=, ?scenario=, ?config=, ?notebook=, ?start=, ?guide=, ?autosave= and ?map= are read in test builds only.
// A production build ignores them.
const numberParam = (name: string): number => {
  const raw = params.get(name);
  return __LANTERN_E2E__ && raw !== null && raw !== "" ? Number(raw) : Number.NaN;
};
const testSeed = numberParam("seed");
const testPace = numberParam("pace");
const testUntil = numberParam("until");
const seed = Number.isSafeInteger(testSeed) ? testSeed : (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) & 0x7fffffff;
const pace = Number.isFinite(testPace) && testPace > 0 ? testPace : 1;
// The page plays the bridge town. The demo world m0 is for the host tests.
const scenario = __LANTERN_E2E__ && params.get("scenario") === "m0" ? "m0" : "bridge";
// `?config=days:1,dev_actions:1` sets keys of the game's config, as integers.
function configParam(): Record<string, number> | undefined {
  const raw = __LANTERN_E2E__ ? params.get("config") : null;
  if (raw === null || raw === "") return undefined;
  const config: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split(":");
    if (key !== undefined && key !== "" && Number.isSafeInteger(Number(value))) config[key] = Number(value);
  }
  return config;
}
// A few written entries for the notebook, shown in place of the real ones when the page asks for them.
const sampleNotebook =
  __LANTERN_E2E__ && params.get("notebook") === "sample" ? (await import("./notebook-sample.ts")).sampleNotebook() : null;

// The language and the theme are set before the first render, from what the viewer chose last
// time or else from the browser.
bindTheme();
bindLanguage();

const spawnWorker = (): Worker => new Worker(new URL("../worker/host.worker.ts", import.meta.url), { type: "module" });
const client = new HostClient(spawnWorker());
// `?map=off` leaves the map out, for the tests of the host: nothing is drawn, and the browser makes no graphics context.
const mapOff = __LANTERN_E2E__ && params.get("map") === "off";
const makeView = (): MapView => new MapView({ off: mapOff });
const view = makeView();
// A test page opened with ?showclock=manual plays its shows on a clock that the test moves by hand.
const showClock = __LANTERN_E2E__ && params.get("showclock") === "manual" ? (await import("./show-clock.ts")).manualShowClock() : null;
if (showClock !== null) (await import("./director.ts")).overrideDirectorEnv(() => showClock.env);
const play = new Play(client);
// The sound of the game. It makes nothing until the player has pressed Start or Continue (`release` below), and it only reads the frames.
const sound = createSoundscape(client, view);

const root = document.getElementById("app");
if (root === null) throw new Error("the page has no #app");

const remembered = loadRemembered();
if (remembered !== null) {
  client.configure({ provider: remembered.provider, key: remembered.key, model: remembered.model });
}

// A hidden page pauses the world, a visible one resumes it. Both are recorded as inputs. Behind the opening page the world
// stays held whatever the page does, and Start lets it go.
const syncVisibility = (): void => {
  if (!holding) client.setHidden(document.visibilityState === "hidden");
};
document.addEventListener("visibilitychange", syncVisibility);
const release = (): void => {
  holding = false;
  client.setHidden(document.visibilityState === "hidden");
  sound.begin();
};

const startLive = (): void =>
  client.start({
    seed: intro ? 0 : seed,
    scenario: intro ? "bridge" : scenario,
    // The game behind the opening page is the core's game `slice`, which the host asks the core for by name.
    preset: intro ? "slice" : undefined,
    hidden: holding || document.visibilityState === "hidden",
    pace,
    pauseAtTick: Number.isSafeInteger(testUntil) && testUntil > 0 ? testUntil : undefined,
    config: configParam(),
  });

// A page that is opened on a link to a recording shows the recording and does not start a game until it is let go of.
const linked = parseReplayHash(location.hash) !== null;
// The first thing a player sees is the opening page, and the game behind it is the slice, held until Start. A test build that
// names a game in its address (?seed=, ?scenario=, ?start=1) plays that game from the first moment, as it always did.
const namesGame = __LANTERN_E2E__ && (params.has("seed") || params.has("scenario") || params.get("start") === "1");
const intro = !linked && !namesGame;
let holding = intro;
// The help (tutorial, hints, the elder) is on for a page that began with the opening page. A test page turns it on with ?guide=on.
play.guide.enabled = intro || (__LANTERN_E2E__ && params.get("guide") === "on");
// The moments of the festival and the festival night are shown on the same pages. A test page turns them on with ?director=on.
play.director.enabled = intro || (__LANTERN_E2E__ && params.get("director") === "on");
// The festival night plays before the ending page on the same pages. A test page that is not about it leaves it out, and turns it on with ?festival=on.
if (!__LANTERN_E2E__ || params.get("festival") === "on") registerFestivalShow();
// The drums, the gongs and the tune of the procession are the sound's: the show tells it when a parade walks, how far it is and when it is over.
setFestivalSound(festival);
// The saves the page makes by itself (each morning, and at the ending) are for the same page, on a host that keeps saves, which the server host
// does not. A test page turns them on with ?autosave=on.
play.autosave.enabled = (intro || (__LANTERN_E2E__ && params.get("autosave") === "on")) && serverUrlFor(location.search, location) === null;

let hooks: LanternHandle | null = null;
if (__LANTERN_E2E__) {
  const { installE2E } = await import("./e2e.ts");
  hooks = installE2E(client, view, play, showClock);
  hooks.sound = sound;
  hooks.renderSound = (await import("./audio/render.ts")).renderClip;
  hooks.festivalSound = festival;
}

render(
  <Root
    live={{ client, view, play }}
    remembered={remembered}
    sampleNotebook={sampleNotebook}
    spawnWorker={spawnWorker}
    makeView={makeView}
    startLive={startLive}
    liveStarted={!linked}
    intro={intro}
    sound={sound}
    onBegin={release}
    onOpen={(open) => {
      if (hooks !== null) hooks.replay = open;
    }}
  />,
  root,
);

if (!linked) startLive();
