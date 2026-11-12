<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# web

The web client of Lantern Eve holds the game page and the browser host. The page is a PixiJS map under a Preact interface, in Chinese and English, with a light and a dark theme. The browser host runs the Python core of the world in Pyodide, inside a module Web Worker. The same page can drive the server host instead, which runs the core under CPython. The page fetches nothing from outside its own origin except from the model provider the player picks.

## Commands

Needs Node 22.18 or later, npm, and [uv](https://docs.astral.sh/uv/) for the core wheel.

```bash
npm ci
npm run dev          # the assets, then the Vite dev server: no Content Security Policy, no test hooks
npm run build        # the assets, the type check, then the production build in dist/
npm run preview      # serves dist/ with the policy as a header
npm run typecheck    # the type check alone: the page, the worker, and the configs, scripts and tests that run in Node
npm run build:e2e    # the assets, then the test build in dist-e2e/: the same page with the hooks the browser tests use
npm run test:unit    # Node-only tests, no browser
npm run test:e2e     # builds dist/ and dist-e2e/, then runs unit and browser tests
npm run assets       # copies the Pyodide runtime to public/pyodide, builds the wheel into public/core and writes the licence texts of the packages into public/licenses/npm
npm run wheel        # the wheel step alone: uv build --wheel ../core --out-dir public/core
npm run csp          # prints the Content Security Policy
```

The browser tests use Playwright's Chromium. Install it once with `npx playwright install chromium`.

`public/pyodide/`, `public/core/`, `public/licenses/npm/`, `dist/` and `dist-e2e/` are generated, and git ignores them.

## What runs where

By default the page starts the browser host.

```
page (main thread)                    host worker (module worker)
  client.ts   ---- messages ---->       host.worker.ts
  ui/, map/        <-- frames ---         HostRuntime   the loop, the input log, saves, model calls
                                          Pyodide       lantern_core.api.Game.step
                                          transport     fetch to the provider, streaming
                                          IndexedDB     saves
```

With `?host=ws` in the URL the page ends its worker before the worker loads anything. `src/page/ws-source.ts` then stands in for the worker: `client.ts` sends it the same messages, and it passes them over a WebSocket to the server host.

```
page (main thread)                    server host (lantern-eve play)
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       the loop, the input log, model calls
  ui/, map/        <-- frames ---         CPython       lantern_core.api.Game.step
                                          transport     the services of a provider file, or the mock
                                          runs/         replays
```

The page knows nothing about Pyodide. `src/shared/` is plain TypeScript that uses no browser globals beyond `fetch`, `AbortController`, `TextDecoder`, `indexedDB`, `performance` and timers, so the unit tests run it in Node against a stand-in `Game`. The server host keeps no saves. When the player picks a model there, the page answers with a notice and sends neither the provider nor the key. The messages between the page and a host are described in the docstring of [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py) and typed in `src/shared/protocol.ts`.

## Where things are

| Path | What is in it |
|---|---|
| `src/page/` | the page on the main thread: `client.ts` (the page's side of a host, which sends it messages and keeps the latest state it reported), `ui/` (the Preact interface), `map/` (the PixiJS map), `style/` (the CSS), `audio/` (the sound, made with Web Audio), `festival/` (the show of the festival night), and the modules that turn a frame into what the interface shows |
| `src/worker/` | the browser host: `host.worker.ts` and `pyodide-game.ts` |
| `src/shared/` | what the browser host and the page share: the loop (`runtime.ts`), the transport to a provider (`transport.ts`, `providers.ts`), replays (`replay.ts`, `player.ts`), saves (`idb-saves.ts`) and the handling of keys (`secrets.ts`) |
| `src/i18n/` | the words of the interface: `zh.ts` and `en.ts` hold the same keys |
| `public/` | the fonts (cut down to the characters the game can show, see `tools/fonts`), the sprite atlas (`tools/sprite-kit`), the paper textures and the licence texts |
| `scripts/` | `prepare-assets.mjs` (the Pyodide copy, the core wheel, the npm licences) and `print-csp.mjs` |
| `test/` | `unit/` (Node), `e2e/` (browser), `support/` (the fixtures, servers and fake hosts they share), `groups/` (the lists of the browser specs, see below) and `live.spec.ts` (three short requests to a real provider, skipped unless `LANTERN_LIVE_PROVIDER` and `LANTERN_LIVE_KEY` are set) |

## Tests

`npm run test:unit` runs the project `unit`: plain TypeScript in Node, with no browser. `npm run test:e2e` builds the production page and a test build with the hooks the tests use, and runs both projects. The browser project, `chromium`, runs against the test build in `dist-e2e/` (`npm run build:e2e`). Its fixtures start the servers they need on free ports, so nothing has to be running first. Most browser tests drive the page with a fake host that feeds it frames made for the test. The ones that play the real core in Pyodide take longer. Run one file with `npx playwright test --project=chromium test/e2e/<file>`. The browser tests run one at a time by default (`workers: 1`), because some of them time how the page keeps the clock.

The browser specs are in two lists in `test/groups/`. `fake.txt` holds the specs that drive the page with a fake host, and `real.txt` those that play the real core, which take most of the time. Every spec of `test/e2e/` is in exactly one of them. Each list is cut into parts that take about the same time on the two cores of a CI runner (`fake-1.txt`, `fake-2.txt`, ..., `real-1.txt`, ...), and CI runs one part in each job, with the unit project in the first part of `fake`. The parts of `fake` run two specs at a time, one to a core of the runner, and the parts of `real` one at a time. The specs are not split by count, because the ones that play whole games take many times as long as the rest. To run a list or a part, pass its files to Playwright:

```bash
npx playwright test --project=chromium $(sed 's|^|test/e2e/|' test/groups/real-1.txt)
```

A new spec goes into one list and into the part with the least time. Every spec must be in one list, each list must be the sum of its parts, and the workflow must run every part, or `test/unit/groups.spec.ts` fails.

The limits in the tests are those of a development machine. `LANTERN_TIME_SCALE` stretches all of them by one factor, which CI sets (in `.github/workflows/ci.yml`) for its two slower cores: the limit of a test, that of an expectation and of an action, and each limit a test sets for itself with `test.setTimeout`. Apart from that, a test must not depend on the speed of the machine. The game keeps its own pace, so a test cannot count on the page catching up with the game. A test that needs a quiet world turns the hints off (`lantern.hints` in `localStorage`), since the elder comes by when nothing has moved for 600 ticks. A test that needs the world to stand still at a moment that lasts a few seconds lets the host hold it at a tick (`?until=`). A test that walks the manager to a person who is at hand for a few hours of the game runs the game at a pace of 1 or less. A game that is left to run meets the card of its first night after some 2300 ticks, which holds the world and keeps the card of a job waiting behind it. At a pace of 20 that is twelve seconds, so a test that waits for a card of its own runs the game at a pace of 2 or less. What the page shows for a few seconds and then takes away has to be read in one call or kept longer. A show of the camera (a moment of the festival, the festival night) lasts a few seconds of the page's clock too, and a page that draws two frames a second on two cores takes longer than that to answer a step of a test, so a test opens the page with `showclock=manual` and moves the clock of the shows by hand (`advance` in `test/support/festival.ts`). The page folds the note of the slip a few frames after a talk begins, and on two cores a few frames take a second, so a test that needs the note open waits for the frames of the page and not for a number of milliseconds (`openTheNote` in `test/support/note.ts`). A test that looks at the figures of the map at set times sets the clock of the map and draws the map once at each look (`view.clock` and `view.redraw()`), since a page that draws two frames a second shows every figure at the same beat. The words of a note go after five seconds, so a test reads them in both languages in one call (`textsInBothLanguages`). A signal that a hint lights goes out after nine seconds, so a test lights it again before it looks (`relight` in `test/support/slice.ts`). A timer of any other length is stretched (`stretchTimer`). Where the menu is not what is tested, the language and the theme are chosen by a click in the page (`switchLang`, `switchTheme`).

## Keys

A key lives in the memory of the worker and is sent only to the address of the provider it belongs to. It is written to `localStorage` only when "remember on this device" is ticked, and it never goes into a replay, a save or an export. The server host never receives it.

## Content Security Policy

`npm run build` puts the policy into `dist/index.html` as a `<meta>` tag. A `<meta>` policy covers the document only. A worker takes its policy from the headers of its own script, so a server that can send headers should send the policy (`npm run csp` prints it) on every response. `npm run preview` does, and so does `lantern-eve play`. The server must send `.wasm` as `application/wasm`.

## Licences

The licence texts of what the built site carries are in `public/licenses/`, and the build copies them into `dist/licenses/`, where `README.txt` says what each file is. [THIRD_PARTY.md](../THIRD_PARTY.md) lists the components with their versions.
