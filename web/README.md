<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# web

The web client of Lantern Eve: the game page, a PixiJS map under a Preact interface in Chinese and English with a light and a dark theme, and the browser host, which runs the Python world core in Pyodide inside a module Web Worker. The same page can drive the server host instead, which runs the core under CPython. The page fetches nothing from outside its own origin except from the model provider the player picks.

## Commands

Needs Node 22.18 or later, npm, and [uv](https://docs.astral.sh/uv/) for the core wheel.

```bash
npm ci
npm run dev          # Vite dev server. No Content Security Policy, no test hooks
npm run build        # core wheel, Pyodide copy, type check, production build in dist/
npm run preview      # serves dist/ with the policy as a header
npm run test:unit    # Node-only tests, no browser
npm run test:e2e     # builds dist/ and dist-e2e/, then runs unit and browser tests
npm run assets       # copies the Pyodide runtime to public/pyodide, builds the wheel into public/core and writes the licence texts of the packages into public/licenses/npm
npm run wheel        # the wheel step alone: uv build --wheel ../core --out-dir public/core
npm run csp          # prints the Content Security Policy
```

The browser tests use Playwright's Chromium. Install it once with `npx playwright install chromium`.

`public/pyodide/`, `public/core/`, `public/licenses/npm/`, `dist/` and `dist-e2e/` are generated and ignored by git.

## What runs where

By default the page starts the browser host:

```
page (main thread)                    host worker (module worker)
  client.ts   ---- messages ---->       host.worker.ts
  ui/, map/        <-- frames ---         HostRuntime   the loop, the input log, saves, model calls
                                          Pyodide       lantern_core.api.Game.step
                                          transport     fetch to the provider, streaming
                                          IndexedDB     saves
```

With `?host=ws` in the URL the page ends its worker before the worker loads anything. `src/page/ws-source.ts` gives `client.ts` the surface of a worker and sends the same messages over a WebSocket to the server host:

```
page (main thread)                    server host (lantern-eve play)
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       the loop, the input log, model calls
  ui/, map/        <-- frames ---         CPython       lantern_core.api.Game.step
                                          transport     the services of a provider file, or the mock
                                          runs/         replays
```

The page knows nothing about Pyodide. `src/shared/` is plain TypeScript with no browser globals beyond `fetch`, `AbortController`, `TextDecoder`, `indexedDB`, `performance` and timers, so the unit tests run it in Node against a stand-in `Game`. The server host keeps no saves, and the page answers a model choice with a notice instead of sending the provider or the key to it. The messages between the page and a host are described in the docstring of [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py) and typed in `src/shared/protocol.ts`.

## Where things are

| Path | What is in it |
|---|---|
| `src/page/` | the page on the main thread: `client.ts` (the surface of a host), `ui/` (the Preact interface), `map/` (the PixiJS map), `style/` (the CSS), and the modules that turn a frame into what the interface shows |
| `src/worker/` | the browser host: `host.worker.ts` and `pyodide-game.ts` |
| `src/shared/` | what the browser host and the page share: the loop (`runtime.ts`), the transport to a provider (`transport.ts`, `providers.ts`), replays (`replay.ts`, `player.ts`), saves (`idb-saves.ts`) and the handling of keys (`secrets.ts`) |
| `src/i18n/` | the words of the interface: `zh.ts` and `en.ts` hold the same keys |
| `public/` | the fonts (cut down to the characters the game can show, see `tools/fonts`), the sprite atlas (`tools/sprite-kit`), the paper textures and the licence texts |
| `scripts/` | `prepare-assets.mjs` (the Pyodide copy, the core wheel, the npm licences) and `print-csp.mjs` |
| `test/` | `unit/` (Node), `e2e/` (browser) and `support/` (the fixtures, servers and fake hosts they share) |

## Tests

`npm run test:unit` runs the project `unit`: plain TypeScript in Node, with no browser. `npm run test:e2e` builds the production page and a test build with a few hooks of its own, and runs both projects. The browser project, `chromium`, runs against the test build in `dist-e2e/` (`npm run build:e2e`). Its fixtures start the servers they need on free ports, so nothing has to be running first. Most browser tests drive the page with a fake host that feeds it frames made for the test. The ones that play the real core in Pyodide take longer. Run one file with `npx playwright test --project=chromium test/e2e/<file>`. The browser tests run one at a time (`workers: 1`), because some of them time how the page keeps the clock.

## Keys

A key lives in the memory of the worker and is sent only to the address of the provider it belongs to. It is written to `localStorage` only when "remember on this device" is ticked, and it never goes into a replay, a save or an export. The server host never receives it.

## Content Security Policy

`npm run build` puts the policy into `dist/index.html` as a `<meta>` tag. A `<meta>` policy covers the document only. A worker takes its policy from the headers of its own script, so a host that can send headers should send the policy (`npm run csp` prints it) on every response. `npm run preview` does, and so does `lantern-eve play`. The host must serve `.wasm` as `application/wasm`.

## Licences

The licence texts of what the built site carries are in `public/licenses/` and are copied into `dist/licenses/`; `README.txt` there says what each file is. [THIRD_PARTY.md](../THIRD_PARTY.md) lists the components with their versions.
