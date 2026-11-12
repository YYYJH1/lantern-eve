// Drive the test build of the game page to exact moments, and take pictures of them.
//
// The page is the real one (web/dist-e2e, served by lib/serve.mjs) and the world behind it is the
// real core running in Pyodide in the page's worker. Two things make the pictures repeatable.
//
// Time is stepped by hand. The page is opened with `?until=1`, which holds the world after its
// first tick. From then on, one tick is one pair of the page's own pause messages: `resume`,
// which the host answers at once with one tick, and `pause` right behind it, which the worker
// reads before the next tick can be due (`?pace=0.1` makes a tick take a second of real time, and
// nothing here ever waits for one). So the world is always held at a tick the script chose, and an
// action sent in between is applied at exactly that tick. The core is a function of its seed and
// of the inputs it is given at each tick, so the same script gives the same game, and the same
// frames as a run in real time.
//
// A talk is the exception. While the manager talks the core holds the clock by itself: no tick
// comes, whatever is asked of the host, so a step inside a talk would wait for ever. The script
// does not step there. It acts, which is to ask with a topic tag (`ask`), or it leaves (`leave`).
// A question costs the minutes written over the tags: the world owes them, runs through them at
// twenty times its pace, and holds again. `ask` steps through those ticks, and a step that is made
// while a talk holds the world is an error that says so at once. While the talk holds the world
// the script lets the page be as it is (the bar says "time held") and takes the pictures there.
//
// The picture is let to settle before it is taken: the pieces on the map glide to their cells in a
// moment of real time, so the script waits until none of them moves, fixes the clock of the map's
// own animations (river glints, lanterns) to a value of its own and ends the page's CSS animations.

/** The part of the film that runs in the page. Installed before the page's own scripts. */
export const PAGE_SIDE = String.raw`
(() => {
  const L = () => window.__lantern;
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const film = {
    /** Whether the manager is in a talk. */
    talking() {
      return L().play.state.talk !== null;
    },
    /**
     * Whether a talk holds the world: the core stops its own clock in a talk (the rate stays [1, 1]), and starts it again, at
     * [20, 1], only for the minutes that an act of the talk owes. While it holds, no tick comes.
     */
    holds() {
      const [num, den] = L().client.state.rate;
      return film.talking() && num === 1 && den === 1;
    },
    /** The host holds the world at the tick it is at, and applies what the script sends at once. */
    pauseWorld() {
      L().client.pause();
    },
    /**
     * Gives the world back to the talk: the script's own pause is lifted, and so is the page's hold for an open notebook, so that
     * the core's hold is the only one left and the bar says that time is held. Nothing runs, because the talk holds the clock.
     * It returns when the host has said twice in a row that none of the script's holds is among its reasons to stand still: what the
     * host said before it read the lifting may still be on its way, and it says its reasons again within half a second.
     */
    letHold() {
      const client = L().client;
      return new Promise((resolve, reject) => {
        let clean = 0;
        const timer = setTimeout(() => {
          off();
          reject(new Error('the host did not say that the world is held by the talk alone'));
        }, 20000);
        const off = client.tap((m) => {
          if (m.type !== 'stats') return;
          clean = m.stats.reasons.includes('user') || m.stats.reasons.includes('page') ? 0 : clean + 1;
          if (clean < 2) return;
          off();
          clearTimeout(timer);
          resolve();
        });
        client.resume();
        client.resume('page');
      });
    },
    /**
     * One tick: the host answers a resume with a tick and a pause with a held world. The script's resume lifts the hold that the
     * page takes for an open notebook as well, because a picture with the notebook open is taken with the world running. In a talk
     * that holds the world no tick comes, so there it is an error. That includes a talk that began a moment ago, which the
     * first frame without a tick gives away: the host is paused again and the error says what to do. A tick that does not
     * come in time is an error too.
     */
    tickOnce() {
      const held = () => new Error('a talk holds the world, so no tick will come: ask a tag or leave, and do not step');
      if (film.holds()) return Promise.reject(held());
      return new Promise((resolve, reject) => {
        const client = L().client;
        let advanced = false;
        const finish = (settle, value) => {
          off();
          clearTimeout(timer);
          settle(value);
        };
        const timer = setTimeout(() => {
          client.pause();
          finish(reject, new Error('no tick came within 20 seconds'));
        }, 20000);
        const off = client.tap((m) => {
          if (m.type !== 'frame') return;
          if (m.advanced) advanced = true;
          else if (advanced) finish(resolve, client.state.simTick);
          else if (film.holds()) {
            client.pause();
            finish(reject, held());
          }
        });
        client.resume();
        client.resume('page');
        client.pause();
      });
    },
    async step(n) {
      let tick = L().client.state.simTick;
      for (let i = 0; i < n; i++) tick = await film.tickOnce();
      return tick;
    },
    /** Up to n ticks of the minutes that a question owes, fewer if the talk holds the world again. Returns the ticks it took. */
    async stepOwed(n) {
      let used = 0;
      while (used < n && film.talking() && !film.holds()) {
        await film.tickOnce();
        used++;
      }
      return used;
    },
    /**
     * Up to n ticks, fewer if a talk begins and holds the world: the manager that walks up to somebody talks as soon as they are in
     * reach, in the middle of a step. Returns the ticks it took.
     */
    async stepOrTalk(n) {
      let used = 0;
      while (used < n && !film.holds()) {
        try {
          await film.tickOnce();
          used++;
        } catch (error) {
          if (film.holds()) break;
          throw error;
        }
      }
      return used;
    },
    /** The number of frames the host has sent, to tell that it answered. */
    frames() {
      return L().client.state.frameCount;
    },
    /** Steps until the condition holds. Returns the ticks it took, or -1 if it did not hold in time. */
    async stepUntil(condition, max) {
      for (let i = 0; i <= max; i++) {
        if (condition()) return i;
        if (i < max) await film.tickOnce();
      }
      return -1;
    },
    positions() {
      const L_ = L();
      const people = L_.play.view ? L_.play.view.people.map((p) => p.id) : [];
      const cam = L_.view.camera;
      const parts = [cam.x.toFixed(3), cam.y.toFixed(3), cam.zoom.toFixed(5)];
      for (const id of [...people, 'player']) {
        const at = L_.view.screenPositionOf(id);
        parts.push(at === null ? '-' : at.x.toFixed(2) + ',' + at.y.toFixed(2));
      }
      return parts.join(';');
    },
    /**
     * Waits until nothing on the map moves, then has the map draw once more with its clock at
     * "seconds". The top bar says "paused" while the world is held between two pictures, which is
     * the script's doing and not the game's, so the page is told that the world is running. The
     * page renders on its own schedule and what it renders can start a CSS animation or
     * transition, so each one is ended in the frame after it starts. A few things on the page
     * count real time, not ticks (a notebook entry is "new" for 2.8 seconds while the notebook is
     * open), and a picture should not depend on how long the machine took to get to it, so
     * what is new in the notebook is counted as seen.
     */
    async settle(seconds) {
      const view = L().view;
      view.clock = () => seconds;
      // In a talk the world stands still for real, which is what the bar should say. Anywhere else the script's pause is not the game's.
      if (!film.holds()) L().client.state.paused = false;
      L().play.markSeen();
      L().client.touch();
      const endAnimations = () => {
        for (const animation of document.getAnimations()) {
          try {
            animation.finish();
          } catch {
            animation.pause(); // an endless one stays at its first frame
            animation.currentTime = 0;
          }
        }
      };
      const frames = async (n) => {
        for (let i = 0; i < n; i++) {
          await frame();
          endAnimations();
        }
      };
      await frames(4);
      let last = '';
      let same = 0;
      for (let i = 0; i < 900 && same < 8; i++) {
        await frames(1);
        const now = film.positions();
        if (now === last) same++;
        else {
          same = 0;
          last = now;
        }
      }
      if (same < 8) throw new Error('the map did not come to rest');
      const drawn = view.stats().frames;
      view.zoomBy(1); // asks for a frame without moving the camera
      for (let i = 0; i < 300 && view.stats().frames < drawn + 2; i++) await frames(1);
      await frames(4);
      return view.stats().frames;
    },
    canvasPoint(x, y) {
      const rect = document.querySelector('[data-testid=map]').getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    },
    cellPoint(cx, cy) {
      const at = L().view.cellToScreen(cx, cy);
      return film.canvasPoint(at.x, at.y);
    },
    personPoint(id) {
      const at = L().view.screenPositionOf(id);
      return at === null ? null : film.canvasPoint(at.x, at.y);
    },
    elementPoint(selector) {
      const el = document.querySelector(selector);
      if (el === null) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    /**
     * The middle of an element once it has stopped moving: a column that has just lost a card or gained one lays itself out
     * again in the frames after, and a click at the old place would miss the button. Null if there is no such element.
     */
    async stablePoint(selector) {
      let last = null;
      for (let i = 0; i < 40; i++) {
        const point = film.elementPoint(selector);
        if (point === null) {
          last = null;
        } else if (last !== null && Math.abs(point.x - last.x) < 0.5 && Math.abs(point.y - last.y) < 0.5) {
          return point;
        } else {
          last = point;
        }
        await frame();
        await frame();
      }
      return last;
    },
    /**
     * Puts the camera so that a cell of the town is at a fraction of the width and of the height of the map (0.5, 0.5 is the middle), at a zoom
     * of its own (1 shows the whole town).
     */
    lookAtCell(cx, cy, zoom, fx, fy) {
      const view = L().view;
      const canvas = document.querySelector('[data-testid=map]');
      // A cell on the screen is 32 pixels wide and 25.22 deep (web/src/page/map/projection.ts).
      const CELL = 32;
      const DEPTH = 25.22;
      const cam = view.camera;
      cam.zoom = zoom;
      cam.x = canvas.clientWidth * fx - (cx + 0.5) * CELL * zoom;
      cam.y = canvas.clientHeight * fy - (cy + 0.5) * DEPTH * zoom;
      cam.moved = true;
      view.zoomBy(1);
    },
    /** A cell of the pile of bamboo at the bridge, which covers two cells at the west end of the deck, in the row just south of it: the one nearer the deck. */
    pileCell() {
      const bridge = L().client.state.scene.places.find((place) => place.kind === 'bridge');
      if (bridge === undefined) throw new Error('the town has no bridge');
      const [x, y, , height] = bridge.rect;
      return { x: x - 1, y: y + height };
    },
  };
  window.__film = film;
})();
`;

/** The film of one game: a page, and the moves the scripts make on it. */
export class Film {
  constructor(page) {
    this.page = page;
  }

  /**
   * Open the test build at a held world.
   * @param {import('./chrome.mjs').Browser} browser
   * @param {string} origin  where the build is served
   * @param {{lang: 'en'|'zh', theme: 'light'|'dark', size: [number, number], scale: number, query: string}} options
   */
  static async open(browser, origin, { lang, theme, size, scale = 1, query }) {
    const page = await browser.newPage({ width: size[0], height: size[1], scale, colorScheme: theme });
    await page.setLanguage(lang === 'zh' ? 'zh-CN' : 'en-US');
    // What a returning visitor has chosen: the language and the theme the page remembers.
    await page.addInitScript(
      `try { localStorage.setItem('lantern.lang', '${lang}'); localStorage.setItem('lantern.theme', '${theme}'); } catch {}`,
    );
    await page.addInitScript(PAGE_SIDE);
    await page.goto(`${origin}/?${query}`);
    await page.waitFor('window.__lantern?.client.state.phase === "ready"', { timeout: 90000, what: 'the world to start' });
    const film = new Film(page);
    await page.waitFor('window.__lantern.view.stats().people > 0', { timeout: 60000, what: 'the map to draw the town' });
    await page.evaluate('document.fonts.ready.then(() => true)');
    return film;
  }

  get tick() {
    return this.page.evaluate('window.__lantern.client.state.simTick');
  }

  /** The ticks the script moves the world by. In a talk that holds the world there are none, and this throws at once. */
  step(n) {
    return this.page.evaluate(`window.__film.step(${n})`);
  }

  /** Up to n ticks, fewer if a talk begins and holds the world, which is what a manager who walks up to somebody does. */
  stepOrTalk(n) {
    return this.page.evaluate(`window.__film.stepOrTalk(${n})`);
  }

  /** Whether the manager is in a talk. */
  inTalk() {
    return this.page.evaluate('window.__film.talking()');
  }

  /** Whether a talk holds the world, so that no tick will come until the manager asks or leaves. */
  holds() {
    return this.page.evaluate('window.__film.holds()');
  }

  /** Lifts the script's own pause in a talk, so that the page shows what the game shows: the core holds the time (the bar says so only then). */
  letHold() {
    return this.page.evaluate('window.__film.letHold()');
  }

  /**
   * Presses a control that acts in the game, with the world held at the tick it is at, and waits for the host to answer. The
   * answer of a host that is held comes at once, so the action is applied at the tick the script was at.
   */
  async act(selector) {
    const frames = await this.page.evaluate('(window.__film.pauseWorld(), window.__film.frames())');
    await this.click(selector);
    await this.page.waitFor(`window.__film.frames() > ${frames}`, { timeout: 30000, what: `the host to answer ${selector}` });
  }

  /**
   * Asks the person of the talk about a topic, with its tag in the row above the acts. The person answers at once and the
   * world owes the minutes of the question, which the script steps through, `every` ticks to a picture (`grab` takes one). It
   * ends with the talk holding the world again and the page showing it.
   */
  async ask(topic, grab, every = 7) {
    const lines = await this.page.evaluate('window.__lantern.play.state.talk.lines.length');
    await this.act(`[data-testid=topic-chip][data-id=${topic}]`);
    await this.page.waitFor(`window.__lantern.play.state.talk.lines.length > ${lines}`, { timeout: 30000, what: `the answer about ${topic}` });
    for (let rounds = 0; !(await this.holds()); rounds++) {
      if (rounds > 400 || !(await this.inTalk())) throw new Error(`the question about ${topic} did not end in a held talk`);
      await this.page.evaluate(`window.__film.stepOwed(${every})`);
      await grab(1);
    }
    await this.letHold();
  }

  /** Leaves the talk, with the world held at the tick it is at. The world then runs at its pace again, and is stepped as before. */
  async leave() {
    await this.act('[data-testid=verb-leave]');
    await this.page.waitFor('window.__film.talking() === false', { timeout: 30000, what: 'the talk to end' });
  }

  /** Steps until a condition (the source of an expression) holds in the page. Throws if it does not within `max` ticks. */
  async stepUntil(condition, max, what = condition) {
    const used = await this.page.evaluate(`window.__film.stepUntil(() => (${condition}), ${max})`);
    if (used < 0) throw new Error(`${what} did not happen within ${max} ticks`);
    return used;
  }

  /** Lets the picture settle and returns the number of the map's frame. */
  settle(seconds) {
    return this.page.evaluate(`window.__film.settle(${seconds})`);
  }

  async pointAt(expression) {
    const point = await this.page.evaluate(expression);
    if (point === null || point === undefined) throw new Error(`nothing to point at: ${expression}`);
    return point;
  }

  /** Click the middle of the first element that the selector matches. */
  async click(selector) {
    const point = await this.pointAt(`window.__film.stablePoint(${JSON.stringify(selector)})`);
    await this.page.click(point.x, point.y);
  }

  /** Click on a person's piece on the map. */
  async clickPerson(id) {
    const point = await this.pointAt(`window.__film.personPoint(${JSON.stringify(id)})`);
    await this.page.click(point.x, point.y);
  }

  /** Click on the middle of a cell of the map. */
  async clickCell(x, y) {
    const point = await this.pointAt(`window.__film.cellPoint(${x}, ${y})`);
    await this.page.click(point.x, point.y);
  }

  /** The pointer goes to a quiet corner of the top bar, so that nothing on the page is hovered. */
  async rest() {
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 520, y: 26 });
  }

  /** A picture of the page as it is, after it settles. A talk that holds the world is shown as the game shows it, with no pause of the script's on it. */
  async shoot(seconds, clip = undefined) {
    await this.rest();
    if (await this.holds()) await this.letHold();
    await this.settle(seconds);
    return this.page.screenshot({ clip });
  }
}
