// ===================== which place is drawn, and the albedo of the place materials =====================
vec2 mapPlace(vec3 p, int lod){
  if (uObj == OBJ_TEAHOUSE) return mapTeahouse(p, lod);
  if (uObj == OBJ_HOUSE)    return mapHouse(p, lod);
  if (uObj == OBJ_PIER)     return mapPier(p, lod);
  if (uObj == OBJ_BRIDGE)   return mapBridge(p, lod);
  if (uObj == OBJ_BAMBOO)   return mapBamboo(p, lod);
  if (uObj == OBJ_LANTERN)  return mapLantern(p, lod);
  if (uObj == OBJ_TREE)     return mapTree(p, lod);
  if (uObj == OBJ_SCHOOL)   return mapSchool(p, lod);
  if (uObj == OBJ_HOUSE2)   return mapHouse2(p, lod);
  if (uObj == OBJ_POST)     return mapPost(p, lod);
  if (uObj == OBJ_STALL)    return mapStall(p, lod);
  if (uObj == OBJ_WORKSHOP) return mapWorkshop(p, lod);
  if (uObj == OBJ_TAVERN)   return mapTavern(p, lod);
  if (uObj == OBJ_HALL)     return mapHall(p, lod);
  if (uObj == OBJ_TEMPLE)   return mapTemple(p, lod);
  return mapWillow(p, lod);
}

// ---------------------------------------------------------------- albedo of the place materials
float stoneLines(vec2 uv, vec2 cell, float w, out float hsh){
  vec2 q = uv/cell; float row = floor(q.y); q.x += 0.5*mod(row,2.0)*1.0 + hash11(row)*0.37;
  vec2 f = fract(q), id = floor(q);
  vec2 e = min(f,1.0-f)*cell;
  hsh = hash21(id);
  return smoothstep(0.0, w, min(e.x,e.y));
}
// the door of the building being drawn: the height of its middle, half width and half height
vec3 doorOf(){
  if (uObj == OBJ_TEAHOUSE) return vec3(0.82, 0.375, 0.615);
  if (uObj == OBJ_HOUSE)    return vec3(0.70, 0.315, 0.505);
  if (uObj == OBJ_SCHOOL)   return vec3(0.72, 0.335, 0.525);
  if (uObj == OBJ_HOUSE2)   return uP0.z > 1.5 && uP0.z < 2.5 ? vec3(0.66, 0.275, 0.485) : vec3(0.70, 0.315, 0.505);
  if (uObj == OBJ_POST)     return vec3(0.54, 0.235, 0.385);
  if (uObj == OBJ_WORKSHOP) return vec3(0.68, 0.315, 0.505);
  if (uObj == OBJ_TAVERN)   return vec3(0.72, 0.375, 0.525);
  if (uObj == OBJ_HALL)     return vec3(0.86, 0.435, 0.605);
  if (uObj == OBJ_TEMPLE)   return vec3(0.84, 0.395, 0.585);
  return vec3(0.70, 0.315, 0.505);
}
void placeMat(int code, vec3 pw, vec3 n, out vec3 alb, out float emis, out float sss, out float rimK, out float soft){
  emis = 0.0; sss = 0.0; rimK = 0.5; soft = 0.35;
  float W = uP0.x, D = uP0.y;
  vec3 q = pw - vec3(0.5*W, 0.0, -0.5*D);
  if (code == 160){                                   // plaster
    alb = vec3(0.945,0.925,0.865);
    float nz = noise2(q.xy*vec2(3.0,1.3) + q.z*2.0); alb *= 0.96 + 0.07*nz;
    alb = mix(alb*vec3(0.84,0.85,0.80), alb, smoothstep(0.1,0.7,pw.y));
    alb = mix(alb, alb*vec3(0.80,0.78,0.72), smoothstep(1.2,1.9,pw.y)*0.18*noise2(vec2(q.x*5.0,q.z*5.0+q.y)));
  } else if (code == 161){ alb = vec3(0.36,0.25,0.17)*(0.95+0.1*noise2(pw.xy*vec2(30.0,2.0)+pw.z*30.0));
  } else if (code == 162){                            // door leaf: its colour is the building's; panels, a knocker, and studs on the temple and the hall
    vec3 dd = doorOf();
    vec3 base = vec3(0.60,0.37,0.21);
    if (uObj == OBJ_HOUSE) base = (uP0.z > 0.5) ? vec3(0.72,0.46,0.20) : vec3(0.22,0.34,0.58);
    else if (uObj == OBJ_SCHOOL) base = vec3(0.50,0.20,0.14);
    else if (uObj == OBJ_HOUSE2) base = uP0.z < 0.5 ? vec3(0.26,0.40,0.34) : (uP0.z < 1.5 ? vec3(0.72,0.52,0.30) : (uP0.z < 2.5 ? vec3(0.78,0.60,0.26) : vec3(0.28,0.40,0.52)));
    else if (uObj == OBJ_POST) base = vec3(0.66,0.18,0.14);
    else if (uObj == OBJ_WORKSHOP) base = vec3(0.55,0.35,0.20);
    else if (uObj == OBJ_TAVERN) base = vec3(0.62,0.38,0.18);
    else if (uObj == OBJ_HALL) base = vec3(0.44,0.14,0.11);
    else if (uObj == OBJ_TEMPLE) base = vec3(0.80,0.21,0.14);
    vec3 dq = q - vec3(0.0, dd.x, 0.0);
    vec2 u = vec2(abs(dq.x)/dd.y, dq.y/dd.z);
    float pnl = step(max(abs(u.x - 0.50) - 0.40, abs(u.y) - 0.80), 0.0);
    if (uObj == OBJ_TEAHOUSE || uObj == OBJ_HOUSE) pnl = step(max(abs(abs(dq.x) - 0.17) - 0.13, abs(dq.y) - 0.40), 0.0);   // the panels of the first two, as they were baked
    alb = mix(base, base*0.82, pnl);
    float ring = step(length(vec2(abs(dq.x)-0.06, dq.y+0.02)), 0.030); alb = mix(alb, vec3(0.82,0.70,0.40), ring);
    if (uObj == OBJ_HALL || uObj == OBJ_TEMPLE) {
      vec2 gs = fract(vec2(u.x*4.0, u.y*3.5 + 0.5)) - 0.5;
      float stud = (1.0 - smoothstep(0.14, 0.20, length(gs))) * step(abs(u.x - 0.5), 0.44) * step(abs(u.y), 0.84);
      alb = mix(alb, vec3(0.90,0.74,0.34), stud*0.95);
    }
  } else if (code == 163){                            // roof tiles
    float s = abs(fract(q.x/0.115)-0.5); float ln = smoothstep(0.38,0.5,s);
    float row = abs(fract(abs(q.z)/0.12)-0.5); float rl = smoothstep(0.42,0.5,row)*0.30;
    alb = mix(vec3(0.33,0.35,0.38), vec3(0.24,0.26,0.29), max(ln,rl)); alb *= 0.96+0.08*hash21(floor(vec2(q.x/0.115, abs(q.z)/0.12)));
  } else if (code == 164){ alb = (uObj == OBJ_HOUSE && uP0.z > 0.5) ? vec3(0.50,0.36,0.22) : (uObj == OBJ_TEMPLE ? vec3(0.82,0.66,0.30) : vec3(0.28,0.30,0.33));
  } else if (code == 165){ alb = vec3(0.42,0.28,0.18);
  } else if (code == 166){ alb = vec3(0.50,0.44,0.36); rimK = 0.0;      // dim room behind the lattice
  } else if (code == 167){ alb = vec3(0.56,0.55,0.52)*(0.94+0.1*noise2(pw.xz*6.0+pw.y*4.0));
  } else if (code == 168){                            // tea flag
    vec3 fq = q - vec3(0.5*W - 0.06 + 0.34 + 0.27, 2.38, 0.5*D - 0.06 - 0.04);
    float tx = decalAt(vec4(0.0,0.0,0.25,0.5), vec2(fq.x/0.54 + 0.5, fq.y/1.08 + 0.5));
    alb = mix(vec3(0.74,0.26,0.19), vec3(0.97,0.92,0.80), tx);
  } else if (code == 169){                            // plaques
    if (uObj == OBJ_TEAHOUSE) {
      vec3 pq = q - vec3(0.0, 1.66, 0.5*D - 0.06 + 0.05); float tx = decalAt(vec4(0.25,0.0,0.75,0.125), vec2(pq.x/1.08 + 0.5, pq.y/0.21 + 0.5));
      alb = mix(vec3(0.30,0.20,0.14), vec3(0.93,0.82,0.52), tx);
    } else if (uObj == OBJ_SCHOOL) {                  // the school's board: cream letters on dark red
      vec3 pq = q - vec3(0.0, 1.47, 0.0); float tx = decalAt(vec4(0.25,0.125,0.75,0.25), vec2(pq.x/0.72 + 0.5, pq.y/0.17 + 0.5));
      alb = mix(vec3(0.46,0.17,0.12), vec3(0.97,0.92,0.78), tx);
    } else if (uObj == OBJ_HALL) {                    // the hall's board: gold letters on black lacquer
      vec3 pq = q - vec3(0.0, 1.70, 0.0); float tx = decalAt(vec4(0.25,0.25,0.75,0.375), vec2(pq.x/1.08 + 0.5, pq.y/0.25 + 0.5));
      alb = mix(vec3(0.13,0.11,0.10), vec3(0.94,0.78,0.38), tx);
    } else if (uObj == OBJ_HOUSE2) {                  // the accountant's board: dark letters on pale wood
      float hx = 0.5*W - 0.05; vec3 pq = q - vec3(hx - 0.20, 0.88, 0.0); float tx = decalAt(vec4(0.5,0.5,0.75,0.75), vec2(pq.x/0.23 + 0.5, pq.y/0.40 + 0.5));
      alb = mix(vec3(0.80,0.64,0.40), vec3(0.22,0.13,0.08), tx);
    } else {
      vec3 pq = q - vec3(0.0, 1.34, 0.5*D - 0.05 + 0.04); bool zh = uP0.z > 0.5;
      float tx = decalAt(zh ? vec4(0.25,0.5,0.5,0.75) : vec4(0.0,0.5,0.25,0.75), vec2(pq.x/0.40 + 0.5, pq.y/0.40 + 0.5));
      alb = mix(zh ? vec3(0.62,0.38,0.15) : vec3(0.20,0.31,0.53), vec3(0.96,0.92,0.80), tx);
    }
  } else if (code == 170){ alb = vec3(0.82,0.68,0.33);
  } else if (code == 171){                            // bridge stone
    vec3 bq = pw - vec3(0.5*W, 0.0, -0.5*D); float yd = bridgeDeckY(bq.x), dep = yd - pw.y; float h;
    bool top = n.y > 0.55;
    if (dep > 0.04 && dep < 0.20 && abs(bq.z) < BR_W - 0.01 && pw.y > -0.1 && n.y > -0.2) {
      alb = mix(vec3(0.29,0.26,0.23), vec3(0.42,0.38,0.33), noise2(pw.xz*9.0 + pw.y*5.0));          // rubble where slabs are gone
    } else if (top) {
      float l = stoneLines(vec2(bq.x, bq.z), vec2(0.34,0.30), 0.016, h);
      alb = mix(vec3(0.48,0.47,0.44), mix(vec3(0.74,0.72,0.66), vec3(0.64,0.64,0.60), h), l);
    } else {
      float l = stoneLines(vec2(bq.x, pw.y), vec2(0.50,0.16), 0.014, h);
      alb = mix(vec3(0.42,0.42,0.40), mix(vec3(0.70,0.69,0.64), vec3(0.60,0.60,0.56), h), l);
      alb = mix(alb, vec3(0.30,0.42,0.33), (1.0 - smoothstep(WATER_Y, WATER_Y+0.5, pw.y))*0.65);
    }
    soft = 0.5;
  } else if (code == 172){                            // arch ring (voussoirs)
    vec3 bq = pw - vec3(0.5*W, 0.0, -0.5*D); float a = atan(bq.y/BR_AH, bq.x/BR_AW);
    float f = abs(fract(a/0.22) - 0.5); float l = smoothstep(0.0, 0.05, 0.5 - f);
    float h = hash11(floor(a/0.22)*1.7);
    alb = mix(vec3(0.42,0.41,0.38), mix(vec3(0.80,0.78,0.72), vec3(0.72,0.71,0.66), h), l); soft = 0.5;
  } else if (code == 173){                            // bamboo poles
    if (uObj == OBJ_TREE || uObj == OBJ_WORKSHOP) {   // standing stalks: the joints are along the height
      float f = fract(pw.y/0.30 + hash11(floor((pw.x + pw.z*1.7)*16.0))); float nd = 1.0 - smoothstep(0.0, 0.07, min(f, 1.0-f));
      alb = mix(vec3(0.50,0.66,0.30), vec3(0.40,0.56,0.26), noise2(vec2(pw.x*40.0 + pw.z*30.0, pw.y*4.0)));
      alb *= 1.0 - 0.34*nd; rimK = 0.5;
    } else {
    float f = fract(pw.x/0.30 + hash11(floor(pw.z*9.0))*0.5); float nd = 1.0 - smoothstep(0.0, 0.06, min(f, 1.0-f));
    alb = mix(vec3(0.55,0.68,0.34), vec3(0.42,0.56,0.27), noise2(vec2(pw.z*14.0, pw.y*9.0)));
    alb *= 1.0 - 0.30*nd; rimK = 0.5;
    }
  } else if (code == 174){ alb = vec3(0.80,0.69,0.46);
  } else if (code == 175){ alb = vec3(0.42,0.32,0.24)*(0.95+0.1*noise2(vec2(pw.x*14.0+pw.z*14.0, pw.y*3.0))); rimK = 0.3;
  } else if (code == 176){                            // willow leaves: darker inside, yellow-green at the tips
    vec3 lq = pw - vec3(0.5*W, 0.0, -0.5*D); float h = noise2(lq.xz*5.0 + lq.y*2.0);
    float layer = clamp(gBid, 0.0, 3.5)/3.5;
    vec3 inner = vec3(0.40,0.56,0.30), outer = vec3(0.66,0.80,0.38);
    alb = mix(inner, outer, layer*0.8 + 0.2*h);
    alb = mix(alb, vec3(0.84,0.88,0.48), (1.0 - smoothstep(0.2, 1.6, pw.y))*0.55);
    sss = 0.0; rimK = 0.8; gInkA = 0.25; soft = 0.2;
  } else if (code == 184){                            // willow crown: flat, dark leaf discs
    vec3 lq = pw - vec3(0.5*W, 0.0, -0.5*D); float h = noise2(lq.xz*9.0);
    float h2 = noise2(lq.xz*17.0 + lq.y*3.0);
    alb = mix(vec3(0.27,0.42,0.22), vec3(0.44,0.60,0.29), clamp(0.15 + 0.55*h + 0.45*h2, 0.0, 1.0));
    alb = mix(alb, vec3(0.64,0.76,0.36), smoothstep(0.55, 0.95, n.y)*0.35*h2);
    sss = 0.0; rimK = 0.5; gInkA = 0.30; soft = 0.2;
  } else if (code == 177){                            // striped awning / sign
    float st = step(0.5, fract((pw.x - 0.5*W)/0.16 + 0.25));
    vec3 c0 = vec3(0.82,0.50,0.20);
    if (uObj == OBJ_STALL && uP0.z > 0.5) c0 = vec3(0.30,0.48,0.64);                                            // the second kind of stall has a blue awning
    alb = mix(c0, vec3(0.95,0.90,0.76), st); soft = 0.3;
  } else if (code == 178){                            // pier planks
    vec3 bq = pw - vec3(0.5*W, 0.0, -0.5*D); float f = abs(fract(bq.x/0.16)-0.5); float pl = smoothstep(0.0, 0.05, 0.5 - f);
    alb = mix(vec3(0.30,0.22,0.15), mix(vec3(0.66,0.52,0.36), vec3(0.58,0.45,0.31), hash11(floor(bq.x/0.16)*1.3)), pl);
  } else if (code == 179){ alb = vec3(0.40,0.31,0.23)*(0.92+0.12*noise2(pw.xy*vec2(40.0,4.0)));
    if (uObj == OBJ_HOUSE2) {                         // the planks of the boat: seams along the hull
      vec3 hq = q - vec3(0.5*W - 0.05 + 0.78, 0.0, 0.5*D - 0.05 + 0.10); hq.xz = rot2(hq.xz, 0.12);
      float seam = abs(fract(atan(hq.y, hq.z)*3.8197 + 0.5) - 0.5);
      alb = vec3(0.46,0.34,0.24)*(0.95 + 0.10*noise2(pw.xz*20.0)); alb *= 1.0 - 0.40*(1.0 - smoothstep(0.0, 0.07, seam));
    }
  } else if (code == 180){ alb = vec3(0.66,0.52,0.34)*(0.92+0.12*noise2(pw.xz*30.0));
  } else if (code == 181){                            // lantern paper: lit glows, unlit is dull
    if (uObj == OBJ_WORKSHOP) {                       // the lanterns of the workshop, each its own colour
      float k = mod(floor(q.x/0.60 + 3.0), 3.0);
      alb = k < 0.5 ? vec3(0.82,0.26,0.17) : (k < 1.5 ? vec3(0.90,0.58,0.20) : vec3(0.86,0.38,0.30));
    } else if (uP0.z > 0.5) { alb = vec3(0.80,0.24,0.16); emis = 1.0; } else alb = vec3(0.50,0.17,0.14);
    rimK = 0.2;
  } else if (code == 182){ alb = vec3(0.25,0.19,0.14);
  } else if (code == 183){ alb = vec3(0.22,0.35,0.60);
  } else if (code == 185){                            // red lacquer: the walls of the temple, the drum
    alb = vec3(0.72,0.17,0.12)*(0.96 + 0.07*noise2(q.xy*vec2(4.0,2.0) + q.z*3.0));
    alb = mix(alb*vec3(0.80,0.78,0.76), alb, smoothstep(0.1,0.7,pw.y));
    soft = 0.3;
  } else if (code == 186){                            // fresh timber
    alb = vec3(0.80,0.62,0.40)*(0.93 + 0.10*noise2(pw.xy*vec2(5.0,38.0) + pw.z*9.0));
    soft = 0.3;
  } else if (code == 187){ alb = vec3(0.76,0.56,0.25); soft = 0.5; rimK = 0.8;                                   // bronze
  } else if (code == 188){                            // the wine flag: white letters on indigo
    vec3 fq = q - vec3(-(0.5*W - 0.05) - 0.40 - 0.33, 2.12, 0.0);
    float tx = decalAt(vec4(0.75,0.0,1.0,0.5), vec2(fq.x/0.54 + 0.5, fq.y/1.08 + 0.5));
    alb = mix(vec3(0.20,0.31,0.55), vec3(0.97,0.93,0.82), tx); soft = 0.3;
  } else if (code == 191){                            // goods on a stall: fruit, by the basket they are in
    float k = mod(floor((pw.x - 0.5*W)/0.33 + 1.5), 3.0);
    alb = k < 0.5 ? vec3(0.82,0.22,0.16) : (k < 1.5 ? vec3(0.93,0.62,0.18) : vec3(0.54,0.70,0.26)); soft = 0.3;
  } else if (code == 189){                            // leaves: darker inside and underneath, lighter on top and in the patches the noise picks; the greens are the kind of tree's
    vec3 lq = pw - vec3(0.5*W, 0.0, -0.5*D); float v = uP0.z;
    float h = noise2(lq.xz*7.0 + lq.y*3.0), h2 = noise2(lq.xz*15.0 + lq.y*5.0);
    vec3 dark = vec3(0.24,0.40,0.22), light = vec3(0.52,0.70,0.31);
    if (v > 4.5) { dark = vec3(0.33,0.49,0.21); light = vec3(0.68,0.80,0.34); }              // the low, wide crown is a lighter, yellower green
    else if (v > 1.5) { dark = vec3(0.30,0.50,0.22); light = vec3(0.62,0.77,0.34); }         // bamboo leaves
    else if (v > 0.5) { dark = vec3(0.14,0.28,0.20); light = vec3(0.30,0.48,0.29); }         // cypress: dark blue-green
    float k = clamp(0.12 + 0.42*h + 0.22*h2 + 0.40*n.y, 0.0, 1.0);
    alb = mix(dark, light, k);
    sss = 0.0; rimK = 0.6; gInkA = 0.5; soft = 0.25;
  } else if (code == 190){                            // stones with moss on the tops
    vec3 sq = pw - vec3(0.5*W, 0.0, -0.5*D); float h = noise2(sq.xz*9.0 + sq.y*6.0);
    alb = mix(vec3(0.58,0.60,0.58), vec3(0.72,0.73,0.69), h);
    alb *= mix(0.80, 1.0, smoothstep(0.0, 0.5, n.y));
    float moss = smoothstep(0.50, 0.85, n.y) * smoothstep(0.30, 0.65, noise2(sq.xz*6.0 + 3.0));
    alb = mix(alb, vec3(0.42,0.58,0.30), moss*0.85);
    soft = 0.4; rimK = 0.4;
  } else { alb = vec3(0.7); }
}

// ---------------------------------------------------------------- the night light of a building (uMode 1): the panes of the windows and the paper of the lanterns hung on it, lit; everything else is clear
vec4 nightLight(int code, vec3 pw, vec3 n, float ao){
  if (code == 166) return vec4(vec3(1.00,0.80,0.46)*mix(0.72, 1.0, ao), 1.0);          // paper window, a lamp behind it
  if (code == 181 && uObj != OBJ_LANTERN) return vec4(vec3(1.00,0.56,0.26)*mix(0.80, 1.0, ao), 1.0);   // lantern paper hung on a building
  return vec4(0.0);
}
