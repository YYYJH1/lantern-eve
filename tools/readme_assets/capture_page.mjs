#!/usr/bin/env node
// Capture the game page: the animated GIF of the first day, the notebook and the rumour tree of the ending.
//
//   node tools/readme_assets/capture_page.mjs [options]
//
// What it does
//   1. Starts a file server on 127.0.0.1, on a port the system picks, that serves the test build
//      of the web client (web/dist-e2e, made by `npm run build:e2e` in web/).
//   2. Starts the headless Chromium (CHROME_BIN) and drives the real page through the Chrome
//      DevTools Protocol, with Node's own WebSocket. The world behind the page is the real core in
//      Pyodide. The script steps it one tick at a time (lib/film.mjs), so the same build gives the
//      same game and the same pictures.
//   3. Takes the pictures: for the GIF one screenshot per frame, which ffmpeg turns into a GIF with
//      a palette made from all of its frames; for the notebook, the page at the moment the pair has
//      been judged; for the ending, a game of one day that runs to its last night.
//
// Pictures (<lang> is en or zh, <theme> is light or dark)
//   play-<lang>-<theme>.gif       the first day of the game as a player meets it, from the opening
//                                 page to the next morning: the elder's first cards, the manager
//                                 asking Granny Li for the bamboo and being refused, the rumour
//                                 followed back to Zhou's Clerk, the pair of lines that the clerk's
//                                 words do not support, the teahouse in the evening where it is said
//                                 in public, Li Da's promise, the summary of the day at nine in
//                                 the evening, and the bamboo at the bridge with the Town Gazette
//                                 of the morning and the card that says the first day is done. The
//                                 world is stepped without pictures between the beats, which is a
//                                 cut in the film
//   notebook-<lang>-<theme>.png   the notebook, a book bound with thread, at the moment the manager has
//                                 judged that pair, cut to the book with a small margin round it
//   ending-<lang>-<theme>.png     the rumour tree of the ending, with the hops where the story changed
//
// Options
//   --out <dir>       where the pictures go (default: docs/assets)
//   --dist <dir>      the test build (default: web/dist-e2e)
//   --only <list>     comma-separated: gif, notebook, ending (default: all of them)
//   --lang <list>     en, zh or both (default: both)
//   --theme <list>    light, dark or both (default: both)
//   --seed <n>        the seed of the game of the ending (default: 7); the first day has its own
//   --fps <n>         GIF: frames per second (default: 10)
//   --width <px>      GIF: width in pixels (default: 960)
//   --max-mb <n>      GIF: the size it must stay under (default: 4)
//   --jobs <n>        how many pictures to make at the same time (default: 2)
//   --chrome <file>   the browser (default: the environment variable CHROME_BIN, else the
//                     headless shell under PLAYWRIGHT_BROWSERS_PATH)
//   --tmp <dir>       directory for the browser's and the script's temporary files (default: the system's)
//   --keep            keep the temporary files

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Browser, chromeBin, makeWorkDir } from './lib/chrome.mjs';
import { Film } from './lib/film.mjs';
import { makeGif, numberFrames, quantizePng } from './lib/media.mjs';
import { serve } from './lib/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PARTS = ['gif', 'notebook', 'ending'];
const THEMES = ['light', 'dark'];
const LANGS = ['en', 'zh'];
// The page is 1280 x 800 CSS pixels. Pictures are taken at twice the pixel ratio.
const WINDOW = [1280, 800];
const SCALE = 2;
const PNG_LIMIT = 400 * 1024;
// A one-pixel outline on the GIF, so that it stands out on a page of nearly its own colour.
const EDGE = { light: 'cfc5ab', dark: '363e5e' };

function fail(message) {
  console.error(`capture_page: ${message}`);
  process.exit(2);
}

function listOf(value, allowed, name) {
  if (value === undefined) return allowed;
  const chosen = value.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = chosen.filter((c) => !allowed.includes(c));
  if (unknown.length > 0 || chosen.length === 0) fail(`unknown ${name}: ${unknown.join(', ')} (known: ${allowed.join(', ')})`);
  return chosen;
}

const { values: opt } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(REPO, 'docs', 'assets') },
    dist: { type: 'string', default: path.join(REPO, 'web', 'dist-e2e') },
    only: { type: 'string' },
    lang: { type: 'string' },
    theme: { type: 'string' },
    seed: { type: 'string', default: '7' },
    fps: { type: 'string', default: '10' },
    width: { type: 'string', default: '960' },
    'max-mb': { type: 'string', default: '4' },
    jobs: { type: 'string', default: '2' },
    chrome: { type: 'string' },
    tmp: { type: 'string' },
    keep: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help) {
  console.log(
    'usage: node tools/readme_assets/capture_page.mjs [--out DIR] [--dist DIR] [--only gif,notebook,ending] ' +
      '[--lang en,zh] [--theme light,dark] [--seed N] [--fps N] [--width PX] [--max-mb N] [--jobs N] ' +
      '[--chrome FILE] [--tmp DIR] [--keep]\n(see the comment at the top of the file)',
  );
  process.exit(0);
}

const parts = listOf(opt.only, PARTS, 'picture');
const langs = listOf(opt.lang, LANGS, 'language');
const themes = listOf(opt.theme, THEMES, 'theme');
const number = (name, min, max) => {
  const value = Number(opt[name]);
  if (!Number.isFinite(value) || value < min || value > max) fail(`--${name} must be a number from ${min} to ${max}`);
  return value;
};
const SEED = Math.round(number('seed', 0, 2 ** 31 - 1));
const FPS = Math.round(number('fps', 4, 25));
const GIF_WIDTH = Math.round(number('width', 320, 2560));
const MAX_BYTES = number('max-mb', 0.1, 64) * 1024 * 1024;
const JOBS = Math.round(number('jobs', 1, 8));

try {
  chromeBin(opt.chrome);
} catch (error) {
  fail(error.message);
}
const dist = path.resolve(opt.dist);
const outDir = path.resolve(opt.out);
if (!(await stat(path.join(dist, 'index.html')).catch(() => null))) {
  fail(`${dist} has no index.html: build the test build first (npm run build:e2e in web/)`);
}

// ------------------------------------------------------------------------ the story

/**
 * The game of the GIF: the game the opening page starts, as a player meets it, from the opening page to the next morning. The page is opened
 * without a game in its address, so that it shows its opening page and plays the slice (seed 0, held until Start). Each step is a
 * number of ticks, then a picture. Between the beats the world is stepped without pictures, which is a cut in the film.
 *
 * In a talk the core holds the clock, so the script does not step there: it acts (a tag, a list, a button of the card) or it leaves,
 * and the minutes that an act owes are stepped through before the talk holds again (see lib/film.mjs).
 */
async function story(film, grab, keep) {
  const { page } = film;
  const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
  const there = (selector) => `${q(selector)} !== null`;
  const gone = (selector) => `${q(selector)} === null`;
  const step = (name) => `${q('[data-testid=tutorial-card]')}?.getAttribute('data-step') === '${name}'`;
  const wait = (expression, what, timeout = 30000) => page.waitFor(expression, { timeout, what });
  /** A press of a button, with the world held at the tick it is at: the host applies what it sends at once. */
  const press = (selector) => film.act(selector);
  /**
   * Walks to the person that the task card names, as the button does, with a picture now and then on the way, until the talk begins.
   * A person who has moved on before the manager is there leaves the manager with no one to walk to, and the button is pressed again.
   */
  const walkToTalk = async (who, every = 18) => {
    await press('[data-testid=task-do]');
    for (let used = 0; !(await film.inTalk()); used += every) {
      if (used > 600) throw new Error(`the manager did not reach ${who} within ${used} ticks`);
      if (await page.evaluate('window.__lantern.play.state.approach === null && window.__lantern.play.state.talk === null')) await press('[data-testid=task-do]');
      await film.stepOrTalk(every);
      await grab(1);
    }
    await film.letHold();
    await wait(`window.__lantern.play.state.talk?.npc === ${JSON.stringify(who)}`, `the talk with ${who}`);
  };
  /**
   * Steps through the minutes that an act of the talk owes, `every` ticks at a time, until the talk holds the world again. A picture
   * is taken on the way only when `frames` is set: the minutes are a cut in the film, and the next picture shows where they ended.
   */
  const paid = async (every = 20, frames = false) => {
    for (let rounds = 0; !(await film.holds()); rounds++) {
      if (rounds > 400 || !(await film.inTalk())) break;
      await page.evaluate(`window.__film.stepOwed(${every})`);
      if (frames) await grab(1);
    }
    if (await film.inTalk()) await film.letHold();
  };
  /** The lines of the talk, to tell that the person has answered. */
  const lines = () => page.evaluate('window.__lantern.play.state.talk?.lines.length ?? 0');
  const closeElder = async () => {
    if (await page.evaluate(there('[data-testid=elder-close]'))) await film.click('[data-testid=elder-close]');
  };

  // 1. The opening page.
  await wait(`${q('[data-testid=opening-start]')}?.disabled === false`, 'the opening page to be ready');
  await grab(14);

  // 2. Start: the clan elder's first two cards, the goal and the first errand.
  await film.click('[data-testid=opening-start]');
  await wait(step('goal'), 'the first card of the tutorial');
  await grab(16);
  await film.click('[data-testid=tutorial-next]');
  await wait(step('ask'), 'the second card of the tutorial');
  await grab(12);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');

  // 3. The button of the task walks the manager up to Granny Li, who is asked for the bamboo and refuses.
  await walkToTalk('li_laotai');
  await wait(there('[data-testid=picker-entrust]'), 'the list of requests');
  await film.click('[data-testid=picker-option][data-id=lend]');
  await wait(`${q('[data-testid=request-card]')}?.getAttribute('data-phase') === 'preview'`, 'the preview of the request');
  await page.evaluate(`${q('[data-testid=request-card]')}.scrollIntoView({ block: 'nearest' })`);
  await grab(14);
  await press('[data-testid=request-confirm]');
  await wait(step('refusal'), 'the card of the refusal');
  await paid();
  await grab(16);
  await film.click('[data-testid=tutorial-next]');
  await wait(step('source'), 'the card of the source');
  await grab(12);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');

  // 4. The rumour, back to its source. Granny Li is asked about Li Er with a tag, and the button of the task then sends the
  // manager to whoever the rumour came from: the teahouse keeper, and then Zhou's clerk, who saw it himself. At each of them the
  // list of notes to ask the source of is open already, and the manager picks the note.
  await film.ask('li_er', async () => {});
  await film.leave();
  const askSource = async (who, every, picture) => {
    await walkToTalk(who, every);
    await wait(there('[data-testid=picker-askSource]'), 'the list of notes to ask the source of');
    if (picture) await grab(8);
    const asked = await lines();
    await press('[data-testid=picker-option]');
    await wait(`window.__lantern.play.state.talk?.lines.length > ${asked}`, `the answer of ${who}`);
  };
  await askSource('cha_laoban', 30, true);
  await paid();
  await grab(10);
  await film.leave();
  await askSource('zhou_huoji', 60, false);

  // 5. The elder's card on how two lines stand, with the notebook open: what the clerk saw does not support what the town says.
  await wait(step('compare'), 'the card of the comparison');
  await paid();
  await grab(16);
  await film.click('[data-testid=tutorial-next]');
  await press('[data-testid=pair-judge]');
  await wait(there('[data-testid=judgment]'), 'the judgement');
  await grab(16);
  // The card of the help, the line of what to do (the chip) and the line of a hint are over the book for a while; the picture is of the book.
  await page.evaluate("document.querySelectorAll('.tut, .tut-chip, .hint-pill').forEach((el) => { el.style.visibility = 'hidden'; })");
  await keep('notebook', '[data-testid=notebook] .book');
  await page.evaluate("document.querySelectorAll('.tut, .tut-chip, .hint-pill').forEach((el) => { el.style.visibility = ''; })");
  await film.click('[data-testid=notebook-close]');
  await film.leave();

  // 6. The afternoon comes, and the elder's last card says when and where the town will be at the teahouse.
  const minutes = '(() => { const t = window.__lantern.client.state.frame.time; return t.hour * 60 + t.minute; })()';
  await film.stepUntil(step('evening'), 1800, 'the card of the evening');
  await grab(16);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');

  // 7. The evening at the teahouse. The task that sets the rumour straight is followed, and its button walks the manager there, to
  // the people who have come by a quarter to six.
  // (By now the top bar follows it of itself, since its window is the one that closes soonest; a card that is not followed is tracked.)
  if ((await page.evaluate(`${q('[data-testid=task-card]')}?.getAttribute('data-id')`)) !== 't_clear_rumour') {
    await film.click('[data-testid=task-more]');
    await press('[data-testid=task-other][data-id=t_clear_rumour] [data-testid=task-track]');
  }
  await wait(`${q('[data-testid=task-card]')}?.getAttribute('data-id') === 't_clear_rumour'`, 'the task of the evening');
  await film.stepUntil(`${minutes} >= 17 * 60 + 15`, 900, 'a quarter past five');
  await press('[data-testid=task-do]');
  for (let used = 0; ; used += 40) {
    if (used > 900) throw new Error('the manager did not reach the teahouse');
    if (await page.evaluate(`${there('[data-testid=verb-speak]')} && ${minutes} >= 17 * 60 + 45`)) break;
    await film.step(40);
    await grab(1);
  }
  await grab(12);

  // 8. The notebook says what can be said in public now, and the pair that was judged is said to the people there, who each make up
  // their own mind in their own words. Granny Li is one of them, and takes her objection back.
  await film.click('[data-testid=btn-notebook]');
  await wait(`${there('[data-testid=judgment-clarify]')} && !${q('[data-testid=judgment-clarify]')}.disabled`, 'the button that clears it up');
  await grab(12);
  const spokeAt = await page.evaluate(minutes);
  // The phrase that turns the page of the notebook lies over the last lines in view, and a page that was left scrolled (the card of the comparison
  // scrolled it) can have the button under it: the button is pressed in the page and not at the point where the bar is.
  const framesBefore = await page.evaluate('(window.__film.pauseWorld(), window.__film.frames())');
  await page.evaluate("document.querySelector('[data-testid=judgment-clarify]').click()");
  await wait(`window.__film.frames() > ${framesBefore}`, 'the host to answer the button that clears it up');
  await wait(there('[data-testid=clarify-sum]'), 'the people to answer', 60000);
  await grab(22);
  await film.click('[data-testid=clarify-done]');
  await film.click('[data-testid=notebook-close]');
  await film.stepUntil(`${minutes} >= ${spokeAt} + 30`, 400, 'the half hour of speaking');

  // 9. Li Da is asked for the bamboo. The button of the task walks the manager up to him, and the preview says what he would bring
  // and by when. He promises.
  await wait(`${q('[data-testid=task-card]')}?.getAttribute('data-id') === 't_bamboo_first'`, 'the task of the bamboo');
  await walkToTalk('li_da', 20);
  await wait(there('[data-testid=picker-entrust]'), 'the list of requests');
  await film.click('[data-testid=picker-option][data-id=material]');
  await wait(`${q('[data-testid=request-card]')}?.getAttribute('data-phase') === 'preview'`, 'the preview of the request');
  await page.evaluate(`${q('[data-testid=request-card]')}.scrollIntoView({ block: 'nearest' })`);
  await grab(14);
  await press('[data-testid=request-confirm]');
  await wait(`${q('[data-testid=request-card]')}?.getAttribute('data-phase') === 'result'`, 'the answer of Li Da');
  await paid();
  await page.evaluate(`${q('[data-testid=request-card]')}.scrollIntoView({ block: 'nearest' })`);
  await grab(16);
  await film.leave();

  // 10. The night passes. At dusk the card that sums up the day is up and holds the world until it is put away (it comes at nine in the
  // evening, whatever the manager is doing, which is why the script steps to it and not past it). In the morning the bamboo is at the
  // bridge: the pile is on the map, and the paper of the morning is up.
  await film.stepUntil(there('[data-testid=night]'), 2400, 'the summary of the day at dusk');
  await grab(22);
  await film.click('[data-testid=night-done]');
  await wait(gone('[data-testid=night]'), 'the summary of the day to go');
  await film.stepUntil("window.__lantern.view.stats().pile === 'small'", 2400, 'the bamboo at the bridge');
  await film.stepUntil('window.__lantern.play.flows.state.recap !== null', 400, 'the paper of the morning');
  await closeElder();
  await wait(there('[data-testid=gazette]'), 'the paper of the morning');
  await grab(22);

  // The paper is put away, and the card that says the first day is done comes after it, once the clock is past the hour of the recap,
  // and holds the world. It is put away in turn, and the camera comes to the bridge, where the bamboo lies as a pile. The board says
  // what was promised and what has come.
  await film.click('[data-testid=gazette-close]');
  await wait(gone('[data-testid=gazette]'), 'the paper to go');
  await film.stepUntil(there('[data-testid=end-card]'), 60, 'the card that says the first day is done');
  await grab(22);
  await film.click('[data-testid=end-close]');
  await wait(gone('[data-testid=end-card]'), 'the card of the end of the first day to go');
  await page.evaluate('window.__film.frameCells(17, 11, 37, 21)');
  await film.click('[data-testid=board-toggle]');
  await wait(there('[data-testid=board-bridge]'), 'the board');
  await page.evaluate(`${q('[data-testid=board-bridge]')}.scrollIntoView({ block: 'start' })`);
  await grab(24);
}

/** The picture of the notebook: the book as it lies open over the map, cut to its box (this is where it stands when the page has no box to ask). */
const NOTEBOOK_CROP = { x: 150, y: 76, width: 1070, height: 580 };
/** The margin round the book in the picture, in CSS pixels. */
const NOTEBOOK_MARGIN = 2;

async function makeStory(origin, look, work) {
  const { lang, theme } = look;
  const dir = path.join(work, `story-${lang}-${theme}`);
  await mkdir(dir, { recursive: true });
  const browser = await Browser.launch({ bin: opt.chrome, workDir: dir });
  try {
    return await storyIn(browser, origin, look, dir);
  } finally {
    await browser.close();
  }
}

async function storyIn(browser, origin, look, dir) {
  const { lang, theme } = look;
  const film = await Film.open(browser, origin, {
    lang,
    theme,
    size: WINDOW,
    scale: SCALE,
    query: `pace=0.1&until=1`,
  });
  // A browser that composes in software can leave a hole in the map, where an opaque box of the page lies over it: a block of the colour of the page, or
  // of nothing, over the upper part of two houses in the English film at the paper of the morning. The canvas is drawn right; a canvas with a filter of its
  // own is composed in a pass of its own, and the hole does not come. (The page's policy does not let a style element in, so the property is set on the canvas.)
  await film.page.evaluate("document.querySelector('canvas.map-canvas').style.setProperty('filter', 'opacity(0.999)')");
  const wantGif = parts.includes('gif');
  const frames = [];
  let n = 0;
  const grab = async (hold) => {
    if (!wantGif) return;
    const png = await film.shoot(n / FPS);
    const file = path.join(dir, `shot-${String(n).padStart(4, '0')}.png`);
    await writeFile(file, png);
    frames.push({ file, hold });
    n += 1;
  };
  // A full-size picture of a moment that is kept apart from the film (the notebook picture is cut from it), with the box of an
  // element of the page that the cut is made round.
  const kept = new Map();
  const keep = async (name, around) => {
    const file = path.join(dir, `${name}-full.png`);
    await writeFile(file, await film.shoot(n / FPS));
    const box = around === undefined ? null : await film.page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(around)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
    kept.set(name, { file, box });
  };
  await story(film, grab, keep);
  const results = [];
  if (wantGif) {
    const numbered = path.join(dir, 'numbered');
    const count = await numberFrames(frames, numbered);
    const out = path.join(outDir, `play-${lang}-${theme}.gif`);
    const gif = await makeGif({ dir: numbered, out, fps: FPS, width: GIF_WIDTH, edge: EDGE[theme], maxBytes: MAX_BYTES, palette: path.join(dir, 'palette.png') });
    results.push(`${path.relative(REPO, out)}  ${count} frames at ${FPS} per second, ${(gif.size / 1024).toFixed(0)} KiB, ${gif.colors} colours${gif.tooLarge ? '  OVER THE LIMIT' : ''}`);
    if (gif.tooLarge) process.exitCode = 1;
  }
  if (parts.includes('notebook')) {
    const found = kept.get('notebook');
    if (found === undefined) throw new Error('the story did not keep a picture of the notebook');
    // The picture is the book and a margin round it, wherever the words of the language put its edges.
    const box = found.box ?? NOTEBOOK_CROP;
    const x = Math.max(0, Math.floor(box.x - NOTEBOOK_MARGIN));
    const y = Math.max(0, Math.floor(box.y - NOTEBOOK_MARGIN));
    const width = Math.min(WINDOW[0] - x, Math.ceil(box.width + 2 * NOTEBOOK_MARGIN));
    const height = Math.min(WINDOW[1] - y, Math.ceil(box.height + 2 * NOTEBOOK_MARGIN));
    const out = path.join(outDir, `notebook-${lang}-${theme}.png`);
    const size = await pngOf(found.file, out, { x: x * SCALE, y: y * SCALE, width: width * SCALE, height: height * SCALE }, path.join(dir, 'palette-notebook.png'));
    results.push(`${path.relative(REPO, out)}  ${width * SCALE}x${height * SCALE}  ${(size / 1024).toFixed(0)} KiB`);
  }
  if (film.page.errors.length > 0) throw new Error(`the page threw: ${film.page.errors.join(' | ')}`);
  await film.page.close();
  return results;
}

// ----------------------------------------------------------------------- the ending

/** The ending of a game of one day, with nobody at the helm: a story that changed on its way. */
async function makeEnding(origin, look, work) {
  const { lang, theme } = look;
  const dir = path.join(work, `ending-${lang}-${theme}`);
  await mkdir(dir, { recursive: true });
  const browser = await Browser.launch({ bin: opt.chrome, workDir: dir });
  try {
    return await endingIn(browser, origin, look, dir);
  } finally {
    await browser.close();
  }
}

async function endingIn(browser, origin, look, dir) {
  const { lang, theme } = look;
  const film = await Film.open(browser, origin, {
    lang,
    theme,
    size: [WINDOW[0], 900],
    scale: SCALE,
    query: `scenario=bridge&seed=${SEED}&pace=80&config=days:1,dev_actions:1`,
  });
  const { page } = film;
  await page.waitFor('window.__lantern.play.state.ending != null', { timeout: 240000, what: 'the last night to come' });
  await page.waitFor('document.querySelector("[data-testid=reveal-chains]") !== null', { timeout: 30000, what: 'the ending page' });
  await page.evaluate('document.querySelector("[data-testid=reveal-chains]").scrollIntoView({ block: "start" })');
  // The notices of the town (a task that changed, a save) lie over the right edge of the page for a few seconds; the picture is of the tree and not of them.
  await page.evaluate("document.querySelectorAll('.toasts').forEach((el) => { el.style.display = 'none'; })");
  await film.settle(0);
  const box = await page.evaluate(`(() => {
    const r = document.querySelector('[data-testid=reveal-chains]').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const crop = { x: Math.round(box.x * SCALE), y: Math.round(box.y * SCALE), width: Math.round(box.width * SCALE), height: Math.round(box.height * SCALE) };
  const full = path.join(dir, 'ending-full.png');
  await writeFile(full, await page.screenshot());
  const out = path.join(outDir, `ending-${lang}-${theme}.png`);
  const size = await pngOf(full, out, crop, path.join(dir, 'palette.png'));
  if (page.errors.length > 0) throw new Error(`the page threw: ${page.errors.join(' | ')}`);
  await page.close();
  return [`${path.relative(REPO, out)}  ${crop.width}x${crop.height}  ${(size / 1024).toFixed(0)} KiB`];
}

/** A PNG with a palette that is small enough: 256 colours first, fewer if it must be. */
async function pngOf(input, out, crop, palette) {
  let size = Infinity;
  for (const colors of [256, 192, 128, 96, 64]) {
    size = await quantizePng({ input, out, colors, palette, crop });
    if (size <= PNG_LIMIT) return size;
  }
  console.error(`capture_page: ${path.relative(REPO, out)} is larger than 400 KiB (${(size / 1024).toFixed(0)} KiB) with 64 colours`);
  process.exitCode = 1;
  return size;
}

// ------------------------------------------------------------------------- the runs

const work = await makeWorkDir(opt.tmp, 'lantern-capture-');
const server = await serve({ root: dist });
await mkdir(outDir, { recursive: true });

const jobs = [];
for (const lang of langs) {
  for (const theme of themes) {
    const look = { lang, theme };
    if (parts.includes('gif') || parts.includes('notebook')) jobs.push({ name: `story ${lang} ${theme}`, run: () => makeStory(server.origin, look, work) });
    if (parts.includes('ending')) jobs.push({ name: `ending ${lang} ${theme}`, run: () => makeEnding(server.origin, look, work) });
  }
}

let failed = false;
try {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const started = Date.now();
      try {
        const lines = await job.run();
        for (const line of lines) console.log(line);
        console.log(`  (${job.name}: ${((Date.now() - started) / 1000).toFixed(0)} s)`);
      } catch (error) {
        failed = true;
        console.error(`capture_page: ${job.name}: ${error.stack ?? error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
} finally {
  await server.close();
  if (!opt.keep) await rm(work, { recursive: true, force: true });
}
process.exit(failed || process.exitCode ? 1 : 0);
