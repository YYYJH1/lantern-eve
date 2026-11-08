// ===================== figures =====================
// Local frame: feet at origin, +y up, +z the way the figure faces, +x = the figure's left hand.
// Material slots: 0 skin 1 hair 2 clothA 3 clothB 4 trim 5 shoe 6 wood 7 propX 8 propY 9 glow
//                 10 ink(eye) 11 blush 12 red 13 cream 14 gold 15 bamboo/straw
const float HR = 0.2;

vec3 faceLoc(vec3 q, vec2 sxy, float R, float sink){
  vec3 n = normalize(vec3(sxy, sqrt(max(1.0-dot(sxy,sxy),0.02))));
  vec3 t1 = normalize(vec3(n.z, 0.0, -n.x));
  vec3 t2 = cross(n, t1);
  vec3 d = q - n*(R - sink);
  return vec3(dot(d,t1), dot(d,t2), dot(d,n));
}
float sdHead(vec3 q){ return sdEll(q, vec3(HR*1.02, HR*0.97, HR)); }
float sdHairShell(vec3 q, float thick, vec3 n, float off){
  float e = sdEll(q, vec3((HR+thick)*1.02, (HR+thick)*0.97, HR+thick));
  return smax(e, off - dot(q, normalize(n)), 0.014);
}
// eyes, brows, mouth, blush.  eyeP/brow/blush are (sin x, sin y) of the direction on the head sphere
vec2 faceParts(vec3 q, vec2 eyeP, vec2 eyeR, vec3 brow, float browMat, vec2 mouth, vec2 blushP, int lod){
  vec3 qs = vec3(abs(q.x), q.y, q.z);
  vec3 le = faceLoc(qs, eyeP + vec2(0.02,0.0), HR, 0.011);
  vec2 r = vec2(sdEll(le, vec3(eyeR*1.16, 0.017)), 10.0);
  if (lod < 1) {
    r = U(r, vec2(sdSphere(le - vec3(-0.28*eyeR.x, 0.40*eyeR.y, 0.010), 0.0072), 13.0));
    vec3 lb = faceLoc(qs, brow.xy, HR, 0.006); lb.xy = rot2(lb.xy, brow.z);
    r = U(r, vec2(sdEll(lb, vec3(0.030, 0.0068, 0.011)), browMat));
    vec3 lm = faceLoc(q, vec2(0.0, mouth.x), HR, 0.004); lm.y -= 20.0*lm.x*lm.x;
    r = U(r, vec2(sdEll(lm, vec3(mouth.y*1.25, 0.0062, 0.010)), 10.0));
    vec3 lc = faceLoc(qs, blushP, HR, 0.004);
    r = U(r, vec2(sdEll(lc, vec3(0.030, 0.018, 0.011)), 11.0));
  }
  return r;
}
float sdEars(vec3 q){ vec3 qe = vec3(abs(q.x)-HR*0.95, q.y+0.015, q.z+0.005); return sdEll(qe, vec3(0.03,0.04,0.03)); }

vec2 shoes(vec3 p, vec3 fL, vec3 fR, float m){
  float d1 = sdRBox(p - fL - vec3(0.0,0.0,0.028), vec3(0.047,0.032,0.072), 0.027);
  float d2 = sdRBox(p - fR - vec3(0.0,0.0,0.028), vec3(0.047,0.032,0.072), 0.027);
  return vec2(min(d1,d2), m);
}
vec2 arm(vec3 p, vec3 s, vec3 e, vec3 w, float r0, float r1, float mUp, float mLo, float rh){
  float rm = 0.5*(r0+r1);
  vec2 a = vec2(sdRoundCone(p, s, e, r0, rm), mUp);
  vec2 b = vec2(sdRoundCone(p, e, w, rm, r1), mLo);
  vec2 r = SU(a, b, 0.015);
  return U(r, vec2(sdSphere(p-w, rh), 0.0));
}
vec2 lantern(vec3 q, float R, float H, float mb, int lod){
  float body = sdEll(q, vec3(R,H,R));
  if (lod < 1) body += 0.0042*sin(q.y/H*PI*6.0);
  vec2 r = vec2(body, mb);
  r = U(r, vec2(sdCylY(q - vec3(0.0,H*0.93,0.0), 0.016, R*0.55), 14.0));
  r = U(r, vec2(sdCylY(q + vec3(0.0,H*0.93,0.0), 0.016, R*0.55), 14.0));
  if (lod < 1) {
    r = U(r, vec2(sdCap(q, vec3(0.0,-H*0.95,0.0), vec3(0.0,-H*1.55,0.0), 0.006), 12.0));
    r = U(r, vec2(sdSphere(q - vec3(0.0,-H*1.62,0.0), 0.017), 14.0));
  }
  return r;
}
vec2 bundle(vec3 p, vec3 a, vec3 b, int lod){
  vec3 ba=b-a; float L=length(ba); vec3 d=ba/L; vec3 q=p-a; float t=dot(q,d); vec3 perp=q-d*t;
  float db = max(length(perp)-0.13, max(-t, t-L));
  if (db > 0.06) return vec2(db, 15.0);
  vec3 u = normalize(cross(d, vec3(0.0,1.0,0.0))); vec3 v = cross(d,u);
  vec2 c = vec2(dot(perp,u), dot(perp,v));
  float ang = atan(c.y,c.x); float sec = 2.0*PI/5.0; ang = (fract(ang/sec+0.5)-0.5)*sec;
  vec2 cc = length(c)*vec2(cos(ang), sin(ang));
  float dp = min(length(cc - vec2(0.048,0.0)), length(c)) - 0.0235;
  float de = max(-t, t-L);
  float dpoles = length(vec2(max(dp,0.0), max(de,0.0))) + min(max(dp,de),0.0);
  vec2 r = vec2(dpoles, 15.0);
  float rope = max(length(perp)-0.082, abs(t-L*0.38)-0.026);
  rope = min(rope, max(length(perp)-0.082, abs(t-L*0.66)-0.026));
  r = U(r, vec2(rope, 13.0));
  return r;
}
vec2 teapot(vec3 q, int lod){
  float body = sdEll(q, vec3(0.074, 0.062, 0.074));
  float spout = sdRoundCone(q, vec3(0.055,-0.012,0.0), vec3(0.138,0.052,0.0), 0.027, 0.012);
  vec3 hq = q - vec3(-0.088,0.008,0.0);
  float handle = length(vec2(length(hq.xy) - 0.043, hq.z)) - 0.0115;
  vec2 r = vec2(min(smin(body, spout, 0.02), handle), 7.0);
  r = U(r, vec2(sdEll(q - vec3(0.0,0.058,0.0), vec3(0.042,0.021,0.042)), 8.0));
  r = U(r, vec2(sdSphere(q - vec3(0.0,0.082,0.0), 0.014), 8.0));
  return r;
}
vec2 abacus(vec3 q, int lod){
  float fr = sdRBox(q, vec3(0.120,0.076,0.017), 0.009);
  fr = max(fr, -sdBox(q, vec3(0.100,0.057,0.05)));
  vec2 r = vec2(fr, 6.0);
  r = U(r, vec2(sdCap(q, vec3(-0.10,0.02,0.0), vec3(0.10,0.02,0.0), 0.0045), 6.0));
  if (lod < 1) {
    float ix = clamp(floor(q.x/0.03+0.5), -3.0, 3.0);
    vec3 rq = vec3(q.x - ix*0.03, q.y, q.z);
    r = U(r, vec2(sdCap(rq, vec3(0.0,-0.06,0.0), vec3(0.0,0.06,0.0), 0.0032), 6.0));
    float sl = 0.013*step(0.5, hash11(ix+3.0));
    float bu = min(sdEll(rq - vec3(0.0,0.034+sl,0.0), vec3(0.0135,0.0105,0.0105)), sdEll(rq - vec3(0.0,0.0565+sl,0.0), vec3(0.0135,0.0105,0.0105)));
    float bl = 1e5;
    for (int k=0;k<4;k++) bl = min(bl, sdEll(rq - vec3(0.0,0.0-0.0085-0.0225*float(k)+0.0*sl,0.0), vec3(0.0135,0.0105,0.0105)));
    r = U(r, vec2(min(bu,bl), 8.0));
  }
  return r;
}

const float HEADBACK = 0.30;          // heads lean back so that the face shows from the high camera
// Poses. wk = walk amplitude (0 idle/talk, 1 walk), ph = phase, pz = pose (0 idle/walk, 1 talk).
// Idle breathes (the body rises 0.016 on the second frame); talk nods (the head dips and the body sinks a little).
vec3 walkBody(vec3 p, float ph, float wk, float pz){
  float s = sin(ph)*wk;
  float bob = 0.028*abs(sin(ph))*wk;
  if (wk < 0.5) { float b = 0.5 - 0.5*cos(ph); bob = (pz < 0.5) ? 0.016*b : -0.012*b; }
  vec3 q = p - vec3(0.0, bob, 0.0);
  q.x -= 0.032*s*clamp(q.y, 0.0, 1.1);
  return q;
}
float nodOf(float ph, float wk, float pz){ return (wk < 0.5 && pz > 0.5) ? 0.17*(0.5 - 0.5*cos(ph)) : 0.0; }

// ---------------- 0: Li laotai (old woman, stooped, cane) ----------------
vec2 fig0(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.27;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.20,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.07,0.034+0.075*max(c,0.),0.03+0.12*s), vec3(-0.07,0.034+0.075*max(-c,0.),0.03-0.12*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.07,0.21,0.0), vec3(0.07,0.06,0.03+0.12*s), 0.046), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.07,0.21,0.0), vec3(-0.07,0.06,0.03-0.12*s), 0.046), 3.0));
  r = U(r, vec2(sdRobe(pv, 0.085, 0.30, 0.172, 0.15, 0.03), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.19, 0.585, 0.17, 0.118, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.102, 0.016), 13.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pb-vec3(0,0.205,0.0), 0.165, 0.011), 4.0));
    for (int i=0;i<3;i++) r = U(r, vec2(sdSphere(pb-vec3(0.0,0.50-0.085*float(i),0.0)-vec3(0,0,0.12+0.012*float(i)), 0.0125), 13.0));
  }
  vec3 SR = toBase(vec3(-0.14,0.50,0.0), piv, lean), SL = toBase(vec3(0.14,0.50,0.0), piv, lean);
  float cz = 0.05*s;
  vec3 HRh = vec3(-0.19,0.315,0.165+cz);
  r = U(r, arm(pv, SR, vec3(-0.235,0.41,0.10+0.5*cz), HRh, 0.048, 0.040, 2.0, 2.0, 0.043));
  vec3 HLh = vec3(0.115,0.265+0.0*s,-0.115);
  r = U(r, arm(pv, SL, vec3(0.20,0.36,-0.07), HLh, 0.048, 0.040, 2.0, 2.0, 0.043));
  // cane
  r = U(r, vec2(sdCap(pv, vec3(-0.205,-0.03*wk,0.19+2.0*cz), vec3(-0.19,0.365,0.165+cz), 0.0145), 6.0));
  r = U(r, vec2(sdCap(pv, vec3(-0.19,0.365,0.165+cz), vec3(-0.19,0.382,0.218+cz), 0.0165), 6.0));
  r = U(r, vec2(sdSphere(pv - vec3(-0.19,0.382,0.222+cz), 0.024), 6.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.02);
  vec3 hq = toBody(pb, hc, 0.04 + nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.06);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.9,-0.4), 0.0);
  hair = smin(hair, sdSphere(hq - vec3(-0.02,-0.03,-0.215), 0.10), 0.03);
  r = U(r, vec2(hair, 1.0));
  if (lod < 1) {
    r = U(r, vec2(sdCap(hq, vec3(-0.14,-0.015,-0.245), vec3(0.12,-0.075,-0.19), 0.0115), 14.0));
    r = U(r, vec2(sdSphere(hq - vec3(-0.15,-0.012,-0.248), 0.024), 14.0));
  }
  r = U(r, faceParts(hq, vec2(0.37,-0.17), vec2(0.0195,0.025), vec3(0.37,0.10,0.14), 1.0, vec2(-0.52,0.024), vec2(0.62,-0.38), lod));
  return r;
}

// ---------------- 1: Li Da (sturdy young man, bamboo bundle) ----------------
vec2 fig1(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.085,0.034+0.075*max(c,0.),0.03+0.155*s), vec3(-0.085,0.034+0.075*max(-c,0.),0.03-0.155*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.085,0.22,0.0), vec3(0.085,0.06,0.03+0.155*s), 0.06), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.085,0.22,0.0), vec3(-0.085,0.06,0.03-0.155*s), 0.06), 3.0));
  r = SU(r, vec2(sdEll(pv-vec3(0.0,0.21,0.0), vec3(0.165,0.085,0.125)), 3.0), 0.03);
  r = U(r, vec2(sdRoundCone(pv, vec3(0,0.215,0), vec3(0,0.50,0), 0.172, 0.150), 2.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.575,0.0), 0.118, 0.018), 13.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.25,0.0), 0.178, 0.021), 4.0));
    r = U(r, vec2(sdSphere(pv-vec3(0.075,0.245,0.172), 0.034), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(0.075,0.245,0.172), vec3(0.09,0.15,0.17), 0.016), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(0.075,0.245,0.172), vec3(0.04,0.15,0.18), 0.014), 4.0));
  }
  vec3 SR = vec3(-0.165,0.495,0.0), SL = vec3(0.165,0.495,0.0);
  if (vr > 0.5) {                      // carry: the right hand steadies the bamboo bundle on the shoulder
    r = U(r, arm(pv, SR, vec3(-0.255,0.545,0.03), vec3(-0.20,0.635,0.07), 0.064, 0.052, 2.0, 0.0, 0.056));
    r = U(r, bundle(pv, vec3(0.05,0.82,-0.60), vec3(-0.30,0.57,0.44), lod));
  } else {
    r = U(r, arm(pv, SR, vec3(-0.245,0.39,0.0), vec3(-0.215,0.29,0.05+0.135*s), 0.064, 0.052, 2.0, 0.0, 0.056));
  }
  r = U(r, arm(pv, SL, vec3(0.245,0.39,0.0), vec3(0.215,0.29,0.05-0.135*s), 0.064, 0.052, 2.0, 0.0, 0.056));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc;
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.016, vec3(0.0,0.82,-0.30), 0.0);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.135), vec3(0.150,0.050,0.072)), 0.03);
  r = U(r, vec2(hair, 1.0));
  r = U(r, faceParts(hq, vec2(0.38,-0.14), vec2(0.0185,0.024), vec3(0.37,0.12,-0.22), 1.0, vec2(-0.55,0.026), vec2(0.64,-0.36), lod));
  return r;
}

// ---------------- 2: Li Er (slim young man, topknot, small paper lantern) ----------------
vec2 fig2(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = -0.04;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.068,0.034+0.075*max(c,0.),0.03+0.155*s), vec3(-0.068,0.034+0.075*max(-c,0.),0.03-0.155*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.062,0.22,0.0), vec3(0.066,0.06,0.03+0.155*s), 0.04), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.062,0.22,0.0), vec3(-0.066,0.06,0.03-0.155*s), 0.04), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.115, 0.585, 0.158, 0.108, 0.045), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.095, 0.015), 13.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pb-vec3(0,0.30,0.0), 0.134, 0.017), 13.0));
    r = U(r, vec2(sdCap(pb, vec3(0.04,0.30,0.135), vec3(0.06,0.17,0.14), 0.013), 13.0));
    r = U(r, vec2(sdCap(pb, vec3(0.04,0.30,0.135), vec3(0.02,0.18,0.15), 0.011), 13.0));
  }
  vec3 SR = toBase(vec3(-0.12,0.50,0.0), piv, lean), SL = toBase(vec3(0.12,0.50,0.0), piv, lean);
  if (vr < 0.5) {
    vec3 HLh = vec3(0.30,0.53,0.04);
    r = U(r, arm(pv, SL, vec3(0.25,0.43,0.0), HLh, 0.042, 0.036, 2.0, 2.0, 0.040));
    r = U(r, arm(pv, SR, vec3(-0.19,0.40,0.0), vec3(-0.165,0.29,0.04-0.135*s), 0.042, 0.036, 2.0, 2.0, 0.040));
    // lantern hanging from the raised left hand on a string
    r = U(r, vec2(sdCap(pv, HLh + vec3(0.0,-0.02,0.0), HLh + vec3(0.0,-0.085,0.0), 0.0045), 6.0));
    r = U(r, lantern(pv - (HLh + vec3(0.0,-0.085-0.092,0.0)), 0.075, 0.092, 9.0, lod));
  } else {
    r = U(r, arm(pv, SL, vec3(0.19,0.40,0.0), vec3(0.165,0.29,0.04+0.135*s), 0.042, 0.036, 2.0, 2.0, 0.040));
    r = U(r, arm(pv, SR, vec3(-0.19,0.40,0.0), vec3(-0.165,0.29,0.04-0.135*s), 0.042, 0.036, 2.0, 2.0, 0.040));
  }
  // head
  vec3 hc = vec3(0.0,0.80,0.0) + vec3(0.0, 0.0, -0.01);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, -0.07);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.86,-0.42), 0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.135,0.125), vec3(0.135,0.042,0.065)), 0.03);
  float knot = smin(sdSphere(hq - vec3(0.0,0.235,-0.045), 0.062), sdCap(hq, vec3(0.0,0.17,-0.03), vec3(0.0,0.215,-0.045), 0.05), 0.03);
  r = U(r, vec2(min(hair, knot), 1.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus((hq - vec3(0.0,0.2,-0.04)), 0.05, 0.013), 7.0));
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.2,-0.085), vec3(0.03,0.04,-0.215), 0.011), 7.0));
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.2,-0.085), vec3(-0.035,0.06,-0.205), 0.011), 7.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.022,0.031), vec3(0.37,0.13,0.0), 1.0, vec2(-0.54,0.026), vec2(0.63,-0.37), lod));
  return r;
}

// ---------------- 3: Zhou zhanggui (shopkeeper, round cap, abacus) ----------------
vec2 fig3(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = -0.035;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.075,0.034+0.075*max(c,0.),0.04+0.12*s), vec3(-0.075,0.034+0.075*max(-c,0.),0.04-0.12*s), 5.0));
  vec2 robe = vec2(sdRobe(pb, 0.07, 0.585, 0.215, 0.125, 0.045), 2.0);
  robe = SU(robe, vec2(sdEll(pb-vec3(0.0,0.30,0.035), vec3(0.19,0.17,0.19)), 2.0), 0.09);
  r = U(r, robe);
  r = U(r, vec2(sdTorus(pb-vec3(0,0.573,0.0), 0.108, 0.02), 13.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pb-vec3(0,0.31,0.03), 0.196, 0.022), 4.0));
    r = U(r, vec2(sdTorus(pb-vec3(0,0.092,0.0), 0.205, 0.015), 4.0));
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.55,0.12), vec3(0.0,0.12,0.225), 0.009), 4.0));
  }
  vec3 SR = toBase(vec3(-0.145,0.50,0.0), piv, lean), SL = toBase(vec3(0.145,0.50,0.0), piv, lean);
  vec3 HRh = vec3(-0.135,0.355,0.215), HLh = vec3(0.115,0.35,0.215);
  r = U(r, arm(pv, SR, vec3(-0.235,0.395,0.09), HRh, 0.055, 0.048, 2.0, 2.0, 0.044));
  r = U(r, arm(pv, SL, vec3(0.225,0.40,0.10), HLh, 0.055, 0.048, 2.0, 2.0, 0.044));
  // abacus
  vec3 aq = (pv - vec3(-0.01,0.36,0.245)); aq.yz = rot2(aq.yz, 0.55); aq /= 1.28;
  float dab = sdBox(aq, vec3(0.14,0.10,0.04));
  if (dab < 0.1) { vec2 ab = abacus(aq, lod); ab.x *= 1.28; r = U(r, ab); } else r = U(r, vec2(dab*1.28, 6.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.03);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float cap = sdHairShell(hq, 0.016, vec3(0.0,1.0,-0.12), 0.07);
  r = U(r, vec2(cap, 7.0));
  r = U(r, vec2(sdSphere(hq - vec3(0.0,0.212,-0.02), 0.022), 12.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(hq - vec3(0.0,0.082,0.0)+vec3(0,0,0), 0.188, 0.012), 4.0));
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    r = U(r, vec2(sdCap(qs, vec3(0.004,-0.074,0.189), vec3(0.048,-0.088,0.178), 0.0082), 1.0));
    r = U(r, vec2(sdEll(hq - vec3(0.0,-0.16,0.14), vec3(0.03,0.02,0.03)), 1.0));
  }
  r = U(r, faceParts(hq, vec2(0.35,-0.17), vec2(0.0175,0.022), vec3(0.36,0.06,-0.1), 1.0, vec2(-0.66,0.024), vec2(0.66,-0.40), lod));
  return r;
}

// ---------------- 4: Lao He (boatman, conical straw hat, punting pole) ----------------
vec2 fig4(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.08;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  vec3 fL = vec3(0.088,0.034+0.075*max(c,0.),0.02+0.155*s), fR = vec3(-0.088,0.034+0.075*max(-c,0.),0.02-0.155*s);
  float sandals = min(sdRBox(p - fL - vec3(0,-0.012,0.03), vec3(0.047,0.02,0.075), 0.018), sdRBox(p - fR - vec3(0,-0.012,0.03), vec3(0.047,0.02,0.075), 0.018));
  r = U(r, vec2(sandals, 15.0));
  float footL = sdEll(p - fL - vec3(0,0.004,0.03), vec3(0.04,0.03,0.062)), footR = sdEll(p - fR - vec3(0,0.004,0.03), vec3(0.04,0.03,0.062));
  r = U(r, vec2(min(footL, footR), 0.0));
  vec3 kL = vec3(0.086,0.125,0.01+0.05*s), kR = vec3(-0.086,0.125,0.01-0.05*s);
  r = U(r, vec2(sdCap(p, vec3(0.08,0.22,0.0), kL, 0.058), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.08,0.22,0.0), kR, 0.058), 3.0));
  r = U(r, vec2(sdCap(p, kL, vec3(0.088,0.06,0.02+0.155*s), 0.043), 0.0));
  r = U(r, vec2(sdCap(p, kR, vec3(-0.088,0.06,0.02-0.155*s), 0.043), 0.0));
  r = U(r, vec2(sdRobe(pb, 0.17, 0.585, 0.172, 0.12, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.105, 0.017), 13.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pb-vec3(0,0.28,0.0), 0.152, 0.02), 4.0));
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.55,0.115), vec3(0.0,0.30,0.15), 0.008), 4.0));
  }
  vec3 SR = toBase(vec3(-0.145,0.50,0.0), piv, lean), SL = toBase(vec3(0.145,0.50,0.0), piv, lean);
  vec3 HRh = vec3(-0.30,0.60,0.03), HLh = vec3(-0.30,0.40,0.04);
  r = U(r, arm(pv, SR, vec3(-0.30,0.47,-0.02), HRh, 0.052, 0.042, 2.0, 0.0, 0.047));
  r = U(r, arm(pv, SL, vec3(0.05,0.36,0.17), HLh, 0.052, 0.042, 2.0, 0.0, 0.047));
  // pole
  r = U(r, vec2(sdCap(pv, vec3(-0.30,-0.03*wk,0.07+0.12*s), vec3(-0.33,1.32,-0.04), 0.0165), 6.0));
  if (lod < 1) r = U(r, vec2(sdSphere(pv - vec3(-0.33,1.325,-0.04), 0.02), 6.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.02);
  vec3 hq = toBody(pb, hc, 0.06 + nod - HEADBACK) - hc;
  float bh = length(hq) - 0.5;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.012, vec3(0.0,0.2,-1.0), 0.05), 1.0));
  vec3 hh = hq - vec3(0.0,0.185,-0.035);
  hh = vec3(hh.x, hh.y*cos(0.42) - hh.z*sin(0.42), hh.y*sin(0.42) + hh.z*cos(0.42));
  float hat = sdCCone(hh, 0.068, 0.295, 0.012) - 0.012;
  r = U(r, vec2(hat, 15.0));
  r = U(r, vec2(sdTorus(hh - vec3(0.0,-0.068,0.0), 0.285, 0.011), 6.0));
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    r = U(r, vec2(sdCap(qs, vec3(0.255,0.12,-0.02), vec3(0.09,-0.165,0.09), 0.0055), 6.0));
    r = U(r, vec2(sdEll(hq - vec3(0.0,-0.168,0.135), vec3(0.052,0.052,0.04)), 1.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.13), vec2(0.0165,0.02), vec3(0.37,0.07,-0.28), 1.0, vec2(-0.52,0.022), vec2(0.62,-0.34), lod));
  return r;
}

// ---------------- 5: Teahouse owner (bun + flower, apron, teapot) ----------------
vec2 fig5(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.07,0.034+0.075*max(c,0.),0.035+0.135*s), vec3(-0.07,0.034+0.075*max(-c,0.),0.035-0.135*s), 5.0));
  r = U(r, vec2(sdRobe(pv, 0.07, 0.585, 0.215, 0.12, 0.045), 2.0));
  // apron on the front of the dress
  float aw = mix(0.155, 0.088, sat((pv.y-0.10)/0.44));
  float ap = sdRobe(pv, 0.085, 0.575, 0.227, 0.132, 0.045);
  ap = max(ap, max(abs(pv.x)-aw, max(-(pv.z-0.04), pv.y-0.56)));
  r = U(r, vec2(ap, 13.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.572,0.0), 0.10, 0.014), 4.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.30,0.0), 0.168, 0.012), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(-0.07,0.54,0.11), vec3(-0.04,0.50,0.13), 0.009), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(0.07,0.54,0.11), vec3(0.04,0.50,0.13), 0.009), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.30,-0.17), vec3(0.04,0.2,-0.19), 0.012), 13.0));
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.30,-0.17), vec3(-0.04,0.21,-0.2), 0.012), 13.0));
  }
  vec3 SR = vec3(-0.138,0.50,0.0), SL = vec3(0.138,0.50,0.0);
  vec3 P0 = vec3(-0.07,0.315,0.218);
  r = U(r, arm(pv, SR, vec3(-0.215,0.395,0.09), P0+vec3(-0.12,0.0,0.0), 0.047, 0.040, 2.0, 0.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.19,0.37,0.06), P0+vec3(0.0,-0.07,-0.01), 0.047, 0.040, 2.0, 0.0, 0.042));
  // teapot (spout toward +x)
  vec3 tq = pv - P0; tq.xy = rot2(tq.xy, -0.10);
  float dtp = length(tq) - 0.22;
  if (dtp < 0.08) r = U(r, teapot(tq, lod)); else r = U(r, vec2(dtp, 7.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.08);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.75,-0.55), -0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.13), vec3(0.15,0.052,0.075)), 0.03);
  hair = smin(hair, sdSphere(hq - vec3(0.02,0.195,-0.085), 0.098), 0.04);
  r = U(r, vec2(hair, 1.0));
  if (lod < 1) {
    vec3 fq = hq - vec3(-0.10,0.205,-0.015);
    float pet = 1e5;
    for (int i=0;i<5;i++){ float a = float(i)*1.2566; pet = min(pet, sdEll(fq - vec3(cos(a),sin(a),0.0)*0.032 - vec3(0,0,0.03), vec3(0.027,0.027,0.017))); }
    r = U(r, vec2(pet, 12.0));
    r = U(r, vec2(sdSphere(fq - vec3(0,0,0.05), 0.017), 14.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.021,0.0295), vec3(0.37,0.11,0.12), 1.0, vec2(-0.54,0.026), vec2(0.62,-0.36), lod));
  return r;
}

// ---------------- 6: Zongguan (the player: green robe, gold trim, square cap, red lantern) ----------------
vec2 fig6(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.075,0.034+0.075*max(c,0.),0.035+0.155*s), vec3(-0.075,0.034+0.075*max(-c,0.),0.035-0.155*s), 5.0));
  r = U(r, vec2(sdRobe(pv, 0.075, 0.585, 0.215, 0.125, 0.045), 2.0));
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.105,0), 0.205, 0.015), 14.0));
    r = U(r, vec2(sdTorus(pv-vec3(0,0.31,0), 0.171, 0.02), 14.0));
    r = U(r, vec2(sdSphere(pv-vec3(0,0.31,0.171), 0.029), 14.0));
    r = U(r, vec2(sdCap(pv, vec3(0,0.545,0.118), vec3(0,0.12,0.208), 0.011), 14.0));
  }
  r = U(r, vec2(sdTorus(pv-vec3(0,0.572,0.0), 0.11, 0.022), 14.0));
  vec3 SR = vec3(-0.145,0.50,0.0), SL = vec3(0.145,0.50,0.0);
  vec3 HRh = vec3(-0.26,0.455,0.02);
  vec2 aR = arm(pv, SR, vec3(-0.23,0.40,0.0), HRh, 0.058, 0.050, 2.0, 2.0, 0.044);
  r = U(r, aR);
  r = U(r, vec2(sdCap(pv, vec3(-0.238,0.42,0.0), HRh + vec3(0.0,0.0,-0.0), 0.058), 14.0));
  vec2 aL = arm(pv, SL, vec3(0.215,0.38,-0.01), vec3(0.20,0.26,0.05-0.135*s), 0.058, 0.050, 2.0, 2.0, 0.044);
  r = U(r, aL);
  r = U(r, vec2(sdCap(pv, vec3(0.207,0.30,0.03), vec3(0.20,0.26,0.05-0.135*s), 0.057), 14.0));
  // lantern on a stick
  vec3 tip = vec3(-0.43,0.72,-0.03);
  r = U(r, vec2(sdCap(pv, vec3(-0.235,0.40,0.02), tip, 0.0125), 6.0));
  r = U(r, vec2(sdCap(pv, tip, tip - vec3(0.0,0.05,0.0), 0.005), 6.0));
  r = U(r, lantern(pv - (tip - vec3(0.0,0.05+0.125,0.0)), 0.098, 0.12, 9.0, lod));
  // head
  vec3 hc = vec3(0.0,0.805,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc;
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.012, vec3(0.0,0.5,-0.85), -0.03), 1.0));
  float capb = sdRBox(hq - vec3(0.0,0.185,-0.012), vec3(0.168,0.078,0.156), 0.036);
  r = U(r, vec2(capb, 8.0));
  r = U(r, vec2(sdRBox(hq - vec3(0.0,0.118,-0.012), vec3(0.175,0.016,0.162), 0.014), 14.0));
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    r = U(r, vec2(sdCap(qs, vec3(0.055,0.14,-0.15), vec3(0.075,-0.06,-0.19), 0.0115), 8.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.17), vec2(0.0195,0.0265), vec3(0.37,0.07,-0.18), 1.0, vec2(-0.54,0.024), vec2(0.62,-0.38), lod));
  return r;
}


// ---------------- 7: Zhou shop clerk (ochre jacket, short apron, soft cloth cap, ledger) ----------------
vec2 fig7(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.045;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.072,0.034+0.075*max(c,0.),0.03+0.155*s), vec3(-0.072,0.034+0.075*max(-c,0.),0.03-0.155*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.068,0.23,0.0), vec3(0.072,0.06,0.03+0.155*s), 0.047), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.068,0.23,0.0), vec3(-0.072,0.06,0.03-0.155*s), 0.047), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.205, 0.585, 0.158, 0.118, 0.05), 2.0));                       // short jacket
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.10, 0.016), 13.0));
  // short apron: a curved panel that hangs from the waist to above the knees
  float ap = max(abs(length(pb.xz) - 0.168) - 0.008, max(abs(pb.y - 0.215) - 0.135, max(abs(pb.x) - 0.118, -(pb.z - 0.04))));
  r = U(r, vec2(ap, 13.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.345,0.0), 0.168, 0.014), 4.0));                         // waist tie
  if (lod < 1) {
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.345,-0.168), vec3(0.03,0.22,-0.19), 0.011), 4.0));
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.345,-0.168), vec3(-0.03,0.23,-0.185), 0.011), 4.0));
  }
  vec3 SR = toBase(vec3(-0.128,0.50,0.0), piv, lean), SL = toBase(vec3(0.128,0.50,0.0), piv, lean);
  vec3 HLh = vec3(0.17,0.35,0.15);
  r = U(r, arm(pv, SL, vec3(0.215,0.40,0.07), HLh, 0.052, 0.044, 2.0, 0.0, 0.046));
  r = U(r, arm(pv, SR, vec3(-0.20,0.40,0.0), vec3(-0.175,0.29,0.04-0.135*s), 0.052, 0.044, 2.0, 0.0, 0.046));
  vec3 lq = pv - (HLh + vec3(0.0,0.045,0.04)); lq.yz = rot2(lq.yz, 0.55); lq.xz = rot2(lq.xz, 0.35);
  float dled = length(lq) - 0.13;
  if (dled < 0.08) { r = U(r, vec2(sdRBox(lq, vec3(0.052,0.072,0.016), 0.008), 6.0)); r = U(r, vec2(sdRBox(lq - vec3(0.005,0.0,0.012), vec3(0.046,0.066,0.008), 0.004), 13.0)); }
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.05);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.012, vec3(0.0,0.82,-0.50), -0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.115,0.13), vec3(0.14,0.04,0.066)), 0.03);
  r = U(r, vec2(hair, 1.0));
  // soft cloth cap with a rolled rim and a little tail at the back
  float cap = smax(sdEll(hq - vec3(0.0,0.02,-0.012), vec3(0.216,0.205,0.216)), 0.07 - hq.y, 0.02);
  r = U(r, vec2(cap, 7.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.072,-0.004), 0.196, 0.021), 8.0));
  r = U(r, vec2(sdEll(hq - vec3(0.0,0.10,-0.215), vec3(0.07,0.055,0.04)), 7.0));
  r = U(r, faceParts(hq, vec2(0.37,-0.15), vec2(0.0205,0.028), vec3(0.37,0.10,0.02), 1.0, vec2(-0.54,0.026), vec2(0.63,-0.37), lod));
  return r;
}

// ---------------- 8: the clan elder (tall, dark robe, long grey beard, staff) ----------------
vec2 fig8(vec3 p, int lod, float wk0, float ph, float vr, float pz){
  float wk = wk0*0.82;                                   // a slower walk
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = -0.03;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk0, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.075,0.034+0.07*max(c,0.),0.04+0.12*s), vec3(-0.075,0.034+0.07*max(-c,0.),0.04-0.12*s), 5.0));
  r = U(r, vec2(sdRobe(pb, 0.07, 0.605, 0.228, 0.128, 0.05), 2.0));                          // long dark robe
  r = U(r, vec2(sdTorus(pb-vec3(0,0.594,0.0), 0.112, 0.022), 4.0));                          // collar
  if (lod < 1) {
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.57,0.122), vec3(0.0,0.10,0.224), 0.011), 4.0));       // front placket
    r = U(r, vec2(sdTorus(pb-vec3(0,0.10,0.0), 0.218, 0.014), 4.0));                         // hem band
    r = U(r, vec2(sdTorus(pb-vec3(0,0.335,0.0), 0.172, 0.027), 12.0));                       // sash
    r = U(r, vec2(sdCap(pb, vec3(0.10,0.31,0.17), vec3(0.11,0.20,0.19), 0.006), 4.0));
    r = U(r, vec2(sdEll(pb - vec3(0.11,0.18,0.192), vec3(0.020,0.030,0.014)), 8.0));         // jade pendant
  }
  vec3 SR = toBase(vec3(-0.145,0.51,0.0), piv, lean), SL = toBase(vec3(0.145,0.51,0.0), piv, lean);
  float cz = 0.045*s;
  vec3 HRh = vec3(-0.215,0.46,0.20+cz);
  r = U(r, arm(pv, SR, vec3(-0.23,0.43,0.10+0.5*cz), HRh, 0.058, 0.050, 2.0, 2.0, 0.045));
  r = U(r, vec2(sdCap(pv, HRh + vec3(0.004,0.01,-0.07), HRh + vec3(0.0,0.0,-0.012), 0.056), 4.0));    // cuff
  r = U(r, arm(pv, SL, vec3(0.22,0.40,0.09), vec3(0.075,0.345,0.185), 0.058, 0.050, 2.0, 2.0, 0.044));   // hand rests at the sash
  // staff with a carved head
  r = U(r, vec2(sdCap(pv, vec3(-0.222,-0.03*wk0,0.215+2.0*cz), vec3(-0.212,1.00,0.20+cz), 0.0175), 6.0));
  r = U(r, vec2(sdSphere(pv - vec3(-0.212,1.035,0.20+cz), 0.042), 6.0));
  r = U(r, vec2(sdEll(pv - vec3(-0.212,1.05,0.226+cz), vec3(0.020,0.022,0.030)), 6.0));
  r = U(r, vec2(sdTorus(pv - vec3(-0.212,0.955,0.20+cz), 0.026, 0.0095), 14.0));
  // head
  vec3 hc = vec3(0.0,0.84,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc;
  vec3 hb = toBody(pb, hc, nod - 0.02) - hc;
  float bh = length(hq) - 0.62;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.013, vec3(0.0,0.62,-0.78), -0.06), 1.0));               // grey hair at the sides and back
  float hat = sdHairShell(hq, 0.018, vec3(0.0,1.0,-0.16), 0.125);                          // small black cap
  r = U(r, vec2(hat, 7.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.136,-0.012), 0.168, 0.0115), 14.0));
  r = U(r, vec2(sdSphere(hq - vec3(0.0,0.222,-0.005), 0.026), 14.0));
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    // long beard and moustache
    vec3 bs = vec3(abs(hb.x), hb.y, hb.z);
    float beard = sdRoundCone(hb, vec3(0.0,-0.115,0.135), vec3(0.0,-0.36,0.19), 0.092, 0.028);
    beard = smin(beard, sdEll(bs - vec3(0.125,-0.07,0.085), vec3(0.055,0.10,0.07)), 0.05);
    r = U(r, vec2(beard, 1.0));
    r = U(r, vec2(sdCap(qs, vec3(0.004,-0.072,0.188), vec3(0.075,-0.098,0.162), 0.0155), 1.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.12), vec2(0.0165,0.0185), vec3(0.37,0.085,-0.28), 1.0, vec2(-0.56,0.020), vec2(0.62,-0.34), lod));
  return r;
}

// ---------------- 9: townsman (plain grey-blue jacket, dark trousers, short hair, rolled sleeves, no props) ----------------
vec2 fig9(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.025;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.078,0.034+0.075*max(c,0.),0.03+0.14*s), vec3(-0.078,0.034+0.075*max(-c,0.),0.03-0.14*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.074,0.23,0.0), vec3(0.078,0.06,0.03+0.14*s), 0.052), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.074,0.23,0.0), vec3(-0.078,0.06,0.03-0.14*s), 0.052), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.19, 0.585, 0.17, 0.122, 0.05), 2.0));                        // plain jacket
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.104, 0.016), 4.0));                       // collar
  if (lod < 1) r = U(r, vec2(sdTorus(pb-vec3(0,0.25,0.0), 0.176, 0.015), 4.0));           // a cloth belt
  vec3 SR = toBase(vec3(-0.13,0.50,0.0), piv, lean), SL = toBase(vec3(0.13,0.50,0.0), piv, lean);
  r = U(r, arm(pv, SR, vec3(-0.222,0.40,0.0), vec3(-0.195,0.295,0.05+0.12*s), 0.056, 0.047, 2.0, 0.0, 0.048));
  r = U(r, arm(pv, SL, vec3(0.222,0.40,0.0), vec3(0.195,0.295,0.05-0.12*s), 0.056, 0.047, 2.0, 0.0, 0.048));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.03);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.015, vec3(0.0,0.84,-0.38), 0.01);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.118,0.128), vec3(0.14,0.045,0.07)), 0.03);
  r = U(r, vec2(hair, 1.0));
  r = U(r, faceParts(hq, vec2(0.37,-0.15), vec2(0.0185,0.0245), vec3(0.37,0.11,-0.12), 1.0, vec2(-0.54,0.025), vec2(0.63,-0.36), lod));
  return r;
}

// ---------------- 10: townswoman (muted green dress, cream apron, plain bun, hands folded at the waist) ----------------
vec2 fig10(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.068,0.034+0.075*max(c,0.),0.035+0.12*s), vec3(-0.068,0.034+0.075*max(-c,0.),0.035-0.12*s), 5.0));
  r = U(r, vec2(sdRobe(pv, 0.07, 0.585, 0.212, 0.118, 0.045), 2.0));                      // the dress
  float aw = mix(0.155, 0.095, sat((pv.y-0.10)/0.32));
  float ap = sdRobe(pv, 0.085, 0.47, 0.224, 0.150, 0.04);                                  // the apron: a panel on the front of the dress
  ap = max(ap, max(abs(pv.x)-aw, max(-(pv.z-0.04), pv.y-0.46)));
  r = U(r, vec2(ap, 13.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.572,0.0), 0.10, 0.014), 4.0));                         // collar
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.415,0.0), 0.162, 0.010), 4.0));                      // apron tie
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.415,-0.16), vec3(0.04,0.31,-0.18), 0.011), 13.0));
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.415,-0.16), vec3(-0.04,0.32,-0.185), 0.011), 13.0));
  }
  vec3 SR = vec3(-0.138,0.50,0.0), SL = vec3(0.138,0.50,0.0);
  r = U(r, arm(pv, SR, vec3(-0.215,0.395,0.075), vec3(-0.055,0.325,0.205), 0.047, 0.040, 2.0, 2.0, 0.043));
  r = U(r, arm(pv, SL, vec3(0.215,0.395,0.075), vec3(0.055,0.325,0.205), 0.047, 0.040, 2.0, 2.0, 0.043));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.05);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.75,-0.55), -0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.13), vec3(0.15,0.052,0.075)), 0.03);
  hair = smin(hair, sdSphere(hq - vec3(0.0,0.185,-0.10), 0.088), 0.04);                    // a plain bun
  r = U(r, vec2(hair, 1.0));
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.021,0.029), vec3(0.37,0.11,0.10), 1.0, vec2(-0.54,0.026), vec2(0.62,-0.36), lod));
  return r;
}

// ---------------- 11: child (short legs and a big head, topknot with a red cord, plain tan jacket); baked at scale 0.74 ----------------
vec2 fig11(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.065,0.034+0.07*max(c,0.),0.03+0.10*s), vec3(-0.065,0.034+0.07*max(-c,0.),0.03-0.10*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.062,0.17,0.0), vec3(0.065,0.06,0.03+0.10*s), 0.05), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.062,0.17,0.0), vec3(-0.065,0.06,0.03-0.10*s), 0.05), 3.0));
  r = U(r, vec2(sdRobe(pv, 0.13, 0.50, 0.165, 0.115, 0.05), 2.0));                        // a short, round jacket
  r = U(r, vec2(sdTorus(pv-vec3(0,0.488,0.0), 0.10, 0.015), 4.0));
  vec3 SR = vec3(-0.115,0.43,0.0), SL = vec3(0.115,0.43,0.0);
  r = U(r, arm(pv, SR, vec3(-0.185,0.34,0.0), vec3(-0.165,0.25,0.04+0.10*s), 0.046, 0.039, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.185,0.34,0.0), vec3(0.165,0.25,0.04-0.10*s), 0.046, 0.039, 2.0, 2.0, 0.042));
  // head: 15% bigger than the adults' and set low, so the body is short and the head looks big
  const float HS = 1.15;
  vec3 hc = vec3(0.0,0.66,0.0);
  vec3 hq = (toBody(pv, hc, nod - HEADBACK) - hc)/HS;
  float bh = (length(hq) - 0.5)*HS;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  vec2 hd = vec2(sdHead(hq), 0.0);
  hd = U(hd, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.86,-0.42), 0.03);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.135,0.125), vec3(0.135,0.042,0.065)), 0.03);
  float knot = smin(sdSphere(hq - vec3(0.0,0.225,-0.045), 0.058), sdCap(hq, vec3(0.0,0.17,-0.03), vec3(0.0,0.205,-0.045), 0.046), 0.03);
  hd = U(hd, vec2(min(hair, knot), 1.0));
  if (lod < 1) hd = U(hd, vec2(sdTorus((hq - vec3(0.0,0.19,-0.04)), 0.046, 0.011), 12.0));   // a red cord around the knot
  hd = U(hd, faceParts(hq, vec2(0.34,-0.19), vec2(0.0235,0.0325), vec3(0.37,0.13,0.0), 1.0, vec2(-0.57,0.022), vec2(0.62,-0.40), lod));
  hd.x *= HS;
  return U(r, hd);
}

// ================= the other twelve people of the cast, ids 12 to 23 =================
// Props that more than one of them has.
// A thread-bound book: a cover, and a block of cream pages that shows at the top, the foot and the open edge. q: the middle of the book, x across, y along the spine.
vec2 bookProp(vec3 q, float cover){
  vec2 r = vec2(sdRBox(q, vec3(0.056,0.075,0.012), 0.005), cover);
  r = U(r, vec2(sdRBox(q - vec3(0.011,0.0,0.0), vec3(0.049,0.078,0.0105), 0.004), 13.0));
  return r;
}
// A woven market basket with a handle arched over it and greens heaped in it. q: the middle of the base, y up. R: radius of the rim, H: its height.
vec2 basketProp(vec3 q, float R, float H, int lod){
  vec2 r = vec2(sdRobe(q, 0.0, H, R*0.78, R, 0.012), 15.0);
  r = U(r, vec2(sdTorus(q - vec3(0.0,H,0.0), R, 0.0095), 6.0));
  if (lod < 1) r = U(r, vec2(sdTorus(q - vec3(0.0,H*0.5,0.0), R*0.89, 0.0065), 6.0));
  vec3 g = q - vec3(0.0,H+0.010,0.0);
  float goods = smin(sdEll(g - vec3(0.02,0.012,0.012), vec3(R*0.66,0.046,R*0.60)), sdSphere(g - vec3(-0.03,0.020,-0.02), 0.04), 0.03);
  r = U(r, vec2(goods, 8.0));
  float arc = length(vec2(length(vec2(q.x, q.y - H)) - R, q.z)) - 0.0075;
  r = U(r, vec2(max(arc, -(q.y - H)), 6.0));
  return r;
}

// ---------------- 12: Li Xiaomei (girl: blue dress, a red sash, red ribbons on two buns, a red paper lantern); baked at scale 0.80 ----------------
vec2 fig12(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.062,0.034+0.07*max(c,0.),0.03+0.10*s), vec3(-0.062,0.034+0.07*max(-c,0.),0.03-0.10*s), 5.0));
  r = U(r, vec2(sdRobe(pv, 0.07, 0.50, 0.188, 0.113, 0.05), 2.0));                         // a flared dress
  r = U(r, vec2(sdTorus(pv-vec3(0,0.488,0.0), 0.10, 0.015), 13.0));                        // collar
  r = U(r, vec2(sdTorus(pv-vec3(0,0.105,0.0), 0.183, 0.013), 13.0));                       // hem
  r = U(r, vec2(sdTorus(pv-vec3(0,0.345,0.0), 0.146, 0.015), 12.0));                       // red sash
  if (lod < 1) {
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.345,-0.145), vec3(0.04,0.22,-0.17), 0.011), 12.0));
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.345,-0.145), vec3(-0.035,0.23,-0.175), 0.011), 12.0));
  }
  vec3 SR = vec3(-0.115,0.43,0.0), SL = vec3(0.115,0.43,0.0);
  vec3 HRh = vec3(-0.172,0.300,0.05+0.10*s);
  r = U(r, arm(pv, SR, vec3(-0.185,0.375,0.0), HRh, 0.046, 0.039, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.185,0.345,0.0), vec3(0.165,0.25,0.04-0.10*s), 0.046, 0.039, 2.0, 2.0, 0.042));
  // the paper lantern hangs from her right hand on a string
  r = U(r, vec2(sdCap(pv, HRh + vec3(0.0,-0.02,0.0), HRh + vec3(0.0,-0.060,0.0), 0.0045), 6.0));
  r = U(r, lantern(pv - (HRh + vec3(0.0,-0.060-0.095,0.0)), 0.092, 0.095, 9.0, lod));
  // head: 15% bigger than the adults', set low
  const float HS = 1.15;
  vec3 hc = vec3(0.0,0.66,0.0);
  vec3 hq = (toBody(pv, hc, nod - HEADBACK) - hc)/HS;
  float bh = (length(hq) - 0.55)*HS;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  vec2 hd = vec2(sdHead(hq), 0.0);
  hd = U(hd, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.86,-0.42), 0.03);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.135,0.125), vec3(0.135,0.042,0.065)), 0.03);
  vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
  hair = smin(hair, sdSphere(qs - vec3(0.150,0.150,-0.030), 0.066), 0.04);                   // a bun on each side of the crown
  hd = U(hd, vec2(hair, 1.0));
  hd = U(hd, vec2(sdSphere(qs - vec3(0.150,0.118,0.024), 0.024), 12.0));                     // a red ribbon at the foot of each bun
  if (lod < 1) hd = U(hd, vec2(sdSphere(qs - vec3(0.172,0.205,-0.040), 0.019), 12.0));      // and a red bead on top
  hd = U(hd, faceParts(hq, vec2(0.34,-0.19), vec2(0.0235,0.0325), vec3(0.37,0.13,0.0), 1.0, vec2(-0.57,0.022), vec2(0.62,-0.40), lod));
  hd.x *= HS;
  return U(r, hd);
}

// ---------------- 13: Shitou (boy: blue jacket, trousers, a bowl cut, a book against his chest); baked at scale 0.76 ----------------
vec2 fig13(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.065,0.034+0.07*max(c,0.),0.03+0.10*s), vec3(-0.065,0.034+0.07*max(-c,0.),0.03-0.10*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.062,0.17,0.0), vec3(0.065,0.06,0.03+0.10*s), 0.05), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.062,0.17,0.0), vec3(-0.065,0.06,0.03-0.10*s), 0.05), 3.0));
  r = U(r, vec2(sdRobe(pv, 0.13, 0.50, 0.165, 0.115, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.488,0.0), 0.10, 0.015), 13.0));
  if (lod < 1) r = U(r, vec2(sdTorus(pv-vec3(0,0.255,0.0), 0.146, 0.013), 4.0));          // a cloth belt
  vec3 SR = vec3(-0.115,0.43,0.0), SL = vec3(0.115,0.43,0.0);
  vec3 HRh = vec3(-0.100,0.335,0.165);
  r = U(r, arm(pv, SR, vec3(-0.185,0.34,0.07), HRh, 0.046, 0.039, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.185,0.34,0.0), vec3(0.165,0.25,0.04-0.10*s), 0.046, 0.039, 2.0, 2.0, 0.042));
  // the book: held against the chest, its cover to the front and a little up
  vec3 bq = pv - (HRh + vec3(0.025,0.050,0.040)); bq.yz = rot2(bq.yz, 0.5); bq /= 1.25;
  float dbk = length(bq) - 0.13;
  if (dbk < 0.08) { vec2 bk = bookProp(bq, 7.0); bk.x *= 1.25; r = U(r, bk); } else r = U(r, vec2(dbk*1.25, 7.0));
  // head
  const float HS = 1.15;
  vec3 hc = vec3(0.0,0.66,0.0);
  vec3 hq = (toBody(pv, hc, nod - HEADBACK) - hc)/HS;
  float bh = (length(hq) - 0.5)*HS;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  vec2 hd = vec2(sdHead(hq), 0.0);
  hd = U(hd, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.016, vec3(0.0,0.40,-0.60), -0.045);                         // a bowl of hair, low at the back
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.125), vec3(0.145,0.05,0.07)), 0.03);
  hd = U(hd, vec2(hair, 1.0));
  hd = U(hd, faceParts(hq, vec2(0.34,-0.19), vec2(0.0235,0.0325), vec3(0.37,0.13,0.0), 1.0, vec2(-0.57,0.022), vec2(0.62,-0.40), lod));
  hd.x *= HS;
  return U(r, hd);
}

// ---------------- 14: Xiaoman (a child who fishes: teal jacket, trousers to the knee, a wide straw hat, a rod and a basket for the catch); baked at scale 0.76 ----------------
vec2 fig14(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  vec3 fL = vec3(0.065,0.034+0.07*max(c,0.),0.03+0.10*s), fR = vec3(-0.065,0.034+0.07*max(-c,0.),0.03-0.10*s);
  float sandals = min(sdRBox(p - fL - vec3(0,-0.012,0.03), vec3(0.042,0.018,0.07), 0.016), sdRBox(p - fR - vec3(0,-0.012,0.03), vec3(0.042,0.018,0.07), 0.016));
  r = U(r, vec2(sandals, 15.0));
  float footL = sdEll(p - fL - vec3(0,0.004,0.03), vec3(0.036,0.028,0.058)), footR = sdEll(p - fR - vec3(0,0.004,0.03), vec3(0.036,0.028,0.058));
  r = U(r, vec2(min(footL, footR), 0.0));
  vec3 kL = vec3(0.063,0.115,0.01+0.04*s), kR = vec3(-0.063,0.115,0.01-0.04*s);
  r = U(r, vec2(sdCap(p, vec3(0.062,0.17,0.0), kL, 0.05), 3.0));                          // trousers rolled to the knee
  r = U(r, vec2(sdCap(p, vec3(-0.062,0.17,0.0), kR, 0.05), 3.0));
  r = U(r, vec2(sdCap(p, kL, vec3(0.065,0.06,0.03+0.10*s), 0.037), 0.0));                 // bare shins
  r = U(r, vec2(sdCap(p, kR, vec3(-0.065,0.06,0.03-0.10*s), 0.037), 0.0));
  r = U(r, vec2(sdRobe(pv, 0.13, 0.50, 0.165, 0.115, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.488,0.0), 0.10, 0.015), 13.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.255,0.0), 0.146, 0.014), 15.0));                      // a rope belt
  vec3 SR = vec3(-0.115,0.43,0.0), SL = vec3(0.115,0.43,0.0);
  vec3 HRh = vec3(-0.165,0.27,0.03);
  r = U(r, arm(pv, SR, vec3(-0.19,0.35,0.0), HRh, 0.046, 0.039, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.185,0.34,0.0), vec3(0.165,0.25,0.04-0.10*s), 0.046, 0.039, 2.0, 2.0, 0.042));
  // the rod: a bamboo pole through the right hand, up and out in front, with a line and a red float
  vec3 rb = vec3(-0.19,0.10,-0.09), rt = vec3(-0.02,1.05,0.50);
  r = U(r, vec2(sdRoundCone(pv, rb, rt, 0.016, 0.006), 6.0));
  r = U(r, vec2(sdCap(pv, rt, rt + vec3(0.0,-0.40,0.0), 0.0045), 13.0));
  r = U(r, vec2(sdSphere(pv - (rt + vec3(0.0,-0.43,0.0)), 0.018), 12.0));
  // the basket for the catch, hung at the left hip by a cord
  vec3 bq = pv - vec3(0.205,0.115,0.0);
  float dbs = length(bq - vec3(0.0,0.07,0.0)) - 0.13;
  if (dbs < 0.06) {
    vec2 bs = vec2(sdRobe(bq, 0.0, 0.11, 0.052, 0.062, 0.012), 15.0);
    bs = U(bs, vec2(sdEll(bq - vec3(0.0,0.118,0.0), vec3(0.058,0.022,0.058)), 6.0));
    bs = U(bs, vec2(sdTorus(bq - vec3(0.0,0.055,0.0), 0.059, 0.006), 6.0));
    r = U(r, bs);
  } else r = U(r, vec2(dbs, 15.0));
  r = U(r, vec2(sdCap(pv, vec3(0.185,0.27,0.0), vec3(0.205,0.235,0.0), 0.007), 12.0));
  // head
  const float HS = 1.15;
  vec3 hc = vec3(0.0,0.66,0.0);
  vec3 hq = (toBody(pv, hc, nod - HEADBACK) - hc)/HS;
  float bh = (length(hq) - 0.62)*HS;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  vec2 hd = vec2(sdHead(hq), 0.0);
  hd = U(hd, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.30,-0.70), -0.06);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.125), vec3(0.135,0.042,0.065)), 0.03);
  hd = U(hd, vec2(hair, 1.0));
  // a wide straw hat, tipped back a little
  vec3 hh = hq - vec3(0.0,0.165,-0.02);
  hh = vec3(hh.x, hh.y*cos(0.26) - hh.z*sin(0.26), hh.y*sin(0.26) + hh.z*cos(0.26));
  float hat = sdCCone(hh, 0.062, 0.265, 0.012) - 0.012;
  hd = U(hd, vec2(hat, 15.0));
  hd = U(hd, vec2(sdTorus(hh - vec3(0.0,-0.062,0.0), 0.258, 0.010), 6.0));
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    hd = U(hd, vec2(sdCap(qs, vec3(0.19,0.03,0.0), vec3(0.075,-0.17,0.09), 0.0055), 12.0));        // the chin cord
  }
  hd = U(hd, faceParts(hq, vec2(0.34,-0.19), vec2(0.0235,0.0325), vec3(0.37,0.13,0.0), 1.0, vec2(-0.57,0.022), vec2(0.62,-0.40), lod));
  hd.x *= HS;
  return U(r, hd);
}

// ---------------- 15: Madam Zhou (mistress of the Zhou house: orange jacket, brown skirt, a gold pin in a high bun, a market basket and a round fan) ----------------
vec2 fig15(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.07,0.034+0.075*max(c,0.),0.035+0.13*s), vec3(-0.07,0.034+0.075*max(-c,0.),0.035-0.13*s), 5.0));
  vec2 skirt = vec2(sdRobe(pv, 0.07, 0.40, 0.215, 0.145, 0.045), 3.0);
  vec2 jacket = vec2(sdRobe(pv, 0.28, 0.585, 0.172, 0.122, 0.05), 2.0);
  r = U(r, SU(skirt, jacket, 0.03));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.572,0.0), 0.106, 0.015), 13.0));                      // collar
  r = U(r, vec2(sdTorus(pv-vec3(0,0.292,0.0), 0.172, 0.016), 4.0));                       // the band at the hem of the jacket
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.102,0.0), 0.210, 0.013), 4.0));                     // the hem of the skirt
    r = U(r, vec2(sdCap(pv, vec3(0.0,0.56,0.108), vec3(0.0,0.31,0.17), 0.008), 4.0));     // the front of the jacket
  }
  vec3 SR = vec3(-0.138,0.50,0.0), SL = vec3(0.138,0.50,0.0);
  vec3 HRh = vec3(-0.205,0.44,0.13);                                                       // the right hand holds the fan up
  r = U(r, arm(pv, SR, vec3(-0.225,0.40,0.04), HRh, 0.047, 0.040, 2.0, 0.0, 0.042));
  vec3 HLh = vec3(0.19,0.33,0.17);                                                         // the left forearm carries the basket
  r = U(r, arm(pv, SL, vec3(0.235,0.40,0.07), HLh, 0.047, 0.040, 2.0, 0.0, 0.042));
  // the round fan, a little tipped up
  vec3 fq = pv - (HRh + vec3(0.0,0.105,0.02)); fq.yz = rot2(fq.yz, 0.5);
  r = U(r, vec2(sdCap(pv, HRh, HRh + vec3(0.0,0.062,0.012), 0.0085), 6.0));
  float dfan = length(fq) - 0.12;
  if (dfan < 0.06) {
    r = U(r, vec2(max(length(fq.xy) - 0.075, abs(fq.z) - 0.006), 7.0));
    r = U(r, vec2(sdTorus(vec3(fq.x, fq.z, fq.y), 0.075, 0.0065), 12.0));
  } else r = U(r, vec2(dfan, 7.0));
  // the basket hangs from the left hand
  vec3 bq = pv - (HLh - vec3(0.0,0.185,0.0));
  float dbs = length(bq - vec3(0.0,0.10,0.0)) - 0.22;
  if (dbs < 0.06) r = U(r, basketProp(bq, 0.10, 0.085, lod)); else r = U(r, vec2(dbs, 15.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.04);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.75,-0.55), -0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.13), vec3(0.15,0.052,0.075)), 0.03);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.20,-0.07), vec3(0.115,0.075,0.09)), 0.04);          // a high, wide bun
  r = U(r, vec2(hair, 1.0));
  if (lod < 1) {
    r = U(r, vec2(sdCap(hq, vec3(-0.09,0.265,-0.055), vec3(0.14,0.15,-0.10), 0.0085), 14.0));  // a gold pin through it
    r = U(r, vec2(sdSphere(hq - vec3(-0.095,0.27,-0.055), 0.022), 14.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.021,0.029), vec3(0.37,0.11,0.12), 1.0, vec2(-0.54,0.026), vec2(0.62,-0.36), lod));
  return r;
}

// ---------------- 16: Zhou Dalang (eldest son of the Zhou house: broad and strong, rust jacket with the sleeves rolled, a red headband, a wine gourd at his belt) ----------------
vec2 fig16(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.092,0.034+0.075*max(c,0.),0.03+0.155*s), vec3(-0.092,0.034+0.075*max(-c,0.),0.03-0.155*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.092,0.22,0.0), vec3(0.092,0.06,0.03+0.155*s), 0.066), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.092,0.22,0.0), vec3(-0.092,0.06,0.03-0.155*s), 0.066), 3.0));
  r = SU(r, vec2(sdEll(pv-vec3(0.0,0.21,0.0), vec3(0.178,0.085,0.130)), 3.0), 0.03);
  r = U(r, vec2(sdRoundCone(pv, vec3(0,0.215,0), vec3(0,0.50,0), 0.184, 0.164), 2.0));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.575,0.0), 0.128, 0.019), 13.0));                      // collar
  r = U(r, vec2(sdTorus(pv-vec3(0,0.255,0.0), 0.190, 0.026), 4.0));                       // a wide sash
  if (lod < 1) {
    r = U(r, vec2(sdCap(pv, vec3(-0.06,0.27,0.17), vec3(-0.10,0.17,0.185), 0.014), 4.0));
    r = U(r, vec2(sdCap(pv, vec3(-0.06,0.27,0.17), vec3(-0.02,0.16,0.19), 0.013), 4.0));
  }
  vec3 SR = vec3(-0.178,0.495,0.0), SL = vec3(0.178,0.495,0.0);
  r = U(r, arm(pv, SR, vec3(-0.268,0.39,0.0), vec3(-0.235,0.29,0.05+0.135*s), 0.072, 0.060, 2.0, 0.0, 0.060));
  r = U(r, arm(pv, SL, vec3(0.268,0.39,0.0), vec3(0.235,0.29,0.05-0.135*s), 0.072, 0.060, 2.0, 0.0, 0.060));
  // the wine gourd on a red cord, at the belt on his left
  r = U(r, vec2(sdCap(pv, vec3(0.19,0.262,0.06), vec3(0.215,0.345,0.10), 0.0075), 12.0));
  vec3 gq = (pv - vec3(0.222,0.195,0.10))/1.3;
  float dgd = length(gq - vec3(0.0,0.07,0.0)) - 0.17;
  if (dgd < 0.06) {
    float gd = smin(sdSphere(gq, 0.066), sdSphere(gq - vec3(0.0,0.088,0.0), 0.045), 0.04);
    vec2 g = vec2(gd, 8.0);
    g = U(g, vec2(sdCylY(gq - vec3(0.0,0.150,0.0), 0.014, 0.019), 6.0));
    g = U(g, vec2(sdTorus(gq - vec3(0.0,0.104,0.0), 0.040, 0.007), 12.0));
    g.x *= 1.3;
    r = U(r, g);
  } else r = U(r, vec2(dgd*1.3, 8.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc;
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.016, vec3(0.0,0.82,-0.30), 0.0);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.135), vec3(0.150,0.050,0.072)), 0.03);
  hair = smin(hair, sdSphere(hq - vec3(0.0,0.215,-0.04), 0.055), 0.03);                     // a topknot
  r = U(r, vec2(hair, 1.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.085,0.0), 0.200, 0.017), 12.0));                    // the red headband
  if (lod < 1) {
    r = U(r, vec2(sdSphere(hq - vec3(0.17,0.075,-0.10), 0.026), 12.0));
    r = U(r, vec2(sdCap(hq, vec3(0.17,0.075,-0.10), vec3(0.135,-0.05,-0.19), 0.011), 12.0));
    r = U(r, vec2(sdCap(hq, vec3(0.17,0.075,-0.10), vec3(0.19,-0.04,-0.16), 0.011), 12.0));
  }
  r = U(r, faceParts(hq, vec2(0.38,-0.14), vec2(0.0175,0.022), vec3(0.37,0.10,0.30), 1.0, vec2(-0.55,0.03), vec2(0.64,-0.36), lod));
  return r;
}

// A lantern frame of bamboo: ribs between two rings, its upper half covered in red paper. q: the middle of the lantern, R: its radius at the middle, H: half its height.
vec2 lanternFrame(vec3 q, float R, float H, int lod){
  float y = clamp(q.y, -H*0.97, H*0.97);
  float rad = R*sqrt(max(1.0 - (y/H)*(y/H), 0.0));
  float a = atan(q.z, q.x); float sec = 2.0*PI/10.0;
  a = (fract(a/sec + 0.5) - 0.5)*sec;
  vec2 pq = length(q.xz)*vec2(cos(a), sin(a));
  vec2 r = vec2(length(vec3(pq.x - rad, pq.y, q.y - y)) - 0.0072, 15.0);
  r = U(r, vec2(sdTorus(q - vec3(0.0,H*0.86,0.0), R*0.51, 0.0085), 6.0));
  r = U(r, vec2(sdTorus(q + vec3(0.0,H*0.86,0.0), R*0.51, 0.0085), 6.0));
  r = U(r, vec2(sdTorus(q, R, 0.0085), 6.0));
  r = U(r, vec2(max(abs(sdEll(q, vec3(R,H,R))) - 0.0055, -q.y), 12.0));
  r = U(r, vec2(sdCylY(q - vec3(0.0,H,0.0), 0.012, R*0.34), 6.0));
  r = U(r, vec2(sdCylY(q + vec3(0.0,H,0.0), 0.012, R*0.34), 6.0));
  return r;
}
// Three sticks of incense that fan out upwards, with a glowing tip each. q: the hand that holds them.
vec2 incenseProp(vec3 q){
  vec2 r = vec2(1e5, 0.0);
  for (int i=0;i<3;i++){
    float a = (float(i) - 1.0)*0.30;
    vec3 tip = vec3(sin(a)*0.3, 0.255, 0.035*(float(i) - 1.0));
    r = U(r, vec2(sdCap(q, vec3(0.0,-0.025,0.0), tip, 0.0105), 6.0));
    r = U(r, vec2(sdCap(q, tip - normalize(tip)*0.034, tip, 0.0125), 9.0));
  }
  return r;
}
// A hanging bronze gong, its face to +z. q: the middle of the disc.
vec2 gongProp(vec3 q, int lod){
  vec2 d = abs(vec2(length(q.xy), q.z)) - vec2(0.103, 0.0125);
  vec2 r = vec2(min(max(d.x,d.y),0.0) + length(max(d,0.0)) - 0.012, 8.0);
  r = U(r, vec2(sdTorus(vec3(q.x, q.z, q.y), 0.103, 0.011), 14.0));
  r = U(r, vec2(sdEll(q - vec3(0.0,0.0,0.014), vec3(0.036,0.036,0.016)), 14.0));
  if (lod < 1) r = U(r, vec2(sdTorus(vec3(q.x, q.z, q.y - 0.118), 0.014, 0.0045), 6.0));
  return r;
}

// ---------------- 17: Zhou Erlang (younger son of the Zhou house: slim, a light orange jacket, a cloth satchel across the chest, one hand raised in greeting) ----------------
vec2 fig17(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = -0.04;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.068,0.034+0.075*max(c,0.),0.03+0.155*s), vec3(-0.068,0.034+0.075*max(-c,0.),0.03-0.155*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.062,0.22,0.0), vec3(0.066,0.06,0.03+0.155*s), 0.04), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.062,0.22,0.0), vec3(-0.066,0.06,0.03-0.155*s), 0.04), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.115, 0.585, 0.158, 0.108, 0.045), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.095, 0.015), 13.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.30,0.0), 0.136, 0.017), 4.0));                        // a sash
  // the satchel: a strap across the chest from the right shoulder to a pouch at the left hip
  vec3 s0 = vec3(-0.085,0.545,0.080), s1 = vec3(-0.020,0.470,0.125), s2 = vec3(0.040,0.360,0.140), s3 = vec3(0.115,0.265,0.112);
  float strap = min(sdCap(pb, s0, s1, 0.014), min(sdCap(pb, s1, s2, 0.014), sdCap(pb, s2, s3, 0.014)));
  r = U(r, vec2(strap, 4.0));
  vec3 pq = pb - vec3(0.115,0.235,0.105); float cs = cos(0.83), sn = sin(0.83); pq = vec3(pq.x*cs - pq.z*sn, pq.y, pq.x*sn + pq.z*cs);
  r = U(r, vec2(sdRBox(pq, vec3(0.050,0.058,0.022), 0.016), 7.0));
  if (lod < 1) r = U(r, vec2(sdRBox(pq - vec3(0.0,0.036,0.016), vec3(0.052,0.024,0.012), 0.008), 4.0));    // its flap
  vec3 SR = toBase(vec3(-0.12,0.50,0.0), piv, lean), SL = toBase(vec3(0.12,0.50,0.0), piv, lean);
  r = U(r, arm(pv, SR, vec3(-0.19,0.40,0.0), vec3(-0.165,0.29,0.04-0.135*s), 0.042, 0.036, 2.0, 2.0, 0.040));
  r = U(r, arm(pv, SL, vec3(0.255,0.47,0.03), vec3(0.285,0.645,0.07), 0.042, 0.036, 2.0, 2.0, 0.046));    // the raised hand
  if (lod < 1) r = U(r, vec2(sdEll(pv - vec3(0.288,0.672,0.074), vec3(0.036,0.042,0.016)), 0.0));         // an open palm
  // head
  vec3 hc = vec3(0.0,0.80,0.0) + vec3(0.0, 0.0, -0.01);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, -0.05);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.86,-0.42), 0.02);
  hair = smin(hair, sdEll(hq-vec3(0.02,0.135,0.125), vec3(0.14,0.045,0.068)), 0.03);
  r = U(r, vec2(hair, 1.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.075,-0.005), 0.202, 0.015), 13.0));                // a cloth headband
  if (lod < 1) {
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.075,-0.20), vec3(0.04,-0.06,-0.235), 0.012), 13.0));
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.075,-0.20), vec3(-0.035,-0.05,-0.24), 0.012), 13.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.022,0.031), vec3(0.37,0.13,0.0), 1.0, vec2(-0.54,0.026), vec2(0.63,-0.37), lod));
  return r;
}

// ---------------- 18: the schoolmaster (tall and thin, a pale blue-grey gown, a scholar's cap, a thin grey beard, a book in both hands) ----------------
vec2 fig18(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.03;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.062,0.034+0.07*max(c,0.),0.04+0.12*s), vec3(-0.062,0.034+0.07*max(-c,0.),0.04-0.12*s), 5.0));
  r = U(r, vec2(sdRobe(pb, 0.07, 0.60, 0.205, 0.118, 0.05), 2.0));                           // the long gown
  r = U(r, vec2(sdTorus(pb-vec3(0,0.588,0.0), 0.106, 0.019), 4.0));                          // a pale collar
  if (lod < 1) {
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.57,0.112), vec3(0.0,0.10,0.206), 0.009), 4.0));      // the front edge
    r = U(r, vec2(sdTorus(pb-vec3(0,0.10,0.0), 0.202, 0.013), 3.0));                         // a hem band in the darker blue
    r = U(r, vec2(sdTorus(pb-vec3(0,0.34,0.0), 0.162, 0.016), 7.0));                         // a dark sash
  }
  vec3 SR = toBase(vec3(-0.135,0.51,0.0), piv, lean), SL = toBase(vec3(0.135,0.51,0.0), piv, lean);
  vec3 HRh = vec3(-0.080,0.385,0.205), HLh = vec3(0.100,0.375,0.205);
  r = U(r, arm(pv, SR, vec3(-0.215,0.41,0.09), HRh, 0.050, 0.043, 2.0, 2.0, 0.043));
  r = U(r, arm(pv, SL, vec3(0.215,0.40,0.09), HLh, 0.050, 0.043, 2.0, 2.0, 0.043));
  // the book, held open to the front in both hands, its cover tipped up
  vec3 bq = pv - vec3(0.01,0.425,0.238); bq.yz = rot2(bq.yz, 0.55); bq /= 1.18;
  float dbk = length(bq) - 0.14;
  if (dbk < 0.08) { vec2 b = bookProp(bq, 8.0); b.x *= 1.18; r = U(r, b); } else r = U(r, vec2(dbk*1.18, 8.0));
  // head
  vec3 hc = vec3(0.0,0.835,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc;
  vec3 hb = toBody(pb, hc, nod - 0.02) - hc;
  float bh = length(hq) - 0.55;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.013, vec3(0.0,0.60,-0.80), -0.05), 1.0));
  r = U(r, vec2(sdRBox(hq - vec3(0.0,0.188,-0.02), vec3(0.150,0.084,0.145), 0.04), 7.0));    // the scholar's cap: tall, soft and square
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.112,-0.008), 0.192, 0.012), 14.0));                  // its band
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    r = U(r, vec2(sdRoundCone(hb, vec3(0.0,-0.125,0.14), vec3(0.0,-0.30,0.175), 0.052, 0.022), 1.0));   // a goatee
    r = U(r, vec2(sdCap(qs, vec3(0.004,-0.075,0.188), vec3(0.07,-0.094,0.165), 0.0125), 1.0));          // and a moustache
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.12), vec2(0.0165,0.0185), vec3(0.37,0.085,-0.28), 1.0, vec2(-0.58,0.02), vec2(0.62,-0.34), lod));
  return r;
}

// ---------------- 19: the accountant (thin, a maroon gown, a black skullcap, round spectacles, an abacus in one hand and the ledger against the other side) ----------------
vec2 fig19(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = -0.02;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.064,0.034+0.07*max(c,0.),0.04+0.12*s), vec3(-0.064,0.034+0.07*max(-c,0.),0.04-0.12*s), 5.0));
  r = U(r, vec2(sdRobe(pb, 0.07, 0.60, 0.198, 0.116, 0.05), 2.0));                           // the gown
  r = U(r, vec2(sdTorus(pb-vec3(0,0.588,0.0), 0.104, 0.018), 13.0));                         // collar
  r = U(r, vec2(sdTorus(pb-vec3(0,0.335,0.0), 0.156, 0.016), 3.0));                          // a dark sash
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pb-vec3(0,0.10,0.0), 0.194, 0.012), 4.0));                         // a thin gold hem
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.57,0.11), vec3(0.0,0.10,0.2), 0.008), 13.0));
  }
  vec3 SR = toBase(vec3(-0.13,0.51,0.0), piv, lean), SL = toBase(vec3(0.13,0.51,0.0), piv, lean);
  vec3 HRh = vec3(-0.115,0.43,0.195), HLh = vec3(0.150,0.385,0.185);
  r = U(r, arm(pv, SR, vec3(-0.215,0.41,0.09), HRh, 0.048, 0.041, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.215,0.40,0.07), HLh, 0.048, 0.041, 2.0, 2.0, 0.042));
  // the abacus in the right hand, tipped up; the ledger in the left, a little turned to the front
  vec3 aq = pv - vec3(-0.075,0.47,0.235); aq.yz = rot2(aq.yz, 0.6); aq /= 1.12;
  float dab = sdBox(aq, vec3(0.14,0.10,0.04));
  if (dab < 0.1) { vec2 ab = abacus(aq, lod); ab.x *= 1.12; r = U(r, ab); } else r = U(r, vec2(dab*1.12, 6.0));
  vec3 lq = pv - vec3(0.150,0.415,0.222); lq.yz = rot2(lq.yz, 0.45); lq.xz = rot2(lq.xz, -0.35); lq /= 1.05;
  float dlg = length(lq) - 0.14;
  if (dlg < 0.08) { vec2 lg = bookProp(lq, 7.0); lg.x *= 1.05; r = U(r, lg); } else r = U(r, vec2(dlg*1.05, 7.0));
  // head
  vec3 hc = vec3(0.0,0.82,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc;
  float bh = length(hq) - 0.48;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.016, vec3(0.0,1.0,-0.12), 0.07), 3.0));                    // a black skullcap
  r = U(r, vec2(sdSphere(hq - vec3(0.0,0.212,-0.02), 0.020), 14.0));
  if (lod < 1) {
    vec3 qs = vec3(abs(hq.x), hq.y, hq.z);
    r = U(r, vec2(sdTorus(vec3(qs.x - 0.076, qs.z - 0.200, qs.y + 0.030), 0.039, 0.0058), 14.0));   // round spectacles
    r = U(r, vec2(sdCap(hq, vec3(-0.04,-0.03,0.200), vec3(0.04,-0.03,0.200), 0.0042), 14.0));
    r = U(r, vec2(sdCap(qs, vec3(0.115,-0.03,0.19), vec3(0.195,-0.005,0.03), 0.0042), 14.0));
    r = U(r, vec2(sdCap(hq, vec3(0.19,0.0,0.01), vec3(0.265,0.10,-0.045), 0.0085), 6.0));            // a brush behind the ear
  }
  r = U(r, faceParts(hq, vec2(0.35,-0.15), vec2(0.0175,0.022), vec3(0.36,0.07,-0.1), 1.0, vec2(-0.62,0.022), vec2(0.64,-0.38), lod));
  return r;
}

// ---------------- 20: the temple keeper (an old woman: a mauve robe, an ochre head cloth, incense held in both hands, a ring of keys at the belt) ----------------
vec2 fig20(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.10;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.062,0.034+0.07*max(c,0.),0.035+0.10*s), vec3(-0.062,0.034+0.07*max(-c,0.),0.035-0.10*s), 5.0));
  r = U(r, vec2(sdRobe(pv, 0.07, 0.34, 0.20, 0.16, 0.04), 2.0));                             // a long plain robe
  r = U(r, vec2(sdRobe(pb, 0.19, 0.585, 0.17, 0.118, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.104, 0.017), 13.0));                         // collar
  r = U(r, vec2(sdTorus(pv-vec3(0,0.33,0.0), 0.163, 0.017), 4.0));                           // an ochre sash
  if (lod < 1) {
    r = U(r, vec2(sdTorus(pv-vec3(0,0.10,0.0), 0.196, 0.013), 3.0));                         // hem band
    r = U(r, vec2(sdCap(pb, vec3(-0.07,0.56,0.108), vec3(0.05,0.36,0.15), 0.009), 13.0));  // the crossed front of the robe
  }
  vec3 SR = toBase(vec3(-0.135,0.50,0.0), piv, lean), SL = toBase(vec3(0.135,0.50,0.0), piv, lean);
  vec3 HRh = vec3(-0.040,0.440,0.205), HLh = vec3(0.060,0.425,0.205);
  r = U(r, arm(pv, SR, vec3(-0.215,0.41,0.09), HRh, 0.046, 0.040, 2.0, 2.0, 0.042));
  r = U(r, arm(pv, SL, vec3(0.215,0.40,0.09), HLh, 0.046, 0.040, 2.0, 2.0, 0.042));
  r = U(r, incenseProp(pv - vec3(0.0,0.445,0.215)));
  // the keys at her belt, on her left
  if (lod < 1) {
    vec3 kq = pv - vec3(0.175,0.255,0.115);
    r = U(r, vec2(sdTorus(vec3(kq.x, kq.z, kq.y), 0.022, 0.0058), 14.0));
    r = U(r, vec2(sdCap(kq, vec3(0.0,-0.02,0.0), vec3(0.0,-0.10,0.012), 0.008), 14.0));
  }
  // head
  vec3 hc = vec3(0.0,0.80,0.02);
  vec3 hq = toBody(pb, hc, 0.04 + nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.05);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.012, vec3(0.0,0.2,-1.0), -0.03), 1.0));                    // grey hair at the sides and the back
  float cloth = sdHairShell(hq, 0.020, vec3(0.0,0.95,-0.25), 0.03);                          // the head cloth
  cloth = smin(cloth, sdSphere(hq - vec3(0.0,0.10,-0.215), 0.046), 0.03);
  r = U(r, vec2(cloth, 7.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.085,-0.005), 0.203, 0.016), 7.0));
  r = U(r, faceParts(hq, vec2(0.37,-0.17), vec2(0.0165,0.0195), vec3(0.37,0.09,0.2), 1.0, vec2(-0.55,0.02), vec2(0.62,-0.38), lod));
  return r;
}

// ---------------- 21: the night watchman (a dark blue jacket, a red belt, a felt hat, a bronze gong in one hand and a lantern on a pole in the other) ----------------
vec2 fig21(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.03;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.08,0.034+0.075*max(c,0.),0.03+0.14*s), vec3(-0.08,0.034+0.075*max(-c,0.),0.03-0.14*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.076,0.23,0.0), vec3(0.08,0.06,0.03+0.14*s), 0.054), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.076,0.23,0.0), vec3(-0.08,0.06,0.03-0.14*s), 0.054), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.19, 0.585, 0.178, 0.124, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.106, 0.017), 12.0));                         // a red collar
  r = U(r, vec2(sdTorus(pb-vec3(0,0.258,0.0), 0.174, 0.026), 12.0));                         // a red belt
  if (lod < 1) {
    r = U(r, vec2(sdCap(pb, vec3(0.0,0.56,0.118), vec3(0.0,0.27,0.168), 0.008), 12.0));
    r = U(r, vec2(sdTorus(p-vec3(0.0787,0.115,0.0203+0.0947*s), 0.054, 0.009), 13.0));        // leg wraps
    r = U(r, vec2(sdTorus(p-vec3(-0.0787,0.115,0.0203-0.0947*s), 0.054, 0.009), 13.0));
  }
  vec3 SR = toBase(vec3(-0.135,0.50,0.0), piv, lean), SL = toBase(vec3(0.135,0.50,0.0), piv, lean);
  vec3 HRh = vec3(-0.215,0.44,0.15), HLh = vec3(0.215,0.315,0.12);
  r = U(r, arm(pv, SR, vec3(-0.245,0.40,0.06), HRh, 0.052, 0.044, 2.0, 0.0, 0.047));
  r = U(r, arm(pv, SL, vec3(0.245,0.38,0.05), HLh, 0.052, 0.044, 2.0, 0.0, 0.047));
  // the lantern on a pole in the right hand
  vec3 pt = vec3(-0.335,0.90,0.215);
  r = U(r, vec2(sdCap(pv, vec3(-0.205,0.22,0.12), pt, 0.0145), 6.0));
  r = U(r, vec2(sdCap(pv, pt, pt + vec3(0.0,-0.045,0.0), 0.005), 6.0));
  r = U(r, lantern(pv - (pt + vec3(0.0,-0.045-0.105,0.0)), 0.082, 0.105, 9.0, lod));
  // the gong on a cord from the left hand, and the mallet
  vec3 gq = (pv - vec3(0.262,0.205,0.115)); gq.yz = rot2(gq.yz, 0.5); gq /= 1.12;
  float dgg = length(gq) - 0.2;
  if (dgg < 0.06) { vec2 gg = gongProp(gq, lod); gg.x *= 1.12; r = U(r, gg); } else r = U(r, vec2(dgg*1.12, 8.0));
  r = U(r, vec2(sdCap(pv, HLh, vec3(0.20,0.28,0.285), 0.0105), 6.0));
  r = U(r, vec2(sdSphere(pv - vec3(0.20,0.28,0.30), 0.03), 13.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc;
  float bh = length(hq) - 0.5;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  r = U(r, vec2(sdHairShell(hq, 0.012, vec3(0.0,0.3,-1.0), -0.02), 1.0));
  float dome = smax(sdEll(hq - vec3(0.0,0.095,-0.01), vec3(0.208,0.15,0.208)), 0.07 - hq.y, 0.015);   // a felt hat with a rolled brim
  r = U(r, vec2(dome, 7.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.07,-0.008), 0.222, 0.026), 7.0));
  r = U(r, faceParts(hq, vec2(0.37,-0.14), vec2(0.0175,0.0225), vec3(0.37,0.06,-0.1), 1.0, vec2(-0.55,0.024), vec2(0.63,-0.33), lod));
  return r;
}

// ---------------- 22: the carpenter (a tan jacket with the sleeves rolled, a leather apron with a pocket and a ruler, a cloth headband, a saw over the shoulder) ----------------
vec2 fig22(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  float lean = 0.03;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec3 piv = vec3(0.0,0.2,0.0);
  vec3 pb = toBody(pv, piv, lean);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.08,0.034+0.075*max(c,0.),0.03+0.14*s), vec3(-0.08,0.034+0.075*max(-c,0.),0.03-0.14*s), 5.0));
  r = U(r, vec2(sdCap(p, vec3(0.076,0.23,0.0), vec3(0.08,0.06,0.03+0.14*s), 0.054), 3.0));
  r = U(r, vec2(sdCap(p, vec3(-0.076,0.23,0.0), vec3(-0.08,0.06,0.03-0.14*s), 0.054), 3.0));
  r = U(r, vec2(sdRobe(pb, 0.19, 0.585, 0.172, 0.122, 0.05), 2.0));
  r = U(r, vec2(sdTorus(pb-vec3(0,0.572,0.0), 0.104, 0.016), 13.0));
  // the apron: a bib of leather from the chest to the knees
  float aw = mix(0.172, 0.102, sat((pv.y-0.12)/0.40));
  float ap = sdRobe(pv, 0.115, 0.545, 0.192, 0.136, 0.04);
  ap = max(ap, max(abs(pv.x)-aw, max(-(pv.z-0.05), pv.y-0.54)));
  r = U(r, vec2(ap, 7.0));
  if (lod < 1) {
    r = U(r, vec2(sdRBox(pv - vec3(0.0,0.27,0.186), vec3(0.07,0.045,0.012), 0.008), 4.0));           // a pocket
    r = U(r, vec2(sdCap(pv, vec3(0.034,0.285,0.190), vec3(0.052,0.375,0.183), 0.0085), 13.0));        // a ruler in it
  }
  vec3 SR = toBase(vec3(-0.13,0.50,0.0), piv, lean), SL = toBase(vec3(0.13,0.50,0.0), piv, lean);
  vec3 HRh = vec3(-0.215,0.505,0.085);
  r = U(r, arm(pv, SR, vec3(-0.250,0.415,0.02), HRh, 0.056, 0.047, 2.0, 0.0, 0.050));
  r = U(r, arm(pv, SL, vec3(0.222,0.40,0.0), vec3(0.195,0.295,0.05-0.14*s), 0.056, 0.047, 2.0, 0.0, 0.050));
  // the saw: its handle in the right hand and its blade up and back over the shoulder, the broad side to the sky
  vec3 su = normalize(vec3(0.30,0.55,-0.78)), sv = normalize(cross(su, vec3(0.0,1.0,0.0))), sw = cross(su, sv);
  vec3 sd = pv - HRh;
  float dsw = length(sd - su*0.31) - 0.42;
  if (dsw < 0.05) {
    vec3 sq = vec3(dot(sd,su), dot(sd,sv), dot(sd,sw));
    float bw = mix(0.078, 0.040, sat((sq.x - 0.06)/0.56));
    float blade = max(abs(sq.x - 0.34) - 0.28, max(abs(sq.y) - bw, abs(sq.z) - 0.009));
    r = U(r, vec2(blade, 8.0));
    r = U(r, vec2(sdRBox(sq, vec3(0.075,0.026,0.018), 0.012), 6.0));
  } else r = U(r, vec2(dsw, 8.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pb, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.03);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.015, vec3(0.0,0.84,-0.38), 0.01);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.118,0.128), vec3(0.14,0.045,0.07)), 0.03);
  r = U(r, vec2(hair, 1.0));
  r = U(r, vec2(sdTorus(hq - vec3(0.0,0.082,-0.004), 0.202, 0.017), 13.0));                  // a cloth headband
  if (lod < 1) {
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.082,-0.2), vec3(0.045,-0.05,-0.235), 0.012), 13.0));
    r = U(r, vec2(sdCap(hq, vec3(0.0,0.082,-0.2), vec3(-0.04,-0.045,-0.24), 0.012), 13.0));
  }
  r = U(r, faceParts(hq, vec2(0.37,-0.15), vec2(0.0185,0.0245), vec3(0.37,0.11,-0.12), 1.0, vec2(-0.54,0.025), vec2(0.63,-0.36), lod));
  return r;
}

// ---------------- 23: the lantern maker (a teal jacket and skirt, cream sleeve guards, bamboo pins in her bun, a lantern frame half covered in red paper) ----------------
vec2 fig23(vec3 p, int lod, float wk, float ph, float vr, float pz){
  float s=sin(ph)*wk, c=cos(ph)*wk;
  vec3 pv = walkBody(p, ph, wk, pz); float nod = nodOf(ph, wk, pz);
  vec2 r = vec2(1e5, 0.0);
  r = U(r, shoes(p, vec3(0.07,0.034+0.075*max(c,0.),0.035+0.13*s), vec3(-0.07,0.034+0.075*max(-c,0.),0.035-0.13*s), 5.0));
  vec2 skirt = vec2(sdRobe(pv, 0.07, 0.40, 0.215, 0.145, 0.045), 3.0);
  vec2 jacket = vec2(sdRobe(pv, 0.28, 0.585, 0.172, 0.122, 0.05), 2.0);
  r = U(r, SU(skirt, jacket, 0.03));
  r = U(r, vec2(sdTorus(pv-vec3(0,0.572,0.0), 0.106, 0.015), 13.0));                      // collar
  r = U(r, vec2(sdTorus(pv-vec3(0,0.292,0.0), 0.172, 0.014), 13.0));                      // a pale band at the hem of the jacket
  if (lod < 1) r = U(r, vec2(sdTorus(pv-vec3(0,0.102,0.0), 0.210, 0.013), 13.0));
  vec3 SR = vec3(-0.138,0.50,0.0), SL = vec3(0.138,0.50,0.0);
  vec3 HRh = vec3(-0.118,0.345,0.262), HLh = vec3(0.118,0.345,0.262);
  r = U(r, arm(pv, SR, vec3(-0.225,0.40,0.10), HRh, 0.047, 0.040, 2.0, 13.0, 0.042));      // the forearms in cream sleeve guards
  r = U(r, arm(pv, SL, vec3(0.225,0.40,0.10), HLh, 0.047, 0.040, 2.0, 13.0, 0.042));
  // the lantern frame, held in front of her at the waist
  vec3 fq = pv - vec3(0.0,0.35,0.295); fq.yz = rot2(fq.yz, 0.22);
  float dfr = length(fq) - 0.22;
  if (dfr < 0.06) r = U(r, lanternFrame(fq, 0.118, 0.145, lod)); else r = U(r, vec2(dfr, 12.0));
  // head
  vec3 hc = vec3(0.0,0.80,0.0);
  vec3 hq = toBody(pv, hc, nod - HEADBACK) - hc; hq.xy = rot2(hq.xy, 0.05);
  float bh = length(hq) - 0.45;
  if (bh > 0.08) { r = U(r, vec2(bh, 0.0)); return r; }
  r = U(r, vec2(sdHead(hq), 0.0));
  r = U(r, vec2(sdEars(hq), 0.0));
  float hair = sdHairShell(hq, 0.014, vec3(0.0,0.75,-0.55), -0.02);
  hair = smin(hair, sdEll(hq-vec3(0.0,0.125,0.13), vec3(0.15,0.052,0.075)), 0.03);
  hair = smin(hair, sdSphere(hq - vec3(0.0,0.19,-0.10), 0.09), 0.04);                       // a bun at the back of the crown
  r = U(r, vec2(hair, 1.0));
  if (lod < 1) {
    r = U(r, vec2(sdCap(hq, vec3(-0.13,0.235,-0.125), vec3(0.15,0.15,-0.08), 0.0075), 15.0));   // two bamboo pins through the bun
    r = U(r, vec2(sdCap(hq, vec3(0.13,0.245,-0.13), vec3(-0.14,0.14,-0.075), 0.0075), 15.0));
  }
  r = U(r, faceParts(hq, vec2(0.36,-0.15), vec2(0.021,0.0295), vec3(0.37,0.11,0.12), 1.0, vec2(-0.54,0.026), vec2(0.62,-0.36), lod));
  return r;
}

vec2 figMap(vec3 p, int id, int lod, float wk, float ph, float vr, float pz){
  if (id==0) return fig0(p,lod,wk,ph,vr,pz);
  if (id==1) return fig1(p,lod,wk,ph,vr,pz);
  if (id==2) return fig2(p,lod,wk,ph,0.0,pz);
  if (id==3) return fig3(p,lod,wk,ph,vr,pz);
  if (id==4) return fig4(p,lod,wk,ph,vr,pz);
  if (id==5) return fig5(p,lod,wk,ph,vr,pz);
  if (id==7) return fig7(p,lod,wk,ph,vr,pz);
  if (id==8) return fig8(p,lod,wk,ph,vr,pz);
  if (id==9) return fig9(p,lod,wk,ph,0.0,pz);
  if (id==10) return fig10(p,lod,wk,ph,0.0,pz);
  if (id==11) return fig11(p,lod,wk,ph,0.0,pz);
  if (id==12) return fig12(p,lod,wk,ph,0.0,pz);
  if (id==13) return fig13(p,lod,wk,ph,0.0,pz);
  if (id==14) return fig14(p,lod,wk,ph,0.0,pz);
  if (id==15) return fig15(p,lod,wk,ph,0.0,pz);
  if (id==16) return fig16(p,lod,wk,ph,0.0,pz);
  if (id==17) return fig17(p,lod,wk,ph,0.0,pz);
  if (id==18) return fig18(p,lod,wk,ph,0.0,pz);
  if (id==19) return fig19(p,lod,wk,ph,0.0,pz);
  if (id==20) return fig20(p,lod,wk,ph,0.0,pz);
  if (id==21) return fig21(p,lod,wk,ph,0.0,pz);
  if (id==22) return fig22(p,lod,wk,ph,0.0,pz);
  if (id==23) return fig23(p,lod,wk,ph,0.0,pz);
  return fig6(p,lod,wk,ph,vr,pz);
}
