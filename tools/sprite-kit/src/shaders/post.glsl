#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uCol, uGeo, uInk;
uniform int   uSS;
uniform float uLine;       // line radius in SS pixels
uniform float uPxSS;
uniform vec3  uCamR, uCamU, uCamF;
uniform float uDepthThr, uCreaseCos, uInkAlpha;
out vec4 oFrag;

vec4 samplePix(ivec2 sp, ivec2 sz){
  vec4 col = texelFetch(uCol, sp, 0);
  vec4 g = texelFetch(uGeo, sp, 0);
  bool geo = g.w < 1e4;
  vec3 n = g.xyz; float t = g.w;
  float edge = 0.0; vec3 ink = vec3(0.17,0.145,0.09);
  for (int ring=0; ring<3; ring++){
    float rr = uLine * float(ring+1)/3.0;
    for (int k=0;k<8;k++){
      float a = (float(k) + 0.5*float(ring))*0.785398;
      vec2 dv = vec2(cos(a), sin(a));
      float w = 1.0 + 0.45*max(0.0, dot(dv, vec2(-0.6,0.8)));
      ivec2 q = clamp(sp + ivec2(floor(dv*rr*w + 0.5)), ivec2(0), sz-1);
      vec4 gq = texelFetch(uGeo, q, 0);
      bool qgeo = gq.w < 1e4;
      float e = 0.0; vec4 inkq = vec4(0.0);
      if (qgeo) {
        inkq = texelFetch(uInk, q, 0);
        if (!geo) e = 1.0;
        else {
          vec2 off = vec2(q - sp)/uPxSS;
          float dn = min(dot(n, uCamF), -0.15);
          float pred = t - (off.x*dot(n,uCamR) + off.y*dot(n,uCamU))/dn;
          float r = gq.w - pred;
          if (r < -uDepthThr) e = 1.0;
          else if (dot(n, gq.xyz) < uCreaseCos && abs(r) < uDepthThr*2.5) e = 0.55;
        }
      }
      if (e < 1.0) inkq = texelFetch(uInk, sp, 0);
      e *= inkq.a;
      if (e > edge) { edge = e; ink = inkq.rgb; }
    }
  }
  vec4 base = geo ? vec4(col.rgb, 1.0) : vec4(col.rgb, col.a);
  vec3 pm = base.rgb*base.a; float a = base.a;
  float ea = edge*uInkAlpha;
  pm = ink*ea + pm*(1.0-ea); a = ea + a*(1.0-ea);
  return vec4(pm, a);
}
void main(){
  ivec2 sz = textureSize(uGeo, 0);
  ivec2 base = ivec2(gl_FragCoord.xy)*uSS;
  vec4 acc = vec4(0.0);
  for (int j=0;j<uSS;j++) for (int i=0;i<uSS;i++) acc += samplePix(base + ivec2(i,j), sz);
  acc /= float(uSS*uSS);
  vec3 rgb = acc.a > 1e-4 ? acc.rgb/acc.a : vec3(0.0);
  oFrag = vec4(rgb, acc.a);
}
