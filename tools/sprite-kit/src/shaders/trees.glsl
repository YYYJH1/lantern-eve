// ===================== trees, stone heaps and the clutter of the lane =====================
// One cell each: the model stands on the middle of its footprint (x in [0, W], z in [-D, 0]).
// uP0.z picks the model: 0 round broadleaf (tall crown), 1 cypress, 2 clump of bamboo, 3 mossy stone heap, 4 pile of junk, 5 round broadleaf (low, wide crown).

vec3 treeQ(vec3 p){ return p - vec3(0.5*uP0.x, 0.0, -0.5*uP0.y); }

// leafy lumps on a crown: a little noise on the distance, off in the shadow and AO rays (lod 1)
float leafy(vec3 q, float k, int lod){ return lod < 1 ? k*sin(q.x*19.0)*sin(q.y*17.0 + 1.0)*sin(q.z*21.0) : 0.0; }

vec2 mapTreeRound(vec3 q0, int lod, float wide){
  const float S = 1.15;
  vec3 q = q0/S;
  float bb = sdBox(q - vec3(0.0, 0.95, 0.0), vec3(0.66, 0.95, 0.66));
  if (bb > 0.2) return vec2((bb + (lod==1 ? 1.0 : 0.2))*S, 175.0);
  vec2 r = vec2(sdRoundCone(q, vec3(0.0,0.0,0.0), vec3(0.03,0.66,0.0), 0.078, 0.05), 175.0);
  r = U(r, vec2(sdCap(q, vec3(0.03,0.6,0.0), vec3(-0.17,0.95,0.04), 0.03), 175.0));
  r = U(r, vec2(sdCap(q, vec3(0.03,0.6,0.0), vec3(0.2,0.92,-0.03), 0.028), 175.0));
  float c;
  if (wide < 0.5) {                      // tall crown: a cluster of balls
    c = sdSphere(q - vec3(0.00,1.06,0.00), 0.40);
    c = smin(c, sdSphere(q - vec3(-0.28,0.88,0.06), 0.30), 0.14);
    c = smin(c, sdSphere(q - vec3( 0.29,0.90,-0.04), 0.31), 0.14);
    c = smin(c, sdSphere(q - vec3( 0.02,0.86,0.28), 0.28), 0.14);
    c = smin(c, sdSphere(q - vec3(-0.05,1.36,-0.04), 0.27), 0.14);
    c = smin(c, sdSphere(q - vec3( 0.17,1.24,0.16), 0.22), 0.12);
  } else {                               // low, wide crown: an umbrella of flat lobes
    c = sdEll(q - vec3(0.00,1.04,0.00), vec3(0.44,0.30,0.40));
    c = smin(c, sdEll(q - vec3(-0.27,0.90,0.07), vec3(0.28,0.24,0.27)), 0.12);
    c = smin(c, sdEll(q - vec3( 0.28,0.92,-0.05), vec3(0.29,0.25,0.27)), 0.12);
    c = smin(c, sdEll(q - vec3( 0.03,0.88,0.27), vec3(0.30,0.24,0.23)), 0.12);
    c = smin(c, sdEll(q - vec3(-0.03,1.26,-0.03), vec3(0.30,0.22,0.28)), 0.12);
  }
  c += leafy(q, 0.022, lod);
  r = U(r, vec2(c, 189.0));
  r.x *= S;
  return r;
}

vec2 mapTreeCypress(vec3 q, int lod){
  float bb = sdBox(q - vec3(0.0, 1.22, 0.0), vec3(0.42, 1.28, 0.42));
  if (bb > 0.2) return vec2(bb + (lod==1 ? 1.0 : 0.2), 175.0);
  vec2 r = vec2(sdRoundCone(q, vec3(0.0,0.0,0.0), vec3(0.0,0.55,0.0), 0.07, 0.05), 175.0);
  float c = sdEll(q - vec3( 0.00,0.66,0.00), vec3(0.31,0.36,0.30));
  c = smin(c, sdEll(q - vec3( 0.03,0.98,0.00), vec3(0.29,0.36,0.28)), 0.12);
  c = smin(c, sdEll(q - vec3(-0.02,1.30,0.02), vec3(0.25,0.36,0.24)), 0.12);
  c = smin(c, sdEll(q - vec3( 0.02,1.60,0.00), vec3(0.20,0.34,0.19)), 0.12);
  c = smin(c, sdEll(q - vec3( 0.00,1.90,0.01), vec3(0.13,0.30,0.12)), 0.10);
  c = smin(c, sdEll(q - vec3( 0.00,2.14,0.00), vec3(0.06,0.18,0.06)), 0.08);
  c += leafy(q, 0.016, lod);
  return U(r, vec2(c, 189.0));
}

vec2 mapTreeBamboo(vec3 q, int lod){
  float bb = sdBox(q - vec3(0.0, 1.05, 0.0), vec3(0.62, 1.15, 0.58));
  if (bb > 0.15) return vec2(bb + (lod==1 ? 1.0 : 0.1), 173.0);
  float st = 1e5, lf = 1e5;
  for (int i=0;i<9;i++){
    float fi = float(i);
    float a = fi*2.399 + 0.5, rad = 0.05 + 0.15*hash11(fi*3.1 + 1.0);
    vec3 base = vec3(cos(a)*rad, 0.0, sin(a)*rad*0.8);
    float h = 1.50 + 0.62*hash11(fi*5.7 + 2.0), lean = 0.13 + 0.16*hash11(fi*2.3 + 7.0);
    vec3 top = base + vec3(cos(a)*lean, h, sin(a)*lean*0.8);
    vec3 mid = mix(base, top, 0.55);
    float s = min(sdCap(q, base, mid, 0.027), sdCap(q, mid, top, 0.022));
    st = min(st, s);
    if (lod < 1 || i < 5) {
      for (int k=0;k<3;k++){                                  // three slender leaves at the top of each stalk, drooping
        float ka = a + float(k)*2.094 + fi*0.7;
        vec3 d = q - (top + vec3(cos(ka), 0.0, sin(ka)*0.8)*0.10 - vec3(0.0,0.05,0.0));
        d.xz = rot2(d.xz, ka); d.xy = rot2(d.xy, 0.45);
        lf = min(lf, sdEll(d, vec3(0.19, 0.022, 0.052)));
      }
    }
  }
  vec2 r = vec2(st, 173.0);
  return U(r, vec2(lf, 189.0));
}

vec2 mapStones(vec3 q, int lod){
  float bb = sdBox(q - vec3(0.0, 0.22, 0.0), vec3(0.56, 0.32, 0.50));
  if (bb > 0.12) return vec2(bb + (lod==1 ? 0.8 : 0.1), 190.0);
  vec3 a = q - vec3(-0.12,0.17,0.02); a.xz = rot2(a.xz, 0.5);
  float d = sdEll(a, vec3(0.34,0.22,0.26));
  vec3 b = q - vec3(0.25,0.12,0.10); b.xz = rot2(b.xz, -0.4);
  d = smin(d, sdEll(b, vec3(0.23,0.16,0.20)), 0.05);
  vec3 c = q - vec3(0.03,0.31,-0.10); c.xz = rot2(c.xz, 0.9);
  d = smin(d, sdEll(c, vec3(0.21,0.17,0.19)), 0.05);
  vec3 e = q - vec3(-0.30,0.08,0.20);
  d = smin(d, sdEll(e, vec3(0.16,0.10,0.14)), 0.04);
  vec3 f = q - vec3(0.14,0.06,0.30);
  d = smin(d, sdEll(f, vec3(0.12,0.08,0.10)), 0.04);
  d += (lod < 1) ? 0.008*sin(q.x*31.0 + q.z*17.0)*sin(q.y*27.0) : 0.0;
  return vec2(d, 190.0);
}

vec2 mapJunk(vec3 q, int lod){
  float bb = sdBox(q - vec3(0.0, 0.25, 0.0), vec3(0.50, 0.30, 0.42));
  if (bb > 0.12) return vec2(bb + (lod==1 ? 0.8 : 0.1), 180.0);
  vec3 a = q - vec3(-0.15,0.14,0.07); a.xz = rot2(a.xz, 0.28);
  vec2 r = vec2(sdRBox(a, vec3(0.17,0.14,0.15), 0.015), 180.0);
  vec3 b = q - vec3(0.19,0.115,0.13); b.xz = rot2(b.xz, -0.35);
  r = U(r, vec2(sdRBox(b, vec3(0.14,0.115,0.12), 0.015), 180.0));
  vec3 c = q - vec3(0.02,0.14,-0.22);
  r = U(r, vec2(sdCylY(c, 0.14, 0.12) - 0.012, 179.0));
  r = U(r, vec2(sdCylY(c - vec3(0.0,0.05,0.0), 0.012, 0.128), 174.0));
  r = U(r, vec2(sdCap(q, vec3(-0.36,0.02,0.20), vec3(0.34,0.44,-0.08), 0.032), 161.0));            // a plank leaning on the heap
  r = U(r, vec2(sdCap(q, vec3(-0.30,0.05,-0.10), vec3(0.22,0.30,0.25), 0.026), 179.0));
  return r;
}

vec2 mapTree(vec3 p, int lod){
  vec3 q = treeQ(p);
  float v = uP0.z;
  if (v < 0.5) return mapTreeRound(q, lod, 0.0);
  if (v < 1.5) return mapTreeCypress(q, lod);
  if (v < 2.5) return mapTreeBamboo(q, lod);
  if (v < 3.5) return mapStones(q, lod);
  if (v < 4.5) return mapJunk(q, lod);
  return mapTreeRound(q, lod, 1.0);
}
