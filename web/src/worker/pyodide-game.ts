import type { PyodideInterface } from "pyodide";
import type { GameLike, GameSpec, PresetGame, PresetOptions, ReadyInfo } from "../shared/protocol.ts";
import { redact } from "../shared/secrets.ts";

export interface BootOptions {
  /** Absolute URL of the directory with pyodide.mjs, pyodide.asm.* and python_stdlib.zip. */
  pyodideBase: string;
  /** Absolute URL of the directory with the core wheel and its manifest. */
  coreBase: string;
  onStage(stage: string, ms: number): void;
  log(level: "info" | "warn" | "error", message: string): void;
}

export interface BootedCore {
  newGame(spec: GameSpec): GameLike;
  /** Continues a game from `Game.snapshot_json()`. */
  restoreGame(snapshotJson: string): GameLike;
  /**
   * The seed, the scenario and the config of a named game of the core (`lantern_core.api.preset`), at another seed and with another
   * story true where the options say so. Throws for any other name, and for a seed or a story the core does not accept.
   */
  preset(name: string, options?: PresetOptions): PresetGame;
  coreVersion: string;
  coreFormat: number;
  pyodideVersion: string;
  pythonVersion: string;
  wheel: ReadyInfo["wheel"];
  timings: { pyodideMs: number; wheelMs: number; importMs: number };
}

// Two helpers that hand a Game's header and its last applied inputs to JavaScript as canonical JSON.
// A PyProxy conversion would turn Python's None into undefined and drop the key.
const HELPERS = `
from lantern_core import canon

def header_json(game):
    return canon.dumps_str(game.header())

def last_inputs_json(game):
    return canon.dumps_str(game.last_inputs)

def preset_json(name, seed=None, variant=None):
    from lantern_core import api
    return canon.dumps_str(api.preset(name, seed=seed, variant=variant))
`;

/** What the adapter uses of a PyProxy of a Game. */
interface PyProxyLike {
  step: { (inputsJson: string): unknown; destroy(): void };
  hash: { (): unknown; destroy(): void };
  scene_json: { (): unknown; destroy(): void };
  ending_json: { (): unknown; destroy(): void };
  preview_json: { (actionJson: string): unknown; destroy(): void };
  snapshot_json: { (): unknown; destroy(): void };
  tick: unknown;
  destroy(): void;
}

interface Manifest {
  wheel: string;
  sha256: string;
  bytes: number;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  // crypto.subtle exists in secure contexts only. A page served from plain http on a LAN address
  // has none, and then the manifest check is skipped.
  if (typeof crypto === "undefined" || crypto.subtle === undefined) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Starts Pyodide from the self-hosted runtime files, unpacks the core wheel into site-packages and
 * imports lantern_core.api. Nothing is fetched from outside the page's own origin.
 */
export async function bootCore(options: BootOptions): Promise<BootedCore> {
  const { pyodideBase, coreBase, onStage, log } = options;
  const t0 = performance.now();

  const loader = (await import(/* @vite-ignore */ new URL("pyodide.mjs", pyodideBase).href)) as {
    loadPyodide: (config: Record<string, unknown>) => Promise<PyodideInterface>;
  };
  const pyodide = await loader.loadPyodide({
    indexURL: pyodideBase,
    stdout: (line: string) => log("info", `[py] ${redact(line)}`),
    stderr: (line: string) => log("warn", `[py] ${redact(line)}`),
  });
  const t1 = performance.now();
  onStage("pyodide", t1 - t0);

  const manifestResponse = await fetch(new URL("manifest.json", coreBase), { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error(`core manifest: HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as Manifest;
  const wheelUrl = new URL(manifest.wheel, coreBase);
  wheelUrl.search = `v=${manifest.sha256.slice(0, 12)}`;
  const wheelResponse = await fetch(wheelUrl);
  if (!wheelResponse.ok) throw new Error(`core wheel: HTTP ${wheelResponse.status}`);
  const wheelBytes = await wheelResponse.arrayBuffer();
  const actual = await sha256Hex(wheelBytes);
  if (actual !== null && actual !== manifest.sha256) {
    throw new Error("the core wheel does not match its manifest");
  }
  const sitePackages = pyodide.runPython("import site\nsite.getsitepackages()[0]") as string;
  pyodide.unpackArchive(wheelBytes, "wheel", { extractDir: sitePackages });
  const t2 = performance.now();
  onStage("wheel", t2 - t1);

  pyodide.runPython("import importlib\nimportlib.invalidate_caches()");
  const api = pyodide.pyimport("lantern_core.api");
  const GameClass = api.Game;
  const coreFormat = api.FORMAT as number;
  const coreVersion = pyodide.runPython(
    "import lantern_core\ngetattr(lantern_core, '__version__', 'unknown')",
  ) as string;
  const pythonVersion = pyodide.runPython("import sys\nsys.version.split()[0]") as string;
  const t3 = performance.now();
  onStage("core", t3 - t2);

  const helpers = pyodide.globals.get("dict")();
  pyodide.runPython(HELPERS, { globals: helpers });
  const headerJson = helpers.get("header_json");
  const lastInputsJson = helpers.get("last_inputs_json");
  const presetJson = helpers.get("preset_json");

  const wrap = (game: PyProxyLike): GameLike => {
    const step = game.step;
    const hash = game.hash;
    const scene = game.scene_json;
    const ending = game.ending_json;
    const preview = game.preview_json;
    const snapshot = game.snapshot_json;
    return {
      step: (inputsJson: string) => step(inputsJson) as string,
      hash: () => hash() as string,
      sceneJson: () => scene() as string,
      endingJson: () => ending() as string,
      previewJson: (actionJson: string) => preview(actionJson) as string,
      snapshotJson: () => snapshot() as string,
      get tick() {
        return game.tick as number;
      },
      headerJson: () => headerJson(game) as string,
      lastInputsJson: () => lastInputsJson(game) as string,
      destroy() {
        step.destroy();
        hash.destroy();
        scene.destroy();
        ending.destroy();
        preview.destroy();
        snapshot.destroy();
        game.destroy();
      },
    };
  };

  const newGame = (spec: GameSpec): GameLike => {
    let game: PyProxyLike;
    if (spec.config === null) {
      game = GameClass(spec.seed, spec.scenario);
    } else {
      const config = pyodide.toPy(spec.config);
      try {
        game = GameClass(spec.seed, spec.scenario, config);
      } finally {
        config.destroy();
      }
    }
    return wrap(game);
  };

  const restoreGame = (snapshotJson: string): GameLike => wrap(GameClass.from_snapshot_json(snapshotJson));

  // A named game of the core: its config has texts as well as numbers, so it travels as JSON. A seed and a story that are not asked
  // for go over as `undefined`, which Pyodide hands to Python as None and the core reads as the game's own (`null` would arrive as
  // `jsnull`, which is no None).
  const preset = (name: string, options?: PresetOptions): PresetGame =>
    JSON.parse(presetJson(name, options?.seed, options?.variant) as string) as PresetGame;

  return {
    newGame,
    restoreGame,
    preset,
    coreVersion,
    coreFormat,
    pyodideVersion: pyodide.version,
    pythonVersion,
    wheel: { name: manifest.wheel, bytes: manifest.bytes, sha256: manifest.sha256 },
    timings: { pyodideMs: t1 - t0, wheelMs: t2 - t1, importMs: t3 - t2 },
  };
}
