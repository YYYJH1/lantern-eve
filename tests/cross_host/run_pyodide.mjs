// Runs the lantern_core driver under Pyodide in Node and prints one line of JSON.
//
//   node run_pyodide.mjs --mode hashes|bench --ticks 2000 --seed 2026 --host-seed 7 \
//        [--driver m0_driver] \
//        (--src <dir holding lantern_core/> | --wheel <lantern_core wheel>) \
//        --file <module.py> [--file <module.py> ...]
//
// The --driver module (m0_driver by default) must offer run(seed, ticks, host_seed) and
// bench(seed, ticks, host_seed). The --file modules (the driver and whatever it imports, such as
// the mock host) are written next to each other into Pyodide's in-memory file system. The core comes either as source files or as the wheel that
// `uv build --wheel core` produces, which is how the browser loads it.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadPyodide, version } from "pyodide";

function parse(argv) {
  const opts = { files: [], mode: "hashes", ticks: 2000, seed: 2026, hostSeed: 7, driver: "m0_driver" };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--mode") opts.mode = value;
    else if (flag === "--ticks") opts.ticks = Number(value);
    else if (flag === "--seed") opts.seed = Number(value);
    else if (flag === "--host-seed") opts.hostSeed = Number(value);
    else if (flag === "--driver") opts.driver = value;
    else if (flag === "--src") opts.src = value;
    else if (flag === "--wheel") opts.wheel = value;
    else if (flag === "--file") opts.files.push(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!opts.src === !opts.wheel) throw new Error("give exactly one of --src and --wheel");
  return opts;
}

function* pythonFiles(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__pycache__") yield* pythonFiles(root, path);
    } else if (entry.name.endsWith(".py")) {
      yield [relative(root, path), path];
    }
  }
}

function writeFile(py, target, source) {
  const directory = target.slice(0, target.lastIndexOf("/"));
  py.FS.mkdirTree(directory);
  py.FS.writeFile(target, readFileSync(source));
}

const opts = parse(process.argv.slice(2));
const py = await loadPyodide();
py.FS.mkdirTree("/work");
if (opts.src) {
  // Only the lantern_core package itself, so that the tests/ and web/ trees stay out of it.
  for (const [rel, path] of pythonFiles(join(opts.src, "lantern_core"), join(opts.src, "lantern_core"))) {
    writeFile(py, `/work/lantern_core/${rel}`, path);
  }
} else {
  // Pyodide rejects a Node Buffer, so hand it a plain Uint8Array.
  await py.unpackArchive(new Uint8Array(readFileSync(opts.wheel)), "wheel");
}
for (const file of opts.files) writeFile(py, `/work/${basename(file)}`, file);
py.runPython('import sys\nsys.path.insert(0, "/work")');

const args = `${opts.seed}, ${opts.ticks}, ${opts.hostSeed}`;
let result;
if (opts.mode === "hashes") {
  result = JSON.parse(py.runPython(`import json, ${opts.driver} as driver\njson.dumps(driver.run(${args}))`));
} else if (opts.mode === "bench") {
  py.runPython(`import ${opts.driver} as driver\ndriver.bench(${opts.seed}, 300, ${opts.hostSeed})`); // warm-up
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(JSON.parse(py.runPython(`import json, ${opts.driver} as driver\njson.dumps(driver.bench(${args}))`)));
  }
  result = { runs };
} else {
  throw new Error(`unknown mode ${opts.mode}`);
}
result.python = py.runPython("import sys\nsys.version");
result.pyodide = version;
result.node = process.version;
process.stdout.write(JSON.stringify(result) + "\n");
