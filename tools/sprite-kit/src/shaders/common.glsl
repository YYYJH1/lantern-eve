#define PI 3.14159265
float sat(float x){ return clamp(x,0.0,1.0); }
float dot2(vec3 v){ return dot(v,v); }
float smin(float a,float b,float k){ float h=max(k-abs(a-b),0.0)/k; return min(a,b)-h*h*k*0.25; }
float smax(float a,float b,float k){ return -smin(-a,-b,k); }
vec2  U(vec2 a, vec2 b){ return a.x<b.x?a:b; }
vec2  SU(vec2 a, vec2 b, float k){ return vec2(smin(a.x,b.x,k), a.x<b.x?a.y:b.y); }
vec2  rot2(vec2 v,float a){ float c=cos(a),s=sin(a); return vec2(c*v.x-s*v.y, s*v.x+c*v.y); }
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }

float sdSphere(vec3 p,float r){ return length(p)-r; }
float sdEll(vec3 p, vec3 r){ float k0=length(p/r); float k1=length(p/(r*r)); return k0*(k0-1.0)/max(k1,1e-5); }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-r; }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdRBox(vec3 p, vec3 b, float r){ vec3 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r; }
float sdTorus(vec3 p, float R, float r){ vec2 q=vec2(length(p.xz)-R,p.y); return length(q)-r; }
float sdCylY(vec3 p, float h, float r){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h); return min(max(d.x,d.y),0.)+length(max(d,0.)); }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba); float rr=r1-r2; float a2=l2-rr*rr; float il2=1.0/l2;
  vec3 pa=p-a; float y=dot(pa,ba); float z=y-l2; float x2=dot2(pa*l2-ba*y); float y2=y*y*l2; float z2=z*z*l2;
  float k=sign(rr)*rr*rr*x2;
  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;
  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2-r1;
}
// capped cone, axis y, from -h (radius r1) to +h (radius r2)
float sdCCone(vec3 p, float h, float r1, float r2){
  vec2 q=vec2(length(p.xz),p.y); vec2 k1=vec2(r2,h); vec2 k2=vec2(r2-r1,2.0*h);
  vec2 ca=vec2(q.x-min(q.x,(q.y<0.0)?r1:r2), abs(q.y)-h);
  vec2 cb=q-k1+k2*clamp(dot(k1-q,k2)/dot(k2,k2),0.0,1.0);
  float s=(cb.x<0.0&&ca.y<0.0)?-1.0:1.0;
  return s*sqrt(min(dot(ca,ca),dot(cb,cb)));
}
// rounded cone frustum, y0..y1, radii r0 (bottom) r1 (top), corner rounding rnd
float sdRobe(vec3 p, float y0, float y1, float r0, float r1, float rnd){
  float h=0.5*(y1-y0); vec3 q=p-vec3(0.0,0.5*(y0+y1),0.0);
  return sdCCone(q, h-rnd, r0-rnd, r1-rnd)-rnd;
}
vec3 toBody(vec3 p, vec3 pivot, float a){ vec3 q=p-pivot; float c=cos(a),s=sin(a); return vec3(q.x, q.y*c+q.z*s, -q.y*s+q.z*c)+pivot; }
vec3 toBase(vec3 q, vec3 pivot, float a){ vec3 v=q-pivot; float c=cos(a),s=sin(a); return vec3(v.x, v.y*c-v.z*s, v.y*s+v.z*c)+pivot; }
