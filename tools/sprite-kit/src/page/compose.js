'use strict';
// ---------------------------------------------------------------- composing: trim, pack, atlases, contact sheet, walk4.gif
const PAPER = '#efe5cb', INK = '#2b2518', VERM = '#c0392b';
const SERIF = '"Noto Serif CJK SC","Songti SC","STSong","Source Han Serif SC",serif';

async function decodePng(b64){
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0); return c;
}
function alphaBounds(c){
  const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data, W = c.width, H = c.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (d[(y*W+x)*4+3] >= KIT.ALPHA_T) { if (x<x0) x0=x; if (x>x1) x1=x; if (y<y0) y0=y; if (y>y1) y1=y; }
  return x1 < 0 ? null : [x0, y0, x1+1, y1+1];
}
function shelfPack(items, pageW, maxH, pad){
  const pages = []; let page = null, x = 0, y = 0, shelfH = 0;
  const open = () => { page = { w: pageW, h: 0, items: [] }; pages.push(page); x = 0; y = 0; shelfH = 0; };
  open();
  for (const it of items) {
    if (x + it.w > pageW) { y += shelfH + pad; x = 0; shelfH = 0; }
    if (y + it.h > maxH && page.items.length) { open(); }
    it.page = pages.length - 1; it.x = x; it.y = y; page.items.push(it);
    x += it.w + pad; shelfH = Math.max(shelfH, it.h); page.h = Math.max(page.h, y + shelfH);
  }
  for (const pg of pages) pg.h = Math.ceil(pg.h/4)*4;
  return pages;
}

// the windows of a night-light sprite, as [x, y, w, h] in 1x px from the anchor (y down): the lit pixels, joined when they are within a few pixels of each other (the panes of one lattice are one window)
function windowSpots(canvas, rect, S0, ax, ay){
  const x0 = rect[0]*S0, y0 = rect[1]*S0, W = (rect[2]-rect[0])*S0, H = (rect[3]-rect[1])*S0;
  const d = canvas.getContext('2d').getImageData(x0, y0, W, H).data;
  const on = new Uint8Array(W*H); for (let i=0;i<W*H;i++) on[i] = d[i*4+3] >= 128 ? 1 : 0;
  const R = 5*S0, grown = new Uint8Array(W*H), tmp = new Uint8Array(W*H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) { let v = 0; for (let k=-R;k<=R && !v;k++) { const xx = x+k; if (xx >= 0 && xx < W && on[y*W+xx]) v = 1; } tmp[y*W+x] = v; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) { let v = 0; for (let k=-R;k<=R && !v;k++) { const yy = y+k; if (yy >= 0 && yy < H && tmp[yy*W+x]) v = 1; } grown[y*W+x] = v; }
  const seen = new Uint8Array(W*H), out = [];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (!grown[y*W+x] || seen[y*W+x]) continue;
    const stack = [y*W+x]; seen[y*W+x] = 1; let bx0 = W, by0 = H, bx1 = -1, by1 = -1, n = 0;
    while (stack.length) {
      const i = stack.pop(), cx = i % W, cy = (i - cx) / W;
      if (on[i]) { n++; if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy; }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = cx+dx, ny = cy+dy; if (nx >= 0 && nx < W && ny >= 0 && ny < H && grown[ny*W+nx] && !seen[ny*W+nx]) { seen[ny*W+nx] = 1; stack.push(ny*W+nx); } }
    }
    if (n >= 8*S0*S0) out.push([Math.round(((bx0 + bx1 + 1)/2)/S0 - ax), Math.round(((by0 + by1 + 1)/2)/S0 - ay), Math.round((bx1 - bx0 + 1)/S0), Math.round((by1 - by0 + 1)/S0)]);
  }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out;
}

window.__compose = async (results) => {
  const jobs = window.__allJobs(), jobByKey = new Map(jobs.map(j => [j.key, j]));
  const frames = { 1: new Map(), 2: new Map() };
  for (const r of results) frames[r.scale].set(r.key, { ...r, canvas: await decodePng(r.png) });
  const scales = KIT.SCALES.filter(s => frames[s].size), S0 = scales[0];     // the smallest baked scale decides the trim
  // ---- per sprite: union of the visible pixels of its 1x frames (in the sprite window), then the same rectangle at every scale
  const spriteIds = []; for (const j of jobs) if (!spriteIds.includes(j.sprite)) spriteIds.push(j.sprite);
  const layout = [];
  for (const id of spriteIds) {
    const js = jobs.filter(j => j.sprite === id && frames[S0].has(j.key));
    if (!js.length) continue;
    let u = null;
    for (const j of js) { const b = alphaBounds(frames[S0].get(j.key).canvas); if (b) u = u ? [Math.min(u[0],b[0]),Math.min(u[1],b[1]),Math.max(u[2],b[2]),Math.max(u[3],b[3])] : b; }
    const f0 = frames[S0].get(js[0].key), W1 = f0.W/S0, H1 = f0.H/S0, ax1 = f0.ax/S0, ay1 = f0.ay/S0;
    const rect = [Math.max(0, Math.floor(u[0]/S0)-1), Math.max(0, Math.floor(u[1]/S0)-1), Math.min(W1, Math.ceil(u[2]/S0)+1), Math.min(H1, Math.ceil(u[3]/S0)+1)];
    layout.push({ id, jobs: js, rect, w: rect[2]-rect[0], h: rect[3]-rect[1], ax: ax1 - rect[0], ay: ay1 - rect[1] });
  }
  // ---- atlases
  const pagesOut = {};
  for (const S of scales) {
    const items = [];
    for (const sp of layout) for (const j of sp.jobs) { const f = frames[S].get(j.key); if (f) items.push({ sp, key: j.key, w: sp.w*S, h: sp.h*S, src: f.canvas, crop: sp.rect.map(v => v*S) }); }
    items.sort((a,b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : 1));
    const pages = shelfPack(items, S === 1 ? 2048 : 4096, 4096, KIT.PAD*S);
    const out = [];
    for (const pg of pages) {
      const c = document.createElement('canvas'); c.width = pg.w; c.height = pg.h; const g = c.getContext('2d');
      for (const it of pg.items) g.drawImage(it.src, it.crop[0], it.crop[1], it.w, it.h, it.x, it.y, it.w, it.h);
      const blob = await new Promise(res => c.toBlob(res, 'image/webp', 1));
      const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i=0;i<buf.length;i+=8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i+8192));
      out.push({ w: pg.w, h: pg.h, webp: btoa(bin) });
    }
    pagesOut[S] = { pages: out, placed: items.map(it => ({ key: it.key, page: it.page, x: it.x, y: it.y })) };
  }
  const sheet = await contactSheet(layout, frames, S0);
  const gif = await walk4Gif(layout, frames);
  return {
    sprites: layout.map(sp => ({ id: sp.id, w: sp.w, h: sp.h, ax: sp.ax, ay: sp.ay, keys: sp.jobs.map(j => j.key),
      ...(sp.id.startsWith('fx.windows.') ? { spots: windowSpots(frames[S0].get(sp.jobs[0].key).canvas, sp.rect, S0, sp.ax, sp.ay) } : {}) })),
    atlases: pagesOut, sheet, gif,
  };
};

// ---------------------------------------------------------------- contact sheet: every sprite at 1x on paper, labelled
function text(g, s, x, y, size, color, bold, align){
  g.font = `${bold ? 'bold ' : ''}${size}px ${SERIF}`; g.fillStyle = color || INK; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic'; g.fillText(s, x, y);
}
async function contactSheet(layout, frames, S0){
  const byId = new Map(layout.map(sp => [sp.id, sp]));
  const chars = CHARS.filter(c => byId.has(c.id));
  const M = 18, DEP = KIT.CELL_PX*Math.sin(KIT.PITCH*Math.PI/180);          // on screen a grid cell is 32 px wide and DEP px deep
  // pre-measure heights and widths
  const blocks = [];
  let H = 64, Wneed = 1300;
  for (const ch of chars) {
    const sp = byId.get(ch.id), cw = sp.w + 8, chh = sp.h + 6, anims = ch.anims || ['idle','walk','talk'];
    const h = 30 + 18 + 4*chh + 14; blocks.push({ ch, sp, cw, chh, anims, h, y: H }); H += h;
    Wneed = Math.max(Wneed, M + 46 + anims.reduce((n, a) => n + POSES[a].frames*cw + 10, 0) + M);
  }
  const W = Wneed;
  const places = layout.filter(sp => !sp.id.startsWith('char.'));
  H += 50;
  const placeBlocks = []; let px = M, py = H, rowH = 0;
  for (const sp of places) {
    const meta = placeMeta(sp.id); const gw = Math.max(sp.w + 40, sp.id.startsWith('fx.windows.') ? 340 : 230), gh = sp.h + 54;
    if (px + gw > W - M) { px = M; py += rowH + 12; rowH = 0; }
    placeBlocks.push({ sp, meta, x: px, y: py, gw, gh }); px += gw + 12; rowH = Math.max(rowH, gh);
  }
  H = py + rowH + M;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0,0,W,H);
  text(g, '灯会前夕  精灵清单 (1x)', M, 34, 26, INK, true);
  text(g, `相机：朝北，俯角 ${KIT.PITCH}°　1 世界单位 = ${KIT.PX} px　1 格 = 宽 ${KIT.CELL_PX} px、纵深 ${DEP.toFixed(1)} px　红点 = 锚点（角色在两脚之间，场景在占地左下角）`, M, 56, 13, 'rgba(43,37,24,0.7)', false);
  for (const b of blocks) {
    const { ch, sp, cw, chh, anims } = b; const fig = FIGS[ch.fig];
    text(g, `${fig.zh}  ${ch.id}`, M, b.y + 20, 17, INK, true);
    text(g, `帧 ${sp.w}×${sp.h}  锚点 (${sp.ax}, ${sp.ay})`, M + 330, b.y + 20, 12, 'rgba(43,37,24,0.6)', false);
    // column headers
    let cx = M + 46; const colX = [];
    for (const a of anims) { const P = POSES[a]; text(g, `${a} ×${P.frames}`, cx, b.y + 40, 11, 'rgba(43,37,24,0.65)', true); for (let k=0;k<P.frames;k++) { colX.push({ a, k, x: cx }); cx += cw; } cx += 10; }
    DIRS.forEach((dir, di) => {
      const y0 = b.y + 48 + di*chh;
      text(g, dir, M + 2, y0 + sp.ay + 2, 11, 'rgba(43,37,24,0.65)', false);
      g.strokeStyle = 'rgba(43,37,24,0.07)'; g.beginPath(); g.moveTo(M+44, y0 + sp.ay + 0.5); g.lineTo(cx, y0 + sp.ay + 0.5); g.stroke();
      for (const col of colX) {
        const key = `${ch.id}|${col.a}|${dir}|${col.k}`, f = frames[S0].get(key); if (!f) continue;
        g.drawImage(f.canvas, sp.rect[0]*S0, sp.rect[1]*S0, sp.w*S0, sp.h*S0, col.x, y0, sp.w, sp.h);
        g.fillStyle = VERM; g.fillRect(col.x + sp.ax - 1, y0 + sp.ay - 1, 3, 3);
      }
    });
  }
  text(g, `场景与道具（灰格 = 一格，宽 ${KIT.CELL_PX} px、纵深 ${DEP.toFixed(1)} px；红框 = 占地）`, M, blocks.length ? blocks[blocks.length-1].y + blocks[blocks.length-1].h + 30 : 100, 20, INK, true);
  for (const b of placeBlocks) {
    const { sp, meta } = b, f = frames[S0].get(sp.jobs[0].key);
    text(g, `${meta.label}  ${sp.id}`, b.x, b.y + 12, 12, INK, true);
    text(g, `${sp.w}×${sp.h}px  锚点 (${sp.ax}, ${sp.ay})` + (meta.cols ? `  占地 ${meta.cols}×${meta.rows} 格` : ''), b.x, b.y + 27, 11, 'rgba(43,37,24,0.65)', false);
    const ox = b.x + 20, oy = b.y + 36;
    // the grid, anchored at the sprite's anchor
    g.save(); g.beginPath(); g.rect(ox, oy, Math.max(sp.w,80), sp.h); g.clip();
    g.fillStyle = 'rgba(43,37,24,0.04)'; g.fillRect(ox, oy, Math.max(sp.w,80), sp.h);
    g.strokeStyle = 'rgba(43,37,24,0.13)'; g.lineWidth = 1;
    for (let gx = ox + sp.ax - 32*Math.ceil(sp.ax/32); gx <= ox + Math.max(sp.w,80); gx += 32) { g.beginPath(); g.moveTo(gx+0.5, oy); g.lineTo(gx+0.5, oy+sp.h); g.stroke(); }
    for (let gy = oy + sp.ay - DEP*Math.ceil(sp.ay/DEP); gy <= oy + sp.h; gy += DEP) { g.beginPath(); g.moveTo(ox, gy+0.5); g.lineTo(ox+Math.max(sp.w,80), gy+0.5); g.stroke(); }
    g.restore();
    if (sp.id.startsWith('fx.windows.')) {                // the night light of a building is added to the picture: shown on the dark of the night
      g.fillStyle = '#283159'; g.fillRect(ox, oy, Math.max(sp.w,80), sp.h);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(f.canvas, sp.rect[0]*S0, sp.rect[1]*S0, sp.w*S0, sp.h*S0, ox, oy, sp.w, sp.h);
      g.globalCompositeOperation = 'source-over';
    } else g.drawImage(f.canvas, sp.rect[0]*S0, sp.rect[1]*S0, sp.w*S0, sp.h*S0, ox, oy, sp.w, sp.h);
    if (meta.cols) { g.strokeStyle = VERM; g.lineWidth = 1.5; g.strokeRect(ox + sp.ax + 0.5, oy + sp.ay - meta.rows*DEP + 0.5, meta.cols*KIT.CELL_PX, meta.rows*DEP); }
    g.fillStyle = VERM; g.beginPath(); g.arc(ox + sp.ax, oy + sp.ay, 3, 0, Math.PI*2); g.fill();
  }
  return c.toDataURL('image/png').slice(22);
}
function placeMeta(id){ const p = PLACES.find(p => p.id === id); return p ? { label: p.zh, cols: p.cols, rows: p.rows } : { label: id }; }

// ---------------------------------------------------------------- walk4.gif: the seven slice characters, then the three townsfolk, then the twelve with a figure of their own in two bands of six, walking in all four directions
async function walk4Gif(layout, frames){
  const byId = new Map(layout.map(sp => [sp.id, sp])), S = frames[2].size ? 2 : 1;
  const bands = [SLICE7, TOWN3, ...OWN12].map(b => b.filter(id => byId.has(id))).filter(b => b.length);
  if (!bands.length) return null;
  const allIds = bands.flat();
  let cw = 0, ch = 0, ax = 0, ay = 0;
  for (const id of allIds) { const sp = byId.get(id); ax = Math.max(ax, sp.ax*S); ay = Math.max(ay, sp.ay*S); }
  for (const id of allIds) { const sp = byId.get(id); cw = Math.max(cw, ax + (sp.w - sp.ax)*S); ch = Math.max(ch, ay + (sp.h - sp.ay)*S); }
  cw += 6; ch += 6;
  const L = 74, T = 34, ncol = Math.max(...bands.map(b => b.length)), bandH = T + 4*ch + 8;
  const W = L + ncol*cw + 8, H = bandH*bands.length, out = [];
  for (let k=0;k<POSES.walk.frames;k++) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = PAPER; g.fillRect(0,0,W,H);
    bands.forEach((ids, bi) => {
      const y0 = bi*bandH;
      ids.forEach((id, i) => { const fig = FIGS[CHARS.find(c => c.id === id).fig]; text(g, fig.zh, L + i*cw + cw/2, y0 + 22, 15, INK, true, 'center'); });
      DIRS.forEach((dir, di) => {
        text(g, { down:'向下', up:'向上', left:'向左', right:'向右' }[dir], 10, y0 + T + di*ch + ay, 14, 'rgba(43,37,24,0.75)', true);
        g.strokeStyle = 'rgba(43,37,24,0.10)'; g.beginPath(); g.moveTo(L, y0 + T + di*ch + ay + 0.5); g.lineTo(W-4, y0 + T + di*ch + ay + 0.5); g.stroke();
        ids.forEach((id, i) => {
          const sp = byId.get(id), f = frames[S].get(`${id}|walk|${dir}|${k}`); if (!f) return;
          g.drawImage(f.canvas, sp.rect[0]*S, sp.rect[1]*S, sp.w*S, sp.h*S, L + i*cw + 3 + ax - sp.ax*S, y0 + T + di*ch + 3 + ay - sp.ay*S, sp.w*S, sp.h*S);
        });
      });
    });
    out.push({ data: g.getImageData(0,0,W,H).data, w: W, h: H, delay: k % 2 === 0 ? 13 : 12 });
  }
  const bytes = encodeGif(out); let bin = ''; for (let i=0;i<bytes.length;i+=8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i+8192));
  return btoa(bin);
}
