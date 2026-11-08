// ===================== places and props =====================
// Every place is modelled with its anchor at the origin: the bottom-left corner of its footprint on the ground.
// The footprint is x in [0, W], z in [-D, 0] (x to the right, -z up the map); W and D (world units) come in uP0.xy.
// uP0.z = variant (house: 0 Li, 1 Zhou; bridge: 1 = railing fallen; bamboo: pole count; lantern: 1 = lit), uP0.w spare.

float sdRoofK(vec3 q, float hx, float hz, float wallH, float ridgeH, float ovx, float ovz, float lift){
  float Zm = hz + ovz, Xm = hx + ovx;
  float zz = abs(q.z), xx = abs(q.x);
  float u = clamp(zz/Zm, 0.0, 1.0);
  float yR = wallH + ridgeH + 0.02, yE = wallH - 0.03;
  float g = 1.0 - pow(1.0-u, 1.7);
  float lf = lift*(0.15*smoothstep(0.75,1.0,u) + 0.22*smoothstep(0.62,1.0,xx/Xm)*smoothstep(0.5,1.0,u));
  float ys = mix(yR, yE, g) + lf;
  float d = (abs(q.y - ys) - 0.055) * 0.70;
  return smax(d, max(zz - Zm, xx - Xm), 0.03);
}
vec2 lanternP(vec3 q, float R, float H, int lod){          // a paper lantern with the place materials
  vec2 l = lantern(q, R, H, 9.0, lod);
  l.y = (l.y == 9.0) ? 181.0 : ((l.y == 14.0) ? 170.0 : 182.0);
  return l;
}
float decalAt(vec4 r, vec2 uv){                              // r = rectangle in the decal canvas (fractions, top-left origin); uv.y = 1 at the top
  return texture(uTex, vec2(mix(r.x, r.z, uv.x), 1.0 - (r.y + (1.0 - uv.y)*(r.w - r.y)))).a;
}

// ---------------------------------------------------------------- teahouse (white walls, dark curved roof, tea flag)
vec2 mapTeahouse(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.06, hz = 0.5*D - 0.06;
  const float WH = 1.95, RH = 0.88;
  float bb = sdBox(q - vec3(0.35, 1.9, 0.0), vec3(hx+1.1, 2.4, hz+0.9));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  vec2 r = vec2(1e5, 160.0);
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.10,0.0), vec3(hx+0.06,0.10,hz+0.06), 0.035), 167.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.045,hz+0.14), vec3(0.64,0.045,0.14), 0.02), 167.0));
  float wall = sdRBox(q - vec3(0.0, 0.2+(WH-0.2)*0.5, 0.0), vec3(hx, (WH-0.2)*0.5, hz), 0.025);
  float yy = q.y - WH;
  float gable = max(max(abs(q.x)-hx, -yy-0.05), (abs(q.z)*RH + yy*hz - RH*hz)/length(vec2(RH,hz)));
  wall = min(wall, gable);
  vec3 dq = q - vec3(0.0, 0.2+0.62, hz);
  float wx = 0.5*(0.42 + hx - 0.08);
  vec3 wq = vec3(abs(q.x) - wx, q.y - 1.0, q.z - hz);
  float whw = 0.5*(hx - 0.08 - 0.42) - 0.1;
  wall = max(wall, -sdBox(dq, vec3(0.40,0.62,0.12)));
  wall = max(wall, -sdBox(wq, vec3(whw,0.37,0.14)));
  r = U(r, vec2(wall, 160.0));
  float post = sdBox(vec3(abs(q.x)-hx, q.y-WH*0.5, abs(q.z)-hz), vec3(0.075, WH*0.5, 0.075));
  float beam = sdBox(q - vec3(0.0, WH-0.10, 0.0), vec3(hx+0.045, 0.10, hz+0.045));
  float lintel = sdBox(q - vec3(0.0, 1.50, hz+0.02), vec3(hx, 0.035, 0.04));
  float df = max(sdBox(dq, vec3(0.455,0.675,0.07)), -sdBox(dq, vec3(0.375,0.615,0.3)));
  float wf = max(sdBox(wq, vec3(whw+0.075,0.435,0.07)), -sdBox(wq, vec3(whw,0.355,0.3)));
  r = U(r, vec2(min(min(post,beam), min(min(df,wf), lintel)), 161.0));
  r = U(r, vec2(sdRBox(dq - vec3(0.0,0.0,-0.06), vec3(0.375,0.615,0.035), 0.012), 162.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.66, hz+0.05), vec3(0.54,0.105,0.028), 0.012), 169.0));
  vec3 wq2 = wq - vec3(0.0,0.0,-0.045);
  vec2 gq = (fract(wq2.xy/0.12 + 0.5) - 0.5)*0.12;
  r = U(r, vec2(max(sdBox(wq2, vec3(whw-0.005,0.365,0.014)), -(max(abs(gq.x),abs(gq.y)) - 0.044)), 165.0));
  r = U(r, vec2(sdBox(wq - vec3(0.0,0.0,-0.12), vec3(whw+0.01,0.38,0.012)), 166.0));
  r = U(r, vec2(sdRBox(vec3(abs(q.x) - wx, q.y - 0.60, q.z - hz - 0.07), vec3(whw+0.07,0.03,0.10), 0.012), 167.0));
  r = U(r, vec2(sdRoofK(q, hx, hz, WH, RH, 0.34, 0.36, 1.0), 163.0));
  float yR = WH + RH + 0.02;
  float ridge = sdCap(q, vec3(-hx-0.26, yR+0.085, 0.0), vec3(hx+0.26, yR+0.085, 0.0), 0.085);
  ridge = min(ridge, sdEll(q - vec3( hx+0.28, yR+0.19, 0.0), vec3(0.06,0.12,0.075)));
  ridge = min(ridge, sdEll(q - vec3(-hx-0.28, yR+0.19, 0.0), vec3(0.06,0.12,0.075)));
  r = U(r, vec2(ridge, 164.0));
  // tea flag on a post just right of the front corner
  vec3 fq = q - vec3(hx + 0.34, 0.0, hz - 0.04);
  r = U(r, vec2(sdRBox(fq - vec3(0.0,0.07,0.0), vec3(0.14,0.07,0.14), 0.03), 167.0));
  r = U(r, vec2(sdCap(fq, vec3(0.0,0.1,0.0), vec3(0.0,3.05,0.0), 0.034), 161.0));
  r = U(r, vec2(sdSphere(fq - vec3(0.0,3.10,0.0), 0.06), 170.0));
  r = U(r, vec2(sdCap(fq, vec3(0.0,2.94,0.0), vec3(0.50,2.94,0.0), 0.016), 161.0));
  vec3 cq = fq - vec3(0.27, 2.38, 0.0);
  cq.z += 0.05*sin(cq.x*6.0+0.6)*smoothstep(-0.3,0.3,cq.x);
  float cloth = sdBox(cq, vec3(0.27, 0.54, 0.010));
  cloth = max(cloth, (cq.x - 0.12 - 0.26*abs(cq.y))*0.8);
  r = U(r, vec2(cloth*0.8, 168.0));
  return r;
}

// ---------------------------------------------------------------- the two family houses (stepped gable ends, a plaque with the surname)
vec2 mapHouse(vec3 p, int lod){
  float W = uP0.x, D = uP0.y, zhou = uP0.z;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  const float WH = 1.62, RH = 0.62;
  float bb = sdBox(q - vec3(0.0, 1.6, 0.1), vec3(hx+0.5, 2.0, hz+0.7));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  vec2 r = vec2(1e5, 160.0);
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.09,0.0), vec3(hx+0.05,0.09,hz+0.05), 0.03), 167.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.04,hz+0.12), vec3(0.50,0.04,0.12), 0.02), 167.0));
  float wall = sdRBox(q - vec3(0.0, 0.18+(WH-0.18)*0.5, 0.0), vec3(hx, (WH-0.18)*0.5, hz), 0.025);
  float yy = q.y - WH;
  float gable = max(max(abs(q.x)-hx, -yy-0.05), (abs(q.z)*RH + yy*hz - RH*hz)/length(vec2(RH,hz)));
  wall = min(wall, gable);
  vec3 dq = q - vec3(0.0, 0.18+0.52, hz);
  float wx = 0.98, whw = 0.26;
  vec3 wq = vec3(abs(q.x) - wx, q.y - 0.98, q.z - hz);
  wall = max(wall, -sdBox(dq, vec3(0.34,0.52,0.12)));
  wall = max(wall, -sdBox(wq, vec3(whw,0.27,0.14)));
  r = U(r, vec2(wall, 160.0));
  float post = sdBox(vec3(abs(q.x)-hx, q.y-WH*0.5, abs(q.z)-hz), vec3(0.06, WH*0.5, 0.06));
  float beam = sdBox(q - vec3(0.0, WH-0.08, 0.0), vec3(hx+0.04, 0.08, hz+0.04));
  float df = max(sdBox(dq, vec3(0.385,0.565,0.07)), -sdBox(dq, vec3(0.315,0.505,0.3)));
  float wf = max(sdBox(wq, vec3(whw+0.06,0.33,0.07)), -sdBox(wq, vec3(whw,0.27,0.3)));
  r = U(r, vec2(min(min(post,beam), min(df,wf)), 161.0));
  r = U(r, vec2(sdRBox(dq - vec3(0.0,0.0,-0.06), vec3(0.315,0.505,0.035), 0.012), 162.0));
  vec3 wq2 = wq - vec3(0.0,0.0,-0.04);
  vec2 gq = (fract(wq2.xy/0.10 + 0.5) - 0.5)*0.10;
  r = U(r, vec2(max(sdBox(wq2, vec3(whw-0.005,0.265,0.012)), -(max(abs(gq.x),abs(gq.y)) - 0.036)), 165.0));
  r = U(r, vec2(sdBox(wq - vec3(0.0,0.0,-0.11), vec3(whw+0.01,0.28,0.012)), 166.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.34, hz+0.04), vec3(0.20,0.20,0.02), 0.01), 169.0));        // the surname plaque
  r = U(r, vec2(sdRoofK(q, hx, hz, WH, RH, 0.04, 0.30, zhou > 0.5 ? 0.9 : 0.35), 163.0));       // the roof ends at the gable walls
  float yR = WH + RH + 0.02;
  r = U(r, vec2(sdCap(q, vec3(-hx-0.10, yR+0.075, 0.0), vec3(hx+0.10, yR+0.075, 0.0), 0.072), 164.0));
  // stepped gable ends (horse-head walls, the old river towns): low walls that follow the roof slope from the ridge to the eaves in four steps
  float az = abs(q.z);
  float Zm = hz + 0.30;                                                                       // the depth of the roof sheet (sdRoofK)
  float ui = floor(clamp(az/Zm, 0.0, 0.999)*4.0)/4.0;
  float top = mix(yR - 0.02, WH - 0.03, 1.0 - pow(1.0 - ui, 1.7)) + 0.09;                      // the top of the step: a little above the roof at its high end
  float gw = max(abs(abs(q.x) - hx - 0.01) - 0.055, max(az - hz - 0.02, max(q.y - top, 0.2 - q.y)));
  r = U(r, vec2(gw, 160.0));
  float cap = max(abs(abs(q.x) - hx - 0.01) - 0.085, max(az - hz - 0.045, max(abs(q.y - top - 0.02) - 0.026, 0.0)));
  r = U(r, vec2(cap, 163.0));
  if (zhou > 0.5) {                     // a striped awning over the door and a hanging shop sign
    vec3 aq = q - vec3(0.0, 1.30, hz + 0.20); aq.yz = rot2(aq.yz, 0.30);
    r = U(r, vec2(sdRBox(aq, vec3(0.50,0.018,0.23), 0.012), 177.0));
    r = U(r, vec2(sdCap(q, vec3(0.50, 1.28, hz+0.02), vec3(0.50, 1.28, hz+0.36), 0.012), 161.0));
    r = U(r, vec2(sdCap(q, vec3(-0.50, 1.28, hz+0.02), vec3(-0.50, 1.28, hz+0.36), 0.012), 161.0));
    vec3 sq = q - vec3(hx - 0.02, 1.20, hz + 0.16);
    r = U(r, vec2(sdCap(sq, vec3(0.0,0.2,-0.14), vec3(0.0,0.2,0.0), 0.014), 161.0));
    r = U(r, vec2(sdCap(sq, vec3(0.0,0.2,0.0), vec3(0.0,-0.02,0.0), 0.006), 161.0));
    r = U(r, vec2(sdRBox(sq - vec3(0.0,-0.12,0.0), vec3(0.075,0.10,0.014), 0.01), 177.0));
  } else {                              // Li: a strip of indigo cloth over the door
    r = U(r, vec2(sdRBox(q - vec3(0.0, 1.17, hz+0.03), vec3(0.45,0.045,0.014), 0.008), 183.0));
  }
  return r;
}

// ---------------------------------------------------------------- the ferry pier: planks on piles, mooring posts, a rope, a crate and a basket
vec2 mapPier(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W, hz = 0.5*D;
  float bb = sdBox(q - vec3(0.0, 0.1, 0.0), vec3(hx+0.35, 0.85, hz+0.35));
  if (bb > 0.15) return vec2(bb + (lod==1 ? 1.2 : 0.2), 178.0);
  vec2 r = vec2(sdBox(q - vec3(0.0,-0.045,0.0), vec3(hx, 0.045, hz)) - 0.012, 178.0);
  r = U(r, vec2(sdBox(vec3(q.x, q.y + 0.17, abs(q.z) - hz + 0.07), vec3(hx - 0.04, 0.05, 0.05)), 179.0));       // stringers
  for (int i=0;i<2;i++) for (int j=0;j<2;j++) {
    vec3 pq = q - vec3((i==0 ? -1.0 : 1.0)*(hx - 0.09), -0.20, (j==0 ? -1.0 : 1.0)*(hz - 0.09));
    r = U(r, vec2(sdCylY(pq, 0.50, 0.062) - 0.01, 179.0));
  }
  float m1 = sdCylY(q - vec3(-hx + 0.09, 0.30, hz - 0.09), 0.30, 0.050);                                      // taller mooring posts at the water side
  m1 = min(m1, sdCylY(q - vec3(-hx + 0.09, 0.30, -hz + 0.09), 0.30, 0.050));
  r = U(r, vec2(m1 - 0.008, 179.0));
  r = U(r, vec2(sdSphere(q - vec3(-hx + 0.09, 0.62, hz - 0.09), 0.058), 179.0));
  r = U(r, vec2(sdSphere(q - vec3(-hx + 0.09, 0.62, -hz + 0.09), 0.058), 179.0));
  float sag = 0.0;
  vec3 a = vec3(-hx + 0.09, 0.50, hz - 0.09), b = vec3(hx - 0.09, 0.30, hz - 0.09);          // a rope from the mooring post to the shore post
  float rope = 1e5;
  for (int i=0;i<6;i++){ float t0 = float(i)/6.0, t1 = float(i+1)/6.0; vec3 pa = mix(a,b,t0), pb2 = mix(a,b,t1); pa.y -= 0.12*4.0*t0*(1.0-t0); pb2.y -= 0.12*4.0*t1*(1.0-t1); rope = min(rope, sdCap(q, pa, pb2, 0.014)); }
  r = U(r, vec2(rope, 174.0));
  r = U(r, vec2(sdRBox(q - vec3(hx - 0.30, 0.10, -hz + 0.20), vec3(0.11,0.10,0.10), 0.015), 180.0));        // crate
  r = U(r, vec2(sdCylY(q - vec3(hx - 0.34, 0.07, hz - 0.18), 0.07, 0.10) - 0.012, 180.0));                  // basket
  r = U(r, vec2(sdTorus(q - vec3(-hx + 0.30, 0.012, 0.0), 0.075, 0.020), 174.0));                           // coiled rope
  return r;
}

// ---------------------------------------------------------------- the single-arch stone bridge, whole or with the near railing fallen
float bridgeDeckY(float x){ float h = BR_H; return h*(1.0 - smoothstep(0.30, BR_X, abs(x))); }
vec2 mapBridge(vec3 p, int lod){
  float damaged = uP0.z;
  vec3 q = p - vec3(0.5*uP0.x, 0.0, -0.5*uP0.y);
  float bb = sdBox(q - vec3(0.0,0.5,0.55), vec3(BR_X+0.35, 1.5, 1.45));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.3), 171.0);
  float x = q.x, ax = abs(x), yd = bridgeDeckY(x);
  // body: soft-edged slab under the deck line, as wide as the deck
  float body = smax((q.y - yd)*0.75, abs(q.z) - BR_W, 0.07);
  body = smax(body, ax - BR_X, 0.09);
  body = smax(body, -q.y + mix(-0.8, -0.0, smoothstep(BR_AW - 0.03, BR_AW + 0.03, ax)), 0.02);       // below ground level only inside the canal channel
  // slabs missing from the deck edge (damaged state): rounded bites out of the near edge
  if (damaged > 0.5) {
    float hl = max(abs(x - 0.34) - 0.40, abs(q.z - 0.46) - 0.20);
    hl = min(hl, max(abs(x + 0.50) - 0.19, abs(q.z - 0.16) - 0.17));
    hl = min(hl, max(abs(x + 0.06) - 0.17, abs(q.z - 0.20) - 0.16));
    body = smax(body, -smax(hl, (yd - 0.17) - q.y, 0.05), 0.03);
  }
  // arch: semi-ellipse above the springing line, canal channel below
  vec2 e = vec2(x/BR_AW, q.y/BR_AH);
  float tun = (q.y > 0.0) ? (length(e) - 1.0)*min(BR_AW, BR_AH)*0.85 : (ax - BR_AW);
  body = smax(body, -tun, 0.03);
  vec2 r = vec2(body, 171.0);
  float eR = length(e);                                                // voussoir ring, a little proud of both faces, with a keystone
  float ring = max(max(eR - 1.20, 1.0 - eR)*min(BR_AW, BR_AH)*0.85, abs(q.z) - (BR_W + 0.04));
  ring = max(max(ring, -q.y - 0.02), ax - BR_AW - 0.3);
  float key = max(max(abs(x) - 0.10, abs(q.y - BR_AH*1.10) - 0.12), abs(q.z) - (BR_W + 0.06));
  r = U(r, vec2(smin(ring, key, 0.03), 172.0));
  // railings: panels with rounded tops between posts with round caps
  for (int sd=0; sd<2; sd++) {
    float side = (sd == 0) ? 1.0 : -1.0;
    float zc = side*(BR_W - 0.075);
    float dyb = (yd - 0.03) - q.y;
    float panel = smax(max(abs(q.z - zc) - 0.065, dyb), q.y - (yd + 0.30), 0.03);
    panel = smax(panel, ax - (BR_X - 0.14), 0.03);
    float xe = BR_X - 0.15, ps = 0.5*xe;                              // five posts, the end ones fully on the deck
    float px = (fract((x + xe)/ps + 0.5) - 0.5)*ps;
    float post = smax(max(abs(px) - 0.085, abs(q.z - zc) - 0.095), max(dyb, q.y - (yd + 0.42)), 0.025);
    post = max(post, ax - (xe + 0.11));
    float cap = max(sdSphere(vec3(px, q.y - (yd + 0.48), q.z - zc), 0.10), ax - (xe + 0.11));
    if (side > 0.0 && damaged > 0.5) {                              // the stretch between x = 0 and the next post has fallen; that post is broken off
      panel = max(panel, -(abs(x - 0.5*ps) - 0.5*ps));
      float stump = step(abs(x - ps), 0.2);
      post = mix(post, max(post, q.y - (yd + 0.16)), stump);
      cap = mix(cap, 1e3, stump);
    }
    r = U(r, vec2(min(min(panel, post), cap)*0.8, 171.0));
  }
  if (damaged > 0.5) {                                               // the fallen pieces lie in the canal in front of the bridge
    vec3 d1 = q - vec3(0.40, -0.36, 1.05); d1.xz = rot2(d1.xz, 0.45); d1.xy = rot2(d1.xy, 0.28);
    r = U(r, vec2(sdRBox(d1, vec3(0.38,0.055,0.12), 0.02), 171.0));
    vec3 d2 = q - vec3(0.80, -0.28, 0.86); d2.xy = rot2(d2.xy, 1.25); d2.xz = rot2(d2.xz, -0.4);
    r = U(r, vec2(sdRBox(d2, vec3(0.085,0.22,0.085), 0.02), 171.0));
    r = U(r, vec2(sdSphere(q - vec3(-0.06,-0.35,1.22), 0.095), 171.0));
    r = U(r, vec2(sdRBox(q - vec3(0.62,-0.37,1.28), vec3(0.07,0.045,0.055), 0.02), 171.0));
    r = U(r, vec2(sdRBox(q - vec3(0.10,-0.38,0.92), vec3(0.055,0.04,0.06), 0.02), 171.0));
    r = U(r, vec2(sdRBox(q - vec3(-0.34,-0.38,1.02), vec3(0.06,0.04,0.045), 0.02), 171.0));
  }
  return r;
}

// ---------------------------------------------------------------- bamboo poles lying in a pile (4 or 10), tied with rope
vec2 mapBamboo(vec3 p, int lod){
  float W = uP0.x, D = uP0.y, cnt = uP0.z;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float bb = sdBox(q - vec3(0.0,0.2,0.0), vec3(0.75,0.40,0.62));
  if (bb > 0.12) return vec2(bb + (lod==1 ? 1.0 : 0.0), 173.0);
  float d = 1e5;
  int n = (cnt > 5.0) ? 10 : 4;
  for (int i=0;i<10;i++){
    if (i >= n) break;
    float fi = float(i);
    float row = (i<4) ? 0.0 : ((i<7) ? 1.0 : ((i<9) ? 2.0 : 3.0));
    float idx = (i<4) ? fi : ((i<7) ? fi-4.0 : ((i<9) ? fi-7.0 : 0.0));
    float rc = (i<4) ? 4.0 : ((i<7) ? 3.0 : ((i<9) ? 2.0 : 1.0));
    if (n == 4) { row = (i<3) ? 0.0 : 1.0; idx = (i<3) ? fi : 0.0; rc = (i<3) ? 3.0 : 1.0; }
    float zc = (idx - 0.5*(rc-1.0))*0.092 + (hash11(fi*3.7)-0.5)*0.012;
    float yc = 0.044 + row*0.079;
    float len = 0.48 + 0.14*hash11(fi*5.3);
    float xo = (hash11(fi*9.1)-0.5)*0.18;
    d = min(d, sdCap(q, vec3(xo - len, yc, zc), vec3(xo + len, yc, zc + (hash11(fi*2.1)-0.5)*0.03), 0.044));
  }
  if (n == 10) {                                           // a few loose poles round the big pile
    d = min(d, sdCap(q, vec3(-0.30,0.34,-0.08), vec3(0.45,0.31,0.26), 0.042));
    d = min(d, sdCap(q, vec3(-0.50,0.045,0.38), vec3(0.20,0.045,0.50), 0.042));
  }
  vec2 r = vec2(d, 173.0);
  vec2 cq = q.yz - vec2(n == 10 ? 0.13 : 0.10, 0.0);
  float rr = n == 10 ? 0.205 : 0.145;
  float rope = max(abs(q.x + 0.10) - 0.028, abs(length(cq) - rr) - 0.015);
  rope = min(rope, max(abs(q.x - 0.34) - 0.028, abs(length(cq) - rr) - 0.015));
  r = U(r, vec2(rope, 174.0));
  return r;
}

// ---------------------------------------------------------------- a door lantern on its bracket; the anchor is the point on the wall where the bracket is fixed
vec2 mapLantern(vec3 p, int lod){
  vec3 q = p/LANTERN_S;                                    // modelled at the first size, drawn LANTERN_S times bigger about the anchor
  vec2 r = vec2(sdRBox(q - vec3(0.0,-0.02,-0.03), vec3(0.055,0.10,0.025), 0.01), 161.0);
  r = U(r, vec2(sdCap(q, vec3(0.0,0.0,-0.01), vec3(0.0,0.015,0.27), 0.015), 161.0));
  r = U(r, vec2(sdCap(q, vec3(0.0,-0.075,0.0), vec3(0.0,0.0,0.19), 0.010), 161.0));
  r = U(r, vec2(sdSphere(q - vec3(0.0,0.015,0.27), 0.022), 161.0));
  r = U(r, vec2(sdCap(q, vec3(0.0,0.015,0.27), vec3(0.0,-0.035,0.27), 0.005), 182.0));
  r = U(r, lanternP(q - vec3(0.0,-0.035-0.11,0.27), 0.082, 0.10, lod));
  r.x *= LANTERN_S; return r;
}

// ---------------------------------------------------------------- the willow: a forked trunk, and long thin fronds that arch out of the crown and droop, in four layers
vec3 frondPt(float t, float r0, float R, float yt, float ye, float sw){
  float x = r0 + (R - r0)*(1.0 - 0.9*(1.0 - t)*(1.0 - t));
  float y = yt + 0.30*sin(3.14159*min(t*1.3, 1.0))*(1.0 - t) - (yt - ye)*t*t;
  return vec3(x, y, sw*t*t);
}
vec2 mapWillow(vec3 p, int lod){
  const float SCW = 0.80;
  vec3 q = (p - vec3(0.5*uP0.x, 0.0, -0.5*uP0.y))/SCW;
  float bb = sdBox(q - vec3(0.0,2.0,0.0), vec3(2.0,2.4,2.0));
  if (bb > 0.3) return vec2((bb + (lod==1 ? 1.6 : 0.3))*SCW, 175.0);
  float trunk = sdRoundCone(q, vec3(0.0,0.0,0.0), vec3(0.14,1.0,0.0), 0.25, 0.17);
  trunk = smin(trunk, sdRoundCone(q, vec3(0.14,1.0,0.0), vec3(-0.04,1.9,0.04), 0.17, 0.12), 0.10);
  for (int k=0;k<4;k++){                                   // a few limbs from the top of the trunk, mostly hidden under the fronds
    float a = float(k)*1.5708 + 0.4;
    vec3 tip = vec3(cos(a)*0.38, 2.52 + 0.08*hash11(float(k)*7.7), sin(a)*0.38);
    trunk = smin(trunk, sdCap(q, vec3(-0.04,1.85,0.04), tip, 0.05), 0.07);
  }
  vec2 r = vec2(trunk, 175.0);
  if (lod == 1) {                                          // shadow and AO rays: the crown is a soft, tall dome, not a thousand threads
    r = U(r, vec2(sdEll(q - vec3(0.0,2.25,0.0), vec3(1.25,0.95,1.25)), 176.0));
    r.x *= SCW; return r;
  }
  float ang = atan(q.z, q.x);
  float best = 1e5; float bid = 0.0;
  for (int ring=0; ring<4; ring++){
    float N  = (ring==0) ? 66.0 : ((ring==1) ? 52.0 : ((ring==2) ? 40.0 : 28.0)); float sec = 2.0*PI/N;
    float r0 = (ring==0) ? 0.30 : ((ring==1) ? 0.20 : ((ring==2) ? 0.10 : 0.02));
    float Rm = (ring==0) ? 1.30 : ((ring==1) ? 1.02 : ((ring==2) ? 0.74 : 0.46));
    float yb = (ring==0) ? 0.55 : ((ring==1) ? 0.95 : ((ring==2) ? 1.35 : 1.80));
    float m0 = floor(ang/sec - 0.5);
    for (int k=0;k<2;k++){
      float ia = mod(m0 + float(k), N); float sd = ia*1.37 + float(ring)*17.0;
      float hh = hash11(sd);
      float a = (m0 + float(k) + 0.5 + 0.60*(hash11(sd+3.0)-0.5))*sec;
      float ca = cos(a), sa = sin(a);
      vec3 ql = vec3(q.x*ca + q.z*sa, q.y, (-q.x*sa + q.z*ca));
      float R = Rm*(0.86 + 0.28*hash11(sd+5.0)), ye = yb + 0.75*hh, sw = (hash11(sd+9.0) - 0.5)*0.16;
      vec3 pa = frondPt(0.0, r0, R, 2.88, ye, sw);
      float d = 1e5;
      for (int sg=0; sg<6; sg++){
        float t0 = float(sg)/6.0, t1 = t0 + 1.0/6.0; vec3 pb = frondPt(t1, r0, R, 2.88, ye, sw);
        d = min(d, sdRoundCone(ql, pa, pb, 0.024 - 0.014*t0, 0.024 - 0.014*t1)); pa = pb;
      }
      if (d < best) { best = d; bid = float(ring) + hh*0.5; }
    }
  }
  r = U(r, vec2(best, 176.0));
  r = U(r, vec2(sdEll(q - vec3(0.0,2.90,0.0), vec3(0.34,0.12,0.34)) + 0.02*sin(q.x*14.0)*sin(q.z*14.0), 184.0));   // a small tuft of leaves where the fronds spring from
  r.x *= SCW;
  gBid = bid;
  return r;
}
