<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# README pictures

The scripts in this directory generate the images in `docs/assets/` for both READMEs. They use Node 22, ffmpeg and Chromium’s headless shell. No additional project packages are required.

```
export CHROME_BIN=/path/to/chrome-headless-shell
```

Set `CHROME_BIN` to choose the browser. By default, the script looks for the shell from `npx playwright install chromium` in `PLAYWRIGHT_BROWSERS_PATH`, or in `~/.cache/ms-playwright` on Linux. Chromium runs in incognito mode, with its profile and temporary files under `--tmp` or the system temporary directory. Install Noto Sans CJK SC for Chinese text. To choose a copy of ffmpeg outside `PATH`, set `FFMPEG`.

## Figures

The `figures/` directory has one HTML file each for the rounded banner and architecture cards. Each source contains English and Chinese spans, and `figures.css` supplies both themes, so one file produces four images. `connect.js` draws the arrows between boxes. Figure titles use the game’s fonts under `web/public/fonts`.

```
node tools/readme_assets/build.mjs
```

The script writes `docs/assets/<figure>-<en|zh>-<light|dark>.png` at 2x with a 256-colour palette. A PNG larger than 400 KiB is an error. Use `--only banner`, `--lang zh` or `--theme dark` to select an image, `--colors 0` to keep true colour, and `--out DIR` or `--tmp DIR` to choose directories. To see the source in a browser, open `figures/banner.html?theme=dark&lang=zh`.

## Pictures of the page

`capture_page.mjs` serves `web/dist-e2e` on a free loopback port. It uses the Chrome DevTools Protocol to drive the test build and capture the real game, with the core running in Pyodide. Build the test app before running it.

```
(cd web && npm ci && npm run build:e2e)
node tools/readme_assets/capture_page.mjs
```

The script makes each of these four images in both languages and both themes.

- `play-<lang>-<theme>.gif` follows the first-day tutorial. The elder sends the manager to borrow bamboo, Granny Li brings up the rumour about Li Er, and the manager traces it to Zhou's clerk. At the teahouse, the manager answers an objection by asking the clerk what was actually seen. The film continues through Li Da's promise and the next morning's delivery. ffmpeg uses the recorded frames to build the GIF's palette.
- `notebook-<lang>-<theme>.png` is the notebook, a book bound with thread, at the moment the manager has judged that pair. The left page holds the notes: the line set against the claim, the three answers, what came of the answer, the hint, and the list of the pairs compared. The right page is the statement card, still empty. The book is shown as tall as the page makes it when no line of help (the tutorial, a hint) is up, and the picture is cut at the line of ink inside the hand-cut edge of its paper. What lies round the book (the note of the slip, the strip of the talk, the note of the person) is put away for the picture. No line of the book is. A page of the book is longer than the book is tall, and the phrase that turns it lies over its foot, so the script scrolls each page, the way a player does, to a place where neither the top edge of the page nor the phrase cuts an entry (a title, a paragraph, a row of a list, a button). The left page has to show what came of the answer, and the right page its third blank with all its accounts. Among the places that qualify, the script takes the one that shows the most of the hint, the title of the pairs compared and the pair judged, and then the highest. Where a rule of the page would show a few pixels over the rule of the phrase, the phrase is made as tall as it takes to cover it, so that nothing but the rule lies under it. After the picture the script reads the place of each page again and stops with an error if an entry is cut. With `--only notebook` the script stops there and does not play the rest of the day.
- `ending-<lang>-<theme>.png` shows the rumour tree from an unattended one-day game. The title names the first and last versions of the rumour, and every node records words actually heard in that game. The capture script checks the title against the words under the names. It stops if the last version in the title is missing from the tree.
- `festival-<lang>-<theme>.png` captures the full festival ending. At tick one, test actions call the families, provide bamboo and timber, establish the truth and reconcile the families. The core then runs to the last night of the three-day game. `--night-at` sets the moment on the show clock. The default is three and a half seconds from the end, with the whole town in view, the parade on its way to the hall, the main lantern lit, river lanterns drifting and the closing line on screen. The viewport is 1280 × 640. The 1,760-pixel image is twice the width used by the READMEs and stays below 400 KiB at 256 colours.

The recording starts at the opening page with the game held. The script pauses around clicks and uses single ticks for character movement and conversations. It runs the clock at skip speed through long gaps, then pauses when the next card or time window arrives. For each shot it waits for map movement to finish, fixes the animation clock and finishes CSS transitions.

Rebuild `web/dist-e2e` after changing the page or core, then recapture the pictures.

- `--only gif,notebook,ending,festival`, `--lang en,zh` and `--theme light,dark` choose what to make (default: everything). `--seed N` sets the seed of the game of the ending (default 4927, a game whose tree holds both sentences of its title). The first day and the festival night have a seed of their own. `--night-at S` takes a second of the festival night, or a list of them (then each picture gets its second in its name).
- `--fps` and `--width` set the frame rate (10) and the width (880, the width the READMEs show it at) of the GIF. A GIF has to stay under `--max-mb` (4), and the script lowers the number of colours until it does. A PNG has to stay under 400 KiB.
- `--jobs N` makes that many pictures at the same time (default 2), each in a browser of its own.
- `--out DIR` and `--dist DIR` set where the pictures go (default `docs/assets`) and which test build is served (default `web/dist-e2e`). `--chrome FILE`, `--tmp DIR` and `--keep` set the browser, the directory for temporary files, and whether to keep them.
- `--help` lists every option.
