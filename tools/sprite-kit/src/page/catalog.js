'use strict';
// ---------------------------------------------------------------- what is baked
const DIRS = ['down','up','left','right'];
const FACE = { down:0, up:180, left:-90, right:90 };          // facing relative to the camera, degrees (+ = towards the right of the screen)
const POSES = {
  idle:  { fps:2, frames:2, wk:0, pz:0, vr:0, phase:k => k*Math.PI },
  walk:  { fps:8, frames:6, wk:1, pz:0, vr:0, phase:k => k*2*Math.PI/6 },
  talk:  { fps:2, frames:2, wk:0, pz:1, vr:0, phase:k => k*Math.PI },
  carry: { fps:8, frames:6, wk:1, pz:0, vr:1, phase:k => k*2*Math.PI/6 },
};
// the seven characters of the slice, then the two that are baked as well
const CHARS = [
  { id:'char.zhanglao',      fig:8, scale:1.10, swing:0.0984 },
  { id:'char.laobanniang',   fig:5, swing:0.135 },
  { id:'char.zhou_huoji',    fig:7, swing:0.155 },
  { id:'char.li_laotai',     fig:0, swing:0.12 },
  { id:'char.li_da',         fig:1, swing:0.155, anims:['idle','walk','talk','carry'] },
  { id:'char.li_er',         fig:2, swing:0.155 },
  { id:'char.zongguan',      fig:6, swing:0.155 },
  { id:'char.zhou_zhanggui', fig:3, swing:0.12 },
  { id:'char.lao_he',        fig:4, swing:0.155 },
  // the other people of the town: plain, muted, no props
  { id:'char.townsman',      fig:9,  swing:0.14 },
  { id:'char.townswoman',    fig:10, swing:0.12 },
  { id:'char.child',         fig:11, scale:0.74, swing:0.10 },
  // the other twelve people of the cast, named by their ids in the cast file
  { id:'char.li_xiaomei',    fig:12, scale:0.80, swing:0.10 },
  { id:'char.shitou',        fig:13, scale:0.76, swing:0.10 },
  { id:'char.xiao_man',      fig:14, scale:0.76, swing:0.10 },
  { id:'char.zhou_niangzi',  fig:15, swing:0.13 },
  { id:'char.zhou_dalang',   fig:16, swing:0.155 },
  { id:'char.zhou_erlang',   fig:17, swing:0.155 },
  { id:'char.sishu_xiansheng', fig:18, swing:0.12 },
  { id:'char.zhangfang',     fig:19, swing:0.12 },
  { id:'char.miaozhu',       fig:20, swing:0.10 },
  { id:'char.gengfu',        fig:21, swing:0.14 },
  { id:'char.mujiang',       fig:22, swing:0.14 },
  { id:'char.zhadeng_shifu', fig:23, swing:0.13 },
];
const SLICE7 = ['char.zhanglao','char.laobanniang','char.zhou_huoji','char.li_laotai','char.li_da','char.li_er','char.zongguan'];
const TOWN3 = ['char.townsman','char.townswoman','char.child'];
const OWN12 = [['char.li_xiaomei','char.shitou','char.xiao_man','char.zhou_niangzi','char.zhou_dalang','char.zhou_erlang'],
               ['char.sishu_xiansheng','char.zhangfang','char.miaozhu','char.gengfu','char.mujiang','char.zhadeng_shifu']];

// the window of a sprite: the screen box of a world box (anchor at the origin), in 1x pixels with the anchor on a whole pixel
function windowOf(box, margin){
  let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;
  for (const x of [box[0],box[1]]) for (const y of [box[2],box[3]]) for (const z of [box[4],box[5]]) {
    const sx = v3.dot([x,y,z], CAM.R), sy = v3.dot([x,y,z], CAM.U);
    xmin=Math.min(xmin,sx); xmax=Math.max(xmax,sx); ymin=Math.min(ymin,sy); ymax=Math.max(ymax,sy);
  }
  const px = KIT.PX, m = margin;
  const ax = Math.ceil(-xmin*px) + m, ay = Math.ceil(ymax*px) + m;
  return { W: ax + Math.ceil(xmax*px) + m, H: ay + Math.ceil(-ymin*px) + m, ax, ay };
}
function characterBox(sc){ return [-0.85*sc, 1.15*sc, 0, 1.62*sc, -0.78*sc, 0.78*sc]; }

function charJobs(){
  const jobs = [];
  for (const ch of CHARS) {
    const sc = ch.scale || 1, win = windowOf(characterBox(sc), 5);
    for (const anim of (ch.anims || ['idle','walk','talk'])) {
      const P = POSES[anim];
      for (const dir of DIRS) for (let k=0;k<P.frames;k++) {
        jobs.push({ sprite: ch.id, anim, dir, k, key: `${ch.id}|${anim}|${dir}|${k}`, win, kind: 0, figId: ch.fig,
          fig: { pos:[0,0,0], yaw: FACE[dir]*Math.PI/180, scale: sc, wk: P.wk, ph: P.phase(k), aux: P.vr + 2*P.pz },
          bound: [0, 0.62*sc, 0, 1.05*sc], catcher: [0, 0, 0.95*sc, 1.0], line: 1.1, depthThr: 0.018, aoR: 0.14, ss1: 4 });
      }
    }
  }
  return jobs;
}
