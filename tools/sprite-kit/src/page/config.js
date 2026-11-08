'use strict';
// ---------------------------------------------------------------- constants shared by every sprite
const OPT = window.__KIT_OPTS || {};
const KIT = {
  PX: OPT.pxPerUnit || 56,                         // 1x: pixels per world unit
  CELL_PX: 32,                                     // CELL of web/src/page/map/geometry.ts
  PITCH: 52, YAW: 0,                               // front-facing 3/4 view: looking north, 52 degrees down
  KEY: [-0.36, 0.40, -0.84],                       // key light in camera space (right, up, towards the viewer); the same for every sprite
  SCALES: [1, 2],
  ALPHA_T: 4,                                       // alpha below this is cut away when frames are trimmed
  PAD: 2,                                          // transparent border between frames in an atlas (logical px)
};
KIT.CELLU = KIT.CELL_PX / KIT.PX;                  // world units per grid cell

// ---------------------------------------------------------------- palette of the cast
const MATN = ['skin','hair','A','B','trim','shoe','wood','X','Y','glow','eye','blush','red','cream','gold','straw'];
const BASE = { skin:'#ecc8a6', hair:'#2c261b', A:'#888888', B:'#666666', trim:'#c9bb92', shoe:'#2b2518', wood:'#7b5636',
  X:'#999999', Y:'#aaaaaa', glow:'#d9573a', eye:'#2b2518', blush:'#e4a08f', red:'#c0392b', cream:'#efe7d2', gold:'#d3b25a', straw:'#d4b97c' };
const MID = [0.90, 0.90, 0.94];                    // the mid band of the toon shading: palette colours are what that band shows
const FIGS = [
  { id:0, key:'li_laotai', zh:'李老太', en:'Granny Li', pal:{ skin:'#e9c3a1', hair:'#9a968f', A:'#33568f', B:'#4a546c', trim:'#e8dfc8', wood:'#7b5636', gold:'#d3b25a', cream:'#efe7d2', blush:'#e3a090' } },
  { id:1, key:'li_da', zh:'李大', en:'Li Da', pal:{ skin:'#dfaf86', A:'#33568f', B:'#3b4764', trim:'#c9bb92', cream:'#e3d6ac', straw:'#8da45c', blush:'#d99a80' } },
  { id:2, key:'li_er', zh:'李二', en:'Li Er', pal:{ skin:'#efcba9', A:'#5878ad', B:'#7d90b4', X:'#a9c2e6', glow:'#eaa63f', cream:'#efe7d2', gold:'#d3b25a', wood:'#7b5636' } },
  { id:3, key:'zhou_zhanggui', zh:'周掌柜', en:'Shopkeeper Zhou', pal:{ skin:'#e8bf99', hair:'#5c544b', A:'#dd8838', B:'#8a5628', trim:'#5a381d', wood:'#5b3a1e', X:'#2b231a', Y:'#d5ac62', red:'#c0392b' } },
  { id:4, key:'lao_he', zh:'老何', en:'Old He', pal:{ skin:'#d6a27a', hair:'#9d9a92', A:'#7b6c5c', B:'#8b7e6b', trim:'#4a3f33', wood:'#9a7b4c', straw:'#d4b97c', cream:'#efe7d2', blush:'#c98467' } },
  { id:5, key:'laobanniang', zh:'茶馆老板娘', en:'Teahouse owner', pal:{ skin:'#f1d1b4', hair:'#2c2620', A:'#cdb083', B:'#c2a574', trim:'#b5694a', cream:'#f3ecd9', X:'#8a4d36', Y:'#6b3b29', red:'#c0392b', gold:'#e2b84c', shoe:'#4a3a2c' } },
  { id:6, key:'zongguan', zh:'总管', en:'Festival manager', pal:{ skin:'#edc7a3', A:'#2f5b47', B:'#274a3a', trim:'#d1ab4f', gold:'#d1ab4f', Y:'#22362b', X:'#22362b', glow:'#c63a2a', wood:'#7b5636' } },
  { id:7, key:'zhou_huoji', zh:'周家伙计', en:'Zhou clerk', pal:{ skin:'#eecaa6', A:'#dc893a', B:'#7a4c22', trim:'#8f5a26', cream:'#f0e4c0', X:'#c79a58', Y:'#8f5f2e', wood:'#6b4a2e', gold:'#d3b25a', shoe:'#2b2518' } },
  { id:8, key:'zhanglao', zh:'族长', en:'Clan elder', pal:{ skin:'#e3bf9b', hair:'#d6d2ca', A:'#4a4354', B:'#37313f', trim:'#b09c6c', cream:'#e9e1cc', X:'#1f1c22', Y:'#6fa58a', red:'#7d3330', gold:'#c8aa5c', wood:'#5e4330', shoe:'#1f1c22', blush:'#dda68c' } },
  { id:9,  key:'townsman',   zh:'男镇民', en:'Townsman',   pal:{ skin:'#e1b890', hair:'#3b352d', A:'#7f8c9c', B:'#555c66', trim:'#a59c88', shoe:'#2b2518', blush:'#d99f84' } },
  { id:10, key:'townswoman', zh:'女镇民', en:'Townswoman', pal:{ skin:'#efcdaa', hair:'#3a2f27', A:'#809c7d', B:'#6c866b', trim:'#a7bb9b', cream:'#e8e0c8', shoe:'#2b2518', blush:'#e4a08f' } },
  { id:11, key:'child',      zh:'孩童',   en:'Child',      pal:{ skin:'#f0cfae', hair:'#2f2923', A:'#b5a27d', B:'#74664f', trim:'#cdbd94', red:'#b5493a', shoe:'#2b2518', blush:'#e8a08c' } },
  // the other twelve people of the cast, a figure of their own each: the Li children wear the blue of their house and the Zhou family the orange of theirs
  { id:12, key:'li_xiaomei', zh:'李家小妹', en:'Li Xiaomei', pal:{ skin:'#f2d0b0', hair:'#2c261b', A:'#4f7cc0', B:'#3b4764', trim:'#e8dfc8', cream:'#f3ecd9', red:'#c8432f', glow:'#e5533c', gold:'#d3b25a', wood:'#7b5636', shoe:'#3a2c25', blush:'#eaa08f' } },
  { id:13, key:'shitou', zh:'石头', en:'Shitou', pal:{ skin:'#e3b48c', hair:'#26211a', A:'#3f68a6', B:'#4a5675', trim:'#c9bb92', cream:'#efe7d2', X:'#9a5a3a', shoe:'#2b2518', blush:'#dc9a80' } },
  { id:14, key:'xiao_man', zh:'小满', en:'Xiaoman', pal:{ skin:'#e8bd98', hair:'#2e271f', A:'#4f8f8a', B:'#6d7050', trim:'#c9bb92', cream:'#f0e8d4', straw:'#d9bf7c', wood:'#a39a52', red:'#c8432f', shoe:'#2b2518', blush:'#e0a08a' } },
  { id:15, key:'zhou_niangzi', zh:'周娘子', en:'Madam Zhou', pal:{ skin:'#f0cfae', hair:'#2a231d', A:'#e08a3a', B:'#8a4a2a', trim:'#5a381d', cream:'#f3ecd9', X:'#f0e4c0', Y:'#7da24f', red:'#c0392b', gold:'#e2b84c', wood:'#6b4a2e', straw:'#d4b97c', shoe:'#3b2a22', blush:'#e8a08c' } },
  { id:16, key:'zhou_dalang', zh:'周家大郎', en:'Zhou Dalang', pal:{ skin:'#dcab82', hair:'#241e18', A:'#d2762e', B:'#6b4423', trim:'#8a3f1f', cream:'#efe3c3', X:'#2b231a', Y:'#c8994f', red:'#c0392b', wood:'#5b3a1e', shoe:'#2b2518', blush:'#cf8f72' } },
  { id:17, key:'zhou_erlang', zh:'周家二郎', en:'Zhou Erlang', pal:{ skin:'#efcba9', hair:'#2c261b', A:'#eaa352', B:'#a8683a', trim:'#8f5a26', cream:'#f3ecd9', X:'#8d8f62', wood:'#7b5636', shoe:'#2b2518', blush:'#e4a08f' } },
  { id:18, key:'sishu_xiansheng', zh:'私塾先生', en:'Schoolmaster', pal:{ skin:'#e8c4a0', hair:'#8a857d', A:'#8196b3', B:'#657a99', trim:'#e9e1cc', cream:'#efe7d2', X:'#26232b', Y:'#3d5a86', gold:'#c8aa5c', wood:'#6a4a30', shoe:'#26232b', blush:'#dda68c' } },
  { id:19, key:'zhangfang', zh:'账房', en:'Accountant', pal:{ skin:'#e6c19c', hair:'#3a342d', A:'#7d3f3a', B:'#2a2321', trim:'#d1b36a', cream:'#efe7d2', X:'#3d5a86', Y:'#d5ac62', gold:'#d3b25a', wood:'#5b3a1e', shoe:'#241f1c', blush:'#d99f84' } },
  { id:20, key:'miaozhu', zh:'庙祝', en:'Temple keeper', pal:{ skin:'#e3c09c', hair:'#bdb8b0', A:'#8d7390', B:'#6f5a75', trim:'#c9a64f', cream:'#e9e1cc', X:'#cbbd92', glow:'#e0502e', gold:'#d3b25a', wood:'#6a4a30', shoe:'#3a2f33', blush:'#d99f8c' } },
  { id:21, key:'gengfu', zh:'更夫', en:'Night watchman', pal:{ skin:'#d9a97f', hair:'#2a251f', A:'#2f3b5c', B:'#252d46', trim:'#b5452f', cream:'#e8dfc8', X:'#5b5248', Y:'#b88a3c', glow:'#f2b64c', red:'#b5452f', gold:'#c9a24c', wood:'#6a4a30', shoe:'#1f1c22', blush:'#cf9174' } },
  { id:22, key:'mujiang', zh:'木匠', en:'Carpenter', pal:{ skin:'#d8a47a', hair:'#2e271f', A:'#b99a68', B:'#6d5a3f', trim:'#8a6a3e', cream:'#eee3c4', X:'#5b3a1e', Y:'#aeb4bc', wood:'#8a5e32', straw:'#d4b97c', shoe:'#2b2518', blush:'#cf9174' } },
  { id:23, key:'zhadeng_shifu', zh:'扎灯师傅', en:'Lantern maker', pal:{ skin:'#efcba9', hair:'#2b241e', A:'#2f8f8a', B:'#276d73', trim:'#e8dfc8', cream:'#f3ecd9', red:'#cf4a35', straw:'#d9c27a', wood:'#7b5636', gold:'#d3b25a', shoe:'#3a2f2a', blush:'#e8a08c' } },
];
function hex2rgb(h){ const n = parseInt(h.slice(1),16); return [(n>>16&255)/255, (n>>8&255)/255, (n&255)/255]; }
function palGLSL(){
  const f = x => x.toFixed(4), ents = [];
  for (const fg of FIGS) for (const m of MATN) {
    const c = hex2rgb(fg.pal[m] || BASE[m]);
    ents.push(`vec3(${f(Math.min(c[0]/MID[0],1.5))},${f(Math.min(c[1]/MID[1],1.5))},${f(Math.min(c[2]/MID[2],1.5))})`);
  }
  return `const vec3 PAL[${ents.length}] = vec3[${ents.length}](\n${ents.join(',\n')});`;
}

// ---------------------------------------------------------------- light and camera (identical for every sprite)
const LIGHT = { shade:[0.70,0.66,0.76], mid:MID, lit:[1.07,1.04,0.97], rim:[1.0,0.92,0.78], emis:0.45 };
const v3 = {
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,k)=>[a[0]*k,a[1]*k,a[2]*k], dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  norm:a=>{const l=Math.hypot(a[0],a[1],a[2]); return [a[0]/l,a[1]/l,a[2]/l];}
};
function camBasis(yawDeg, pitchDeg){
  const pr = pitchDeg*Math.PI/180, y = yawDeg*Math.PI/180, c = Math.cos(pr), s = Math.sin(pr);
  return { R:[Math.cos(y),0,Math.sin(y)], F:[Math.sin(y)*c,-s,-Math.cos(y)*c], U:[Math.sin(y)*s,c,-Math.cos(y)*s] };
}
const CAM = camBasis(KIT.YAW, KIT.PITCH);
const KEYDIR = v3.norm(v3.add(v3.add(v3.mul(CAM.R,KIT.KEY[0]), v3.mul(CAM.U,KIT.KEY[1])), v3.mul(CAM.F,KIT.KEY[2])));
