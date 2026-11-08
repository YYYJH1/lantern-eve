// ===================== the buildings of the town that are not the teahouse or the family houses =====================
// Every building has its anchor at the origin (the bottom-left corner of its footprint) and stands on the footprint x in [0, W], z in [-D, 0], its front (the wall the camera sees) at +z.
// Materials as in places.glsl; the new ones are 185 red lacquer, 186 fresh timber, 187 bronze, 188 the wine flag, 191 goods on a stall.
// What is seen of the front wall is the part under the eaves: from the ground up to (the wall height + the lift of the eave - 1.28 x the overhang), so the doors, windows and plaques stay under that line.

struct Bld {
  float hx, hz;                 // half sizes of the walls
  float wh, rh;                 // height of the walls, rise of the roof
  float ovx, ovz, lift;         // roof: overhang at the gables, overhang at the eaves, lift of the eaves and their corners
  float dw, dh;                 // door: half width and half height (it stands on the plinth)
  float wx0, wpitch, nwin;      // windows: the first one's distance from the middle, the spacing, and how many on each side
  float whw, whh, wy;           // a window: half width, half height, height of its middle
  float wallMat;                // 160 plaster, 185 red lacquer
  float stepped;                // 1: stepped (horse-head) gable ends
  float pl;                     // height of the stone plinth
};

// plinth, walls with a door and windows, frames, door leaf, lattices and panes, roof, ridge: the body of a building seen from the front
vec2 bldCore(vec3 q, Bld b, int lod){
  float hx = b.hx, hz = b.hz, WH = b.wh, RH = b.rh, pl = b.pl, ax = abs(q.x);
  vec2 r = vec2(1e5, 160.0);
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.5*pl,0.0), vec3(hx+0.05,0.5*pl,hz+0.05), 0.03), 167.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0,0.04,hz+0.12), vec3(b.dw+0.16,0.04,0.12), 0.02), 167.0));
  float wall = sdRBox(q - vec3(0.0, pl+(WH-pl)*0.5, 0.0), vec3(hx, (WH-pl)*0.5, hz), 0.025);
  float yy = q.y - WH;
  float rg = RH*0.78;                                                                  // the gable wall stays a little under the curved roof sheet, which sags below the straight line from the ridge to the eave
  float gable = max(max(ax-hx, -yy-0.05), (abs(q.z)*rg + yy*hz - rg*hz)/length(vec2(rg,hz)));
  wall = min(wall, gable);
  vec3 dq = q - vec3(0.0, pl + b.dh, hz);
  wall = max(wall, -sdBox(dq, vec3(b.dw, b.dh, 0.12)));
  float wk = clamp(floor((ax - b.wx0)/b.wpitch + 0.5), 0.0, max(b.nwin - 1.0, 0.0));
  vec3 wq = vec3(ax - (b.wx0 + wk*b.wpitch), q.y - b.wy, q.z - hz);
  bool win = b.nwin > 0.5;
  if (win) wall = max(wall, -sdBox(wq, vec3(b.whw, b.whh, 0.14)));
  r = U(r, vec2(wall, b.wallMat));
  float post = sdBox(vec3(ax-hx, q.y-WH*0.5, abs(q.z)-hz), vec3(0.06, WH*0.5, 0.06));
  float beam = sdBox(q - vec3(0.0, WH-0.08, 0.0), vec3(hx+0.04, 0.08, hz+0.04));
  float fr = min(post, beam);
  fr = min(fr, max(sdBox(dq, vec3(b.dw+0.045, b.dh+0.045, 0.07)), -sdBox(dq, vec3(b.dw-0.025, b.dh-0.015, 0.3))));
  if (win) fr = min(fr, max(sdBox(wq, vec3(b.whw+0.06, b.whh+0.06, 0.07)), -sdBox(wq, vec3(b.whw, b.whh, 0.3))));
  r = U(r, vec2(fr, 161.0));
  r = U(r, vec2(sdRBox(dq - vec3(0.0,0.0,-0.06), vec3(b.dw-0.025, b.dh-0.015, 0.035), 0.012), 162.0));
  if (win) {
    vec3 wq2 = wq - vec3(0.0,0.0,-0.03);
    vec2 gq = (fract(wq2.xy/0.10 + 0.5) - 0.5)*0.10;
    r = U(r, vec2(max(sdBox(wq2, vec3(b.whw-0.005, b.whh-0.005, 0.012)), -(max(abs(gq.x),abs(gq.y)) - 0.036)), 165.0));
    r = U(r, vec2(sdBox(wq - vec3(0.0,0.0,-0.075), vec3(b.whw+0.01, b.whh+0.01, 0.012)), 166.0));
    r = U(r, vec2(sdRBox(wq - vec3(0.0, -b.whh-0.05, 0.07), vec3(b.whw+0.07,0.03,0.10), 0.012), 167.0));
  }
  r = U(r, vec2(sdRoofK(q, hx, hz, WH, RH, b.ovx, b.ovz, b.lift), 163.0));
  float yR = WH + RH + 0.02;
  r = U(r, vec2(sdCap(q, vec3(-hx-b.ovx-0.06, yR+0.075, 0.0), vec3(hx+b.ovx+0.06, yR+0.075, 0.0), 0.072), 164.0));
  if (b.stepped > 0.5) {                      // stepped gable ends: low walls that follow the roof slope in four steps, with a tile cap
    float az = abs(q.z), Zm = hz + b.ovz;
    float ui = floor(clamp(az/Zm, 0.0, 0.999)*4.0)/4.0;
    float top = mix(yR - 0.02, WH - 0.03, 1.0 - pow(1.0 - ui, 1.7)) + 0.09;
    float gw = max(abs(ax - hx - 0.01) - 0.055, max(az - hz - 0.02, max(q.y - top, pl + 0.02 - q.y)));
    r = U(r, vec2(gw, b.wallMat));
    float cap = max(abs(ax - hx - 0.01) - 0.085, max(az - hz - 0.045, max(abs(q.y - top - 0.02) - 0.026, 0.0)));
    r = U(r, vec2(cap, 163.0));
  }
  return r;
}

// a post with a round foot, along y
float sdPost(vec3 q, float h, float r){ return sdCap(q, vec3(0.0,0.0,0.0), vec3(0.0,h,0.0), r); }
// a cylinder along z (a drum or a gong seen from the front): centre c, half thickness t, radius r
float sdDiscZ(vec3 q, float t, float r){ return sdCylY(vec3(q.x, q.z, q.y), t, r); }
// a cylinder along x (a log lying along the wall)
float sdLogX(vec3 q, float h, float r){ return sdCylY(vec3(q.y, q.x, q.z), h, r); }

// ---------------------------------------------------------------- the village school: wide and plain, two windows each side of the door, a board with its name over the door
vec2 mapSchool(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.0, 1.7, 0.1), vec3(hx+0.5, 2.1, hz+0.8));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  Bld b = Bld(hx, hz, 1.95, 0.60, 0.04, 0.26, 0.4,  0.36, 0.54,  0.88, 0.50, 2.0,  0.17, 0.26, 0.92,  160.0, 1.0, 0.18);
  vec2 r = bldCore(q, b, lod);
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.47, hz+0.04), vec3(0.36,0.085,0.02), 0.01), 169.0));              // the board: 私塾
  // a notice board on two stakes in front of the right-hand windows, with a sheet pinned to it
  r = U(r, vec2(sdRBox(q - vec3(1.12, 0.74, hz+0.40), vec3(0.22,0.17,0.016), 0.01), 161.0));
  r = U(r, vec2(sdRBox(q - vec3(1.12, 0.74, hz+0.42), vec3(0.17,0.12,0.010), 0.006), 174.0));
  r = U(r, vec2(sdPost(q - vec3(0.93, 0.0, hz+0.40), 0.92, 0.02), 161.0));
  r = U(r, vec2(sdPost(q - vec3(1.31, 0.0, hz+0.40), 0.92, 0.02), 161.0));
  return r;
}

// ---------------------------------------------------------------- the small houses: 0 the accountant's (a hanging board), 1 the carpenter's (timber stacked outside),
// 2 Xiaoman's (a net on a rack, a basket), 3 Old He's (a boat turned over, an oar)
vec2 mapHouse2(vec3 p, int lod){
  float W = uP0.x, D = uP0.y, v = uP0.z;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.4, 1.4, 0.2), vec3(hx+1.5, 1.9, hz+0.8));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  bool small = v > 1.5 && v < 2.5;
  Bld b = Bld(hx, hz, 1.62, 0.60, 0.20, 0.28, 0.4,  0.34, 0.52,  0.80, 0.0, 1.0,  0.24, 0.27, 0.96,  160.0, 0.0, 0.18);                 // the accountant's: plain gables
  if (v > 0.5 && v < 1.5) b = Bld(hx, hz, 1.62, 0.60, 0.04, 0.28, 0.4,  0.34, 0.52,  0.80, 0.0, 1.0,  0.24, 0.27, 0.96,  160.0, 1.0, 0.18);    // the carpenter's: stepped gables
  if (small) b = Bld(hx, hz, 1.45, 0.50, 0.14, 0.26, 0.3,  0.30, 0.50,  0.62, 0.0, 1.0,  0.20, 0.26, 0.88,  160.0, 0.0, 0.16);               // Xiaoman's: a small cottage
  if (v > 2.5) b = Bld(hx, hz, 1.62, 0.60, 0.04, 0.28, 0.8,  0.34, 0.52,  0.80, 0.0, 1.0,  0.24, 0.27, 0.96,  160.0, 1.0, 0.18);            // Old He's: lifted eaves
  vec2 r = bldCore(q, b, lod);
  if (v < 0.5) {                                                    // the accountant's: a board hung out on a bracket at the right end of the wall
    r = U(r, vec2(sdCap(q, vec3(hx-0.03, 1.16, hz+0.02), vec3(hx-0.03, 1.16, hz+0.44), 0.016), 161.0));
    r = U(r, vec2(sdCap(q, vec3(hx-0.03, 1.16, hz+0.44), vec3(hx-0.27, 1.16, hz+0.44), 0.016), 161.0));
    r = U(r, vec2(sdRBox(q - vec3(hx-0.24, 0.84, hz+0.44), vec3(0.15,0.25,0.014), 0.012), 169.0));              // the board: 账
    r = U(r, vec2(sdCap(q, vec3(hx-0.24, 1.16, hz+0.44), vec3(hx-0.24, 1.09, hz+0.44), 0.008), 161.0));
  } else if (v < 1.5) {                                             // the carpenter's: planks stacked in layers beside the front corner, logs before them, and a sawhorse
    for (int i=0;i<6;i++){
      float fi = float(i);
      vec3 pq = q - vec3(hx + 0.62 + 0.025*(hash11(fi*3.0)-0.5), 0.045 + fi*0.075, hz + 0.10 + 0.02*(hash11(fi*7.0)-0.5));
      r = U(r, vec2(sdRBox(pq, vec3(0.44 + 0.04*hash11(fi*5.0), 0.032, 0.17), 0.008), 186.0));
      if (i < 5) {                                                  // a thin sticker between the layers, at both ends
        r = U(r, vec2(sdRBox(pq - vec3(-0.33, 0.04, 0.0), vec3(0.025,0.012,0.17), 0.003), 161.0));
        r = U(r, vec2(sdRBox(pq - vec3( 0.33, 0.04, 0.0), vec3(0.025,0.012,0.17), 0.003), 161.0));
      }
    }
    r = U(r, vec2(sdLogX(q - vec3(hx + 0.40, 0.09, hz + 0.50), 0.36, 0.09) - 0.004, 175.0));
    r = U(r, vec2(sdLogX(q - vec3(hx + 0.62, 0.075, hz + 0.68), 0.30, 0.075) - 0.004, 175.0));
    r = U(r, vec2(sdLogX(q - vec3(hx + 0.52, 0.20, hz + 0.58), 0.30, 0.075) - 0.004, 175.0));
    vec3 hq = q - vec3(-0.78, 0.0, hz + 0.38);
    float legs = min(sdCap(hq, vec3(-0.24,0.0,0.0), vec3(-0.16,0.44,0.0), 0.024), sdCap(hq, vec3(0.24,0.0,0.0), vec3(0.16,0.44,0.0), 0.024));
    legs = min(legs, min(sdCap(hq, vec3(-0.24,0.0,0.14), vec3(-0.16,0.44,0.0), 0.024), sdCap(hq, vec3(0.24,0.0,0.14), vec3(0.16,0.44,0.0), 0.024)));
    r = U(r, vec2(min(legs, sdRBox(hq - vec3(0.0,0.46,0.0), vec3(0.32,0.035,0.05), 0.008)), 186.0));
    r = U(r, vec2(sdRBox(hq - vec3(0.0,0.505,0.0), vec3(0.22,0.012,0.14), 0.004), 186.0));                      // a board on the horse
  } else if (v < 2.5) {                                             // Xiaoman's: a rack at the west end with a net over it, and a basket by the door
    vec3 rq = q - vec3(-hx - 0.40, 0.0, hz + 0.20);
    r = U(r, vec2(min(sdPost(rq - vec3(-0.36,0.0,0.0), 1.25, 0.024), sdPost(rq - vec3(0.36,0.0,0.0), 1.25, 0.024)), 161.0));
    r = U(r, vec2(sdCap(rq, vec3(-0.40,1.25,0.0), vec3(0.40,1.25,0.0), 0.022), 161.0));
    vec3 nq = rq - vec3(0.0, 0.88, 0.0);
    vec2 ng = (fract(nq.xy/0.085 + 0.5) - 0.5)*0.085;
    r = U(r, vec2(max(sdBox(nq, vec3(0.33, 0.36, 0.008)), -(max(abs(ng.x), abs(ng.y)) - 0.030)), 174.0));
    for (int i=0;i<4;i++) r = U(r, vec2(sdSphere(nq - vec3(-0.24 + float(i)*0.16, -0.37, 0.0), 0.030), 191.0));         // floats along the lower edge
    vec3 bq = q - vec3(0.62, 0.11, hz + 0.30);
    r = U(r, vec2(sdCylY(bq, 0.11, 0.13 - 0.04*(bq.y + 0.11)) - 0.01, 180.0));
  } else {                                                          // Old He's: a boat turned over beside the house, an oar against the wall
    vec3 hq = q - vec3(hx + 0.78, 0.0, hz + 0.10);
    hq.xz = rot2(hq.xz, 0.12);
    float t = clamp(hq.x/0.74, -1.0, 1.0);
    float w = 0.27*pow(max(1.0 - t*t, 0.0), 0.55) + 0.025;
    float hull = (length(vec3(hq.x/0.74, hq.y/0.34, hq.z/w)) - 1.0)*0.22;
    r = U(r, vec2(max(hull, -hq.y), 179.0));
    r = U(r, vec2(sdCap(hq, vec3(-0.68,0.30,0.0), vec3(0.68,0.30,0.0), 0.028), 161.0));                          // the keel, now on top
    r = U(r, vec2(sdCap(q, vec3(-0.92,0.04,hz+0.16), vec3(-0.78,1.30,hz+0.06), 0.026), 161.0));                  // an oar against the wall
    r = U(r, vec2(sdRBox(q - vec3(-0.93, 0.20, hz+0.17), vec3(0.065,0.21,0.014), 0.008), 161.0));
  }
  return r;
}

// ---------------------------------------------------------------- the watch post: a small hut, a gong on a wooden frame at one side, the watch drum at the other
vec2 mapPost(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.0, 1.0, 0.2), vec3(hx+0.75, 1.5, hz+0.7));
  if (bb > 0.2) return vec2(bb + (lod==1 ? 1.4 : 0.3), 160.0);
  Bld b = Bld(hx, hz, 1.28, 0.54, 0.04, 0.20, 0.3,  0.26, 0.40,  0.58, 0.0, 1.0,  0.14, 0.20, 0.80,  160.0, 1.0, 0.14);
  vec2 r = bldCore(q, b, lod);
  // the gong: two posts and a bar, the bronze disc hung from it
  vec3 gq = q - vec3(-hx - 0.34, 0.0, hz + 0.10);
  r = U(r, vec2(min(sdPost(gq - vec3(-0.19,0.0,0.0), 1.06, 0.026), sdPost(gq - vec3(0.19,0.0,0.0), 1.06, 0.026)), 161.0));
  r = U(r, vec2(sdCap(gq, vec3(-0.22,1.02,0.0), vec3(0.22,1.02,0.0), 0.024), 161.0));
  r = U(r, vec2(min(sdCap(gq, vec3(-0.07,1.02,0.0), vec3(-0.06,0.84,0.0), 0.006), sdCap(gq, vec3(0.07,1.02,0.0), vec3(0.06,0.84,0.0), 0.006)), 174.0));
  r = U(r, vec2(sdDiscZ(gq - vec3(0.0,0.64,0.0), 0.014, 0.20) - 0.008, 187.0));
  r = U(r, vec2(sdSphere(gq - vec3(0.0,0.64,0.03), 0.050), 170.0));
  r = U(r, vec2(sdCap(gq, vec3(0.30,0.0,0.06), vec3(0.22,0.46,0.02), 0.014), 161.0));                              // the mallet, leaning
  // the drum on a low stand, its face to the street
  vec3 dq = q - vec3(hx + 0.34, 0.0, hz + 0.20);
  r = U(r, vec2(min(sdCap(dq, vec3(-0.17,0.0,0.05), vec3(-0.09,0.22,0.0), 0.022), sdCap(dq, vec3(0.17,0.0,0.05), vec3(0.09,0.22,0.0), 0.022)), 161.0));
  r = U(r, vec2(sdDiscZ(dq - vec3(0.0,0.46,0.0), 0.14, 0.23) - 0.02, 185.0));
  r = U(r, vec2(sdDiscZ(dq - vec3(0.0,0.46,0.15), 0.014, 0.235) - 0.006, 174.0));
  r = U(r, vec2(sdDiscZ(dq - vec3(0.0,0.46,0.0), 0.152, 0.205) - 0.006 - 0.0, 161.0));
  return r;
}

// ---------------------------------------------------------------- a market stall: a counter with goods, four posts, a tilted awning in stripes
vec2 mapStall(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W, hz = 0.5*D;
  float bb = sdBox(q - vec3(0.0, 0.62, 0.12), vec3(hx+0.22, 0.78, hz+0.5));
  if (bb > 0.15) return vec2(bb + (lod==1 ? 1.0 : 0.2), 161.0);
  vec2 r = vec2(sdRBox(q - vec3(0.0, 0.17, hz-0.02), vec3(hx-0.04, 0.17, 0.16), 0.012), 161.0);            // the counter
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.345, hz-0.02), vec3(hx-0.02, 0.02, 0.18), 0.008), 186.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.14, -hz+0.07), vec3(hx-0.12, 0.14, 0.08), 0.01), 161.0));          // the back table
  vec3 pq = vec3(abs(q.x) - (hx-0.03), q.y, abs(q.z) - (hz-0.03));
  float posts = sdBox(vec3(pq.x, pq.y - 0.62, pq.z), vec3(0.022, 0.62, 0.022));
  r = U(r, vec2(posts, 161.0));
  vec3 aq = q - vec3(0.0, 1.18, 0.0); aq.yz = rot2(aq.yz, 0.24);                                          // the awning: the front edge lower than the back
  float awn = sdRBox(aq, vec3(hx+0.10, 0.016, hz+0.24), 0.01);
  r = U(r, vec2(awn, 177.0));
  vec3 vq = q - vec3(0.0, 1.07, hz+0.225);
  r = U(r, vec2(sdRBox(vq, vec3(hx+0.10, 0.06, 0.010), 0.006), 177.0));                                    // the valance
  for (int i=0;i<3;i++) {                                                                                  // baskets of goods on the counter
    float fi = float(i) - 1.0;
    vec3 bq = q - vec3(fi*0.33, 0.40, hz-0.02);
    r = U(r, vec2(sdCylY(bq, 0.035, 0.085) - 0.008, 180.0));
    r = U(r, vec2(sdSphere(bq - vec3(-0.03,0.055,0.01), 0.048), 191.0));
    r = U(r, vec2(sdSphere(bq - vec3(0.04,0.050,-0.02), 0.046), 191.0));
    r = U(r, vec2(sdSphere(bq - vec3(0.01,0.075,0.04), 0.044), 191.0));
  }
  return r;
}

// ---------------------------------------------------------------- the lantern workshop: a long low house, paper lanterns hung in a row under the eaves, bamboo against the end wall
vec2 mapWorkshop(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.2, 1.4, 0.2), vec3(hx+0.7, 1.8, hz+0.8));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  Bld b = Bld(hx, hz, 1.50, 0.52, 0.04, 0.30, 0.3,  0.34, 0.52,  0.90, 0.62, 2.0,  0.22, 0.25, 0.86,  160.0, 1.0, 0.16);
  vec2 r = bldCore(q, b, lod);
  // the lanterns hang from a bar under the front eave
  vec3 bq = q - vec3(0.0, 1.43, hz + 0.27);
  r = U(r, vec2(sdCap(bq, vec3(-hx+0.10,0.0,0.0), vec3(hx-0.10,0.0,0.0), 0.016), 161.0));
  float k = clamp(floor(q.x/0.60), -3.0, 2.0);
  if (!(lod == 1 && abs(q.y - 1.15) > 0.5)) {
    vec3 lq = vec3(q.x - (k + 0.5)*0.60, q.y - 1.12, q.z - (hz + 0.27));
    vec2 l = lanternP(lq, 0.135, 0.16, lod);
    r = U(r, l);
    r = U(r, vec2(sdCap(lq, vec3(0.0,0.16,0.0), vec3(0.0,0.31,0.0), 0.006), 174.0));
  }
  // bamboo poles leaning against the east end
  for (int i=0;i<5;i++){
    float fi = float(i);
    vec3 a = vec3(hx + 0.10 + fi*0.075, 0.0, hz - 0.30 - 0.10*fi), c = vec3(hx + 0.02 + fi*0.065, 1.55 - 0.10*hash11(fi*3.3), hz - 0.62 - 0.12*fi);
    r = U(r, vec2(sdCap(q, a, c, 0.027), 173.0));
  }
  return r;
}

// ---------------------------------------------------------------- the tavern: wide, plain gables, a wine flag on a post at the west corner, two wine jars at the door
vec2 mapTavern(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(-0.3, 1.6, 0.2), vec3(hx+1.2, 2.0, hz+0.8));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.6 : 0.4), 160.0);
  Bld b = Bld(hx, hz, 1.64, 0.58, 0.26, 0.30, 0.5,  0.40, 0.54,  0.98, 0.50, 2.0,  0.18, 0.26, 0.90,  160.0, 0.0, 0.18);
  vec2 r = bldCore(q, b, lod);
  // the flag: a post at the west corner, an arm to the west, the cloth hanging from it
  vec3 fq = q - vec3(-hx - 0.40, 0.0, hz - 0.02);
  r = U(r, vec2(sdRBox(fq - vec3(0.0,0.07,0.0), vec3(0.13,0.07,0.13), 0.03), 167.0));
  r = U(r, vec2(sdPost(fq - vec3(0.0,0.08,0.0), 2.72, 0.032), 161.0));
  r = U(r, vec2(sdSphere(fq - vec3(0.0,2.84,0.0), 0.06), 170.0));
  r = U(r, vec2(sdCap(fq, vec3(0.0,2.68,0.0), vec3(-0.60,2.68,0.0), 0.016), 161.0));
  vec3 cq = fq - vec3(-0.33, 2.12, 0.0);
  cq.z += 0.05*sin(cq.x*6.0 + 0.6)*smoothstep(0.3,-0.3,cq.x);
  float cloth = sdBox(cq, vec3(0.27, 0.54, 0.010));
  cloth = max(cloth, (-cq.x - 0.14 - 0.24*abs(cq.y))*0.8);
  r = U(r, vec2(cloth*0.8, 188.0));
  // wine jars either side of the door
  for (int i=0;i<2;i++) {
    float sg = i == 0 ? -1.0 : 1.0;
    vec3 jq = q - vec3(sg*0.80, 0.0, hz + 0.26);
    float jar = sdEll(jq - vec3(0.0,0.20,0.0), vec3(0.15,0.19,0.15));
    jar = smin(jar, sdCylY(jq - vec3(0.0,0.40,0.0), 0.04, 0.075), 0.03);
    r = U(r, vec2(jar, 161.0));
    r = U(r, vec2(sdCylY(jq - vec3(0.0,0.455,0.0), 0.02, 0.085), 185.0));
  }
  return r;
}

// ---------------------------------------------------------------- the ancestral hall: the biggest of the white buildings, a black board with gold letters over the door, a wide stair, stone lions
vec2 mapHall(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.0, 2.2, 0.2), vec3(hx+0.8, 2.7, hz+1.0));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.8 : 0.4), 160.0);
  Bld b = Bld(hx, hz, 2.25, 0.80, 0.05, 0.32, 1.2,  0.46, 0.62,  1.22, 0.64, 2.0,  0.22, 0.30, 1.08,  160.0, 1.0, 0.24);
  vec2 r = bldCore(q, b, lod);
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.70, hz+0.045), vec3(0.54,0.125,0.025), 0.012), 169.0));            // the board: 祠堂
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.07, hz+0.30), vec3(0.78,0.07,0.17), 0.02), 167.0));                // the stair: three wide steps
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.035, hz+0.46), vec3(0.88,0.035,0.17), 0.02), 167.0));
  for (int i=0;i<2;i++) {                                                                                  // a stone lion on a block each side of the stair
    float sg = i == 0 ? -1.0 : 1.0;
    vec3 lq = q - vec3(sg*1.12, 0.0, hz + 0.34);
    r = U(r, vec2(sdRBox(lq - vec3(0.0,0.08,0.0), vec3(0.12,0.08,0.12), 0.015), 167.0));
    float body = sdEll(lq - vec3(0.0,0.27,0.0), vec3(0.09,0.12,0.10));
    body = smin(body, sdSphere(lq - vec3(0.0,0.40,0.03), 0.075), 0.04);
    r = U(r, vec2(body, 167.0));
  }
  float yR = 2.25 + 0.80 + 0.02;                                                                           // gold knobs at the ends of the ridge
  r = U(r, vec2(sdEll(q - vec3(hx+0.34, yR+0.19, 0.0), vec3(0.06,0.12,0.075)), 170.0));
  r = U(r, vec2(sdEll(q - vec3(-hx-0.34, yR+0.19, 0.0), vec3(0.06,0.12,0.075)), 170.0));
  return r;
}

// ---------------------------------------------------------------- the temple: red lacquered walls, a roof with strongly upturned eaves and a gold ridge, a door with gold studs, an incense burner
vec2 mapTemple(vec3 p, int lod){
  float W = uP0.x, D = uP0.y;
  vec3 q = p - vec3(0.5*W, 0.0, -0.5*D);
  float hx = 0.5*W - 0.05, hz = 0.5*D - 0.05;
  float bb = sdBox(q - vec3(0.0, 2.2, 0.3), vec3(hx+0.8, 2.7, hz+1.0));
  if (bb > 0.25) return vec2(bb + (lod==1 ? 1.8 : 0.4), 160.0);
  Bld b = Bld(hx, hz, 2.02, 0.86, 0.32, 0.40, 2.0,  0.42, 0.60,  1.22, 0.58, 2.0,  0.20, 0.28, 1.02,  185.0, 0.0, 0.24);
  vec2 r = bldCore(q, b, lod);
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.66, hz+0.02), vec3(hx+0.05, 0.10, 0.045), 0.01), 183.0));            // the painted frieze under the eaves
  r = U(r, vec2(sdRBox(q - vec3(0.0, 1.575, hz+0.03), vec3(hx+0.05, 0.012, 0.05), 0.004), 170.0));
  float Zm = hz + 0.40, Xm = hx + 0.32, yE = 2.02 - 0.03, lf = 2.0*(0.15 + 0.22);                          // the four corners of the eaves carry a curled gold tip
  for (int i=0;i<4;i++) {
    vec3 c = vec3(i < 2 ? -1.0 : 1.0, 0.0, (i & 1) == 0 ? -1.0 : 1.0);
    vec3 a = vec3(c.x*(Xm-0.03), yE + lf - 0.03, c.z*(Zm-0.03));
    vec3 e = a + vec3(c.x*0.14, 0.24, c.z*0.10);
    r = U(r, vec2(sdCap(q, a, e, 0.026), 170.0));
    r = U(r, vec2(sdSphere(q - e, 0.045), 170.0));
  }
  float yR = 2.02 + 0.86 + 0.02;                                                                           // the ridge: a gold jewel in the middle, beasts at the ends
  r = U(r, vec2(sdEll(q - vec3(0.0, yR+0.26, 0.0), vec3(0.08,0.17,0.08)), 170.0));
  r = U(r, vec2(sdSphere(q - vec3(0.0, yR+0.47, 0.0), 0.055), 170.0));
  r = U(r, vec2(sdEll(q - vec3(hx+0.36, yR+0.20, 0.0), vec3(0.07,0.14,0.09)), 170.0));
  r = U(r, vec2(sdEll(q - vec3(-hx-0.36, yR+0.20, 0.0), vec3(0.07,0.14,0.09)), 170.0));
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.07, hz+0.30), vec3(0.70,0.07,0.16), 0.02), 167.0));                // stair
  r = U(r, vec2(sdRBox(q - vec3(0.0, 0.035, hz+0.45), vec3(0.80,0.035,0.16), 0.02), 167.0));
  vec3 cq = q - vec3(0.95, 0.0, hz + 0.60);                                                                // an incense burner: a bronze bowl on three legs
  float bowl = sdEll(cq - vec3(0.0,0.27,0.0), vec3(0.14,0.10,0.14));
  bowl = smin(bowl, sdCylY(cq - vec3(0.0,0.36,0.0), 0.012, 0.15), 0.02);
  r = U(r, vec2(bowl, 187.0));
  for (int i=0;i<3;i++) { float a = float(i)*2.094 + 0.5; r = U(r, vec2(sdCap(cq, vec3(cos(a)*0.08,0.0,sin(a)*0.08), vec3(cos(a)*0.11,0.20,sin(a)*0.11), 0.016), 187.0)); }
  r = U(r, vec2(sdCap(cq, vec3(-0.03,0.38,0.0), vec3(-0.03,0.58,0.01), 0.006), 174.0));
  r = U(r, vec2(sdCap(cq, vec3(0.0,0.38,0.0), vec3(0.0,0.62,0.0), 0.006), 174.0));
  r = U(r, vec2(sdCap(cq, vec3(0.03,0.38,0.0), vec3(0.03,0.56,-0.01), 0.006), 174.0));
  return r;
}
