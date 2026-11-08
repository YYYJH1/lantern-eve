'use strict';
// ---------------------------------------------------------------- the ray-marching engine: WebGL2, no libraries
const VS_SRC = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
const tick = () => new Promise(r => setTimeout(r, 0));

class Engine {
  constructor(){
    const cv = this.canvas = document.createElement('canvas'); cv.width = 8; cv.height = 8;
    const gl = this.gl = cv.getContext('webgl2', {antialias:false, depth:false, stencil:false, alpha:false, preserveDrawingBuffer:true});
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
    this.progs = {}; this.locs = new Map(); this.vao = gl.createVertexArray(); this.decalTex = null;
  }
  compile(type, src, label){
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh); const lines = src.split('\n');
      const m = /ERROR: \d+:(\d+)/.exec(log); let ctx = '';
      if (m) { const ln = +m[1]; ctx = lines.slice(Math.max(0,ln-4), ln+2).map((l,i)=>(Math.max(0,ln-4)+i+1)+': '+l).join('\n'); }
      throw new Error('shader compile failed ('+label+'): '+log+'\n'+ctx);
    }
    return sh;
  }
  program(kind){
    if (this.progs[kind]) return this.progs[kind];
    const gl = this.gl;
    let fsrc;
    if (kind === 'post') fsrc = GLSL.post;
    else {
      const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
      // 'objects' is the program of the things of the corner of the page (shaders/objects.glsl): the same marcher and figures with models of its own in
      // place of the places, so that the program that every other sprite is baked with stays as it was, to the byte
      const models = kind === 'objects' ? GLSL.objects : [GLSL.places, GLSL.town, GLSL.trees, GLSL.dispatch].join('\n');
      const march = GLSL.march.replace('__PAL__', palGLSL()).replace('__KITCONST__', kitConstsGLSL()).replace('__PLACES__', () => models);
      fsrc = head + GLSL.common + GLSL.figures + march;
    }
    const vs = this.compile(gl.VERTEX_SHADER, VS_SRC, 'vs'), fs = this.compile(gl.FRAGMENT_SHADER, fsrc, kind);
    const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link failed '+kind+': '+gl.getProgramInfoLog(pr));
    return (this.progs[kind] = pr);
  }
  loc(pr, name){
    let m = this.locs.get(pr); if (!m) { m = {}; this.locs.set(pr, m); }
    if (!(name in m)) m[name] = this.gl.getUniformLocation(pr, name);
    return m[name];
  }
  set(pr, name, v){
    const gl = this.gl, l = this.loc(pr, name); if (l === null) return;
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else gl.uniform4fv(l, v);
  }
  seti(pr, name, v){ const l = this.loc(pr, name); if (l !== null) this.gl.uniform1i(l, v); }
  tex(w, h, internal){
    const gl = this.gl, t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  setDecal(canvas){                        // the text decals (tea flag, plaques) live in one texture on unit 5
    const gl = this.gl;
    if (!this.decalTex) this.decalTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.decalTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // o: W,H (final px), ss, px (px per unit at final size), target [x,y,z] (world point at the window centre),
  //    program ('sprite', or 'objects' for the things of the corner), kind (0 figure / 1 place), figId, fig {pos,yaw,scale,wk,ph,aux}, obj, p0, p1, bound [x,y,z,r], catcher [x,z,r,strength],
  //    line (px), depthThr, creaseCos, aoR, shK, tile
  async render(o){
    const gl = this.gl, ss = o.ss, W = o.W, H = o.H, SW = W*ss, SH = H*ss;
    const pr = this.program(o.program || 'sprite');
    const tCol = this.tex(SW,SH,gl.RGBA16F), tGeo = this.tex(SW,SH,gl.RGBA32F), tInk = this.tex(SW,SH,gl.RGBA8);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    [tCol,tGeo,tInk].forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete');
    gl.viewport(0,0,SW,SH); gl.bindVertexArray(this.vao); gl.useProgram(pr);
    const pxSS = o.px*ss, f = o.fig || {pos:[0,0,0], yaw:0, scale:1, wk:0, ph:0, aux:0};
    this.set(pr,'uRes',[SW,SH]); this.set(pr,'uPx',pxSS); this.set(pr,'uTarget',o.target);
    this.set(pr,'uCamR',CAM.R); this.set(pr,'uCamU',CAM.U); this.set(pr,'uCamF',CAM.F);
    this.seti(pr,'uKind',o.kind); this.seti(pr,'uFigId',o.figId||0); this.seti(pr,'uObj',o.obj||0); this.seti(pr,'uMode',o.mode||0);
    this.set(pr,'uFigPos',[f.pos[0],f.pos[1],f.pos[2],f.yaw]); this.set(pr,'uFigPar',[f.scale,f.wk,f.ph,f.aux||0]);
    this.set(pr,'uP0',o.p0||[0,0,0,0]); this.set(pr,'uP1',o.p1||[0,0,0,0]);
    this.set(pr,'uKeyDir',KEYDIR);
    this.set(pr,'uTintShade',LIGHT.shade); this.set(pr,'uTintMid',LIGHT.mid); this.set(pr,'uTintLit',LIGHT.lit); this.set(pr,'uRimCol',LIGHT.rim);
    this.set(pr,'uEmis',o.emis === undefined ? LIGHT.emis : o.emis); this.set(pr,'uAoR',o.aoR||0.14); this.set(pr,'uShK',o.shK||7.0);
    this.set(pr,'uShadowCol',[0.20,0.15,0.09]);
    this.set(pr,'uBound',o.bound); this.set(pr,'uCatch',o.catcher);
    this.seti(pr,'uTex',5); if (o.decal && o.decal !== this.decalSrc) { this.setDecal(o.decal); this.decalSrc = o.decal; }
    // a frame must not depend on the frames drawn before it: bind the decal texture again on unit 5 for every frame, and leave unit 0 active
    if (this.decalTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.decalTex); }
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.SCISSOR_TEST);
    const tile = o.tile || 128;
    for (let y=0;y<SH;y+=tile) for (let x=0;x<SW;x+=tile){
      gl.scissor(x,y,Math.min(tile,SW-x),Math.min(tile,SH-y)); gl.drawArrays(gl.TRIANGLES,0,3); gl.finish();
      await tick();
    }
    gl.disable(gl.SCISSOR_TEST);
    // outlines and the supersample resolve
    const pp = this.program('post'), tOut = this.tex(W,H,gl.RGBA8);
    const fbo2 = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tOut, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0,0,W,H); gl.useProgram(pp);
    [tCol,tGeo,tInk].forEach((t,i)=>{ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D,t); });
    this.seti(pp,'uCol',0); this.seti(pp,'uGeo',1); this.seti(pp,'uInk',2); this.seti(pp,'uSS',ss);
    this.set(pp,'uLine',(o.line||1.0)*ss); this.set(pp,'uPxSS',pxSS);
    this.set(pp,'uCamR',CAM.R); this.set(pp,'uCamU',CAM.U); this.set(pp,'uCamF',CAM.F);
    this.set(pp,'uDepthThr',o.depthThr||0.02); this.set(pp,'uCreaseCos',o.creaseCos||0.80); this.set(pp,'uInkAlpha',o.inkAlpha||0.94);
    gl.drawArrays(gl.TRIANGLES,0,3); gl.finish();
    const buf = new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    [tCol,tGeo,tInk,tOut].forEach(t=>gl.deleteTexture(t)); gl.deleteFramebuffer(fbo); gl.deleteFramebuffer(fbo2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W,H);
    for (let y=0;y<H;y++) img.data.set(buf.subarray((H-1-y)*W*4,(H-y)*W*4), y*W*4);
    ctx.putImageData(img,0,0);
    return c;
  }
}
