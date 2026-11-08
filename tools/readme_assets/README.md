<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# README pictures

The pictures in `docs/assets/` that the two READMEs show are made by the scripts in this folder. They need Node 22, ffmpeg and a headless Chromium (the "headless shell" build), and add no package to the project.

```
export CHROME_BIN=/path/to/chrome-headless-shell
```

Without `CHROME_BIN` the scripts use the headless shell that `npx playwright install chromium` puts in Playwright's browser folder: `PLAYWRIGHT_BROWSERS_PATH` if it is set, else `~/.cache/ms-playwright` (Linux only). The browser is started with `--incognito` and with its profile and temporary files in the directory given by `--tmp` (default: the system's temporary directory). Chinese text uses Noto Sans CJK SC, so that font has to be installed. ffmpeg is taken from `PATH`, or from the variable `FFMPEG`.

## Figures

`figures/` holds one HTML file per figure: `banner` and `architecture`. Each is a single rounded card. `figures.css` defines the colours as variables for the light and the dark theme, and every text exists twice, as `<span class="en">` and `<span class="zh">`, so one source gives four pictures. `connect.js` draws the arrows between the boxes. The title faces are the two fonts that the game page bundles in `web/public/fonts`.

```
node tools/readme_assets/build.mjs
```

writes `docs/assets/<figure>-<en|zh>-<light|dark>.png` at twice the pixel ratio, with a palette of 256 colours. `--only banner`, `--lang zh`, `--theme dark`, `--colors N` (0 keeps the true-colour PNG), `--out DIR` and `--tmp DIR` narrow or redirect it, and a PNG over 400 KiB is an error. To look at a figure in a browser, open `figures/banner.html?theme=dark&lang=zh`.

## Pictures of the page

`capture_page.mjs` drives the real game page: the test build of the web client, with the real core running in Pyodide behind it. It serves `web/dist-e2e` on 127.0.0.1 (a port the system picks), opens the page in the browser through the Chrome DevTools Protocol, and takes screenshots. The test build comes first:

```
(cd web && npm ci && npm run build:e2e)
node tools/readme_assets/capture_page.mjs
```

It makes three pictures, each in the light and the dark theme and in Chinese and English:

- `play-<lang>-<theme>.gif` is the first day of the game as a player meets it. The page is opened without a game in its address, so it shows its opening page and plays the game the opening page starts, with its own seed, held until Start. The film shows the opening page and the first two cards of the clan elder, and the manager walking up to Granny Li at the call of the underlined phrase on the red slip and asking her for the bamboo, with the preview first: she refuses. The rumour is followed back with a tag and with the list of notes to ask the source of, from Granny Li to the teahouse keeper and to Zhou's Clerk, and the elder's card sets a pair of lines side by side in the notebook, where the manager judges that what the clerk saw does not support what the town says. After a cut to the afternoon it is the evening at the teahouse: the pair is said in public, each person there answers in their own words, and Granny Li takes her objection back. Li Da is then asked for the bamboo, the preview first, and promises. At nine in the evening the lamp-lit note that sums up the night holds the world until it is put away, and after a cut through the night it is the next morning: the Town Gazette of the morning is up, then the card that says the first day is done, and then the camera comes to the bridge, where the bamboo lies as a pile beside the ledger that says what was promised and what has come. A cut is a stretch of ticks that the script steps through with no picture. ffmpeg makes the GIF from a palette of all its frames.
- `notebook-<lang>-<theme>.png` is the notebook, a book bound with thread, at the moment the manager has judged that pair: the notes with the judgement on the left page and the statement card on the right one. It is cut to the book, with a small margin.
- `ending-<lang>-<theme>.png` is the rumour tree of an ending, from a game of one day that runs to its last night with nobody at the helm.

The pictures do not depend on how fast the machine is. The page is opened with `?until=1`, which holds the world after its first tick, and the script then moves it one tick at a time with the page's own pause and resume messages: a resume is answered with one tick, and the pause right behind it holds the world before the next tick is due. An action that the script sends is applied at the tick it was sent at. The core is a function of its seed and of the inputs it gets at each tick, so the same build gives the same game. Before each picture the script waits until nothing on the map moves, fixes the clock of the map's own animations and ends the page's CSS animations. The word beside the pause button says "paused" while the world is held between two pictures, so the script has the page say "running". A talk is the exception. While the manager talks, the core holds the clock by itself and no tick comes, whatever the script asks of the host, so the script does not step there: it acts, with a tag, a list of choices or a button of the card, or it leaves. An act takes some minutes of game time, and the script steps through them before the talk holds the clock again. A step that is made while a talk holds the world is an error that says so. In a talk the page is left as the game has it, and the word beside the pause button says that time is held.

The pictures show the core that is in `web/dist-e2e`. After a change to the core, build the test build again and run the script again.

- `--only gif,notebook,ending`, `--lang en,zh` and `--theme light,dark` choose what to make (default: everything). `--seed N` sets the seed of the game of the ending (default 7). The first day has a seed of its own.
- `--fps` and `--width` set the frame rate (10) and the width (960) of the GIF. A GIF has to stay under `--max-mb` (4), and the script lowers the number of colours until it does. A PNG has to stay under 400 KiB.
- `--jobs N` makes that many pictures at the same time (default 2), each in a browser of its own.
- `--out DIR` and `--dist DIR` set where the pictures go (default `docs/assets`) and which test build is served (default `web/dist-e2e`). `--chrome FILE`, `--tmp DIR` and `--keep` set the browser, the directory for temporary files, and whether to keep them.
- `--help` lists every option.
