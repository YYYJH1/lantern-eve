import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { contentSecurityPolicy, PROVIDER_ORIGINS } from "../../src/csp.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(WEB, "dist");
const DIST_E2E = path.join(WEB, "dist-e2e");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");
const text = (file: string): string => readFileSync(file, "utf8");
// The Pyodide runtime is a binary and a large bundle that talk about URLs on their own. What matters
// there is what the page requests, which the browser tests check. Here only our own files are read.
const ours = (dir: string): string[] =>
  files(dir).filter((f) => /\.(js|css|html)$/.test(f) && !f.includes(`${path.sep}pyodide${path.sep}`));

test.describe("the production build", () => {
  test.skip(!existsSync(path.join(DIST, "index.html")), "run `npm run build` first");

  test("has none of the test hooks, which exist only in the test build", () => {
    const markers = ["__lantern", "csp-probe", "log-probe", "request-via-core"];
    const production = ours(DIST).map(text).join("\n");
    for (const marker of markers) expect(production, marker).not.toContain(marker);
    // The page reads `?config=`, which sets the game's config (and so can switch on the test actions of the core), in the test build only.
    const readsConfig = /\.get\(["'`]config["'`]\)/;
    expect(production).not.toMatch(readsConfig);
    expect(production).not.toContain("dev_actions");
    // The same for `?map=off`, which leaves the map out of a page for the tests of the host.
    const readsMap = /\.get\(["'`]map["'`]\)/;
    expect(production).not.toMatch(readsMap);
    if (existsSync(path.join(DIST_E2E, "index.html"))) {
      const testBuild = ours(DIST_E2E).map(text).join("\n");
      for (const marker of markers) expect(testBuild, `${marker} in the test build`).toContain(marker);
      expect(testBuild).toMatch(readsConfig);
      expect(testBuild).toMatch(readsMap);
    }
  });

  test("holds no key and no inline script or style", () => {
    for (const file of ours(DIST)) {
      const body = text(file);
      expect(body.match(/\bsk-[A-Za-z0-9_-]{16,}/), file).toBeNull();
    }
    const html = text(path.join(DIST, "index.html"));
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  test("carries the policy in the page, with the three providers and nothing else outside the origin", () => {
    const html = text(path.join(DIST, "index.html"));
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    expect(meta?.replaceAll("&#39;", "'")).toBe(contentSecurityPolicy());
    expect(PROVIDER_ORIGINS).toEqual(["https://dashscope.aliyuncs.com", "https://api.deepseek.com", "http://localhost:11434"]);
    // The worker names the three provider URLs and no other host.
    const worker = ours(DIST).find((f) => /host\.worker-[^/]+\.js$/.test(f));
    expect(worker).toBeDefined();
    const hosts = new Set((text(worker ?? "").match(/https?:\/\/[A-Za-z0-9.:-]+/g) ?? []).map((u) => new URL(u).origin));
    expect([...hosts].sort()).toEqual([...PROVIDER_ORIGINS].sort());
  });

  test("ships the Pyodide runtime and the core wheel it was built with, byte for byte", () => {
    const runtime = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];
    for (const name of runtime) {
      const built = path.join(DIST, "pyodide", name);
      const source = path.join(WEB, "node_modules", "pyodide", name);
      expect(existsSync(built), name).toBe(true);
      expect(sha(built), name).toBe(sha(source));
    }
    expect(text(path.join(DIST, "pyodide", "VERSION")).trim()).toBe("314.0.7");
    const manifest = JSON.parse(text(path.join(DIST, "core", "manifest.json"))) as { wheel: string; sha256: string; bytes: number };
    const wheel = path.join(DIST, "core", manifest.wheel);
    expect(statSync(wheel).size).toBe(manifest.bytes);
    expect(sha(wheel)).toBe(manifest.sha256);
  });

  test("carries the licence texts of what it ships", () => {
    const lock = JSON.parse(text(path.join(WEB, "package-lock.json"))) as {
      packages: Record<string, { version: string; dev?: boolean; optional?: boolean }>;
    };
    const wanted = Object.entries(lock.packages).filter(([name, info]) => name.startsWith("node_modules/") && !info.dev && !info.optional);
    expect(wanted.length).toBeGreaterThanOrEqual(10);
    const index = text(path.join(DIST, "licenses", "npm", "index.txt")).split("\n").slice(1).filter((line) => line !== "");
    const listed = new Map(index.map((line) => line.split("\t")).map(([name, version, , file]) => [name, { version, file }]));
    for (const [key, info] of wanted) {
      const name = key.slice("node_modules/".length);
      expect(listed.get(name)?.version, name).toBe(info.version);
    }
    for (const [name, { file }] of listed) {
      expect(text(path.join(DIST, "licenses", "npm", file ?? "")).length, name).toBeGreaterThan(300);
    }
    const mit = text(path.join(DIST, "licenses", "npm", listed.get("preact")?.file ?? ""));
    expect(mit).toContain("Permission is hereby granted");
    expect(text(path.join(DIST, "licenses", "pyodide-MPL-2.0.txt"))).toContain("Mozilla Public License Version 2.0");
    expect(text(path.join(DIST, "licenses", "cpython-PSF.txt"))).toContain("PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2");
    expect(existsSync(path.join(DIST, "licenses", "README.txt"))).toBe(true);
    for (const font of ["lxgw-wenkai", "ma-shan-zheng"]) {
      expect(text(path.join(DIST, "fonts", font, "OFL.txt")), font).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  test("ships the icon of the page, named with an address that is relative to the page", () => {
    const html = text(path.join(DIST, "index.html"));
    const link = /<link rel="icon"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain('type="image/svg+xml"');
    // The site lives under a path of its own, so the address begins with no slash and names no host.
    expect(/href="([^"]+)"/.exec(link)?.[1]).toMatch(/^(\.\/)?favicon\.svg$/);
    expect(existsSync(path.join(DIST, "favicon.svg"))).toBe(true);
    expect(text(path.join(DIST, "favicon.svg"))).toBe(text(path.join(WEB, "public", "favicon.svg")));
  });

  test("pins its dependencies exactly", () => {
    const pkg = JSON.parse(text(path.join(WEB, "package.json"))) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(all).toMatchObject({ vite: "8.3.5", "pixi.js": "8.22.0", preact: "11.1.1", pyodide: "314.0.7" });
    expect(existsSync(path.join(WEB, "package-lock.json"))).toBe(true);
  });
});

test.describe("the icon of the page", () => {
  // The browser asks for the icon of a page that names none at the root of its host, which for a site under a path of its own is a file that is not there.
  test("is a file of plain shapes in the colours of the page, linked from the page with an address that is relative to it", () => {
    const html = text(path.join(WEB, "index.html"));
    const link = /<link rel="icon"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain('type="image/svg+xml"');
    expect(/href="([^"]+)"/.exec(link)?.[1]).toBe("favicon.svg");
    const svg = text(path.join(WEB, "public", "favicon.svg"));
    expect(svg).toMatch(/^<svg /);
    // Plain shapes: no script, no picture, no reference to anything outside the file.
    expect(svg.replace(/xmlns="[^"]+"/, "")).not.toMatch(/<script|<image|<use|href=|xlink:|https?:|url\(/);
    expect(svg).toMatch(/<(rect|ellipse|path)\b/);
    // The colours are the named ones of the page (tokens.css), and no other.
    const tokens = text(path.join(WEB, "src/page/style/tokens.css"));
    const named = new Set([...tokens.matchAll(/--[a-z]+:\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => (m[1] ?? "").toLowerCase()));
    const used = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
    expect(used.length).toBeGreaterThan(2);
    for (const colour of used) expect(named.has(colour), colour).toBe(true);
  });
});
