#!/usr/bin/env node
// Capture the game page: the animated GIF of the first day, the notebook, the rumour tree of the ending and a moment of the festival night.
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
//      been judged; for the ending, a game of one day that runs to its last night; for the festival,
//      the night that ends a game of three days, at a second of its own.
//
// Pictures (<lang> is en or zh, <theme> is light or dark)
//   play-<lang>-<theme>.gif       the first day of the game as a player meets it, from the opening
//                                 page to the next morning: the page of the first six people, the
//                                 elder's cards, the talk with Granny Li (four buttons, her name and
//                                 who she is, the hearts, the request the slip names, which she
//                                 refuses), what stands behind the hearts and the gifts, the rumour
//                                 followed back to Zhou's Clerk, the people book and the pair of
//                                 lines in the notebook (a wrong answer, then the right one), the
//                                 teahouse in the evening where the judged pair is said in public
//                                 and each person answers in their own words, Li Da's promise, the
//                                 summary of the day at nine in the evening, and the bamboo at the
//                                 bridge with the Town Gazette of the morning, the card that says
//                                 the first day is done and the ledger of the bridge. The world is
//                                 stepped without pictures between the beats, which is a cut in the film
//   notebook-<lang>-<theme>.png   the notebook, a book bound with thread, at the moment the manager has
//                                 judged that pair, cut to the paper of the book, each of its pages scrolled
//                                 to a place where no entry of it is cut
//   ending-<lang>-<theme>.png     the rumour tree of the ending, with the hops where the story changed, of a
//                                 game whose tree holds both sentences of the title above it
//   festival-<lang>-<theme>.png   a moment of the festival night of a game whose last night is the full
//                                 one: the whole town with the parade, the main lantern lit, the
//                                 lanterns on the river and the closing line of the night
//
// Options
//   --out <dir>       where the pictures go (default: docs/assets)
//   --dist <dir>      the test build (default: web/dist-e2e)
//   --only <list>     comma-separated: gif, notebook, ending, festival (default: all of them)
//   --lang <list>     en, zh or both (default: both)
//   --theme <list>    light, dark or both (default: both)
//   --seed <n>        the seed of the game of the ending (default: 4927, a game whose tree holds both
//                     sentences of its title; the script stops with an error for one whose tree does
//                     not); the first day and the festival night have their own
//   --night-at <s>    the second of the festival night to take the picture at, or a comma-separated
//                     list of them (default: three and a half seconds before the end of the night)
//   --fps <n>         GIF: frames per second (default: 10)
//   --width <px>      GIF: width in pixels (default: 880, the width the READMEs show it at)
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
const PARTS = ['gif', 'notebook', 'ending', 'festival'];
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
    seed: { type: 'string', default: '4927' },
    'night-at': { type: 'string' },
    fps: { type: 'string', default: '10' },
    width: { type: 'string', default: '880' },
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
    'usage: node tools/readme_assets/capture_page.mjs [--out DIR] [--dist DIR] [--only gif,notebook,ending,festival] ' +
      '[--lang en,zh] [--theme light,dark] [--seed N] [--night-at S[,S...]] [--fps N] [--width PX] [--max-mb N] [--jobs N] ' +
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
async function story(film, grab, keep, { untilNotebook = false, notes = [] } = {}) {
  const { page } = film;
  const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
  const there = (selector) => `${q(selector)} !== null`;
  const gone = (selector) => `${q(selector)} === null`;
  const step = (name) => `${q('[data-testid=tutorial-card]')}?.getAttribute('data-step') === '${name}'`;
  const phase = (name) => `${q('[data-testid=request-card]')}?.getAttribute('data-phase') === '${name}'`;
  const wait = (expression, what, timeout = 30000) => page.waitFor(expression, { timeout, what });
  /** A press of a button that acts in the game, with the world held at the tick it is at: the host applies what it sends at once. */
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
      if (!(await film.inTalk())) await grab(1);
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
  /** Waits for `n` frames of the page to be drawn. */
  const frames = (n) => page.evaluate(`new Promise((done) => { let left = ${n}; const next = () => (--left <= 0 ? done() : requestAnimationFrame(next)); requestAnimationFrame(next); })`);
  /** The lines of the talk, to tell that the person has answered. */
  const lines = () => page.evaluate('window.__lantern.play.state.talk?.lines.length ?? 0');
  const closeElder = async () => {
    if (await page.evaluate(there('[data-testid=elder-close]'))) await film.click('[data-testid=elder-close]');
  };
  /** The note of the red slip is folded while a talk is on: it is opened for the button it has. */
  const openSlip = async () => {
    if ((await page.evaluate(`${q('[data-testid=slip-head]')}?.getAttribute('aria-expanded')`)) === 'false') await film.click('[data-testid=slip-head]');
    await wait(`${q('[data-testid=slip-head]')}?.getAttribute('aria-expanded') === 'true'`, 'the note of the slip to open');
  };
  /** Waits for the preview of the request on the button of the talk, which a task that names the request has up when the talk begins. */
  const preview = async (what) => {
    if (!(await page.evaluate(there('[data-testid=request-card]')))) await film.click('[data-testid=verb-entrust]');
    await wait(phase('preview'), `the preview of ${what}`);
    await page.evaluate(`${q('[data-testid=request-card]')}.scrollIntoView({ block: 'nearest' })`);
  };

  // 1. The opening page.
  await wait(`${q('[data-testid=opening-start]')}?.disabled === false`, 'the opening page to be ready');
  await grab(12);

  // 2. Start: the page of the first six people, and then the clan elder's first card, which sends the manager to Granny Li.
  await film.click('[data-testid=opening-start]');
  await wait(there('[data-testid=people-enter]'), 'the page of the first six people');
  await grab(26);
  await film.click('[data-testid=people-enter]');
  await wait(step('granny'), 'the first card of the tutorial');
  await grab(18);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');

  // 3. The button of the red slip walks the manager up to Granny Li. The talk has four buttons and her name and who she is beside it, and
  // the request on the "Ask a favour" button is the bamboo: its preview first, and then she refuses.
  await walkToTalk('li_laotai');
  await wait(there('[data-testid=meeting-note]'), 'the note of the first meeting');
  await preview('the bamboo');
  await grab(26);
  await press('[data-testid=request-confirm]');
  await wait(step('clerk'), 'the card of the refusal');
  await paid();
  await grab(18);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');
  // What stands behind the hearts opens from the hearts.
  await film.click('[data-testid=hearts]');
  await wait(there('[data-testid=hearts-sheet]'), 'the sheet behind the hearts');
  await grab(18);
  await film.click('[data-testid=hearts-close]');
  await wait(gone('[data-testid=hearts-sheet]'), 'the sheet behind the hearts to go');
  // The small things of the day can be given, with what the manager knows of the person's taste beside each.
  await film.click('[data-testid=gift-open]');
  await wait(there('[data-testid=gift-panel]'), 'the list of gifts');
  await grab(16);
  await film.click('[data-testid=picker-close]');
  await wait(gone('[data-testid=gift-panel]'), 'the list of gifts to go');

  // 4. The rumour, back to whoever said it. The button of the slip asks Granny Li about Li Er, and then sends the manager to the one she heard it
  // from: the teahouse keeper, and then Zhou's Clerk, who saw it himself. At each of them the list of notes to ask the source of is open already,
  // and the manager picks the note.
  await openSlip();
  await press('[data-testid=task-do]');
  await wait(there('[data-testid=topic-chips]'), 'the list of questions');
  await grab(10);
  await film.ask('li_er', async () => {});
  await grab(14);
  await film.leave();
  const askSource = async (who, every, picture) => {
    await walkToTalk(who, every);
    await wait(there('[data-testid=picker-askSource]'), 'the list of notes to ask the source of');
    if (picture) await grab(10);
    const asked = await lines();
    await press('[data-testid=picker-option]');
    await wait(`window.__lantern.play.state.talk?.lines.length > ${asked}`, `the answer of ${who}`);
  };
  await askSource('cha_laoban', 30, true);
  await paid();
  await grab(14);
  await film.leave();
  await askSource('zhou_huoji', 60, false);

  // 5. The elder's card on how two lines stand, and the notebook, which opens by itself: the people book, and the pair of lines with the
  // three answers. A wrong answer says to think again and writes nothing down, and the right one is kept.
  await wait(step('compare'), 'the card of the comparison');
  await paid();
  await grab(18);
  await film.click('[data-testid=tutorial-next]');
  await wait(there('[data-testid=pairing]'), 'the pairing of the notebook');
  await film.click('[data-testid=workspace-tab-people]');
  await wait(there('[data-testid=people-leaf]'), 'the people book');
  await grab(18);
  await film.click('[data-testid=workspace-tab-notes]');
  await wait(there('[data-testid=pair-shown]'), 'the pair of lines');
  await grab(16);
  await film.click('[data-testid=ans-contradicts]');
  await wait(`${q('[data-testid=pair-outcome]')}?.getAttribute('data-ok') === 'false'`, 'the answer that says to think again');
  await grab(14);
  await press('[data-testid=ans-unsupported]');
  await wait(there('[data-testid=judgment]'), 'the judgement');
  await grab(16);
  // The picture is of the book, as it lies when no help is up. The line of the help (the card of the tutorial, the line of what to do, the line of a hint) makes the
  // book start lower and end sooner while it is up, so it is taken away, and the page makes the book as tall as it is without it. What lies round the book (the note
  // of the slip, the strip of the talk, the note of the person) is put away too, so that no word of it shows at the edge of the picture. Nothing that is in the book is.
  await page.evaluate(`(() => {
    document.querySelectorAll(${JSON.stringify(HELP_LINES)}).forEach((el) => { el.style.display = 'none'; });
    document.querySelectorAll(${JSON.stringify(COVERS)}).forEach((el) => { el.style.visibility = 'hidden'; });
  })()`);
  await frames(6);
  // The two pages are longer than the book is tall, and in English more so than in Chinese. Each is scrolled, the way a player scrolls it, to a place where neither the top
  // edge of the page nor the phrase at its foot cuts an entry, and where the left page shows what came of the answer. No line of either page is put away.
  await film.settle(0);
  const scrolls = await page.evaluate(`(() => ${JSON.stringify(LEAVES.map((leaf) => leaf.leaf))}.map((selector) => document.querySelector(selector).scrollTop))()`);
  const seated = [];
  for (const leaf of LEAVES) seated.push(await page.evaluate(`(${seatLeaf.toString()})(${JSON.stringify({ ...leaf, seat: true })})`));
  await keep('notebook', '[data-testid=notebook] .book');
  // What the picture holds is read again after it is taken: a page that moved on its own in the meantime would have made the picture of another place.
  for (const [i, leaf] of LEAVES.entries()) await page.evaluate(`(${seatLeaf.toString()})(${JSON.stringify({ ...leaf, seat: false, expect: { top: seated[i].top, bottom: seated[i].bottom } })})`);
  notes.push(
    ...seated.map((found, i) => {
      const held = found.holds.length === 0 ? '' : `, holds ${found.holds.join(' and ')}`;
      const reach = found.reach === 0 ? '' : `, the phrase reaches up ${found.reach.toFixed(1)} px to a rule`;
      return `  ${LEAVES[i].name}: ${found.top.toFixed(1)} to ${found.bottom.toFixed(1)} of the page, from ${JSON.stringify(found.first)} to ${JSON.stringify(found.last)}${held}${reach}`;
    }),
  );
  // The pages go back to where they were, and the page works out again where the phrase at the foot of each begins (it does so when the page is scrolled).
  await page.evaluate(`(() => {
    document.querySelectorAll(${JSON.stringify(HELP_LINES)}).forEach((el) => { el.style.display = ''; });
    document.querySelectorAll(${JSON.stringify(COVERS)}).forEach((el) => { el.style.visibility = ''; });
    ${JSON.stringify(LEAVES.map((leaf) => leaf.leaf))}.forEach((selector, i) => {
      const leaf = document.querySelector(selector);
      leaf.querySelector('.turn-bar')?.style.removeProperty('min-height');
      leaf.scrollTop = ${JSON.stringify(scrolls)}[i];
      leaf.dispatchEvent(new Event('scroll'));
    });
  })()`);
  if (untilNotebook) return;
  await film.click('[data-testid=notebook-close]');
  await film.leave();

  // 6. The afternoon comes, and the elder's last card says when and where the town will be at the teahouse.
  const minutes = '(() => { const t = window.__lantern.client.state.frame.time; return t.hour * 60 + t.minute; })()';
  await film.stepUntil(step('evening'), 1800, 'the card of the evening');
  await grab(18);
  await film.click('[data-testid=tutorial-next]');
  await wait(gone('[data-testid=tutorial-card]'), 'the card to go');

  // 7. The evening at the teahouse. The task that sets the rumour straight is followed, and its button walks the manager there, to the
  // people who have come by a quarter to six.
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

  // 8. The notebook says what can be said in public now, and the pair that was judged is said to the people there, who each make up their own
  // mind in their own words. Granny Li is one of them, and takes her objection back.
  await film.click('[data-testid=btn-notebook]');
  await wait(`${there('[data-testid=judgment-clarify]')} && !${q('[data-testid=judgment-clarify]')}.disabled`, 'the button that clears it up');
  // The notebook scrolls its own pairing into view a few frames after it opens, so the list of what was judged is brought to the head of the page until it stays there.
  // In view: the head of the list is not above the page and the button that says it in public is not under the phrase that turns the page.
  const judgedAtHead = `(() => {
    const leaf = ${q('[data-testid=notes-leaf]')}.getBoundingClientRect();
    const head = ${q('[data-testid=judgments]')}.getBoundingClientRect();
    const button = ${q('[data-testid=judgment-clarify]')}.getBoundingClientRect();
    return head.top >= leaf.top - 1 && button.bottom <= leaf.bottom - 40;
  })()`;
  for (let tries = 0; ; tries++) {
    await frames(4);
    await page.evaluate(`${q('[data-testid=judgments]')}.scrollIntoView({ block: 'start' })`);
    await frames(4);
    if (await page.evaluate(judgedAtHead)) break;
    if (tries > 10) throw new Error('the list of what was judged did not stay at the head of the page');
  }
  await grab(14);
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

  // 9. Li Da is asked for the bamboo. The button of the task walks the manager up to him, and the preview says what he would bring and by
  // when. He promises.
  await wait(`${q('[data-testid=task-card]')}?.getAttribute('data-id') === 't_bamboo_first'`, 'the task of the bamboo');
  await walkToTalk('li_da', 20);
  await preview('the bamboo of Li Da');
  await grab(20);
  await press('[data-testid=request-confirm]');
  await wait(phase('result'), 'the answer of Li Da');
  await paid();
  await page.evaluate(`${q('[data-testid=request-card]')}.scrollIntoView({ block: 'nearest' })`);
  await grab(18);
  await film.leave();

  // 10. The night passes. At dusk the card that sums up the day is up and holds the world until it is put away (it comes at nine in the evening,
  // whatever the manager is doing, which is why the script steps to it and not past it). In the morning the bamboo is at the bridge: the pile is
  // on the map, and the paper of the morning is up.
  await film.stepUntil(there('[data-testid=night]'), 2400, 'the summary of the day at dusk');
  await grab(22);
  await film.click('[data-testid=night-done]');
  await wait(gone('[data-testid=night]'), 'the summary of the day to go');
  await film.stepUntil("window.__lantern.view.stats().pile === 'small'", 2400, 'the bamboo at the bridge');
  await film.stepUntil('window.__lantern.play.flows.state.recap !== null', 400, 'the paper of the morning');
  await closeElder();
  await wait(there('[data-testid=gazette]'), 'the paper of the morning');
  await grab(22);

  // The paper is put away, and the card that says the first day is done comes after it, once the clock is past the hour of the recap, and holds
  // the world. It is put away in turn, and the camera comes to the bridge, where the bamboo lies as a pile. The board says what was promised and
  // what has come.
  await film.click('[data-testid=gazette-close]');
  await wait(gone('[data-testid=gazette]'), 'the paper to go');
  await film.stepUntil(there('[data-testid=end-card]'), 60, 'the card that says the first day is done');
  await grab(22);
  await film.click('[data-testid=end-close]');
  await wait(gone('[data-testid=end-card]'), 'the card of the end of the first day to go');
  // The note of the slip is put away, and the camera comes to the bridge, with the pile of bamboo at the left of the map where the ledger of the bridge
  // will not lie over it.
  if ((await page.evaluate(`${q('[data-testid=slip-head]')}?.getAttribute('aria-expanded')`)) === 'true') await film.click('[data-testid=slip-head]');
  await page.evaluate('(() => { const pile = window.__film.pileCell(); window.__film.lookAtCell(pile.x, pile.y, 1.7, 0.17, 0.36); })()');
  await grab(18);
  await film.click('[data-testid=board-toggle]');
  await wait(there('[data-testid=board-bridge]'), 'the board');
  await page.evaluate(`${q('[data-testid=board-bridge]')}.scrollIntoView({ block: 'start' })`);
  await grab(26);
}

/** The lines of the help that push the notebook down while they are up, and what lies round the notebook and would show at the edge of its picture. */
const HELP_LINES = '.tut, .tut-chip, .hint-pill';
const COVERS = '.slip-note, .talk-dock, .person-note';
/**
 * The two pages of the book as the picture cuts them. A page scrolls inside the book and the phrase that turns it lies over its foot, so the picture shows a window of the page:
 * from the top of the page, where it has been scrolled to, down to the top of the phrase. `entries` are what a window must not cut (a title, a paragraph, a row of a list,
 * a button: the lines of one stay together, and the phrase lies above the first line that it would cut, so that no more than a line of an entry is ever lost to it), `tops` are the
 * places a window may begin at (the head of the page, the head of each of its parts and its foot), `show` is what has to lie whole in the window, and `prefer` is what the
 * window should hold as many of as it can. A page cannot be scrolled past its own foot, and the English words run longer than the Chinese, so a window that holds the
 * same things in both languages is one that holds what `show` names: the outcome of the answer on the left page, the third blank of the statement (the one with three accounts) on the right.
 */
const LEAVES = [
  {
    name: 'left page',
    leaf: '[data-testid=notes-leaf]',
    entries: 'h3, h4, p, li, summary, button, article',
    tops: '.pairing-title, .pairing-hint, .pairing-cards > li, .answers, .pairing-buttons, .pairing-outcome, .hint-bar, .judgments li, .note',
    show: ['[data-testid=pair-outcome]'],
    prefer: ['[data-testid=notebook-hint]', '[data-testid=judgments] .pairing-title', '[data-testid=judgment]'],
  },
  {
    name: 'right page',
    leaf: '[data-testid=workspace-statement]',
    entries: 'h3, h4, p, li, summary, button',
    tops: '.stmt-part',
    show: ['.stmt-part:last-child'],
    prefer: [],
  },
];

/**
 * Runs in the page. Turns a page of the book (`config`, one of LEAVES) to a place that has no entry cut by the top edge of the page or by the phrase at its foot and holds
 * everything in `show` whole. Of such places it takes the one that holds as many of `prefer` as any does, and of those the highest (`seat`). Or it only reads where the page is
 * now, and fails if an entry is cut there or the window is not the one that `expect` names.
 *
 * A rule that lies under the last whole entry of a window and shows over the phrase (the line over the next entry of a list, the line under the parts of the page) would look
 * like a second rule over the rule of the phrase. The phrase is then made as tall as it takes to reach up to that rule, the way the page makes it reach up to the first line that it
 * would cut, and the rule is all that lies under it. The page sets the height of the phrase on the page itself and puts its own value back whenever the page is looked at again,
 * so the height is given to the phrase's own element.
 *
 * Returns the window, the words of the first and of the last entry that lie whole in it, which of `prefer` it holds, and how far the phrase was made to reach up.
 */
async function seatLeaf(config) {
  const leaf = document.querySelector(config.leaf);
  if (leaf === null) throw new Error(`the book has no ${config.name}`);
  const frames = (n) =>
    new Promise((done) => {
      let left = n;
      const next = () => (--left <= 0 ? done() : requestAnimationFrame(next));
      requestAnimationFrame(next);
    });
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  const EPS = 0.75;
  /** The most that the phrase is asked to reach up to a rule over it: a rule has some padding with it. */
  const MOST_PEEK = 16;
  /** Whether the element is what a closed `details` keeps back: the browser leaves such boxes as they were laid out, with a size, though they are not drawn. */
  const kept = (el) => {
    for (let box = el.parentElement?.closest('details') ?? null; box !== null; box = box.parentElement?.closest('details') ?? null) {
      const summary = Array.from(box.children).find((child) => child.tagName === 'SUMMARY');
      if (!box.open && !(summary !== undefined && summary.contains(el))) return true;
    }
    return false;
  };
  const seen = (el) => el.getClientRects().length > 0 && el.closest('.turn') === null && !kept(el);
  /** The box of what is written, as counted from the head of the page: the boxes of its lines of text, and of its buttons and marks, with no padding round them. */
  const inkOf = (el, from) => {
    const boxes = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || node.data.trim() === '' || parent.closest('.turn') !== null || kept(parent)) continue;
      const frame = parent.getBoundingClientRect();
      if (frame.width < 2 || frame.height < 2) continue; // words for a reader of the screen only
      range.selectNodeContents(node);
      for (const box of Array.from(range.getClientRects())) boxes.push(box);
    }
    for (const part of [el, ...Array.from(el.querySelectorAll('button, summary, svg'))]) {
      if (part.matches('button, summary, svg') && part.closest('.turn') === null && !kept(part)) boxes.push(part.getBoundingClientRect());
    }
    const real = boxes.filter((box) => box.width >= 1 && box.height >= 1);
    if (real.length === 0) return null;
    return { top: Math.min(...real.map((b) => b.top)) - from, bottom: Math.max(...real.map((b) => b.bottom)) - from };
  };
  const words = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const here = leaf.getBoundingClientRect().top + leaf.clientTop - leaf.scrollTop;
  const entries = Array.from(leaf.querySelectorAll(config.entries))
    .filter(seen)
    .map((el) => ({ el, ink: inkOf(el, here) }))
    .filter((entry) => entry.ink !== null);
  const found = (selector) => {
    const el = leaf.querySelector(selector);
    return el === null || !seen(el) ? null : { selector, el, ink: inkOf(el, here) };
  };
  const must = config.show.map((selector) => {
    const one = found(selector);
    if (one === null || one.ink === null) throw new Error(`the ${config.name} has no ${selector}`);
    return one;
  });
  const liked = config.prefer.map(found).filter((one) => one !== null && one.ink !== null);
  /** The phrase that turns the page: it is not there where nothing is left to turn to, and it is made again when the page is scrolled back, so it is looked for each time. */
  const barNow = () => leaf.querySelector('.turn-bar');
  /** Where the window is: from the top of the page to the top of the phrase, as counted from the head of the page. */
  const windowNow = () => {
    const top = leaf.scrollTop;
    const bar = barNow();
    const edge = bar === null ? leaf.clientHeight : bar.getBoundingClientRect().top - (leaf.getBoundingClientRect().top + leaf.clientTop);
    return { top, bottom: top + edge };
  };
  const holds = (win, ink) => ink.top >= win.top - EPS && ink.bottom <= win.bottom + EPS;
  /** What is wrong with a window: an entry cut by an edge of it, or something that has to be in it and is not. */
  const problems = (win) => {
    const wrong = [];
    for (const { el, ink } of entries) {
      if (ink.top < win.top - EPS && ink.bottom > win.top + EPS) wrong.push(`cut at the top: ${words(el)}`);
      if (ink.top < win.bottom - EPS && ink.bottom > win.bottom + EPS) wrong.push(`cut at the foot: ${words(el)}`);
    }
    for (const { el, ink } of must) {
      if (!holds(win, ink)) wrong.push(`not in the window: ${words(el)}`);
    }
    return wrong;
  };
  const named = (win) => {
    const whole = entries.filter(({ ink }) => holds(win, ink)).sort((a, b) => a.ink.top - b.ink.top || a.ink.bottom - b.ink.bottom);
    return { first: whole.length === 0 ? '' : words(whole[0].el), last: whole.length === 0 ? '' : words(whole.reduce((a, b) => (b.ink.bottom >= a.ink.bottom ? b : a)).el) };
  };
  /**
   * The window once the page has put the phrase where it puts it for this place: the window is read until it has stayed the same for three looks, a few frames and a
   * moment apart (a page that is turned scrolls smoothly, and one that draws slowly can show the same place twice on its way).
   */
  const settled = async () => {
    let last = null;
    let same = 0;
    for (let tries = 0; tries < 80; tries++) {
      await frames(2);
      await pause(80);
      const win = windowNow();
      same = last !== null && Math.abs(win.top - last.top) < 0.01 && Math.abs(win.bottom - last.bottom) < 0.01 ? same + 1 : 0;
      if (same >= 3) return win;
      last = win;
    }
    throw new Error(`the ${config.name} of the book did not come to rest`);
  };
  /** How far over the phrase the highest rule shows that lies under the last whole entry of the window: 0 where there is none. */
  const peekOf = (win) => {
    const last = Math.max(...entries.filter(({ ink }) => holds(win, ink)).map(({ ink }) => ink.bottom));
    if (!Number.isFinite(last)) return 0;
    const now = leaf.getBoundingClientRect().top + leaf.clientTop - leaf.scrollTop;
    let rule = win.bottom;
    for (const el of Array.from(leaf.querySelectorAll('*')).filter(seen)) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const drawn = (side) => style[`border${side}Style`] !== 'none' && Number.parseFloat(style[`border${side}Width`]) > 0 && !/(?:,|\/)\s*0(?:\.0+)?\s*\)$/.test(style[`border${side}Color`]) && style[`border${side}Color`] !== 'transparent';
      const lines = [];
      if (drawn('Top')) lines.push(box.top - now);
      if (drawn('Bottom')) lines.push(box.bottom - Number.parseFloat(style.borderBottomWidth) - now);
      for (const line of lines) if (line >= last - EPS && line < win.bottom - EPS) rule = Math.min(rule, line);
    }
    return win.bottom - rule;
  };
  const report = (win, reach) => ({ ...win, ...named(win), holds: liked.filter(({ ink }) => holds(win, ink)).map(({ selector }) => selector), reach });
  if (!config.seat) {
    const win = await settled();
    const wrong = problems(win);
    if (config.expect !== undefined && (Math.abs(win.top - config.expect.top) > 0.6 || Math.abs(win.bottom - config.expect.bottom) > 0.6)) {
      wrong.push(`the window is ${win.top.toFixed(1)} to ${win.bottom.toFixed(1)} and was ${config.expect.top.toFixed(1)} to ${config.expect.bottom.toFixed(1)}`);
    }
    if (wrong.length > 0) throw new Error(`the ${config.name} of the book is not as it was seated: ${wrong.join('; ')}`);
    return report(win, 0);
  }
  const room = leaf.scrollHeight - leaf.clientHeight;
  const tops = new Set([0, Math.floor(room)]);
  for (const el of Array.from(leaf.querySelectorAll(config.tops)).filter(seen)) tops.add(Math.floor(el.getBoundingClientRect().top - here));
  const tried = [];
  let best = null;
  for (const top of Array.from(tops).sort((a, b) => a - b)) {
    if (top < 0 || top > room) continue;
    leaf.scrollTop = top;
    const win = await settled();
    const wrong = problems(win);
    if (wrong.length > 0) {
      tried.push(`${win.top.toFixed(1)}: ${wrong.slice(0, 2).join(', ')}`);
      continue;
    }
    const peek = peekOf(win);
    if (peek > MOST_PEEK) {
      tried.push(`${win.top.toFixed(1)}: a rule ${peek.toFixed(1)} px over the phrase shows under the last entry`);
      continue;
    }
    const score = liked.filter(({ ink }) => holds(win, ink)).length;
    if (best === null || score > best.score) best = { top, score, peek };
  }
  if (best === null) throw new Error(`no place of the ${config.name} of the book has no entry cut: ${tried.join(' | ')}`);
  leaf.scrollTop = best.top;
  let win = await settled();
  const bar = barNow();
  const reach = best.peek > 0.5 && bar !== null ? best.peek : 0;
  if (reach > 0) {
    const before = win.bottom;
    bar.style.minHeight = `${(bar.getBoundingClientRect().height + reach).toFixed(2)}px`;
    win = await settled();
    if (Math.abs(win.bottom - (before - reach)) > 0.6) throw new Error(`the phrase at the foot of the ${config.name} of the book did not reach up ${reach.toFixed(1)} px`);
  }
  const wrong = problems(win);
  if (wrong.length > 0) throw new Error(`the ${config.name} of the book is cut where it was seated: ${wrong.join('; ')}`);
  return report(win, reach);
}

/** The picture of the notebook: the book as it lies open over the map, cut to its box (this is where it stands when the page has no box to ask). */
const NOTEBOOK_CROP = { x: 150, y: 84, width: 1060, height: 562 };
/**
 * How far inside the box of the book the picture is cut, in CSS pixels. The paper has a hand-cut edge about five pixels deep, and what lies behind it (the
 * name of a place on the map, the end of a line of a card, the red slip) shows through its notches as scraps of words, so the picture is cut inside the notches,
 * at the line of ink a little inside the edge of the paper.
 */
const NOTEBOOK_INSET = 5.5;

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
  const notes = [];
  await story(film, grab, keep, { untilNotebook: !wantGif, notes });
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
    // The picture is the paper of the book, wherever the words of the language put its edges.
    const box = found.box ?? NOTEBOOK_CROP;
    const x = Math.round((box.x + NOTEBOOK_INSET) * SCALE);
    const y = Math.round((box.y + NOTEBOOK_INSET) * SCALE);
    const width = Math.round((box.width - 2 * NOTEBOOK_INSET) * SCALE);
    const height = Math.round((box.height - 2 * NOTEBOOK_INSET) * SCALE);
    const out = path.join(outDir, `notebook-${lang}-${theme}.png`);
    const size = await pngOf(found.file, out, { x, y, width, height }, path.join(dir, 'palette-notebook.png'));
    results.push(`${path.relative(REPO, out)}  ${width}x${height}  ${(size / 1024).toFixed(0)} KiB`);
    results.push(...notes);
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
  // The title of a tree sets the first version of its story against the last, and the tree holds only what was told in this game. In a game in which the story did not travel as
  // far as the title says, the title ends on a sentence that nobody in the tree holds. The data of the page has the title and the words under each name of the tree, and the
  // picture is made only of a game whose tree holds both sentences of its title.
  const ends = await page.evaluate(`(() => {
    const lang = ${JSON.stringify(lang)};
    const plain = (text) => text.trim().replace(/[.。]+$/u, '').toLowerCase();
    const chains = window.__lantern.play.state.ending?.reveal?.chains ?? [];
    return chains.map((chain) => {
      const title = chain.label?.[lang] ?? '';
      const named = Array.from(title.matchAll(/[“「]([^”」]+)[”」]/gu), (found) => found[1]);
      const tree = document.querySelector('[data-testid=reveal-chain][data-chain=' + JSON.stringify(chain.id) + ']');
      const drawn = Array.from(tree?.querySelectorAll('[data-testid=tree-words]') ?? [], (el) => plain(el.getAttribute('data-words') ?? ''));
      return { id: chain.id, title, named, missing: named.filter((words) => !drawn.includes(plain(words))), versions: new Set(drawn).size, told: chain.told.length };
    });
  })()`);
  if (ends.length === 0) throw new Error(`the game of seed ${SEED} has no tree in its ending`);
  for (const chain of ends) {
    if (chain.named.length === 0) throw new Error(`the title of ${chain.id} names no sentence: ${JSON.stringify(chain.title)}`);
    if (chain.missing.length > 0) {
      throw new Error(`the tree of ${chain.id} does not hold both ends of its title ${JSON.stringify(chain.title)}: nobody in the tree of the game of seed ${SEED} holds ${chain.missing.map((words) => JSON.stringify(words)).join(' or ')}; choose another game with --seed`);
    }
  }
  await page.evaluate('document.querySelector("[data-testid=reveal-chains]").scrollIntoView({ block: "start" })');
  // The notices of the town (a task that changed, a save) lie over the right edge of the page for a few seconds; the picture is of the tree and not of them.
  await page.evaluate("document.querySelectorAll('.toasts').forEach((el) => { el.style.display = 'none'; })");
  await film.settle(0);
  const box = await page.evaluate(`(() => {
    const r = document.querySelector('[data-testid=reveal-chains]').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  // Two pixels short of the foot of the tree: the rule of what comes after it starts there, and would show as a line along the edge of the picture.
  const crop = { x: Math.round(box.x * SCALE), y: Math.round(box.y * SCALE), width: Math.round(box.width * SCALE), height: Math.round((box.height - 2) * SCALE) };
  const full = path.join(dir, 'ending-full.png');
  await writeFile(full, await page.screenshot());
  const out = path.join(outDir, `ending-${lang}-${theme}.png`);
  const size = await pngOf(full, out, crop, path.join(dir, 'palette.png'));
  if (page.errors.length > 0) throw new Error(`the page threw: ${page.errors.join(' | ')}`);
  await page.close();
  const holds = ends.map((chain) => `  seed ${SEED}, ${chain.id}: ${chain.told} tellings, ${chain.versions} versions of the story in the tree, which holds both sentences of its title ${JSON.stringify(chain.title)}`);
  return [`${path.relative(REPO, out)}  ${crop.width}x${crop.height}  ${(size / 1024).toFixed(0)} KiB`, ...holds];
}

/** A PNG with a palette that is small enough: 256 colours first, fewer if it must be. `width` scales the part that `crop` keeps. */
async function pngOf(input, out, crop, palette, width) {
  let size = Infinity;
  for (const colors of [256, 192, 128, 96, 64]) {
    size = await quantizePng({ input, out, colors, palette, crop, width });
    if (size <= PNG_LIMIT) return size;
  }
  console.error(`capture_page: ${path.relative(REPO, out)} is larger than 400 KiB (${(size / 1024).toFixed(0)} KiB) with 64 colours`);
  process.exitCode = 1;
  return size;
}

// ------------------------------------------------------------------------ the festival night

/**
 * The game of the festival picture: a game of three days whose last night is the full one, on the real core. The core's test actions
 * (`dev_actions`) set the goals of the game at its first tick, which the held world applies at once, so the game does not depend on how fast the
 * machine is. The world then runs at its own pace. The shows are on, on a clock that moves only when the script moves it: the moments of the
 * game play and are put away the way a player puts them away, and then the night plays over the map.
 */
const NIGHT_GAME = 'scenario=bridge&seed=7&pace=60&config=dev_actions:1,days:3&director=on&festival=on&showclock=manual&until=1';
/** The goals that the test actions set: the families call, the bamboo and the timber, the truth said in public, the peace made and the grudge low. */
const NIGHT_GOALS = [
  { type: 'dev_goal', op: 'join', npc: 'cha_laoban' },
  { type: 'dev_goal', op: 'join', npc: 'li_da' },
  ...['zhou_niangzi', 'li_er', 'li_xiaomei', 'zhou_dalang', 'zhou_erlang', 'zhou_huoji', 'old_he', 'mujiang'].map((npc) => ({ type: 'dev_goal', op: 'join', npc })),
  { type: 'dev_goal', op: 'material', npc: 'li_da' },
  { type: 'dev_goal', op: 'material', npc: 'zhou_zhanggui' },
  { type: 'dev_goal', op: 'truth' },
  { type: 'dev_goal', op: 'reconcile' },
  { type: 'dev_goal', op: 'grudge', value: 12 },
];

async function makeFestival(origin, look, work) {
  const { lang, theme } = look;
  const dir = path.join(work, `festival-${lang}-${theme}`);
  await mkdir(dir, { recursive: true });
  const browser = await Browser.launch({ bin: opt.chrome, workDir: dir });
  try {
    return await festivalIn(browser, origin, look, dir);
  } finally {
    await browser.close();
  }
}

async function festivalIn(browser, origin, look, dir) {
  const { lang, theme } = look;
  const film = await Film.open(browser, origin, { lang, theme, size: NIGHT_WINDOW, scale: SCALE, query: NIGHT_GAME });
  const { page } = film;
  await page.evaluate("document.querySelector('canvas.map-canvas').style.setProperty('filter', 'opacity(0.999)')");
  // The words of the night come and go by CSS animations that the clock of the shows does not move, and a picture ends every animation, which would end these
  // words too. They are put out (the way the tests of the night take their pictures), so that the words are there for as long as the show says.
  await page.evaluate(`(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('*, *::before, *::after { animation: none !important; transition: none !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  })()`);
  await page.waitFor('window.__lantern.play.director.port !== null', { timeout: 120000, what: 'the page to begin to watch the moments' });
  await page.waitFor('Array.isArray(window.__lantern.client.state.frame?.moments)', { timeout: 60000, what: 'the game to say that it has moments' });
  // The goals are set at the tick the world is held at. Then the world runs at its own pace.
  for (const goal of NIGHT_GOALS) await page.evaluate(`window.__lantern.client.player(${JSON.stringify(goal)})`);
  await page.evaluate('(window.__lantern.client.resume(), window.__lantern.client.resume("page"))');
  const showOf = () => page.evaluate("document.querySelector('[data-testid=director]')?.getAttribute('data-show') ?? null");
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  // The moments come one after the other, each a show that holds the world until it is put away, with the sheets of the days (the paper, the
  // summary of the night) between them. The night is the last show.
  const deadline = Date.now() + 300000;
  // A button that is gone by the time it is pressed is pressed again at the next look.
  const pressIfThere = (selector) => film.click(selector).catch(() => undefined);
  for (let show = await showOf(); show !== 'festival'; show = await showOf()) {
    if (Date.now() > deadline) throw new Error('the festival night did not begin');
    if (show !== null) {
      await page.evaluate('window.__lantern.showClock.advance(1700)');
      await pressIfThere('[data-testid=director-veil]');
    } else {
      for (const sheet of ['gazette', 'recap', 'night']) {
        if (await page.evaluate(`document.querySelector('[data-testid=${sheet}]') !== null`)) await pressIfThere(`[data-testid=${sheet}-done]`);
      }
    }
    await sleep(150);
  }
  const { timeline } = await page.evaluate('(() => { const s = window.__lantern.festival.stats(); return { timeline: { ...s.timeline, beats: undefined } }; })()');
  // The button that skips the night is not part of what the night looks like.
  await page.evaluate("document.querySelectorAll('[data-testid=director-skip]').forEach((el) => { el.style.visibility = 'hidden'; })");
  const results = [];
  const times = nightAt(timeline);
  let now = 0;
  for (const at of times) {
    if (at >= timeline.duration) throw new Error(`the night is ${timeline.duration.toFixed(1)} seconds long and has no ${at} s`);
    if (at > now) await page.evaluate(`window.__lantern.showClock.advance(${Math.round((at - now) * 1000)})`);
    now = Math.max(now, at);
    const full = path.join(dir, `festival-${at}s-full.png`);
    await writeFile(full, await film.shoot(at));
    const out = path.join(outDir, times.length > 1 ? `festival-${lang}-${theme}-${at}s.png` : `festival-${lang}-${theme}.png`);
    const crop = { x: 0, y: 0, width: NIGHT_WINDOW[0] * SCALE, height: NIGHT_WINDOW[1] * SCALE };
    const size = await pngOf(full, out, crop, path.join(dir, 'palette.png'), FESTIVAL_WIDTH);
    results.push(`${path.relative(REPO, out)}  ${FESTIVAL_WIDTH}x${Math.round((FESTIVAL_WIDTH * crop.height) / crop.width)}  ${(size / 1024).toFixed(0)} KiB  at ${at} s of ${timeline.duration.toFixed(1)}`);
  }
  if (page.errors.length > 0) throw new Error(`the page threw: ${page.errors.join(' | ')}`);
  await page.close();
  return results;
}

/**
 * The window of the picture of the night. The whole town is wider than it is tall (about two to one), so a window of that shape has the town fill the picture, where
 * the usual 1280 by 800 leaves a band of empty night over it and under it.
 */
const NIGHT_WINDOW = [1280, 640];
/** The width of the picture of the night: twice the width the READMEs show it at. */
const FESTIVAL_WIDTH = 1760;
/**
 * The seconds of the night that pictures are taken at: those that `--night-at` names, else the default moment. That is three and a half seconds before the end of
 * the night: the camera has drawn back to the whole town, the line of the parade stretches from the street through the town to the hall, the main lantern is lit,
 * the lanterns drift down the river, and the closing line of the night says in words how this game ended.
 */
function nightAt(timeline) {
  if (opt['night-at'] !== undefined) return opt['night-at'].split(',').map(Number).sort((a, b) => a - b);
  return [Math.round((timeline.duration - 3.5) * 10) / 10];
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
    if (parts.includes('festival')) jobs.push({ name: `festival ${lang} ${theme}`, run: () => makeFestival(server.origin, look, work) });
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
