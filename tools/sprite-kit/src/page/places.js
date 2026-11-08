'use strict';
// ---------------------------------------------------------------- places and props (anchor = bottom-left corner of the footprint, on the ground)
// Footprints in grid cells come from content/maps/bridge_town.yaml (the `footprints` of the places and the `=`, `w` cells of the rows).
const CU = KIT.CELLU;
const LANTERN_SCALE = 1.5;                       // the door lanterns are drawn 1.5 times the size of the first version
const lanternBox = () => [-0.15,0.15,-0.32,0.14,-0.06,0.40].map(v => v*LANTERN_SCALE);
// which model a place is drawn with: the number is the `uObj` of the shader and the `OBJ_*` constant of places.glsl
const OBJ = { teahouse:0, house:1, pier:2, bridge:3, bamboo:4, lantern:5, willow:6, school:7, house2:8, post:9, stall:10, workshop:11, tavern:12, hall:13, temple:14, tree:15 };
function mk(id, zh, en, cols, rows, obj, v, boxG, boxS, o){
  const W = cols*CU, D = rows*CU;
  return Object.assign({ id, kind: id.startsWith('place.') ? 'place' : (id.startsWith('fx.') ? 'fx' : 'prop'), zh, en, cols, rows, obj, W, D,
    p0: [W, D, v, 0], p1: [0,0,0,0], boxG: boxG(W,D), boxS: boxS(W,D), catchR: 3.0, catchS: 1.0, ss1: 4, ss2: 3, line: 1.25, depthThr: 0.035, aoR: 0.30, shK: 6.0, extra: {} }, o || {});
}
const PLACES = [
  mk('place.teahouse', '茶馆', 'Teahouse', 7, 4, OBJ.teahouse, 0, (W,D)=>[-0.5,W+1.0,0,3.4,-D-0.6,0.45], (W,D)=>[-0.8,W+2.0,0,3.4,-D-0.9,0.8], { lights: true, catchR: 3.8, extra: { door: { cellX: 3.5 }, lanternMountsPx1x: mounts(7*CU, 0.80, 1.45, -0.06), note: 'tea flag on the right; windows are dim by day' } }),
  mk('place.li_house', '李家宅', 'Li family house', 5, 3, OBJ.house, 0, (W,D)=>[-0.4,W+0.4,0,2.5,-D-0.5,0.45], (W,D)=>[-0.6,W+1.6,0,2.5,-D-0.7,0.7], { lights: true, catchR: 2.8, extra: { door: { cellX: 2.5 }, lanternMountsPx1x: mounts(5*CU, 0.62, 1.12, -0.05) } }),
  mk('place.zhou_house', '周家宅', 'Zhou family house', 5, 3, OBJ.house, 1, (W,D)=>[-0.4,W+0.4,0,2.5,-D-0.5,0.45], (W,D)=>[-0.6,W+1.6,0,2.5,-D-0.7,0.8], { lights: true, catchR: 2.8, extra: { door: { cellX: 2.5 }, lanternMountsPx1x: mounts(5*CU, 0.62, 1.12, -0.05) } }),
  // the other buildings of the town; the mounts of the door lanterns are for the households that live there (the tavern and the market have none)
  mk('place.school', '私塾', 'Village school', 6, 3, OBJ.school, 0, (W,D)=>[-0.6,W+0.6,0,2.7,-D-0.6,0.9], (W,D)=>[-0.9,W+1.8,0,2.7,-D-0.9,1.0], { lights: true, catchR: 3.0, extra: { door: { cellX: 3 }, lanternMountsPx1x: mounts(6*CU, 0.64, 1.14, -0.05) } }),
  mk('place.accountant_home', '账房先生家', "Accountant's house", 4, 3, OBJ.house2, 0, (W,D)=>[-0.5,W+0.5,0,2.5,-D-0.5,0.9], (W,D)=>[-0.8,W+1.6,0,2.5,-D-0.8,1.0], { lights: true, catchR: 2.5, extra: { door: { cellX: 2 }, lanternMountsPx1x: mounts(4*CU, 0.62, 1.10, -0.05) } }),
  mk('place.carpenter_home', '木匠家', "Carpenter's house", 4, 3, OBJ.house2, 1, (W,D)=>[-0.5,W+1.3,0,2.5,-D-0.5,0.9], (W,D)=>[-0.8,W+2.3,0,2.5,-D-0.8,1.0], { lights: true, catchR: 2.8, extra: { door: { cellX: 2 }, lanternMountsPx1x: mounts(4*CU, 0.62, 1.10, -0.05) } }),
  mk('place.xiaoman_home', '小满家', "Xiaoman's house", 3, 3, OBJ.house2, 2, (W,D)=>[-1.3,W+0.5,0,2.3,-D-0.5,0.9], (W,D)=>[-1.6,W+1.5,0,2.3,-D-0.8,1.0], { lights: true, catchR: 2.6, extra: { door: { cellX: 1.5 }, lanternMountsPx1x: mounts(3*CU, 0.58, 1.04, -0.05) } }),
  mk('place.he_home', '老何家', "Old He's house", 4, 3, OBJ.house2, 3, (W,D)=>[-0.5,W+1.7,0,2.5,-D-0.5,0.9], (W,D)=>[-0.8,W+2.7,0,2.5,-D-0.8,1.0], { lights: true, catchR: 3.0, extra: { door: { cellX: 2 }, lanternMountsPx1x: mounts(4*CU, 0.62, 1.10, -0.05) } }),
  mk('place.watch_post', '更铺', 'Watch post', 3, 2, OBJ.post, 0, (W,D)=>[-0.9,W+0.9,0,2.3,-D-0.5,0.9], (W,D)=>[-1.1,W+1.7,0,2.3,-D-0.8,1.0], { lights: true, catchR: 2.2, extra: { door: { cellX: 1.5 }, lanternMountsPx1x: mounts(3*CU, 0.46, 0.86, -0.05) } }),
  mk('place.market_stall', '集市摊位（暖）', 'Market stall, warm awning', 2, 1, OBJ.stall, 0, (W,D)=>[-0.4,W+0.4,0,1.5,-D-0.35,0.7], (W,D)=>[-0.6,W+1.1,0,1.5,-D-0.6,0.9], { catchR: 1.4, aoR: 0.2 }),
  mk('place.market_stall_blue', '集市摊位（冷）', 'Market stall, blue awning', 2, 1, OBJ.stall, 1, (W,D)=>[-0.4,W+0.4,0,1.5,-D-0.35,0.7], (W,D)=>[-0.6,W+1.1,0,1.5,-D-0.6,0.9], { catchR: 1.4, aoR: 0.2 }),
  mk('place.workshop', '扎灯坊', 'Lantern workshop', 7, 3, OBJ.workshop, 0, (W,D)=>[-0.5,W+1.0,0,2.4,-D-0.5,1.0], (W,D)=>[-0.8,W+2.0,0,2.4,-D-0.9,1.1], { lights: true, catchR: 3.5, extra: { door: { cellX: 3.5 }, lanternMountsPx1x: mounts(7*CU, 0.62, 1.04, -0.05) } }),
  mk('place.tavern', '酒肆', 'Tavern', 6, 3, OBJ.tavern, 0, (W,D)=>[-1.3,W+0.8,0,3.0,-D-0.5,1.0], (W,D)=>[-1.5,W+1.8,0,3.0,-D-0.9,1.1], { lights: true, catchR: 3.2, extra: { door: { cellX: 3 }, note: 'wine flag on the left; the household of nobody, so no door lanterns' } }),
  mk('place.clan_hall', '祠堂', 'Ancestral hall', 8, 4, OBJ.hall, 0, (W,D)=>[-0.8,W+0.8,0,3.7,-D-0.8,1.2], (W,D)=>[-1.1,W+2.2,0,3.7,-D-1.1,1.3], { lights: true, catchR: 4.2, extra: { door: { cellX: 4 }, lanternMountsPx1x: mounts(8*CU, 0.74, 1.36, -0.05) } }),
  mk('place.temple', '庙', 'Temple', 7, 4, OBJ.temple, 0, (W,D)=>[-0.8,W+0.8,0,3.8,-D-0.9,1.3], (W,D)=>[-1.1,W+2.2,0,3.8,-D-1.2,1.4], { lights: true, catchR: 4.0, extra: { door: { cellX: 3.5 }, lanternMountsPx1x: mounts(7*CU, 0.70, 1.32, -0.05) } }),
  mk('place.ferry_pier', '渡口栈桥', 'Ferry pier', 2, 1, OBJ.pier, 0, (W,D)=>[-0.3,W+0.3,-0.75,0.8,-D-0.3,0.3], (W,D)=>[-0.5,W+0.5,-0.75,0.8,-D-0.4,0.5], { catchR: 1.0, catchS: 0.5, aoR: 0.2 }),
  mk('place.bridge', '石桥（完好）', 'Stone bridge, whole', 6, 2, OBJ.bridge, 0, (W,D)=>[-0.3,W+0.3,-0.8,1.7,-D-0.3,0.9], (W,D)=>[-0.4,W+1.0,-0.8,1.7,-D-0.4,1.3], { catchR: 3.4, extra: { deckLiftPx1x: deckLift(), deckLiftNote: 'screen lift of a walker on the deck, sampled every half cell from the west end (index 0) to the east end (index 12); the span is 6 cells, the canal under it 4 cells wide and centred' } }),
  mk('place.bridge_broken', '石桥（栏杆塌落）', 'Stone bridge, railing fallen', 6, 2, OBJ.bridge, 1, (W,D)=>[-0.3,W+0.3,-0.8,1.7,-D-0.3,0.9], (W,D)=>[-0.4,W+1.0,-0.8,1.7,-D-0.4,1.3], { catchR: 3.4, extra: { deckLiftPx1x: deckLift(), deckLiftNote: 'screen lift of a walker on the deck, sampled every half cell from the west end (index 0) to the east end (index 12); the span is 6 cells, the canal under it 4 cells wide and centred' } }),
  mk('prop.bamboo_small', '竹竿堆（4 根）', 'Bamboo pile, 4 poles', 2, 1, OBJ.bamboo, 4, (W,D)=>[-0.2,W+0.2,0,0.5,-D-0.3,0.6], (W,D)=>[-0.3,W+0.5,0,0.5,-D-0.3,0.7], { catchR: 1.3, aoR: 0.15, shK: 7.0 }),
  mk('prop.bamboo_large', '竹竿堆（10 根）', 'Bamboo pile, 10 poles', 2, 1, OBJ.bamboo, 10, (W,D)=>[-0.2,W+0.2,0,0.6,-D-0.3,0.65], (W,D)=>[-0.3,W+0.5,0,0.6,-D-0.3,0.75], { catchR: 1.4, aoR: 0.15, shK: 7.0 }),
  mk('prop.willow', '垂柳', 'Willow', 1, 1, OBJ.willow, 0, (W,D)=>[-1.35,W+1.35,0,3.0,-D-1.35,1.1], (W,D)=>[-1.5,W+2.6,0,3.0,-D-1.5,1.3], { catchR: 2.6, ss1: 4, ss2: 4, line: 0.9, depthThr: 0.04, aoR: 0.25 }),
  // the trees of the town (one cell each): the page picks a kind for a cell from a hash of the cell
  mk('prop.tree_round', '圆冠树', 'Round broadleaf tree', 1, 1, OBJ.tree, 0, (W,D)=>[-0.6,W+0.6,0,2.2,-D-0.6,0.6], (W,D)=>[-0.9,W+2.0,0,2.2,-D-0.9,0.9], { catchR: 1.0, line: 1.0, depthThr: 0.04, aoR: 0.25 }),
  mk('prop.tree_umbrella', '伞冠树', 'Spreading broadleaf tree', 1, 1, OBJ.tree, 5, (W,D)=>[-0.7,W+0.7,0,1.9,-D-0.7,0.7], (W,D)=>[-1.0,W+2.0,0,1.9,-D-1.0,1.0], { catchR: 1.05, line: 1.0, depthThr: 0.04, aoR: 0.25 }),
  mk('prop.tree_cypress', '柏树', 'Cypress', 1, 1, OBJ.tree, 1, (W,D)=>[-0.5,W+0.5,0,2.6,-D-0.5,0.5], (W,D)=>[-0.8,W+2.0,0,2.6,-D-0.8,0.8], { catchR: 0.9, line: 1.0, depthThr: 0.04, aoR: 0.25 }),
  mk('prop.tree_bamboo', '竹丛', 'Bamboo clump', 1, 1, OBJ.tree, 2, (W,D)=>[-0.6,W+0.6,0,2.3,-D-0.6,0.6], (W,D)=>[-0.8,W+1.8,0,2.3,-D-0.8,0.8], { catchR: 0.95, line: 0.9, depthThr: 0.04, aoR: 0.2 }),
  mk('prop.stone_heap', '青苔石堆', 'Mossy stone heap', 1, 1, OBJ.tree, 3, (W,D)=>[-0.5,W+0.5,0,0.6,-D-0.5,0.5], (W,D)=>[-0.7,W+1.4,0,0.6,-D-0.7,0.7], { catchR: 0.7, aoR: 0.15 }),
  mk('prop.junk_pile', '杂物堆', 'Pile of junk', 1, 1, OBJ.tree, 4, (W,D)=>[-0.5,W+0.5,0,0.7,-D-0.5,0.5], (W,D)=>[-0.7,W+1.4,0,0.7,-D-0.7,0.7], { catchR: 0.7, aoR: 0.15 }),
  mk('prop.door_lantern_lit', '门灯（点亮）', 'Door lantern, lit', 0, 0, OBJ.lantern, 1, lanternBox, lanternBox, { catchR: 0, catchS: 0, emis: 1.0, line: 0.9, depthThr: 0.02, aoR: 0.1, extra: { mount: 'hang', glow: 'fx.lantern_glow', glowOffsetPx: lanternGlowOffset() } }),
  mk('prop.door_lantern_unlit', '门灯（未点）', 'Door lantern, unlit', 0, 0, OBJ.lantern, 0, lanternBox, lanternBox, { catchR: 0, catchS: 0, emis: 0.0, line: 0.9, depthThr: 0.02, aoR: 0.1, extra: { mount: 'hang' } }),
];
function lanternGlowOffset(){            // from the anchor (the bracket fixing) to the middle of the lantern body, in 1x px (y down)
  const c = [0, -0.035 - 0.11, 0.27].map(v => v*LANTERN_SCALE);
  return { x: Math.round(v3.dot(c, CAM.R)*KIT.PX), y: Math.round(-v3.dot(c, CAM.U)*KIT.PX) };
}
// the things of the corner of the page (shaders/objects.glsl, a program of its own): each stands on one point and has no footprint on the map
const THING = { seal: 16, notebook: 17, burner: 18 };
function thing(id, zh, en, obj, variant, box, extra, opts){
  return mk(id, zh, en, 0, 0, obj, variant, () => box, () => box, Object.assign({ program: 'objects', catchR: 0.85, catchS: 1.0, line: 1.1, depthThr: 0.02, aoR: 0.12, ss1: 4, ss2: 3 }, opts || {}, { extra: extra || {} }));
}
PLACES.push(
  thing('prop.elder_seal', '族长印', "Clan elder's seal", THING.seal, 0, [-0.55, 0.55, 0, 1.45, -0.50, 0.45], { note: 'a stone seal with the character 族 cut in its face; for the corner of the page, not for the map' }),
  thing('prop.notebook', '见闻簿', 'Notebook, thread-bound', THING.notebook, 0, [-0.62, 0.62, 0, 0.34, -0.78, 0.78], { note: 'a thread-bound book lying flat, 见闻簿 on its label; for the corner of the page, not for the map' }),
  thing('prop.incense_unlit', '香炉（未点）', 'Incense burner, unlit', THING.burner, 0, [-0.65, 0.65, 0, 1.20, -0.55, 0.55], { note: 'a bronze burner with a stick of incense; stands on the same point as prop.incense_lit' }),
  thing('prop.incense_lit', '香炉（点燃）', 'Incense burner, lit', THING.burner, 1, [-0.65, 0.65, 0, 1.75, -0.55, 0.55], { note: 'the same burner with the tip glowing and a thread of smoke; stands on the same point as prop.incense_unlit' }, { emis: 1.0 }),
);
const GLOW = { id: 'fx.lantern_glow', kind: 'fx', zh: '灯笼光晕', en: 'Lantern glow halo', cols: 0, rows: 0, extra: { blend: 'add', color: [255, 176, 80], note: 'additive halo: draw it centred on the lantern body (door_lantern_lit anchor + glowOffsetPx), 1x radius 64 px' } };
PLACES.push(GLOW);
const GLOW_R = 64;
// The night window light of a building: the lit panes of its windows (and the paper of the lanterns that hang on it) and nothing else, baked once from the same model
// and shown over the building at night, added to the picture. It is a sprite of its own beside the building and not a second building: it is a few small shapes.
// `spots` in its manifest entry (made by compose.js) say where the windows are, for a halo round each.
function lightsOf(p){
  const name = p.id.slice(p.id.indexOf('.') + 1);
  // The window of the render is the band of the front wall that holds the windows and the hanging lanterns (the whole building is still what hides them): a third of the pixels of the building's own window.
  const band = [-0.4, p.W + 0.4, 0.2, 1.6, -0.35, 0.45];
  return Object.assign({}, p, { id: 'fx.windows.' + name, kind: 'fx', zh: p.zh + '（夜窗光）', en: p.en + ', window light at night', cols: 0, rows: 0, mode: 1, parent: p.id, lights: false, boxS: band,
    extra: { blend: 'add', lightsFor: p.id, note: 'added to the picture at night, anchored like its building; spots = the windows as [x, y, w, h] from the anchor of this sprite (1x px, y down), for a halo round each' } });
}
for (const p of PLACES.slice()) if (p.lights) { p.extra.lights = 'fx.windows.' + p.id.slice(p.id.indexOf('.') + 1); PLACES.push(lightsOf(p)); }

function sphereOf(b){ const c = [(b[0]+b[1])/2, (b[2]+b[3])/2, (b[4]+b[5])/2]; return [c[0], c[1], c[2], Math.hypot(b[1]-b[0], b[3]-b[2], b[5]-b[4])/2 + 0.05]; }
function placeJobs(){
  const jobs = [];
  for (const p of PLACES) {
    if (p.id === GLOW.id) { jobs.push({ sprite: p.id, anim: 'still', dir: '', k: 0, key: `${p.id}|still||0`, kind: 2, win: { W: GLOW_R*2, H: GLOW_R*2, ax: GLOW_R, ay: GLOW_R } }); continue; }
    const win = windowOf(p.boxS, 6);
    jobs.push({ sprite: p.id, anim: 'still', dir: '', k: 0, key: `${p.id}|still||0`, kind: 1, mode: p.mode || 0, win, obj: p.obj, p0: p.p0, p1: p.p1,
      bound: sphereOf(p.boxG), catcher: [p.W/2, -p.D/2, p.catchR, p.catchS], line: p.line, depthThr: p.depthThr, aoR: p.aoR, shK: p.shK, emis: p.emis, ss1: p.ss1, ss2: p.ss2, program: p.program });
  }
  return jobs;
}
// where the door lanterns hang: fixing points on the front wall, in 1x px from the sprite anchor (y down). The lantern sprite's own anchor goes on the point
function wallPt(W, dx, y, zWall){ const P = [W/2 + dx, y, zWall]; return { x: Math.round(v3.dot(P, CAM.R)*KIT.PX), y: Math.round(-v3.dot(P, CAM.U)*KIT.PX) }; }
function mounts(W, dx, y, zWall){ return { left: wallPt(W, -dx, y, zWall), right: wallPt(W, dx, y, zWall) }; }
// how far the deck of the bridge lifts a walker above the ground, every half cell along the 6-cell span (1x px; the deck profile of bridgeDeckY in places.glsl)
function deckLift(){
  const X = 3*CU, H = 0.95, out = [];
  for (let c = 0; c <= 12; c++) {
    const t = Math.min(Math.max((Math.abs((c/2 - 3)*CU) - 0.30)/(X - 0.30), 0), 1);
    out.push(Math.round(H*(1 - t*t*(3 - 2*t))*KIT.PX*Math.cos(KIT.PITCH*Math.PI/180)*10)/10);
  }
  return out;
}
function placeConsts(){
  const f = x => x.toFixed(5);
  const objs = Object.entries(OBJ).map(([k, v]) => `OBJ_${k.toUpperCase()}=${v}`).join(', ');
  return `const int ${objs};
const float LANTERN_S = ${f(LANTERN_SCALE)};
const float BR_X = ${f(3*CU)}, BR_W = ${f(1*CU)}, BR_AW = ${f(2*CU)}, BR_AH = 0.62, BR_H = 0.95, CANAL_HW = ${f(2*CU)};`;
}
// text decals: the tea flag, the teahouse plaque and the two surname plaques share one canvas (white text, alpha used by the shader)
let DECAL = null;
function makeDecal(){
  if (DECAL) return DECAL;
  const c = DECAL = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const face = '"AR PL UKai CN","Noto Serif CJK SC","Songti SC","Source Han Serif SC",serif';
  const put = (ch, cx, cy, sx, sy, size) => { g.save(); g.translate(cx, cy); g.scale(sx, sy); g.font = `bold ${size}px ${face}`; g.fillText(ch, 0, size*0.04); g.restore(); };
  put('茶', 128, 150, 0.80, 0.40, 512); put('馆', 128, 360, 0.80, 0.40, 512);                 // flag: x 0-256, y 0-512
  put('茶', 256+512*0.30, 64, 0.60, 1.0, 118); put('馆', 256+512*0.70, 64, 0.60, 1.0, 118);   // teahouse plaque: x 256-768, y 0-128
  put('李', 128, 512+128, 1.0, 1.0, 190); put('周', 256+128, 512+128, 1.0, 1.0, 190);          // surname plaques: 256 x 256
  put('私', 256+512*0.30, 128+64, 0.60, 1.0, 118); put('塾', 256+512*0.70, 128+64, 0.60, 1.0, 118);   // school board: x 256-768, y 128-256
  put('祠', 256+512*0.30, 256+64, 0.60, 1.0, 118); put('堂', 256+512*0.70, 256+64, 0.60, 1.0, 118);   // hall board: x 256-768, y 256-384
  put('酒', 768+128, 210, 1.0, 1.0, 250);                                                         // wine flag: x 768-1024, y 0-512
  put('账', 512+128, 512+128, 1.0, 1.0, 190);                                                     // the accountant's board: x 512-768, y 512-768
  return c;
}
// the decals of the things of the corner, on a canvas of their own so that the one above, which the places are baked with, stays as it was:
// the character of the elder's seal (x 520-650, y 776-1018) and the title of the notebook, three characters down its label (x 800-904, y 530-890).
// They are outlines (glyphs.js), so no font is asked.
let OBJECTS_DECAL = null;
function makeObjectsDecal(){
  if (OBJECTS_DECAL) return OBJECTS_DECAL;
  const c = OBJECTS_DECAL = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d');
  const glyph = (ch, x, y, w, h, grow) => { const path = new Path2D(GLYPHS[ch]); g.save(); g.translate(x, y); g.scale(w/1000, h/1000); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = grow; g.lineJoin = 'round'; g.fill(path); g.stroke(path); g.restore(); };
  glyph('族', 520, 776, 130, 242, 16);
  glyph('见', 800, 530, 104, 120, 14); glyph('闻', 800, 650, 104, 120, 14); glyph('簿', 800, 770, 104, 120, 14);
  return c;
}
function renderGlow(S){
  const R = GLOW_R*S, c = document.createElement('canvas'); c.width = c.height = R*2; const g = c.getContext('2d');
  const gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0.00, 'rgba(255,176,80,0.80)'); gr.addColorStop(0.18, 'rgba(255,166,70,0.50)'); gr.addColorStop(0.55, 'rgba(255,150,60,0.16)'); gr.addColorStop(1.00, 'rgba(255,140,50,0)');
  g.fillStyle = gr; g.fillRect(0, 0, R*2, R*2);
  return c;
}
