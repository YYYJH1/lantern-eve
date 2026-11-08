#!/usr/bin/env node
// Compares two bakes sprite by sprite and frame by frame, every byte of the decoded pixels.
//
//   node compare.mjs <old dir> <new dir> [--partial]
//
// Each dir holds a manifest.json and the atlases it names (the web/public/sprites of the game, or the out/ of a bake).
// The sprites of the old manifest must be in the new one with the same frame size, anchor, manifest entry and pixels.
// A sprite that only the new manifest has is listed and is no error (a bake that adds a sprite). With --partial, sprites that
// the new manifest lacks are no error either (a bake with --only). Exit code 0: all compared sprites are identical.
//
// The atlases are decoded by Chromium (WebGL, no premultiplied alpha, no colour conversion), so the bytes compared are the ones the
// file holds, and nothing needs installing besides the Playwright of the game.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const partial = process.argv.includes('--partial');
if (args.length !== 2) { console.error('usage: node compare.mjs <old dir> <new dir> [--partial]'); process.exit(2); }
const [oldDir, newDir] = args.map(d => path.resolve(d));

const candidates = [process.env.KIT_PLAYWRIGHT_FROM, path.join(here, '..', 'web'), path.join(here, '..', '..', 'web')].filter(Boolean);
let chromium = null;
for (const c of candidates) { try { chromium = createRequire(import.meta.url)(createRequire(import.meta.url).resolve('playwright', { paths: [c] })).chromium; break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright not found; set KIT_PLAYWRIGHT_FROM to the web/ folder of the game'); process.exit(2); }

const load = dir => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const atlases = {};
  for (const [scale, pages] of Object.entries(manifest.atlases)) atlases[scale] = pages.map(p => ({ w: p.w, h: p.h, b64: fs.readFileSync(path.join(dir, p.file)).toString('base64') }));
  return { manifest, atlases };
};
const A = load(oldDir), B = load(newDir);

// Runs in the page: decodes every atlas page to RGBA bytes, then compares the rectangle of every frame.
const inPage = async ({ A, B, partial }) => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false });
  const decode = async (b64, w, h) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (bitmap.width !== w || bitmap.height !== h) throw new Error(`atlas page is ${bitmap.width}x${bitmap.height}, the manifest says ${w}x${h}`);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const out = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); bitmap.close();
    return out;
  };
  const pixels = async side => { const out = {}; for (const [s, pages] of Object.entries(side.atlases)) out[s] = await Promise.all(pages.map(p => decode(p.b64, p.w, p.h))); return out; };
  const pa = await pixels(A), pb = await pixels(B);
  const rect = (side, px, sprite, scale, k) => {
    const [page, x, y] = sprite.frames[scale][k], w = sprite.frame.w * +scale, h = sprite.frame.h * +scale, W = side.atlases[scale][page].w;
    const out = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r++) out.set(px[scale][page].subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
    return out;
  };
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  let identical = 0, frames = 0, missing = 0; const problems = [];
  for (const [id, old] of Object.entries(A.manifest.sprites)) {
    const now = B.manifest.sprites[id];
    if (!now) { missing++; if (!partial) problems.push(`${id}: missing in the new bake`); continue; }
    const { frames: f0, ...rest0 } = old, { frames: f1, ...rest1 } = now;
    if (JSON.stringify(rest0) !== JSON.stringify(rest1)) { problems.push(`${id}: the manifest entry differs (frame, anchor or another field)`); continue; }
    let ok = true;
    for (const scale of Object.keys(f0)) {
      if (!f1[scale] || f1[scale].length !== f0[scale].length) { problems.push(`${id}: the number of frames at ${scale}x differs`); ok = false; break; }
      for (let k = 0; k < f0[scale].length && ok; k++) { frames++; if (!same(rect(A, pa, old, scale, k), rect(B, pb, now, scale, k))) { problems.push(`${id}: pixels differ at ${scale}x, frame ${k}`); ok = false; } }
      if (!ok) break;
    }
    if (ok) identical++;
  }
  const onlyNew = Object.keys(B.manifest.sprites).filter(id => !A.manifest.sprites[id]);
  return { identical, frames, missing, problems, onlyNew, total: Object.keys(A.manifest.sprites).length };
};

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.setContent('<!doctype html><body></body>');
  const r = await page.evaluate(inPage, { A, B, partial });
  console.log(`sprites of the old bake: ${r.total}; identical ${r.identical}; frames compared ${r.frames}; missing in the new bake ${r.missing}`);
  if (r.onlyNew.length) console.log(`only in the new bake: ${r.onlyNew.join(', ')}`);
  for (const p of r.problems) console.log(`  ${p}`);
  process.exitCode = r.problems.length ? 1 : 0;
} finally {
  await browser.close();
}
