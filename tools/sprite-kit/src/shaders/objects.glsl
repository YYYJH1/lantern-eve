// ===================== the three things of the corner of the page: the elder's seal, the notebook and the incense burner =====================
// This file is the models of a program of its own (engine.js, program 'objects'): the same marcher and figures as the program of the places, with
// these models in place of the places, so that nothing the places are baked with changes. Each thing stands on the ground with the middle of its
// footprint at the anchor (W = D = 0 in uP0): x to the right, -z up the map, y up. uP0.z is the variant: the burner 0 = unlit, 1 = lit (a glowing
// tip and a thread of smoke). The material codes 160 to 172 are what main() sends to placeMat.

const int OBJ_SEAL = 16, OBJ_NOTEBOOK = 17, OBJ_BURNER = 18;
const float M_STONE = 160.0, M_CARVE = 161.0, M_CORD = 162.0, M_CLOTH = 163.0, M_PAGES = 164.0, M_LABEL = 165.0, M_THREAD = 166.0;
const float M_BRONZE = 167.0, M_ASH = 168.0, M_STICK = 169.0, M_EMBER = 170.0, M_BURNT = 171.0, M_SMOKE = 172.0;
// where the characters are in the decal canvas of the objects (pixels, top-left origin; makeObjectsDecal in places.js draws them there)
const vec4 DECAL_SEAL  = vec4(520.0, 776.0, 650.0, 1018.0)/1024.0;
const vec4 DECAL_LABEL = vec4(800.0, 530.0, 904.0, 890.0)/1024.0;

float decalAt(vec4 r, vec2 uv){                              // r = rectangle in the decal canvas (fractions, top-left origin); uv.y = 1 at the top
  return texture(uTex, vec2(mix(r.x, r.z, uv.x), 1.0 - (r.y + (1.0 - uv.y)*(r.w - r.y)))).a;
}
vec4 nightLight(int code, vec3 pw, vec3 n, float ao){ return vec4(0.0); }          // nothing here is a window

// ---------------------------------------------------------------- the seal: a square pillar of pale stone with a stepped knob and the character 族 cut in its face
vec2 mapSeal(vec3 p, int lod){
  float bb = sdBox(p - vec3(0.0, 0.70, 0.0), vec3(0.62, 0.85, 0.50));
  if (bb > 0.15) return vec2(bb + (lod==1 ? 0.6 : 0.1), M_STONE);
  vec3 b = p - vec3(0.0, 0.52, 0.0);
  float body = sdRBox(b, vec3(0.30, 0.52, 0.30), 0.035);
  float recess = sdRBox(b - vec3(0.0, -0.02, 0.30), vec3(0.235, 0.42, 0.04), 0.012);        // the panel of the face is cut back
  body = max(body, -recess);
  vec2 r = vec2(body, M_STONE);
  r = U(r, vec2(sdRBox(b - vec3(0.0, -0.02, 0.272), vec3(0.215, 0.40, 0.012), 0.004), M_CARVE));
  // the knob: a step and a squat bucket turned upside down, a cord tied round its foot with a short tassel
  float kt = clamp((p.y - 1.04)/0.22, 0.0, 1.0), ks = mix(1.0, 0.55, kt);
  float knob = sdRBox(vec3(p.x/ks, p.y - 1.15, p.z/ks), vec3(0.15, 0.11, 0.15), 0.045)*ks;
  r = U(r, vec2(knob, M_STONE));
  r = U(r, vec2(sdTorus(p - vec3(0.0, 1.085, 0.0), 0.152, 0.018), M_CORD));
  r = U(r, vec2(sdCap(p, vec3(0.105, 1.075, 0.11), vec3(0.19, 1.00, 0.27), 0.016), M_CORD));
  r = U(r, vec2(sdCap(p, vec3(0.19, 1.00, 0.27), vec3(0.205, 0.905, 0.31), 0.016), M_CORD));
  r = U(r, vec2(sdEll(p - vec3(0.205, 0.862, 0.312), vec3(0.027, 0.062, 0.027)), M_CORD));
  return r;
}

// ---------------------------------------------------------------- the notebook: a thread-bound book lying flat, indigo cloth, the spine on the right, a paper label on the cover
vec2 mapNotebook(vec3 p, int lod){
  const vec3 H = vec3(0.46, 0.115, 0.60);
  vec3 c = p - vec3(0.0, H.y, 0.0);
  float bb = sdBox(c, vec3(0.56, 0.17, 0.70));
  if (bb > 0.12) return vec2(bb + (lod==1 ? 0.6 : 0.1), M_CLOTH);
  // two boards of cloth and the spine between them; the page block sits back from the edges of the boards on the three open sides
  float shell = sdRBox(c, H, 0.014);
  float open_ = sdBox(c - vec3(-0.5, 0.0, 0.0), vec3(0.5 + H.x - 0.075, H.y - 0.032, 1.0));
  vec2 r = vec2(max(shell, -open_), M_CLOTH);
  float pages = sdBox(c - vec3(-0.012, 0.0, 0.0), vec3(H.x - 0.045, H.y - 0.027, H.z - 0.030));
  r = U(r, vec2(pages, M_PAGES));
  // the label of the cover, and the thread: four holes down the margin of the spine, each with its stitch across the edge
  r = U(r, vec2(sdRBox(c - vec3(-0.17, H.y + 0.004, -0.02), vec3(0.13, 0.006, 0.45), 0.003), M_LABEL));
  for (int i=0;i<4;i++){
    float z = -0.42 + 0.28*float(i);
    r = U(r, vec2(sdCap(c, vec3(0.30, H.y + 0.006, z), vec3(H.x + 0.010, H.y + 0.006, z), 0.012), M_THREAD));
    r = U(r, vec2(sdCap(c, vec3(H.x + 0.012, H.y + 0.002, z), vec3(H.x + 0.012, -H.y - 0.002, z), 0.012), M_THREAD));
  }
  r = U(r, vec2(sdCap(c, vec3(0.30, H.y + 0.006, -0.42), vec3(0.30, H.y + 0.006, 0.42), 0.008), M_THREAD));
  return r;
}

// ---------------------------------------------------------------- the incense burner: a bronze bowl on three legs with two upright ears, ash in it and a stick of incense
vec2 mapBurner(vec3 p, int lod){
  float lit = uP0.z;
  float bb = sdBox(p - vec3(0.0, 0.75, 0.0), vec3(0.62, 0.90, 0.52));
  if (bb > 0.15) return vec2(bb + (lod==1 ? 0.8 : 0.1), M_BRONZE);
  float belly = sdRobe(p, 0.17, 0.50, 0.27, 0.385, 0.07);
  belly = max(belly, -sdCylY(p - vec3(0.0, 0.55, 0.0), 0.12, 0.315));                       // the bowl is hollow
  vec2 r = vec2(belly, M_BRONZE);
  r = U(r, vec2(sdTorus(p - vec3(0.0, 0.485, 0.0), 0.345, 0.034), M_BRONZE));               // the rolled lip
  r = U(r, vec2(sdTorus(p - vec3(0.0, 0.30, 0.0), 0.318, 0.02), M_BRONZE));                // a band round the belly
  r = U(r, vec2(sdCylY(p - vec3(0.0, 0.445, 0.0), 0.012, 0.31), M_ASH));                    // the ash
  vec3 s = vec3(abs(p.x), p.y, p.z);                                                       // the two ears, mirrored
  float ear = sdCap(s, vec3(0.345, 0.49, 0.0), vec3(0.455, 0.60, 0.0), 0.027);
  ear = min(ear, sdCap(s, vec3(0.455, 0.60, 0.0), vec3(0.455, 0.76, 0.0), 0.027));
  ear = min(ear, sdCap(s, vec3(0.455, 0.76, 0.0), vec3(0.355, 0.84, 0.0), 0.027));
  r = U(r, vec2(ear, M_BRONZE));
  for (int i=0;i<3;i++){                                                                   // three legs
    float a = 1.5708 + 2.0944*float(i);
    vec2 d = vec2(cos(a), sin(a));
    r = U(r, vec2(sdRoundCone(p, vec3(d.x*0.20, 0.24, d.y*0.20), vec3(d.x*0.245, 0.0, d.y*0.245), 0.058, 0.034), M_BRONZE));
  }
  // the stick of incense, leaning a little, with its tip; lit, the tip glows over a short grey of ash and a thread of smoke goes up
  vec3 base = vec3(0.0, 0.44, 0.0), tip = vec3(0.055, 1.01, -0.03);
  vec3 grey = mix(base, tip, 0.90);
  r = U(r, vec2(sdCap(p, base, lit > 0.5 ? grey : tip, 0.016), M_STICK));
  if (lit > 0.5) {
    r = U(r, vec2(sdCap(p, grey, tip, 0.016), M_BURNT));
    r = U(r, vec2(sdSphere(p - tip, 0.036), M_EMBER));
    float w = 1e5;
    vec3 a = tip + vec3(0.0, 0.075, 0.0);
    for (int k=1;k<8;k++){
      float f = float(k);
      vec3 b = tip + vec3(0.085*sin(f*0.9)*(0.45 + 0.14*f), 0.075 + 0.050*f, 0.02*sin(f*1.3));
      w = min(w, sdCap(p, a, b, 0.0125 + 0.0017*f));
      a = b;
    }
    r = U(r, vec2(w, M_SMOKE));
  }
  return r;
}

// ---------------------------------------------------------------- the albedo of the materials above
void placeMat(int code, vec3 pw, vec3 n, out vec3 alb, out float emis, out float sss, out float rimK, out float soft){
  emis = 0.0; sss = 0.0; rimK = 0.5; soft = 0.35;
  if (code == 160){                                   // the seal stone: pale, warm grey-green, a few darker veins
    float h = noise2(pw.xy*vec2(6.0,4.0) + pw.z*5.0), v = noise2(vec2(pw.x*3.0 + pw.z*2.0, pw.y*14.0));
    alb = mix(vec3(0.74,0.75,0.68), vec3(0.83,0.83,0.75), h);
    alb *= 1.0 - 0.10*smoothstep(0.62, 0.92, v);
    soft = 0.45; rimK = 0.4;
  } else if (code == 161){                            // the cut panel: darker stone and the character in it, dark with a little red
    vec3 pq = pw - vec3(0.0, 0.50, 0.0);
    float tx = decalAt(DECAL_SEAL, vec2(pq.x/0.43 + 0.5, (pq.y + 0.40)/0.80));
    alb = mix(vec3(0.60,0.61,0.55), vec3(0.20,0.09,0.10), smoothstep(0.30, 0.70, tx));
    soft = 0.5; rimK = 0.2;
  } else if (code == 162){ alb = vec3(0.70,0.17,0.19); soft = 0.3; rimK = 0.6;              // the cord: red silk
  } else if (code == 163){                            // indigo cloth with a faint weave
    float wv = 0.5 + 0.5*sin(pw.x*150.0)*sin(pw.z*150.0);
    alb = mix(vec3(0.20,0.27,0.42), vec3(0.26,0.34,0.50), wv*0.5 + 0.5*noise2(pw.xz*20.0)); soft = 0.4; rimK = 0.5;
  } else if (code == 164){                            // the page block: cream, the leaves a hair line each
    float ln = abs(fract(pw.y/0.0155) - 0.5);
    alb = mix(vec3(0.97,0.93,0.82), vec3(0.78,0.72,0.58), smoothstep(0.30, 0.50, ln)); soft = 0.4; rimK = 0.3;
  } else if (code == 165){                            // the label: white paper, the title down it in ink
    vec3 pq = pw - vec3(-0.17, 0.0, -0.02);
    float tx = decalAt(DECAL_LABEL, vec2(pq.x/0.26 + 0.5, 0.5 - pq.z/0.90));
    alb = mix(vec3(0.96,0.95,0.88), vec3(0.17,0.12,0.14), smoothstep(0.30, 0.70, tx)); soft = 0.3; rimK = 0.2;
  } else if (code == 166){ alb = vec3(1.00,0.98,0.92); soft = 0.3; rimK = 0.5; gInkA = 0.45;  // cotton thread
  } else if (code == 167){                            // bronze: dark brown with a warmer sheen on the lit side
    float h = noise2(pw.xz*18.0 + pw.y*9.0);
    alb = mix(vec3(0.42,0.30,0.18), vec3(0.58,0.43,0.24), 0.35*h + 0.65*smoothstep(0.2, 0.9, n.y));
    soft = 0.2; rimK = 0.9;
  } else if (code == 168){ alb = vec3(0.80,0.78,0.74)*(0.94 + 0.10*noise2(pw.xz*40.0)); soft = 0.6; rimK = 0.2;   // ash
  } else if (code == 169){ alb = vec3(0.66,0.22,0.15); soft = 0.3; rimK = 0.4;                // the stick: red joss paste
  } else if (code == 170){ alb = vec3(1.00,0.56,0.14); emis = 1.0; soft = 0.1; rimK = 0.0; gInkA = 0.7;   // the glowing tip
  } else if (code == 171){ alb = vec3(0.72,0.70,0.68); soft = 0.4; rimK = 0.3;                // ash on the burnt part
  } else if (code == 172){ alb = vec3(0.90,0.92,0.96); soft = 0.2; rimK = 0.0; gInkA = 0.50;  // smoke
  } else { alb = vec3(0.7); }
}

// ---------------------------------------------------------------- which thing is drawn
vec2 mapPlace(vec3 p, int lod){
  if (uObj == OBJ_SEAL)     return mapSeal(p, lod);
  if (uObj == OBJ_NOTEBOOK) return mapNotebook(p, lod);
  return mapBurner(p, lod);
}
