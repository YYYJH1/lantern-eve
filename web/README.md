<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# web

Lantern Eve's web client uses PixiJS for the map and Preact for the interface. It supports Chinese and English and light and dark themes. By default, a module Web Worker runs the Python core in Pyodide. The same page can connect to the CPython server host. The browser loads assets from the page's origin and sends model requests to the provider the player chooses.

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

Add `?host=ws` to the URL to stop the worker before it loads resources. `client.ts` sends the same messages to `src/page/ws-source.ts`, which forwards them to the server host over WebSocket.

```
page (main thread)                    server host (lantern-eve play)
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       the loop, the input log, model calls
  ui/, map/        <-- frames ---         CPython       lantern_core.api.Game.step
                                          transport     the services of a provider file, or the mock
                                          runs/         replays
```

The browser host owns Pyodide. The main thread receives frames from the host. The TypeScript in `src/shared/` uses `fetch`, `AbortController`, `TextDecoder`, `indexedDB`, `performance` and timers, so unit tests can use a stand-in `Game` in Node. The server host does not keep saves. When connected to it, the model picker shows a notice because the server configures its own provider and key. Message types live in `src/shared/protocol.ts`. See [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py) for the protocol.

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

`npm run test:unit` runs the `unit` project in Node. `npm run test:e2e` builds the production page and the page with test hooks, then runs both test projects. The `chromium` project opens the `dist-e2e/` build produced by `npm run build:e2e`. Fixtures start servers on free ports. Most browser tests use a fake host that sends prepared frames. Tests that run the real core in Pyodide take longer. Run one file with `npx playwright test --project=chromium test/e2e/<file>`. The browser project defaults to one worker (`workers: 1`) because some tests check the game clock.

The browser specs are in two lists in `test/groups/`. `fake.txt` holds the specs that drive the page with a fake host, and `real.txt` those that play the real core, which take most of the time. Every spec of `test/e2e/` is in exactly one of them. Each list is cut into parts that take about the same time on the two cores of a CI runner (`fake-1.txt`, `fake-2.txt`, ..., `real-1.txt`, ...), and CI runs one part in each job, with the unit project in the first part of `fake`. The parts of `fake` run two specs at a time, one to a core of the runner, and the parts of `real` one at a time. The specs are not split by count, because the ones that play whole games take many times as long as the rest. To run a list or a part, pass its files to Playwright:

```bash
npx playwright test --project=chromium $(sed 's|^|test/e2e/|' test/groups/real-1.txt)
```

A new spec goes into one list and into the part with the least time. Every spec must be in one list, each list must be the sum of its parts, and the workflow must run every part, or `test/unit/groups.spec.ts` fails.

`LANTERN_TIME_SCALE` applies one multiplier to test, assertion and action timeouts, including overrides set with `test.setTimeout`. The workflow sets it in `.github/workflows/ci.yml` for the slower two-core CI runners. When a test needs a specific game moment, control the relevant clock directly.

- Use `?until=` to stop at a chosen tick. Turn off `lantern.hints` in `localStorage` if the test needs a quiet world. With hints on, the elder comes by after 600 idle ticks.
- Use a pace of 1 or less to reach a character who is available for only a few game hours. The first night recap appears after about 2300 ticks and holds the game, including later task cards. It arrives in roughly twelve seconds at pace 20. Use pace 2 or less when waiting for a specific card.
- Camera shows last a few seconds on the page clock. On a two-core runner, the page may draw only two frames per second. Use `showclock=manual` and `advance` from `test/support/festival.ts` to move the show clock. For map figures at a particular time, set `view.clock` and call `view.redraw()`. Use `openTheNote` from `test/support/note.ts` to wait on rendered frames when reading the red slip as a conversation starts.
- A note disappears after five seconds. Use `textsInBothLanguages` to read both languages in one call. A hint signal expires after nine seconds. Use `relight` from `test/support/slice.ts` just before checking it. Use `stretchTimer` for other timers and `switchLang` or `switchTheme` to set the language or theme when the menu is outside the test's scope.

## Keys

A key lives in the memory of the worker and is sent only to the address of the provider it belongs to. It is written to `localStorage` only when "remember on this device" is ticked, and it never goes into a replay, a save or an export. The server host never receives it.

## Content Security Policy

`npm run build` puts the policy into `dist/index.html` as a `<meta>` tag. A `<meta>` policy covers the document only. A worker takes its policy from the headers of its own script, so a server that can send headers should send the policy (`npm run csp` prints it) on every response. `npm run preview` does, and so does `lantern-eve play`. The server must send `.wasm` as `application/wasm`.

## Licences

The licence texts of what the built site carries are in `public/licenses/`, and the build copies them into `dist/licenses/`, where `README.txt` says what each file is. [THIRD_PARTY.md](../THIRD_PARTY.md) lists the components with their versions.
