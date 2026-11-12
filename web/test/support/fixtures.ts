import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type ConsoleMessage, type Page } from "@playwright/test";
import type { HostStats, ModelRequest, Replay } from "../../src/shared/protocol.ts";
import type { ModelOutcome } from "../../src/shared/transport.ts";
import { type MockServer, startMockServer } from "./mock-server.ts";
import { type StaticServer, startStaticServer } from "./static-server.ts";
import { scaled } from "./time-scale.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.resolve(HERE, "../..");
export const REPO_DIR = path.resolve(WEB_DIR, "..");
export const DIST_E2E = path.join(WEB_DIR, "dist-e2e");
export const OUT_DIR = path.join(WEB_DIR, "test-results");

export interface Servers {
  app: StaticServer;
  /** Two mock providers on different origins. */
  mock: MockServer;
  mock2: MockServer;
}

export interface Snapshot {
  phase: string;
  simTick: number;
  frameCount: number;
  paused: boolean;
  rate: [number, number];
  hash: string | null;
  hashTick: number | null;
  npcCount: number;
  stats: HostStats | null;
  loaded: {
    match: boolean;
    hash: string;
    savedHash: string;
    tick: number;
    hashesChecked: number;
    reissued: number;
    cancelledOpen: number;
  } | null;
  error: { code: string; message: string } | null;
  notices: Array<{ code: string; message: string }>;
  cspViolations: Array<{ directive: string; blocked: string }>;
  ready: {
    timings: { pyodideMs: number; wheelMs: number; coreMs: number; totalMs: number };
    coreVersion: string;
    coreFormat: number;
    pyodideVersion: string;
    pythonVersion: string;
    wheel: { name: string; bytes: number };
  } | null;
  readyAfterMs: number | null;
}

export interface NetworkRecord {
  url: string;
  origin: string;
  method: string;
  authorization: string | undefined;
}

export interface CpythonReport {
  ok: boolean;
  error?: string;
  final_tick?: number;
  final_hash?: string;
  expected_final_hash?: string;
  checkpoints_checked?: number;
  checkpoints_missing?: number[];
  mismatches?: unknown[];
  calls?: number;
  requests_emitted?: number;
  records?: number;
}

/** Replays a replay file under CPython (uv run) and returns the report of replay_check.py. */
export function replayInCpython(replay: Replay, label: string): CpythonReport {
  const dir = path.join(OUT_DIR, "replays");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}.json`);
  writeFileSync(file, JSON.stringify(replay));
  const run = spawnSync(
    "uv",
    ["run", "--project", REPO_DIR, "--directory", REPO_DIR, "python", path.join(WEB_DIR, "test/support/replay_check.py"), file],
    { encoding: "utf8", timeout: 180_000 },
  );
  const lines = run.stdout.trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  try {
    return JSON.parse(last) as CpythonReport;
  } catch {
    return { ok: false, error: `no report from replay_check.py (status ${run.status}): ${run.stderr.slice(-800)}` };
  }
}

/**
 * `LANTERN_CPU_THROTTLE=4` makes the main thread of every page run at a quarter of its speed, with
 * the browser's own CPU throttling (the DevTools protocol's Emulation.setCPUThrottlingRate). It is
 * for finding out how a test behaves on a slow machine, such as a CI runner with four cores. The
 * browser refuses the call for workers, so the host worker keeps its speed.
 */
const CPU_THROTTLE = Number(process.env.LANTERN_CPU_THROTTLE ?? "1");

async function throttleCpu(page: Page): Promise<void> {
  if (!(CPU_THROTTLE > 1)) return;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
}

/** A page running the test build, with everything the tests want to look at collected. */
export class LanternPage {
  readonly consoleLines: string[] = [];
  readonly pageErrors: string[] = [];
  readonly network: NetworkRecord[] = [];
  readonly downloads: string[] = [];
  /** Settles once the page has the CPU throttle the run asked for, which is none by default. */
  readonly throttled: Promise<void>;

  /**
   * `map` is whether the page draws the map. A page that is made by hand has it. The `lantern`
   * fixture does not, unless the spec asks for it with `test.use({ map: true })`.
   */
  constructor(
    readonly page: Page,
    readonly servers: Servers,
    readonly map = true,
  ) {
    this.throttled = throttleCpu(page);
    const note = (source: string, message: ConsoleMessage): void => {
      this.consoleLines.push(`[${source}:${message.type()}] ${message.text()}`);
    };
    page.on("console", (message) => note("page", message));
    page.on("pageerror", (error) => this.pageErrors.push(String(error.message)));
    page.on("worker", (worker) => {
      worker.on("console", (message) => note("worker", message));
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      this.network.push({
        url: request.url(),
        origin: url.origin,
        method: request.method(),
        authorization: request.headers().authorization,
      });
    });
  }

  /**
   * Opens the test build. `query` is for the test-only parameters: pace, seed, until, scenario. The
   * host tests play the demo world m0 unless the query names another scenario, and they leave the
   * menu drawer open, because that is where the saves, the export and the model provider are.
   * The map is left out (`?map=off`) unless the spec looks at it: it is the heavy part of a page on a
   * machine with a software renderer, and it is not what the tests of the host test.
   */
  async open(query = "", options: { menu?: boolean; map?: boolean } = {}): Promise<void> {
    const params = new URLSearchParams(query);
    if (!params.has("scenario")) params.set("scenario", "m0");
    if (!(options.map ?? this.map) && !params.has("map")) params.set("map", "off");
    await this.throttled;
    await this.page.goto(`${this.servers.app.origin}/?${params.toString()}`);
    await this.waitReady();
    if (options.menu !== false) await this.openMenu();
  }

  /** Opens the drawer with the game's own controls, if it is not open. */
  async openMenu(): Promise<void> {
    const menu = this.page.getByTestId("menu");
    if ((await menu.getAttribute("data-open")) !== "true") await this.page.getByTestId("btn-menu").click();
    await expect(menu).toHaveAttribute("data-open", "true");
  }

  /** Runs `work` with the menu open, and leaves the menu as it found it: the language and the theme are chosen there. */
  private async inMenu(work: () => Promise<void>): Promise<void> {
    const menu = this.page.getByTestId("menu");
    const wasOpen = (await menu.getAttribute("data-open")) === "true";
    if (!wasOpen) await this.openMenu();
    await work();
    if (!wasOpen) {
      await this.page.getByTestId("menu-close").click();
      await expect(menu).toHaveAttribute("data-open", "false");
    }
  }

  /** Chooses the language in the menu. */
  async setLang(lang: "zh" | "en"): Promise<void> {
    await this.inMenu(() => this.page.getByTestId(`lang-${lang}`).click());
  }

  /**
   * Chooses the language by a click in the page itself and not through the menu, which takes no time on any machine. A test that reads a note in both languages needs it,
   * since a note goes by itself some five seconds after it comes (`NOTE_MS` in play.ts) and a round through the menu can take that long on a slow one. The menu is tested
   * where it is the subject.
   */
  async switchLang(lang: "zh" | "en"): Promise<void> {
    await this.page.getByTestId(`lang-${lang}`).first().evaluate((button: HTMLElement) => button.click());
  }

  /**
   * The text of the last element of a kind in each language, read in one call of the page: the language is switched by a click, read, and switched back, with nothing
   * between the calls of the test, so that what goes by itself some seconds after it comes (a note, a reason, a pop of hearts) cannot go in the middle of it, as it can
   * between the calls of a test on a slow machine. The text is as `toHaveText` reads it, with the white space made one space, and `attributes` are read from the same
   * element. Null where there is no such element.
   */
  async textsInBothLanguages(testId: string, attributes: string[] = []): Promise<{ en: string; zh: string; attributes: Record<string, string | null> } | null> {
    return this.page.evaluate(
      async ([id, names]) => {
        const last = (): Element | null => {
          const all = document.querySelectorAll(`[data-testid="${id}"]`);
          return all.item(all.length - 1);
        };
        const text = (element: Element | null): string | null => (element === null ? null : (element.textContent ?? "").replace(/\s+/g, " ").trim());
        const choose = async (lang: "zh" | "en"): Promise<void> => {
          document.querySelector<HTMLElement>(`[data-testid="lang-${lang}"]`)?.click();
          await new Promise((resolve) => setTimeout(resolve, 40));
        };
        const now = document.querySelector('[data-testid="lang-switch"]')?.getAttribute("data-lang") === "zh" ? "zh" : "en";
        const other = now === "zh" ? "en" : "zh";
        const element = last();
        const here = text(element);
        const read: Record<string, string | null> = {};
        for (const name of names) read[name] = element?.getAttribute(name) ?? null;
        await choose(other);
        const there = text(last());
        await choose(now);
        if (here === null || there === null) return null;
        return now === "zh" ? { zh: here, en: there, attributes: read } : { en: here, zh: there, attributes: read };
      },
      [testId, attributes] as const,
    );
  }

  /**
   * Makes the timers of the page of one length run `factor` times as long, for a test that reads what the page shows for a few seconds and goes by itself (a reason on an act
   * after 5, the pop of a heart after 6, the notice of a save after 3.5) across calls that take longer than that on a slow machine. It is set before the page opens, and a
   * test that waits for the thing to go waits `factor` times as long.
   */
  async stretchTimer(delay: number, factor = 4): Promise<void> {
    await this.page.addInitScript(
      ([ms, by]) => {
        const original = window.setTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => original(handler, timeout === ms ? ms * by : timeout, ...args)) as typeof window.setTimeout;
      },
      [delay, factor] as const,
    );
  }

  /** Chooses the theme by a click in the page itself and not through the menu, for the reason `switchLang` gives. */
  async switchTheme(theme: "auto" | "light" | "dark"): Promise<void> {
    await this.page.getByTestId(`theme-${theme}`).first().evaluate((button: HTMLElement) => button.click());
  }

  /** Chooses the theme in the menu. */
  async setTheme(theme: "auto" | "light" | "dark"): Promise<void> {
    await this.inMenu(() => this.page.getByTestId(`theme-${theme}`).click());
  }

  async waitReady(timeout = 60_000): Promise<void> {
    // The hooks are installed by the page's module after the load event, so wait for them as well as for the end of the boot.
    await this.page.waitForFunction(() => window.__lantern !== undefined && window.__lantern.client.state.phase !== "boot", undefined, { timeout });
    const phase = await this.page.evaluate(() => window.__lantern.client.state.phase);
    expect(phase, JSON.stringify(await this.snapshot().then((s) => s.error))).toBe("ready");
  }

  async snapshot(): Promise<Snapshot> {
    return this.page.evaluate(() => {
      const s = window.__lantern.client.state;
      return JSON.parse(
        JSON.stringify({
          phase: s.phase,
          simTick: s.simTick,
          frameCount: s.frameCount,
          paused: s.paused,
          rate: s.rate,
          hash: s.hash,
          hashTick: s.hashTick,
          npcCount: s.frame?.npcs.length ?? 0,
          stats: s.stats,
          loaded: s.loaded,
          error: s.error,
          notices: s.notices,
          cspViolations: s.cspViolations,
          ready: s.ready,
          readyAfterMs: s.readyAfterMs,
        }),
      ) as Snapshot;
    });
  }

  async tick(): Promise<number> {
    return this.page.evaluate(() => window.__lantern.client.state.simTick);
  }

  /**
   * The tick, with the clock of the page at the moment it was read. A test that counts ticks against
   * time takes both from the page in one call, so that the time is the one the world ran by and not
   * the time that the test's own round trips took.
   */
  async tickAt(): Promise<{ tick: number; at: number }> {
    return this.page.evaluate(() => ({ tick: window.__lantern.client.state.simTick, at: performance.now() }));
  }

  async waitForTick(tick: number, timeout = 60_000): Promise<void> {
    await this.page.waitForFunction((t) => window.__lantern.client.state.simTick >= t, tick, { timeout, polling: 25 });
  }

  /**
   * Starts timing the pause button on the clock of the page: from the click to the word "paused" in
   * the status. A click from the test takes as long as the machine needs to check that the button can
   * be pressed, which says nothing about how fast the page and the host answer.
   */
  async watchPause(): Promise<void> {
    await this.page.evaluate(() => {
      const times = { clicked: -1, paused: -1 };
      (window as unknown as { __pauseTimes: typeof times }).__pauseTimes = times;
      document.querySelector('[data-testid="btn-pause"]')?.addEventListener("click", () => (times.clicked = performance.now()), { capture: true });
      const status = document.querySelector('[data-testid="status"]');
      if (status === null) return;
      new MutationObserver(() => {
        if (times.clicked >= 0 && times.paused < 0 && status.textContent === "paused") times.paused = performance.now();
      }).observe(status, { childList: true, characterData: true, subtree: true });
    });
  }

  /** Milliseconds from the click on the pause button to the word "paused", on the clock of the page. See watchPause. */
  async pauseTime(): Promise<number> {
    return this.page.evaluate(() => {
      const times = (window as unknown as { __pauseTimes: { clicked: number; paused: number } }).__pauseTimes;
      return times.paused - times.clicked;
    });
  }

  /**
   * Waits for the page to draw two frames. The interface hangs the handler for a key on a list or a
   * sheet after the frame that shows it, so a key pressed the moment it opens finds nobody listening.
   * A person is never that quick, and a test waits for the frames first.
   */
  async settled(): Promise<void> {
    await this.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  /** Statistics as of now, not the ones that arrive twice a second. */
  async exportReplay(): Promise<Replay> {
    return this.page.evaluate(() => window.__lantern.client.exportReplay());
  }

  /** Clicks "Export replay" and returns the text of the file the page offers. */
  async downloadExport(): Promise<string> {
    const [download] = await Promise.all([this.page.waitForEvent("download"), this.page.getByTestId("btn-export").click()]);
    return readFileSync(await download.path(), "utf8");
  }

  async e2e<T>(op: string, args?: unknown): Promise<T> {
    return this.page.evaluate(([o, a]) => window.__lantern.client.e2e<T>(o as string, a), [op, args] as const);
  }

  /** Runs a model request on the transport, as the host would for the core, and returns its outcome. */
  async request(
    id: string,
    options: { tier?: string; timeoutMs?: number; maxTokens?: number } = {},
  ): Promise<ModelOutcome> {
    const request: ModelRequest = {
      request_id: id,
      tier: options.tier ?? "cheap",
      messages: [{ role: "user", content: "say hello" }],
      max_tokens: options.maxTokens ?? 32,
    };
    return this.e2e<ModelOutcome>("request", { request, timeoutMs: options.timeoutMs });
  }

  /** Points a provider at a mock base URL and gives it a key. */
  async configure(config: { provider: string | null; key?: string; baseUrl?: string; model?: string }): Promise<void> {
    await this.page.evaluate((c) => {
      window.__lantern.client.configure(c as Parameters<typeof window.__lantern.client.configure>[0]);
    }, config);
  }

  /**
   * Makes the page report itself hidden or visible. Headless Chromium never changes
   * document.visibilityState on its own (no tab switch, window minimise or background target does
   * it), so the test sets the two properties the page reads and fires the event, which is what the
   * page's own listener receives from a real browser. Returns the clock of the page when it fired.
   */
  async setVisibility(state: "hidden" | "visible"): Promise<number> {
    return this.page.evaluate((s) => {
      const at = performance.now();
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      return at;
    }, state);
  }

  /** Every string the test can see outside the worker's memory. */
  async storageDump(): Promise<{ localStorage: string; sessionStorage: string; indexedDB: string; caches: string; cookies: string }> {
    const inPage = await this.page.evaluate(async () => {
      const dump = (storage: Storage): string => JSON.stringify(Object.fromEntries(Object.entries(storage)));
      const databases = await indexedDB.databases();
      const idb: Record<string, Record<string, unknown[]>> = {};
      for (const info of databases) {
        if (info.name === undefined) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(info.name as string);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        idb[info.name] = {};
        for (const storeName of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((resolve, reject) => {
            const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          (idb[info.name] as Record<string, unknown[]>)[storeName] = rows;
        }
        db.close();
      }
      const cacheNames = await caches.keys();
      return {
        localStorage: dump(localStorage),
        sessionStorage: dump(sessionStorage),
        indexedDB: JSON.stringify(idb),
        caches: JSON.stringify(cacheNames),
      };
    });
    const cookies = JSON.stringify(await this.page.context().cookies());
    return { ...inPage, cookies };
  }
}

const extended = base.extend<{ lantern: LanternPage; map: boolean }, { servers: Servers }>({
  /** Whether the pages of the spec draw the map. Off unless the spec says `test.use({ map: true })`. */
  map: [false, { option: true }],
  servers: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (!existsSync(path.join(DIST_E2E, "index.html"))) {
        throw new Error("dist-e2e is missing: run `npm run build:e2e` first, or use `npm run test:e2e`");
      }
      const mock = await startMockServer();
      const mock2 = await startMockServer();
      const app = await startStaticServer({ root: DIST_E2E, extraConnect: [mock.origin, mock2.origin] });
      await use({ app, mock, mock2 });
      await Promise.all([app.close(), mock.close(), mock2.close()]);
    },
    { scope: "worker" },
  ],
  lantern: async ({ page, servers, map }, use) => {
    servers.mock.reset();
    servers.mock2.reset();
    const lantern = new LanternPage(page, servers, map);
    await lantern.throttled;
    await use(lantern);
  },
});

// A limit that a spec sets for itself with `test.setTimeout(ms)` is written for a development machine like the limits of the config, and is stretched by
// the same factor (LANTERN_TIME_SCALE, see time-scale.ts).
const setLimit = extended.setTimeout.bind(extended);
extended.setTimeout = (ms: number): void => setLimit(scaled(ms));

export const test = extended;

export { expect };
