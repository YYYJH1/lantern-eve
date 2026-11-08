// Runs a replay file through the browser host's own replay checker, with the core in Pyodide.
//
//   node --experimental-transform-types --no-warnings browser_checker.mjs REPLAY.json
//
// The checker is web/src/shared/replay.ts (validateReplay, runReplay), the code the browser uses
// to load a save. The Game it drives is lantern_core under Pyodide 314 (Python 3.14), written
// into Pyodide's file system from core/ and wrapped the way web/src/worker/pyodide-game.ts wraps
// it. The report is one line of JSON on stdout. The exit status is 0 when every hash matched.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PYODIDE_DIR = join(ROOT, "tests", "cross_host", "node_modules", "pyodide");
const { loadPyodide, version } = await import(pathToFileURL(join(PYODIDE_DIR, "pyodide.mjs")).href);
const { runReplay, validateReplay, ReplayError } = await import(
  pathToFileURL(join(ROOT, "web", "src", "shared", "replay.ts")).href
);

function* pythonFiles(base, dir = base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__pycache__") yield* pythonFiles(base, path);
    } else if (entry.name.endsWith(".py")) {
      yield [relative(base, path), path];
    }
  }
}

const file = process.argv[2];
if (file === undefined) throw new Error("usage: browser_checker.mjs REPLAY.json");

// The index is named because Node, with TypeScript transformed on the fly, maps stack traces through
// source maps, and Pyodide finds its own directory by reading a stack trace.
const py = await loadPyodide({ indexURL: PYODIDE_DIR });
const core = join(ROOT, "core", "lantern_core");
for (const [rel, path] of pythonFiles(core)) {
  const target = `/work/lantern_core/${rel}`;
  py.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
  py.FS.writeFile(target, readFileSync(path));
}
py.runPython('import sys\nsys.path.insert(0, "/work")');
const api = py.pyimport("lantern_core.api");
const helpers = py.globals.get("dict")();
py.runPython(
  "from lantern_core import canon\n" +
    "def header_json(game):\n    return canon.dumps_str(game.header())\n" +
    "def last_inputs_json(game):\n    return canon.dumps_str(game.last_inputs)\n",
  { globals: helpers },
);
const headerJson = helpers.get("header_json");
const lastInputsJson = helpers.get("last_inputs_json");

const newGame = (spec) => {
  let game;
  if (spec.config === null) {
    game = api.Game(spec.seed, spec.scenario);
  } else {
    const config = py.toPy(spec.config);
    try {
      game = api.Game(spec.seed, spec.scenario, config);
    } finally {
      config.destroy();
    }
  }
  const step = game.step;
  const hash = game.hash;
  return {
    step: (json) => step(json),
    hash: () => hash(),
    get tick() {
      return game.tick;
    },
    headerJson: () => headerJson(game),
    lastInputsJson: () => lastInputsJson(game),
    destroy() {
      step.destroy();
      hash.destroy();
      game.destroy();
    },
  };
};

let report;
try {
  const replay = validateReplay(JSON.parse(readFileSync(file, "utf8")));
  const result = await runReplay(newGame, replay);
  report = {
    ok: true,
    nextTick: result.nextTick,
    hash: result.hash,
    finalHash: replay.final.hash,
    hashesChecked: result.hashesChecked,
    hashesRecorded: replay.hashes.length,
    records: replay.records.length,
    host: replay.host,
  };
} catch (err) {
  report = {
    ok: false,
    code: err instanceof ReplayError ? err.code : "error",
    message: String(err && err.message ? err.message : err),
  };
}
report.python = py.runPython("import sys\nsys.version.split()[0]");
report.pyodide = version;
process.stdout.write(JSON.stringify(report) + "\n");
process.exit(report.ok ? 0 : 1);
