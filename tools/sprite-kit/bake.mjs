#!/usr/bin/env node
// Sprite kit of Lantern Eve: bakes the characters, places and props in headless Chromium with our own WebGL2 SDF ray marcher.
//
//   node bake.mjs [--jobs 4] [--only char.li_da,place.bridge] [--scales 1,2] [--px 56] [--out out] [--kmax N]
//   (--kmax N bakes only frames 0..N-1 of every animation: a quick look while designing a figure, never for out/)
//
// Needs the Playwright of the game (resolved from ../web, ../../web or KIT_PLAYWRIGHT_FROM, else the path below) and a
// Chromium of it (PLAYWRIGHT_BROWSERS_PATH). Software WebGL (SwiftShader) is enough; a GPU only makes it faster.
// Output, in out/: atlas-1x*.webp, atlas-2x*.webp (lossless), manifest.json, contact-sheet.png, walk4.gif.
// The bake is deterministic: the same sources give byte-identical files. Timings go to bake-report.json, not to out/.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i+1] !== undefined ? argv[i+1] : dflt; };
const JOBS = Math.max(1, +opt('jobs', 4));
const ONLY = opt('only', '').split(',').filter(Boolean);
const SCALES = opt('scales', '1,2').split(',').map(Number);
const PX = +opt('px', 56);
const KMAX = +opt('kmax', 1e9);
const OUT = path.resolve(here, opt('out', 'out'));

// ---- Playwright of the game
const candidates = [process.env.KIT_PLAYWRIGHT_FROM, path.join(here, '..', 'web'), path.join(here, '..', '..', 'web')].filter(Boolean);
let chromium = null;
for (const c of candidates) { try { chromium = createRequire(import.meta.url)(createRequire(import.meta.url).resolve('playwright', { paths: [c] })).chromium; break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found; set KIT_PLAYWRIGHT_FROM to the web/ folder of the game'); process.exit(1); }
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'];

// ---- the page: shaders as strings, then the scripts in order
const rd = f => fs.readFileSync(path.join(here, 'src', f), 'utf8');
function buildHtml(){
  const glsl = {}; for (const n of ['common','figures','places','town','trees','objects','dispatch','march','post']) glsl[n] = rd(`shaders/${n}.glsl`);
  const scripts = ['config','engine','gif','catalog','glyphs','places','bake','compose'].map(n => rd(`page/${n}.js`)).join('\n');
  return `<!doctype html><meta charset="utf-8"><body><script>window.__KIT_OPTS=${JSON.stringify({ pxPerUnit: PX })};\nconst GLSL=${JSON.stringify(glsl)};\n${scripts}\n</script></body>`;
}
const HTML = buildHtml();
const t00 = Date.now();
const log = (...a) => console.log(`[${((Date.now()-t00)/1000).toFixed(0).padStart(4)} s]`, ...a);

async function openPage(browser){
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { const t = m.text(); if (/error|ERROR/.test(t) && !/GPU stall/.test(t)) console.error('[page]', t.slice(0, 600)); });
  await page.setContent(HTML);
  return page;
}

const browsers = [];
const report = { startedAt: new Date().toISOString(), jobs: JOBS, px: PX, scales: SCALES, frames: 0, bakeMsBySprite: {}, phases: {} };
try {
  for (let i=0;i<JOBS;i++) browsers.push(await chromium.launch({ headless: true, args: ARGS }));
  const pages = [];
  for (const b of browsers) pages.push(await openPage(b));
  // ---- plan: every frame of every sprite, heaviest first, dealt to the least loaded worker (deterministic)
  const all = await pages[0].evaluate(() => window.__allJobs().map(j => ({ key: j.key, sprite: j.sprite, k: j.k, cost: j.win.W*j.win.H*(j.ss1 || 4)**2 })));
  const sel = all.filter(j => (!ONLY.length || ONLY.some(o => j.sprite === o || j.sprite.startsWith(o))) && j.k < KMAX);
  const order = sel.map((j, i) => ({ ...j, i })).sort((a, b) => b.cost - a.cost || a.i - b.i);
  const load = new Array(JOBS).fill(0), lists = Array.from({ length: JOBS }, () => []);
  for (const j of order) { let w = 0; for (let k=1;k<JOBS;k++) if (load[k] < load[w]) w = k; lists[w].push(j.key); load[w] += j.cost; }
  log(`${sel.length} frames, ${SCALES.join('x and ')}x, ${JOBS} workers`);
  // ---- bake
  const tBake = Date.now(), results = [];
  let done = 0;
  await Promise.all(pages.map(async (page, w) => {
    const keys = lists[w];
    for (let i=0;i<keys.length;i+=4) {
      const part = await page.evaluate(([ks, sc]) => window.__bakeBatch(ks, sc), [keys.slice(i, i+4), SCALES]);
      for (const r of part) { results.push(r); (report.bakeMsBySprite[r.key.split('|')[0]] ||= { 1: 0, 2: 0 })[r.scale] += r.ms; }
      done += Math.min(4, keys.length - i); if (done % 40 < 4 || done === sel.length) log(`baked ${done}/${sel.length}`);
    }
  }));
  report.phases.bakeSeconds = (Date.now() - tBake) / 1000; report.frames = sel.length;
  results.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.scale - b.scale);     // the order the workers finished in must not matter
  // ---- compose in a fresh page
  const tComp = Date.now(); log('composing…');
  const composed = await pages[0].evaluate(r => window.__compose(r), results);
  report.phases.composeSeconds = (Date.now() - tComp) / 1000;
  // ---- write
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^(atlas-|manifest|contact-sheet|walk4)/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const stripIcc = (buf) => {                                   // drop the sRGB ICC chunk Chromium adds, so every loader shows the same colours
    let p = 12; const chunks = [];
    while (p + 8 <= buf.length) { const id = buf.toString('latin1', p, p+4), len = buf.readUInt32LE(p+4); chunks.push([id, buf.subarray(p+8, p+8+len)]); p += 8 + len + (len & 1); }
    const body = [];
    for (const [id, data] of chunks) {
      if (id === 'ICCP') continue;
      const d = Buffer.from(data); if (id === 'VP8X') d[0] &= ~0x20;
      const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(d.length, 4); body.push(h, d); if (d.length & 1) body.push(Buffer.alloc(1));
    }
    const payload = Buffer.concat(body); const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + payload.length, 4); head.write('WEBP', 8, 'latin1');
    return Buffer.concat([head, payload]);
  };
  const atlasInfo = {};
  for (const S of SCALES) {
    atlasInfo[S] = composed.atlases[S].pages.map((pg, i, arr) => {
      const name = `atlas-${S}x${arr.length > 1 ? '-' + (i+1) : ''}.webp`;
      const buf = stripIcc(Buffer.from(pg.webp, 'base64')); fs.writeFileSync(path.join(OUT, name), buf);
      return { file: name, w: pg.w, h: pg.h, bytes: buf.length };
    });
  }
  fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), Buffer.from(composed.sheet, 'base64'));
  if (composed.gif) fs.writeFileSync(path.join(OUT, 'walk4.gif'), Buffer.from(composed.gif, 'base64'));
  const meta = await pages[0].evaluate(() => window.__meta());
  const manifest = buildManifest(composed, atlasInfo, meta);
  let mtxt = JSON.stringify(manifest, null, 1) + '\n';
  for (let pass = 0; pass < 3; pass++) {            // the download total includes the manifest, whose size includes the total: iterate until it settles
    manifest.sizes.manifestBytes = Buffer.byteLength(mtxt);
    for (const S of SCALES) manifest.sizes.downloadBytes[S] = manifest.sizes.atlasBytes[S] + manifest.sizes.manifestBytes;
    mtxt = JSON.stringify(manifest, null, 1) + '\n';
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), mtxt);
  // ---- report
  report.phases.totalSeconds = (Date.now() - t00) / 1000;
  report.sizes = manifest.sizes;
  fs.writeFileSync(path.join(here, 'bake-report.json'), JSON.stringify(report, null, 1) + '\n');
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 12);
  log('done:', fs.readdirSync(OUT).sort().map(f => `${f} ${(fs.statSync(path.join(OUT, f)).size/1024).toFixed(0)}KB #${sha(f)}`).join('  '));
  log('sizes', JSON.stringify(manifest.sizes));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}

// ---------------------------------------------------------------- manifest
function buildManifest(composed, atlasInfo, meta){
  const frameId = {};     // key -> {scale -> [page,x,y]}
  for (const S of SCALES) for (const p of composed.atlases[S].placed) (frameId[p.key] ||= {})[S] = [p.page, p.x, p.y];
  const sprites = {};
  for (const sp of composed.sprites) {
    const m = meta[sp.id] || {};
    const frames = {}; for (const S of SCALES) frames[S] = [];
    const idx = new Map();
    sp.keys.forEach((key, i) => { idx.set(key, i); for (const S of SCALES) frames[S].push(frameId[key][S]); });
    const entry = { kind: m.kind, name: m.name, frame: { w: sp.w, h: sp.h }, anchor: { x: sp.ax, y: sp.ay } };
    if (m.footprint) entry.footprint = m.footprint;
    if (sp.spots) entry.spots = sp.spots;
    entry.frames = frames;
    if (m.anims) {
      entry.anims = {};
      for (const [anim, P] of Object.entries(m.anims)) {
        const dirs = {};
        for (const dir of m.dirs) dirs[dir] = Array.from({ length: P.frames }, (_, k) => idx.get(`${sp.id}|${anim}|${dir}|${k}`));
        entry.anims[anim] = { fps: P.fps, loop: true, frames: P.frames, ...(P.strideCyclePx ? { strideCyclePx: P.strideCyclePx, groundSpeedPxPerSec: P.groundSpeedPxPerSec } : {}), dirs };
      }
    }
    for (const k of Object.keys(m.extra || {})) entry[k] = m.extra[k];
    sprites[sp.id] = entry;
  }
  const totals = {}, files = {};
  for (const S of SCALES) { files[S] = atlasInfo[S].map(a => a.file); totals[S] = atlasInfo[S].reduce((n, a) => n + a.bytes, 0); }
  return {
    schema: 'lantern-eve/sprite-kit@1',
    camera: { lookDir: 'north', yawDeg: 0, pitchDeg: 52, keyLightCamera: [-0.36, 0.40, -0.84], note: 'one camera and one key light for every sprite; night is a 2D tint in the game' },
    units: { pxPerUnit1x: PX, cellPx: 32, cellUnits: 32 / PX, cellDepthPx1x: +(32 * Math.sin(52 * Math.PI / 180)).toFixed(2), heightPxPerUnit1x: +(PX * Math.cos(52 * Math.PI / 180)).toFixed(2), scaleFactors: SCALES,
      note: 'frame sizes, anchors and footprints are in 1x px; the 2x atlas holds the same frames at exactly twice the size. A grid cell is 32 px wide and cellDepthPx1x px tall on screen (ground depth is foreshortened by sin 52 deg); screen y = ground y * cellDepthPx1x / 32 - height * heightPxPerUnit1x' },
    atlases: Object.fromEntries(SCALES.map(S => [S, atlasInfo[S]])),
    sizes: { atlasBytes: totals, manifestBytes: 0, downloadBytes: Object.fromEntries(SCALES.map(S => [S, totals[S]])) },
    sprites,
  };
}
