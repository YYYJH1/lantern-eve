/**
 * The shapes of the people who are hidden by what stands in front of them (the rule is silhouette.ts).
 * For each person and each thing that hides them, the person's frame is drawn again as a flat shape in
 * the colour of their family: a translucent fill, and an opaque line round the body like the outline of
 * a person who is picked. It is drawn only where the pixels of the thing that hides the person are, and
 * as much as they are there, so that the shape is the person's pixels where the building's are and
 * nowhere else. It is drawn in the sorted container just over the thing that hides the person, and it is
 * not under the tint of the night.
 *
 * Each shape is one quad with a shader of its own, which looks into the atlas for both pictures. A mask
 * or a filter would draw the person and the building into pictures of their own, a pass each, and
 * those passes are what a map with a few people behind its buildings would pay for at every frame. The
 * nodes are kept and used again, and nothing is done for a map where nobody is hidden.
 */
import { type Container, Geometry, GlProgram, Mesh, Shader, Texture, UniformGroup } from "pixi.js";
import type { Figure } from "./people.ts";
import type { Pickable } from "./pick.ts";
import type { Occluder } from "./places.ts";
import { type Hidden, OcclusionTracker, silhouettePickable, silhouetteSort } from "./silhouette.ts";

/** The alpha of the fill of a shape. */
export const FILL_ALPHA = 0.3;
/** The thickness of the line round a shape, in pixels of the screen. */
export const LINE_PX = 2;

const VERTEX = `
in vec2 aPosition;
out vec2 vLocal;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
// The quad: where its top left is in the world, and how wide and how deep it is.
uniform vec4 uBox;

void main(void)
{
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(uBox.xy + aPosition * uBox.zw, 1.0)).xy, 0.0, 1.0);
    vLocal = aPosition * uBox.zw;
}
`;

// Every position here is in pixels of the world from the top left of the quad, so that the numbers stay small.
const FRAGMENT = `precision highp float;
precision highp sampler2D;
in vec2 vLocal;
out vec4 finalColor;

uniform sampler2D uPersonAtlas;
uniform sampler2D uHiderAtlas;
// The colour of the person's family. (Not uColor: that is the name of the uniform of four that the mesh has of its own.)
uniform vec3 uFamily;
// Where the top left of the quad is in the person's frame, in pixels of the frame, and the size of the frame.
uniform vec4 uPerson;
// The frame of the person in the atlas: its top left and its size, as fractions of the page.
uniform vec4 uPersonUv;
uniform vec4 uHider;
uniform vec4 uHiderUv;
// The line in pixels of the world, the alpha of the fill, and how many pixels of the hider's frame are a pixel of the world.
uniform vec3 uShape;

// The alpha of the picture of a frame at a point of the quad. The texture is read at every point, inside the frame or not, so that
// every read has the same level of detail (a read behind a branch has none); what is outside the frame is another sprite of the atlas, and is not counted.
float alphaOf(sampler2D atlas, vec4 frame, vec4 uv, vec2 at)
{
    float inside = step(0.0, at.x) * step(0.0, at.y) * step(at.x, frame.z) * step(at.y, frame.w);
    return texture(atlas, uv.xy + at / frame.zw * uv.zw).a * inside;
}

float solid(vec2 local)
{
    return step(0.5, alphaOf(uPersonAtlas, uPerson, uPersonUv, local + uPerson.xy));
}

void main(void)
{
    float inside = solid(vLocal);
    float line = uShape.x;
    float near = 0.0;
    near = max(near, solid(vLocal + vec2( line, 0.0)));
    near = max(near, solid(vLocal + vec2(-line, 0.0)));
    near = max(near, solid(vLocal + vec2(0.0,  line)));
    near = max(near, solid(vLocal + vec2(0.0, -line)));
    near = max(near, solid(vLocal + vec2( line,  line) * 0.7071));
    near = max(near, solid(vLocal + vec2(-line, -line) * 0.7071));
    near = max(near, solid(vLocal + vec2( line, -line) * 0.7071));
    near = max(near, solid(vLocal + vec2(-line,  line) * 0.7071));
    float edge = near * (1.0 - inside);
    float shape = max(inside * uShape.y, edge);
    // Where the thing that hides the person has its body, as much as it has it.
    float wall = alphaOf(uHiderAtlas, uHider, uHiderUv, vLocal * uShape.z + uHider.xy);
    finalColor = vec4(uFamily * shape, shape) * wall;
}
`;

/** One quad, from (0, 0) to (1, 1): every shape is drawn on it, placed and sized by the shader. */
const QUAD = new Geometry({
  attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: "float32x2", stride: 8, offset: 0 } },
  indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

/** What the shader of one shape is told. They are written in place: the group is sent to the card each time it is drawn. */
class Uniforms {
  readonly box = new Float32Array(4);
  readonly colour = new Float32Array(3);
  readonly person = new Float32Array(4);
  readonly personUv = new Float32Array(4);
  readonly hider = new Float32Array(4);
  readonly hiderUv = new Float32Array(4);
  readonly shape = new Float32Array([LINE_PX, FILL_ALPHA, 1]);
  readonly group = new UniformGroup({
    uBox: { value: this.box, type: "vec4<f32>" },
    uFamily: { value: this.colour, type: "vec3<f32>" },
    uPerson: { value: this.person, type: "vec4<f32>" },
    uPersonUv: { value: this.personUv, type: "vec4<f32>" },
    uHider: { value: this.hider, type: "vec4<f32>" },
    uHiderUv: { value: this.hiderUv, type: "vec4<f32>" },
    uShape: { value: this.shape, type: "vec3<f32>" },
  });

  setColour(colour: number): void {
    this.colour[0] = ((colour >> 16) & 255) / 255;
    this.colour[1] = ((colour >> 8) & 255) / 255;
    this.colour[2] = (colour & 255) / 255;
  }
}

interface Slot {
  mesh: Mesh<Geometry, Shader>;
  shader: Shader;
  uniforms: Uniforms;
}

export class Silhouettes {
  private readonly tracker = new OcclusionTracker<Figure, Occluder>();
  private readonly slots: Slot[] = [];
  /** How many of the slots are in use. */
  private used = 0;

  /** `host` is the container that everything on the ground is sorted in. */
  constructor(private readonly host: Container) {}

  /** How many shapes are on the map. */
  get count(): number {
    return this.tracker.pairs.length;
  }

  /**
   * Brings the shapes to where the people and the things that hide them are now. `stamp` changes when the list of those things does,
   * and `ready` is whether their pixels are at hand. `zoom` is the zoom of the camera, which the line is kept at the same size on the screen by.
   */
  update(people: readonly Figure[], hiders: readonly Occluder[], stamp: number, ready: boolean, zoom: number): void {
    if (this.tracker.update(people, hiders, stamp, ready)) this.bind(this.tracker.pairs);
    const pairs = this.tracker.pairs;
    const line = LINE_PX / zoom;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const slot = this.slots[i];
      if (pair === undefined || slot === undefined) continue;
      this.place(slot, pair, line);
    }
  }

  /** Gives each pair a node in the sorted container, and the part of its shader that does not move with the person. */
  private bind(pairs: readonly Hidden<Figure, Occluder>[]): void {
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (pair === undefined) continue;
      const slot = this.slots[i] ?? this.make();
      const { person, hider } = pair;
      const frame = hider.texture.frame;
      const uv = hider.texture.uvs;
      slot.uniforms.setColour(person.colour);
      slot.uniforms.hiderUv[0] = uv.x0;
      slot.uniforms.hiderUv[1] = uv.y0;
      slot.uniforms.hiderUv[2] = uv.x2 - uv.x0;
      slot.uniforms.hiderUv[3] = uv.y2 - uv.y0;
      slot.uniforms.hider[2] = frame.width;
      slot.uniforms.hider[3] = frame.height;
      slot.uniforms.shape[2] = 1 / hider.scale;
      slot.shader.resources.uHiderAtlas = hider.texture.source;
      if (slot.mesh.parent !== this.host) this.host.addChild(slot.mesh);
    }
    // The nodes that are not needed any more are taken out of the sorted container and kept for the next pair.
    for (let i = pairs.length; i < this.used; i++) this.slots[i]?.mesh.removeFromParent();
    this.used = pairs.length;
  }

  /** Puts a shape where its person is, over the part of the thing that hides them that the person's frame reaches. */
  private place(slot: Slot, { person, hider }: Hidden<Figure, Occluder>, line: number): void {
    const texture = person.sprite.texture;
    const u = slot.uniforms;
    // The quad is where the frame of the person, and the line round it, meet the frame of the thing: nothing is drawn outside it.
    const reach = line + 1;
    const x0 = Math.max(person.box.x0 - reach, hider.box.x0);
    const y0 = Math.max(person.box.y0 - reach, hider.box.y0);
    const x1 = Math.min(person.box.x1 + reach, hider.box.x1);
    const y1 = Math.min(person.box.y1 + reach, hider.box.y1);
    slot.mesh.zIndex = silhouetteSort(hider.sort, person.sort);
    slot.mesh.visible = x1 > x0 && y1 > y0;
    u.box[0] = x0;
    u.box[1] = y0;
    u.box[2] = x1 - x0;
    u.box[3] = y1 - y0;
    const frame = texture.frame;
    const uv = texture.uvs;
    u.person[0] = x0 - person.x + person.sprite.anchor.x * frame.width;
    u.person[1] = y0 - person.y + person.sprite.anchor.y * frame.height;
    u.person[2] = frame.width;
    u.person[3] = frame.height;
    u.personUv[0] = uv.x0;
    u.personUv[1] = uv.y0;
    u.personUv[2] = uv.x2 - uv.x0;
    u.personUv[3] = uv.y2 - uv.y0;
    u.hider[0] = (x0 - hider.x) / hider.scale + hider.anchor.x * hider.texture.frame.width;
    u.hider[1] = (y0 - hider.y) / hider.scale + hider.anchor.y * hider.texture.frame.height;
    u.shape[0] = line;
    if (slot.shader.resources.uPersonAtlas !== texture.source) slot.shader.resources.uPersonAtlas = texture.source;
  }

  private make(): Slot {
    const uniforms = new Uniforms();
    const shader = new Shader({
      // The program is the same for every shape, and for every map of the page: it is made once and kept.
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "lantern-silhouette" }),
      resources: { silhouetteUniforms: uniforms.group, uPersonAtlas: Texture.EMPTY.source, uHiderAtlas: Texture.EMPTY.source },
    });
    const mesh = new Mesh({ geometry: QUAD, shader });
    mesh.eventMode = "none";
    const slot = { mesh, shader, uniforms };
    this.slots.push(slot);
    return slot;
  }

  /** The shapes as things the pointer can be over: the person, where the person's body and the thing over them are both solid. */
  pickables(): Pickable[] {
    return this.tracker.pairs.map(({ person, hider }) => silhouettePickable(person, hider));
  }

  /** What is drawn, for the tests. */
  describe(): Array<{ person: string; occluder: string; key: string; sort: number; colour: number }> {
    return this.tracker.pairs.map(({ person, hider }) => ({ person: person.id, occluder: hider.id, key: hider.key, sort: silhouetteSort(hider.sort, person.sort), colour: person.colour }));
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.mesh.destroy();
      slot.shader.destroy();
    }
    this.slots.length = 0;
    this.used = 0;
  }
}
