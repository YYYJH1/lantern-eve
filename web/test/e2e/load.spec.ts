import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { contentSecurityPolicy } from "../../src/csp.ts";
import { DIST_E2E, expect, OUT_DIR, test } from "../support/fixtures.ts";
import { startStaticServer } from "../support/static-server.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(2)} MB`;

function group(file: string): "runtime" | "core" | "app" {
  if (file.startsWith("/pyodide/")) return "runtime";
  if (file.startsWith("/core/")) return "core";
  return "app";
}

test("loads Pyodide and the core from the page's own origin, and reports what that costs", async ({ lantern, servers }, testInfo) => {
  const from = servers.app.requests.length;
  const started = Date.now();
  await lantern.page.goto(`${servers.app.origin}/?pace=1&seed=1`);
  await lantern.waitReady();
  const wallMs = Date.now() - started;
  const snap = await lantern.snapshot();
  const ready = snap.ready;
  expect(ready).not.toBeNull();
  if (ready === null) return;

  // What was downloaded, as the static server counted it: every response body, uncompressed.
  const served = servers.app.requests.slice(from).filter((r) => r.status === 200);
  const bytes = { app: 0, runtime: 0, core: 0 };
  for (const r of served) bytes[group(r.path)] += r.bytes;
  const total = bytes.app + bytes.runtime + bytes.core;

  // What the same files would cost over a compressing host, computed from the files themselves.
  const files = [...new Set(served.map((r) => r.path))].filter((p) => p !== "/" && !p.endsWith(".html"));
  let gzip = 0;
  let brotli = 0;
  for (const file of files) {
    const data = readFileSync(path.join(DIST_E2E, file));
    gzip += zlib.gzipSync(data, { level: 9 }).length;
    brotli += zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
  }

  const report = {
    versions: { pyodide: ready.pyodideVersion, python: ready.pythonVersion, core: ready.coreVersion, wheel: ready.wheel.name },
    loadMs: {
      gotoToReady: wallMs,
      pageClockToReady: Math.round(snap.readyAfterMs ?? -1),
      workerTotal: Math.round(ready.timings.totalMs),
      pyodideRuntime: Math.round(ready.timings.pyodideMs),
      wheel: Math.round(ready.timings.wheelMs),
      coreImportAndFirstGame: Math.round(ready.timings.coreMs),
    },
    bytesServed: { total, ...bytes, wheel: ready.wheel.bytes, requests: served.length },
    bytesComputed: { gzip9: gzip, brotli9: brotli },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "load-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("load-report", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(
    [
      `load (cold, loopback): ${wallMs} ms from goto to ready`,
      `  worker: runtime ${report.loadMs.pyodideRuntime} ms, wheel ${report.loadMs.wheel} ms, core ${report.loadMs.coreImportAndFirstGame} ms, total ${report.loadMs.workerTotal} ms`,
      `  served: ${mb(total)} in ${served.length} responses (app ${mb(bytes.app)}, Pyodide runtime ${mb(bytes.runtime)}, core wheel ${mb(bytes.core)})`,
      `  computed from the same files: gzip -9 ${mb(gzip)}, brotli q9 ${mb(brotli)}`,
    ].join("\n"),
  );

  expect(ready.pyodideVersion).toBe("314.0.7");
  expect(ready.pythonVersion).toMatch(/^3\.14\./);
  expect(ready.coreFormat).toBe(1);
  expect(ready.wheel.bytes).toBeGreaterThan(1000);
  expect(wallMs).toBeLessThan(30_000);
  expect(snap.error).toBeNull();

  // Nothing came from outside: every request, the worker's included, went to the page's origin.
  expect(lantern.network.length).toBeGreaterThan(10);
  expect(lantern.network.filter((n) => n.origin !== servers.app.origin)).toEqual([]);
  // The runtime and the wheel are the self-hosted copies.
  const urls = lantern.network.map((n) => new URL(n.url).pathname);
  expect(urls).toEqual(expect.arrayContaining(["/pyodide/pyodide.mjs", "/pyodide/pyodide.asm.wasm", "/pyodide/python_stdlib.zip", "/core/manifest.json", `/core/${ready.wheel.name}`]));
  // No script or stylesheet in the page points elsewhere.
  const external = await lantern.page.evaluate(() => {
    const origin = location.origin;
    return Array.from(document.querySelectorAll("script[src], link[href], img[src], iframe[src]"))
      .map((el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href)
      .filter((url) => url !== "" && !url.startsWith(origin));
  });
  expect(external).toEqual([]);
});

test("the page and the worker run under the policy", async ({ lantern, servers }) => {
  const documentResponse = lantern.page.waitForResponse((r) => new URL(r.url()).pathname === "/");
  const workerResponse = lantern.page.waitForResponse((r) => /\/assets\/host\.worker-[^/]+\.js$/.test(new URL(r.url()).pathname));
  await lantern.open("pace=1");

  const production = contentSecurityPolicy();
  expect((await documentResponse).headers()["content-security-policy"]).toBe(servers.app.csp);
  expect((await workerResponse).headers()["content-security-policy"]).toBe(servers.app.csp);
  expect(production).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(production).toMatch(/connect-src 'self' https:\/\/dashscope\.aliyuncs\.com https:\/\/api\.deepseek\.com http:\/\/localhost:11434(;|$)/);
  expect(production).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);

  // The built page also carries the production policy in a <meta> tag, for hosts that send no headers.
  const meta = await lantern.page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"));
  expect(meta).toBe(production);

  // Pyodide, the map and the client all started without a violation.
  expect((await lantern.snapshot()).cspViolations).toEqual([]);
  expect(await lantern.page.evaluate(() => window.__lantern.view.ready)).toBe(true);

  // The worker is bound by it: no eval, no new Function, no connection to an origin that is not listed.
  const probe = await lantern.e2e<Record<string, unknown>>("csp-probe", { fetchUrl: "http://127.0.0.1:1/probe" });
  expect(probe).toMatchObject({ evalBlocked: true, functionBlocked: true, fetchBlocked: true });
  await expect.poll(async () => (await lantern.snapshot()).cspViolations.map((v) => v.directive)).toContain("connect-src");
  const violations = (await lantern.snapshot()).cspViolations;
  expect(violations.some((v) => v.blocked.includes("127.0.0.1:1"))).toBe(true);
  expect(violations.some((v) => v.directive.startsWith("script-src"))).toBe(true);
});

test("runs from a sub-path, as on a project page, with every file requested under it", async ({ page }) => {
  // The build uses relative URLs, so the same files work at /lantern-eve/ as at the root.
  const root = path.join(OUT_DIR, "subpath");
  mkdirSync(root, { recursive: true });
  const link = path.join(root, "lantern-eve");
  if (!existsSync(link)) symlinkSync(DIST_E2E, link, "dir");
  const server = await startStaticServer({ root, extraConnect: [] });
  try {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.goto(`${server.origin}/lantern-eve/?pace=10&seed=2`);
    await page.waitForFunction(() => window.__lantern?.client.state.simTick >= 20, undefined, { timeout: 60_000 });
    expect(await page.evaluate(() => window.__lantern.client.state.phase)).toBe("ready");
    expect(requested.length).toBeGreaterThan(10);
    expect(requested.filter((p) => !p.startsWith("/lantern-eve/"))).toEqual([]);
    expect(server.requests.filter((r) => r.status !== 200)).toEqual([]);
  } finally {
    await server.close();
  }
});
