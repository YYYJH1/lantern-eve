'use strict';
// ---------------------------------------------------------------- baking one frame at one scale
let ENGINE = null;
const engine = () => ENGINE || (ENGINE = new Engine());
function kitConstsGLSL(){
  return `const float CU = ${KIT.CELLU.toFixed(6)};\nconst float WATER_Y = -0.40;\n` + placeConstsGLSL();
}
async function bakeFrame(job, scale){
  const eng = engine(), w = job.win, S = scale;
  const W = w.W*S, H = w.H*S, ax = w.ax*S, ay = w.ay*S, px = KIT.PX*S;
  // world point at the window centre: the origin minus the screen offset of the anchor
  const sx = (ax - W/2)/px, sy = (H/2 - ay)/px;
  const target = v3.sub([0,0,0], v3.add(v3.mul(CAM.R, sx), v3.mul(CAM.U, sy)));
  const t0 = performance.now();
  if (job.kind === 2) { const cv = renderGlow(S); return { key: job.key, scale: S, W, H, ax, ay, ms: Math.round(performance.now() - t0), png: cv.toDataURL('image/png').slice(22) }; }
  const canvas = await eng.render({ W, H, ss: S === 1 ? (job.ss1 || 4) : (job.ss2 || 3), px, target, kind: job.kind, figId: job.figId, fig: job.fig,
    obj: job.obj, mode: job.mode || 0, p0: job.p0, p1: job.p1, bound: job.bound, catcher: job.catcher, program: job.program, decal: job.kind ? (job.program === 'objects' ? objectsDecal() : decalCanvas()) : null,
    line: (job.line || 1.1)*S, depthThr: job.depthThr || 0.02, creaseCos: job.creaseCos || 0.80, aoR: job.aoR || 0.14, shK: job.shK || 7.0, emis: job.emis, tile: 128 });
  return { key: job.key, scale: S, W, H, ax, ay, ms: Math.round(performance.now() - t0), png: canvas.toDataURL('image/png').slice(22) };
}
async function bakeBatch(jobs, scales){
  const out = [];
  for (const job of jobs) for (const s of scales) out.push(await bakeFrame(job, s));
  return out;
}
window.__bakeBatch = async (jobKeys, scales) => {
  const all = window.__allJobs(); const byKey = new Map(all.map(j => [j.key, j]));
  return bakeBatch(jobKeys.map(k => byKey.get(k)), scales);
};
window.__allJobs = () => charJobs().concat(typeof placeJobs === 'function' ? placeJobs() : []);
function decalCanvas(){ return typeof makeDecal === 'function' ? makeDecal() : null; }
function objectsDecal(){ return typeof makeObjectsDecal === 'function' ? makeObjectsDecal() : null; }
function placeConstsGLSL(){ return typeof placeConsts === 'function' ? placeConsts() : ''; }
// what the manifest needs to know about each sprite (kept in the page, next to the catalog)
window.__meta = () => {
  const m = {};
  for (const ch of CHARS) {
    const fig = FIGS[ch.fig], anims = {};
    for (const a of (ch.anims || ['idle','walk','talk'])) {
      anims[a] = { fps: POSES[a].fps, frames: POSES[a].frames };
      if (POSES[a].wk) {                                   // a walk cycle covers two steps: each foot swings +-swing (times the figure scale) and is on the ground for half of it, so the body advances 4 x swing per cycle without foot sliding
        const stride = 4*ch.swing*(ch.scale || 1)*KIT.PX;
        anims[a].strideCyclePx = Math.round(stride*10)/10;
        anims[a].groundSpeedPxPerSec = Math.round(stride/(POSES[a].frames/POSES[a].fps)*10)/10;
      }
    }
    m[ch.id] = { kind: 'character', name: { zh: fig.zh, en: fig.en }, anims, dirs: DIRS };
  }
  for (const p of PLACES) m[p.id] = { kind: p.kind, name: { zh: p.zh, en: p.en }, footprint: p.cols ? { cols: p.cols, rows: p.rows } : undefined, extra: p.extra };
  return m;
};
