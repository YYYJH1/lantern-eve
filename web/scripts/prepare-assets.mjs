#!/usr/bin/env node
// Prepares what the page loads at run time but does not bundle, and the licence texts of what it carries:
//   public/pyodide/       the Pyodide runtime, copied from node_modules/pyodide
//   public/core/          the lantern-core wheel, built with uv, plus a manifest naming it
//   public/licenses/npm/  the licence text of every package the page is built from, copied from node_modules
//                         (the texts of Pyodide and Python sit in public/licenses/ in git, and the fonts carry theirs)
// Usage: node scripts/prepare-assets.mjs [pyodide|wheel|licenses]   (no argument does all three)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = resolve(webDir, "..", "core");
const pyodideSrc = join(webDir, "node_modules", "pyodide");
const pyodideOut = join(webDir, "public", "pyodide");
const coreOut = join(webDir, "public", "core");
const licensesOut = join(webDir, "public", "licenses", "npm");

// What loadPyodide() fetches from its indexURL. Source maps, console.html and the CommonJS
// loader stay out of the build.
const PYODIDE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function preparePyodide() {
  if (!existsSync(join(pyodideSrc, "pyodide.mjs"))) {
    throw new Error("node_modules/pyodide is missing, run `npm ci` first");
  }
  mkdirSync(pyodideOut, { recursive: true });
  for (const name of PYODIDE_FILES) {
    const from = join(pyodideSrc, name);
    const to = join(pyodideOut, name);
    if (existsSync(to) && statSync(to).size === statSync(from).size && sha256(to) === sha256(from)) {
      continue;
    }
    copyFileSync(from, to);
  }
  const version = JSON.parse(readFileSync(join(pyodideSrc, "package.json"), "utf8")).version;
  writeFileSync(join(pyodideOut, "VERSION"), `${version}\n`);
  console.log(`pyodide ${version}: ${PYODIDE_FILES.length} files in public/pyodide`);
}

function prepareWheel() {
  mkdirSync(coreOut, { recursive: true });
  for (const name of readdirSync(coreOut)) {
    if (name.endsWith(".whl") || name === "manifest.json") rmSync(join(coreOut, name));
  }
  const result = spawnSync("uv", ["build", "--wheel", coreDir, "--out-dir", coreOut], {
    stdio: "inherit",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("uv is needed to build the core wheel and was not found on PATH (https://docs.astral.sh/uv/)");
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`uv build failed with status ${result.status}`);
  const wheels = readdirSync(coreOut).filter((name) => name.endsWith(".whl"));
  if (wheels.length !== 1) throw new Error(`expected one wheel in public/core, found ${wheels.length}`);
  const wheel = wheels[0];
  const file = join(coreOut, wheel);
  const manifest = { wheel, sha256: sha256(file), bytes: statSync(file).size };
  writeFileSync(join(coreOut, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`core wheel: ${wheel} (${manifest.bytes} bytes)`);
}

// The standard MIT text without its copyright line, for a package that declares MIT and ships no licence file.
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const LICENCE_FILE = /^(licen[cs]e|copying|unlicen[cs]e)(\.[a-z]+)?$/i;

/** Where the package's source lives, as a web address: its package.json names it as a URL or as `user/repository`. */
function sourceUrl(meta) {
  const named = typeof meta.repository === "string" ? meta.repository : (meta.repository?.url ?? meta.homepage ?? "");
  const url = named.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
}

/** The name of a licence file in public/licenses/npm: version 2.9.6 of `@pixi/colord` is `@pixi__colord@2.9.6.txt`. */
const licenceName = (meta) => `${meta.name.replaceAll("/", "__")}@${meta.version}.txt`;

/**
 * Writes the licence text of every package the page is built from into public/licenses/npm, so that the built site
 * carries the notices its components ask for. The packages are the ones package-lock.json lists as dependencies and
 * not as development tools: the page's own two (pixi.js and preact) and what they need, whether the bundle ends up
 * holding all of it or not. A package without a licence file gets a notice made from its package.json when it
 * declares MIT, and stops the build otherwise, so that no component goes into the site without its text.
 */
function prepareLicenses() {
  const lock = JSON.parse(readFileSync(join(webDir, "package-lock.json"), "utf8"));
  const wanted = Object.entries(lock.packages)
    .filter(([path, info]) => path.startsWith("node_modules/") && !info.dev && !info.optional)
    .map(([path]) => path.slice("node_modules/".length))
    .sort();
  if (wanted.length === 0) throw new Error("package-lock.json lists no dependency of the page");
  mkdirSync(licensesOut, { recursive: true });
  for (const name of readdirSync(licensesOut)) {
    if (name.endsWith(".txt")) rmSync(join(licensesOut, name));
  }
  const index = [];
  for (const pkg of wanted) {
    const dir = join(webDir, "node_modules", pkg);
    if (!existsSync(join(dir, "package.json"))) throw new Error(`node_modules/${pkg} is missing, run \`npm ci\` first`);
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const header = `${meta.name} ${meta.version}\nLicense: ${meta.license}\nSource: ${sourceUrl(meta)}\n\n`;
    const found = readdirSync(dir).filter((name) => LICENCE_FILE.test(name)).sort();
    let body;
    if (found.length > 0) {
      body = readFileSync(join(dir, found[0]), "utf8");
    } else if (meta.license === "MIT") {
      const author = (typeof meta.author === "string" ? meta.author : (meta.author?.name ?? "")).replace(/\s*[<(].*$/, "");
      if (author === "") throw new Error(`node_modules/${pkg} declares MIT, ships no licence file and names no author`);
      body = `The package ships no licence file. Its package.json declares the MIT licence and names ${author} as the author.\n\nCopyright (c) ${author}\n\n${MIT_TEXT}`;
    } else {
      throw new Error(`node_modules/${pkg} ships no licence file and declares ${meta.license}: add its text to public/licenses`);
    }
    writeFileSync(join(licensesOut, licenceName(meta)), header + body);
    index.push(`${meta.name}\t${meta.version}\t${meta.license}\t${licenceName(meta)}`);
  }
  writeFileSync(join(licensesOut, "index.txt"), `package\tversion\tlicense\tfile\n${index.join("\n")}\n`);
  console.log(`licenses: ${wanted.length} packages in public/licenses/npm`);
}

const which = process.argv[2];
if (which === undefined || which === "pyodide") preparePyodide();
if (which === undefined || which === "wheel") prepareWheel();
if (which === undefined || which === "licenses") prepareLicenses();
if (which !== undefined && which !== "pyodide" && which !== "wheel" && which !== "licenses") {
  console.error(`unknown target ${which}`);
  process.exit(2);
}
