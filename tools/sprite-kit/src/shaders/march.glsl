// Ray-marcher for the sprite kit: one figure (uKind 0) or one place/prop (uKind 1) per draw.
uniform vec2  uRes;
uniform float uPx;                 // pixels per world unit in the supersampled target
uniform vec3  uTarget, uCamR, uCamU, uCamF;
uniform int   uKind;               // 0 = figure at the origin, 1 = place or prop with its anchor at the origin
uniform int   uFigId;
uniform vec4  uFigPos;             // x, y, z, yaw
uniform vec4  uFigPar;             // scale, walk amplitude, phase, aux (variant + 2*pose)
uniform int   uMode;               // 0 = the sprite as it is, 1 = its night light only: the lit panes of the windows in flat warm light, everything else clear (but still in front of what lies behind it)
uniform int   uObj;                // which place
uniform vec4  uP0, uP1;            // place parameters (see places.glsl)
uniform vec3  uKeyDir;
uniform vec3  uTintShade, uTintMid, uTintLit, uRimCol;
uniform float uEmis, uAoR, uShK;
uniform vec4  uBound;              // bounding sphere of what is drawn: centre xyz, radius
uniform vec4  uCatch;              // ground shadow region: centre x, centre z, radius, strength
uniform sampler2D uTex;
uniform vec3  uShadowCol;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oGeo;
layout(location=2) out vec4 oInk;
float gInkA = 1.0;
float gEmis = 0.0;
float gBid = 0.0;

__PAL__
__KITCONST__

// material codes: a figure uses 16 slots (its 16 palette entries). ids 0..9 sit at id*16 (0..159), places use 160..191, ids 10 and up sit at 192 + (id - 10)*16.
// NOHIT is the code of "nothing here" and lies above every figure: 24 figures end at code 415.
const float NOHIT = 1000.0;
int figBase(int id){ return id < 10 ? id*16 : 192 + (id - 10)*16; }
int figIdOf(int code){ return code < 160 ? code/16 : 10 + (code - 192)/16; }
vec2 mapFig(vec3 p, int lod){
  float sc = uFigPar.x;
  vec3 q = p - uFigPos.xyz;
  float cy = cos(uFigPos.w), sy = sin(uFigPos.w);
  q = vec3(q.x*cy - q.z*sy, q.y, q.x*sy + q.z*cy);
  q /= sc;
  float bd = length(q - vec3(0.0,0.62,0.0)) - 0.98;
  if (bd > 0.22) return vec2((bd + (lod==1 ? 1.2 : 0.15))*sc, NOHIT);
  float pz = floor(uFigPar.w*0.5 + 0.01); float vr = uFigPar.w - 2.0*pz;
  vec2 r = figMap(q, uFigId, lod, uFigPar.y, uFigPar.z, vr, pz);
  return vec2(r.x*sc, r.y + float(figBase(uFigId)));
}
vec3 figLocal(vec3 pw){
  vec3 q = pw - uFigPos.xyz; float cy = cos(uFigPos.w), sy = sin(uFigPos.w);
  q = vec3(q.x*cy - q.z*sy, q.y, q.x*sy + q.z*cy);
  return q/uFigPar.x;
}

__PLACES__

vec2 map(vec3 p, int lod){
  return (uKind == 0) ? mapFig(p, lod) : mapPlace(p, lod);
}

vec3 calcNormal(vec3 p, float e){
  vec2 k = vec2(1.0,-1.0);
  return normalize(k.xyy*map(p+k.xyy*e,0).x + k.yyx*map(p+k.yyx*e,0).x + k.yxy*map(p+k.yxy*e,0).x + k.xxx*map(p+k.xxx*e,0).x);
}
float softShadow(vec3 ro, vec3 rd, float tmin, float tmax, float k, float smax_){
  float res = 1.0; float t = tmin + 0.03*hash21(gl_FragCoord.xy);
  for (int i=0;i<84;i++){
    float h = map(ro + rd*t, 1).x;
    res = min(res, k*h/t);
    t += clamp(h, 0.014, smax_ + 0.05*t);
    if (res < 0.004 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}
float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for (int i=0;i<5;i++){
    float h = 0.012 + uAoR*float(i)/4.0;
    float d = map(p + h*n, 1).x;
    occ += (h-d)*sca; sca *= 0.88;
  }
  return clamp(1.0 - 3.0*(0.12/uAoR)*occ, 0.0, 1.0);
}

void figMatInfo(int code, vec3 pw, out vec3 alb, out float emis, out float sss){
  int id = figIdOf(code); int m = code - figBase(id);
  alb = PAL[id*16 + m];
  emis = (m==9) ? 1.0 : 0.0;
  sss = (m==0 || m==11) ? 1.0 : 0.0;
  vec3 pl = figLocal(pw);
  if (id==1 && m==15){
    vec3 a = vec3(0.05,0.82,-0.60), b = vec3(-0.30,0.57,0.44); float t = dot(pl-a, normalize(b-a));
    float f = fract(t/0.30); float ring = 1.0 - smoothstep(0.0, 0.07, min(f,1.0-f));
    alb *= mix(1.0, 0.70, ring);
    alb = mix(alb, alb*vec3(1.04,0.98,0.9), step(0.5, fract(t/0.60)));
  }
  if (id==4 && m==15){ float rr = length(pl.xz - vec2(0.0, 0.0)); alb *= 1.0 - 0.12*smoothstep(0.32,0.5,abs(fract(rr*30.0)-0.5)); }
  if (id==4 && m==6 && pl.y < 0.5) alb *= 0.78;
  if (id==3 && m==2){
    float ang = atan(pl.x, pl.z); vec2 cell = abs(fract(vec2(ang*3.7, pl.y/0.085)) - 0.5);
    float dt = 1.0 - smoothstep(0.15, 0.20, length(cell)); alb = mix(alb, alb*vec3(1.16,1.10,1.0), dt*0.9);
  }
  if (id==0 && m==2){
    float ang = atan(pl.x, pl.z); vec2 cell = abs(fract(vec2(ang*4.6, pl.y/0.07)) - 0.5);
    float dt = 1.0 - smoothstep(0.12, 0.17, length(cell)); alb = mix(alb, alb*1.22, dt*0.8);
  }
  if (id==8 && m==2){            // clan elder: a faint woven pattern on the dark robe
    float ang = atan(pl.x, pl.z); vec2 cell = abs(fract(vec2(ang*3.2, pl.y/0.10)) - 0.5);
    float dt = 1.0 - smoothstep(0.10, 0.16, length(cell)); alb = mix(alb, alb*1.35, dt*0.55);
  }
  if (id==7 && m==13){            // apron: a thin vertical stripe
    float st = 1.0 - smoothstep(0.0, 0.012, abs(fract(pl.x/0.07+0.5)-0.5)*0.07);
    alb = mix(alb, alb*vec3(0.92,0.88,0.80), st*0.5);
  }
}

vec3 toon(vec3 alb, vec3 n, float sh, float ao, float sss, vec3 pw, float rimK, float soft){
  float ndl = dot(n, uKeyDir);
  float x = ndl * sh;
  float b1 = smoothstep(-0.03, -0.03 + mix(0.16, 0.45, soft), x);
  float b2 = smoothstep(0.50, 0.50 + mix(0.14, 0.42, soft), x);
  vec3 shadeT = mix(uTintShade, uTintShade*vec3(1.10,0.93,0.90), sss*0.9);
  vec3 tint = mix(mix(shadeT, uTintMid, b1), uTintLit, b2);
  vec3 col = alb * tint;
  col *= mix(0.58, 1.0, ao);
  float rim = 1.0 - max(dot(n, -uCamF), 0.0);
  rim = smoothstep(0.55, 0.85, rim) * (1.0 - b1*0.7) * rimK;
  col += uRimCol * rim * 0.30;
  return col;
}

void main(){
  vec2 sc = (gl_FragCoord.xy - 0.5*uRes) / uPx;
  vec3 ro = uTarget + uCamR*sc.x + uCamU*sc.y - uCamF*30.0;
  vec3 rd = uCamF;
  float eps = 0.35/uPx;
  float t0, t1;
  vec3 oc = ro - uBound.xyz; float bq = dot(oc, rd); float disc = bq*bq - (dot(oc,oc) - uBound.w*uBound.w);
  if (disc > 0.0) { t0 = -bq - sqrt(disc); t1 = -bq + sqrt(disc); } else { t0 = 1.0; t1 = 0.0; }
  float t = t0; vec2 h = vec2(1.0, NOHIT); bool hit = false;
  for (int i=0;i<220;i++){
    if (t > t1) break;
    h = map(ro + rd*t, 0);
    if (h.x < eps) { hit = true; break; }
    t += h.x * 0.92;
  }
  if (!hit || h.y > NOHIT - 1.0) {
    if (uMode == 1) { oCol = vec4(0.0); oGeo = vec4(0.0,1.0,0.0,1e5); oInk = vec4(0.0); return; }
    // soft ground shadow on a transparent catcher
    float tg = -ro.y/rd.y; vec3 pg = ro + rd*tg;
    if (uKind == 1 && uObj == OBJ_BRIDGE && abs(pg.x - 0.5*uP0.x) < CANAL_HW) { tg = (WATER_Y - ro.y)/rd.y; pg = ro + rd*tg; }
    vec2 dxz = pg.xz - uCatch.xy; float dist = length(dxz);
    float rs = uCatch.z;
    float a = 0.0;
    if (dist < rs) {
      vec3 pgs = pg + vec3(0.0,0.004,0.0);
      float fall = 1.0 - smoothstep(rs*0.50, rs, dist);
      if (uKind == 0) {
        float sh = softShadow(pgs, uKeyDir, 0.02, 2.2, 4.0, 0.016);
        float contact = exp(-dot(dxz,dxz)/(0.060*uFigPar.x*uFigPar.x));
        a = (0.26*smoothstep(0.05,0.9,1.0-sh) + 0.30*contact) * fall;
      } else {
        float sh = softShadow(pgs, uKeyDir, 0.02, 6.0, 5.0, 0.04);
        float ao = calcAO(pgs, vec3(0.0,1.0,0.0));
        a = (0.28*smoothstep(0.05,0.9,1.0-sh) + 0.30*(1.0-ao)) * fall;
      }
      a *= uCatch.w;
    }
    oCol = vec4(uShadowCol, clamp(a, 0.0, 0.62)); oGeo = vec4(0.0,1.0,0.0,1e5); oInk = vec4(0.0);
    return;
  }
  vec3 pos = ro + rd*t;
  vec3 n = calcNormal(pos, max(0.5/uPx, 0.0016));
  int code = int(h.y + 0.5);
  if (uMode == 1) { oCol = nightLight(code, pos, n, calcAO(pos, n)); oGeo = vec4(n, 1e5); oInk = vec4(0.0); return; }
  vec3 alb; float emis, sss;
  float rimK = 1.0, soft = 0.0;
  if (code >= 160 && code < 192) { placeMat(code, pos, n, alb, emis, sss, rimK, soft); }
  else { figMatInfo(code, pos, alb, emis, sss); }
  float sh = softShadow(pos + n*0.012, uKeyDir, 0.02, 7.0, uShK, 0.07);
  float ao = calcAO(pos, n);
  vec3 col = toon(alb, n, sh, ao, sss, pos, rimK, soft);
  emis = max(emis, gEmis);
  if (emis > 0.0) {
    float fr = pow(max(dot(n,-uCamF),0.0), 1.5);
    vec3 g = alb*(0.95 + 0.55*fr) + vec3(0.10,0.035,0.0)*fr;
    col = mix(col, g, clamp(emis*uEmis,0.0,1.0));
  }
  vec3 ink = mix(vec3(0.17,0.145,0.09), alb*0.28, 0.40);
  oCol = vec4(col, 1.0);
  oGeo = vec4(n, t);
  oInk = vec4(ink, gInkA);
}
