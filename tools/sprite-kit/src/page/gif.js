'use strict';
// ---------------------------------------------------------------- a small GIF89a encoder (global palette, no dithering, no libraries)
// frames: [{ data: Uint8ClampedArray (RGBA), w, h, delay (1/100 s) }]  ->  Uint8Array
function encodeGif(frames){
  const w = frames[0].w, h = frames[0].h;
  // 1. palette: median cut over a 5-bit histogram of every pixel of every frame
  const hist = new Uint32Array(32768);
  for (const f of frames) { const d = f.data; for (let i=0;i<d.length;i+=4) hist[((d[i]>>3)<<10)|((d[i+1]>>3)<<5)|(d[i+2]>>3)]++; }
  let boxes = [{ bins: [], n: 0 }];
  for (let k=0;k<32768;k++) if (hist[k]) { boxes[0].bins.push(k); boxes[0].n += hist[k]; }
  const chan = (k, c) => c === 0 ? (k>>10)&31 : c === 1 ? (k>>5)&31 : k&31;
  while (boxes.length < 256) {
    let bi = -1, best = 1;
    boxes.forEach((b,i) => { if (b.bins.length > 1 && b.n > best) { best = b.n; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi]; let ax = 0, range = -1;
    for (let c=0;c<3;c++) { let lo = 31, hi = 0; for (const k of b.bins) { const v = chan(k,c); if (v<lo) lo=v; if (v>hi) hi=v; } if (hi-lo > range) { range = hi-lo; ax = c; } }
    b.bins.sort((p,q) => chan(p,ax) - chan(q,ax) || p - q);
    let acc = 0, cut = 1; for (let i=0;i<b.bins.length;i++) { acc += hist[b.bins[i]]; if (acc*2 >= b.n) { cut = Math.min(Math.max(i+1,1), b.bins.length-1); break; } }
    const a = { bins: b.bins.slice(0,cut), n: 0 }, c2 = { bins: b.bins.slice(cut), n: 0 };
    for (const k of a.bins) a.n += hist[k]; for (const k of c2.bins) c2.n += hist[k];
    boxes.splice(bi, 1, a, c2);
  }
  const pal = new Uint8Array(768);
  boxes.forEach((b,i) => { let r=0,g=0,bl=0,n=0; for (const k of b.bins){ const c=hist[k]; r+=chan(k,0)*c; g+=chan(k,1)*c; bl+=chan(k,2)*c; n+=c; }
    pal[i*3]=Math.min(255,Math.round((r/n)*8+4)); pal[i*3+1]=Math.min(255,Math.round((g/n)*8+4)); pal[i*3+2]=Math.min(255,Math.round((bl/n)*8+4)); });
  const nPal = boxes.length;
  // 2. nearest palette entry through a 6-bit lookup table
  const lut = new Int16Array(262144).fill(-1);
  const nearest = (r,g,b) => { let bi=0, bd=1e9; for (let i=0;i<nPal;i++){ const dr=r-pal[i*3], dg=g-pal[i*3+1], db=b-pal[i*3+2]; const d=dr*dr*2+dg*dg*4+db*db*3; if (d<bd){bd=d;bi=i;} } return bi; };
  const index = (d, out) => { for (let i=0,j=0;i<d.length;i+=4,j++){ const k=((d[i]>>2)<<12)|((d[i+1]>>2)<<6)|(d[i+2]>>2); let v=lut[k]; if (v<0){ v=nearest((d[i]&0xfc)+2,(d[i+1]&0xfc)+2,(d[i+2]&0xfc)+2); lut[k]=v; } out[j]=v; } };
  // 3. stream
  const out = [];
  const u16 = v => { out.push(v&255, (v>>8)&255); };
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  u16(w); u16(h); out.push(0xF7, 0, 0);
  for (let i=0;i<768;i++) out.push(pal[i]);
  out.push(0x21,0xFF,0x0B); for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0)); out.push(3,1,0,0,0);
  const idx = new Uint8Array(w*h);
  for (const f of frames) {
    index(f.data, idx);
    out.push(0x21,0xF9,4,0x04); u16(f.delay); out.push(0,0);
    out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
    lzwWrite(out, idx, 8);
  }
  out.push(0x3B);
  return Uint8Array.from(out);
}
function lzwWrite(out, indices, minCodeSize){            // the LZW stream of omggif, written as sub-blocks
  out.push(minCodeSize);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let next = eoi + 1, size = minCodeSize + 1, shift = 0, cur = 0, table = new Map();
  let block = [];
  const put = b => { block.push(b); if (block.length === 255) { out.push(255); for (const x of block) out.push(x); block = []; } };
  const drain = (min) => { while (shift >= min) { put(cur & 255); cur >>= 8; shift -= 8; } };
  const emit = c => { cur |= c << shift; shift += size; drain(8); };
  let ib = indices[0];
  emit(clear);
  for (let i=1;i<indices.length;i++) {
    const k = indices[i], key = (ib << 8) | k, c = table.get(key);
    if (c === undefined) {
      emit(ib);
      if (next === 4096) { emit(clear); next = eoi + 1; size = minCodeSize + 1; table = new Map(); }
      else { if (next >= (1 << size)) size++; table.set(key, next++); }
      ib = k;
    } else ib = c;
  }
  emit(ib); emit(eoi); drain(1);
  if (block.length) { out.push(block.length); for (const x of block) out.push(x); }
  out.push(0);
}
