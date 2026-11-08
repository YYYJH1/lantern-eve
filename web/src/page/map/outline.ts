/**
 * The outline of a picked or hovered figure: a line of colour round the body of the sprite and not
 * round the soft shadow baked under it. A pixel that is clear but has a solid one within the
 * thickness takes the colour. It is a filter, and a filter costs a pass of its own, so it is put on
 * the one or two figures that are marked, and taken off again.
 */
import { Filter, GlProgram, UniformGroup } from "pixi.js";

// The vertex shader every filter of PixiJS has, which maps the quad to the area of the filtered object.
const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform highp vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// The same precision as in the vertex shader, which a uniform of both has to have.
uniform highp vec4 uInputSize;
uniform vec4 uColor;
uniform float uThickness;

float solid(vec2 at) {
    return step(0.5, texture(uTexture, at).a);
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 px = uInputSize.zw * uThickness;
    float near = 0.0;
    near = max(near, solid(vTextureCoord + vec2( px.x, 0.0)));
    near = max(near, solid(vTextureCoord + vec2(-px.x, 0.0)));
    near = max(near, solid(vTextureCoord + vec2(0.0,  px.y)));
    near = max(near, solid(vTextureCoord + vec2(0.0, -px.y)));
    near = max(near, solid(vTextureCoord + px * 0.7071));
    near = max(near, solid(vTextureCoord - px * 0.7071));
    near = max(near, solid(vTextureCoord + vec2( px.x, -px.y) * 0.7071));
    near = max(near, solid(vTextureCoord + vec2(-px.x,  px.y) * 0.7071));
    float edge = near * (1.0 - step(0.5, c.a));
    finalColor = c * (1.0 - edge) + vec4(uColor.rgb * uColor.a, uColor.a) * edge;
}
`;

/** An outline of the given colour and thickness (in pixels of the screen). */
export class OutlineFilter extends Filter {
  constructor(colour: number, thickness: number, pixelRatio: number) {
    const uniforms = new UniformGroup({
      uColor: { value: new Float32Array([((colour >> 16) & 255) / 255, ((colour >> 8) & 255) / 255, (colour & 255) / 255, 1]), type: "vec4<f32>" },
      uThickness: { value: thickness * pixelRatio, type: "f32" },
    });
    super({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "lantern-outline" }),
      resources: { outlineUniforms: uniforms },
      padding: Math.ceil(thickness) + 2,
      resolution: pixelRatio,
    });
  }
}
