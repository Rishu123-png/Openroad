import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { buildCarGeometry, type CarGeometry, type Part, type V3 } from "./carGeometry";
import type { CarSpec } from "./carSpecs";

function meshFrom(part: Part, name: string, scene: Scene, withColors: boolean): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = part.positions;
  data.normals = part.normals;
  data.indices = part.indices;
  if (withColors) data.colors = part.colors;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.isVisible = false; // template: clones and instances are drawn
  return mesh;
}

interface Templates {
  geometry: CarGeometry;
  paint: Mesh;
  glass: Mesh;
  detail: Mesh;
  lamps: Mesh;
  brake: Mesh;
  wheel: Mesh;
}

/**
 * Meshes and materials shared by every vehicle in a scene. Each model is
 * built once; every car is a few instances of it, so a street of traffic
 * costs a handful of draw calls.
 */
export class CarFactory {
  private readonly templates = new Map<string, Templates>();
  private readonly paints = new Map<string, PBRMaterial>();
  readonly glass: PBRMaterial;
  readonly detail: PBRMaterial;
  readonly lamps: PBRMaterial;
  readonly tailLamps: PBRMaterial;
  private readonly shadowMaterial: PBRMaterial;
  private readonly shadowTemplate: Mesh;

  constructor(private readonly scene: Scene) {
    this.glass = new PBRMaterial("carGlass", scene);
    this.glass.albedoColor = new Color3(0.02, 0.03, 0.035);
    this.glass.metallic = 0;
    this.glass.roughness = 0.04;
    this.glass.alpha = 0.84;
    this.glass.environmentIntensity = 1.4;

    this.detail = new PBRMaterial("carDetail", scene);
    this.detail.metallic = 0.1;
    this.detail.roughness = 0.55;

    this.lamps = new PBRMaterial("carLamps", scene);
    this.lamps.unlit = true;
    this.tailLamps = this.createTailLampMaterial("carTailLamps");

    // A soft dark patch under each car: moving vehicles are not in the static shadow map.
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.abs((x + 0.5) / size - 0.5) * 2, dy = Math.abs((y + 0.5) / size - 0.5) * 2;
        const edge = Math.max(0, 1 - Math.pow(Math.max(dx, dy), 3)) * Math.min(1, (1 - Math.max(dx, dy)) * 5);
        pixels.set([0, 0, 0, Math.round(edge * 165)], (y * size + x) * 4);
      }
    }
    const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true;
    this.shadowMaterial = new PBRMaterial("carShadow", scene);
    this.shadowMaterial.unlit = true;
    this.shadowMaterial.albedoColor = Color3.Black();
    this.shadowMaterial.opacityTexture = texture;
    this.shadowMaterial.zOffset = -6;
    this.shadowTemplate = new Mesh("carShadowTemplate", scene);
    const quad = new VertexData();
    quad.positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
    quad.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    quad.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    quad.indices = [0, 2, 1, 0, 3, 2];
    quad.applyToMesh(this.shadowTemplate);
    this.shadowTemplate.material = this.shadowMaterial;
    this.shadowTemplate.isVisible = false;
    this.shadowTemplate.isPickable = false;
  }

  createTailLampMaterial(name: string): PBRMaterial {
    const material = new PBRMaterial(name, this.scene);
    material.unlit = true;
    material.albedoColor = TAIL_DIM.clone();
    return material;
  }

  /** One shared material per paint colour. */
  paint(color: readonly [number, number, number]): PBRMaterial {
    const key = color.join(",");
    let material = this.paints.get(key);
    if (!material) {
      material = new PBRMaterial(`carPaint:${key}`, this.scene);
      material.albedoColor = new Color3(color[0], color[1], color[2]);
      material.metallic = 0.55;
      material.roughness = 0.3;
      material.clearCoat.isEnabled = true;
      material.clearCoat.intensity = 0.9;
      material.clearCoat.roughness = 0.08;
      this.paints.set(key, material);
    }
    return material;
  }

  private templatesFor(spec: CarSpec): Templates {
    let t = this.templates.get(spec.id);
    if (!t) {
      const geometry = buildCarGeometry(spec);
      const make = (part: Part, name: string, material: PBRMaterial | null, colors = true): Mesh => {
        const mesh = meshFrom(part, `${spec.id}:${name}`, this.scene, colors);
        mesh.material = material;
        return mesh;
      };
      t = {
        geometry,
        paint: make(geometry.paint, "paint", null, false),
        glass: make(geometry.glass, "glass", this.glass, false),
        detail: make(geometry.detail, "detail", this.detail),
        lamps: make(geometry.lamps, "lamps", this.lamps),
        brake: make(geometry.brake, "brake", this.tailLamps, false),
        wheel: make(geometry.wheel, "wheel", this.detail),
      };
      this.templates.set(spec.id, t);
    }
    return t;
  }

  /**
   * @param ownTailLamps give this car its own tail-lamp material, so its brake lights can light up alone
   * @param sprung hang the body from its own node, so it can lean on its springs (the player's car)
   */
  create(spec: CarSpec, name: string, color: readonly [number, number, number], ownTailLamps = false, sprung = false): CarVisual {
    const t = this.templatesFor(spec);
    const root = new TransformNode(name, this.scene);
    // The body is sprung: it leans on its own node while the wheels stay on the road.
    const bodyNode = sprung ? new TransformNode(`${name}:sprung`, this.scene) : root;
    if (bodyNode !== root) bodyNode.parent = root;
    const on = <M extends AbstractMesh>(parent: TransformNode, mesh: M): M => {
      mesh.parent = parent;
      mesh.isPickable = false;
      return mesh;
    };
    const child = <M extends AbstractMesh>(mesh: M): M => on(bodyNode, mesh);
    // Paint is a clone, which shares the geometry but can carry its own colour.
    const body = child(t.paint.clone(`${name}:paint`));
    body.material = this.paint(color);
    body.isVisible = true;
    child(t.glass.createInstance(`${name}:glass`));
    child(t.detail.createInstance(`${name}:detail`));
    child(t.lamps.createInstance(`${name}:lamps`));
    let tail: PBRMaterial = this.tailLamps;
    if (ownTailLamps) {
      const brake = child(t.brake.clone(`${name}:brake`));
      tail = this.createTailLampMaterial(`${name}:tailLamps`);
      brake.material = tail;
      brake.isVisible = true;
    } else child(t.brake.createInstance(`${name}:brake`));
    const wheels = t.geometry.wheelCentres.map((centre, i) => {
      const wheel = on(root, t.wheel.createInstance(`${name}:wheel${i}`));
      wheel.position.set(centre[0], centre[1], centre[2]);
      if (centre[0] < 0) wheel.rotation.y = Math.PI; // the left wheels are the same wheel turned round
      return wheel;
    });
    const shadow = on(root, this.shadowTemplate.createInstance(`${name}:shadow`));
    shadow.scaling.set(spec.width * 1.25, 1, spec.length * 1.15);
    shadow.position.y = 0.012;
    return new CarVisual(spec, root, wheels, tail, t.geometry.headlamps, body, ownTailLamps, bodyNode);
  }

  /** Vertex and triangle counts of a model, for the performance notes. */
  stats(spec: CarSpec): { triangles: number } {
    const t = this.templatesFor(spec);
    let indices = 0;
    for (const mesh of [t.paint, t.glass, t.detail, t.lamps, t.brake]) indices += mesh.getTotalIndices();
    indices += t.wheel.getTotalIndices() * 4;
    return { triangles: indices / 3 };
  }
}

/** How far the body leans. Taller vehicles lean more. */
export const SUSPENSION = { pitchPerAccel: 0.0026, rollPerAccel: 0.0048, maxPitch: 0.045, maxRoll: 0.06, rate: 7 } as const;

const TAIL_DIM = new Color3(0.28, 0.012, 0.012);
const TAIL_BRIGHT = new Color3(1, 0.06, 0.04);

/** One vehicle in the scene. Moving it allocates nothing. */
export class CarVisual {
  private spin = 0;
  private braking = false;

  constructor(
    readonly spec: CarSpec,
    readonly root: TransformNode,
    private readonly wheels: AbstractMesh[],
    private readonly tailLamps: PBRMaterial,
    readonly headlamps: readonly V3[],
    readonly body: Mesh,
    private readonly ownsTailLamps = false,
    /** The node the body hangs from: the root itself for a car that is not sprung. */
    readonly sprung: TransformNode = root,
  ) {}

  /**
   * Leans the body on its springs: the nose dips under braking and lifts
   * under power, and the body rolls away from the inside of a turn. The
   * wheels do not move. This is a visual response; it does not change how
   * the vehicle drives or what it collides with.
   *
   * @param forward acceleration along the vehicle, m/s² (negative when slowing)
   * @param rightward acceleration toward the vehicle's right, m/s² (positive in a right turn)
   */
  setBodyMotion(forward: number, rightward: number, deltaSeconds: number): void {
    const S = SUSPENSION;
    const tall = this.spec.height / 1.6;
    const pitch = Math.max(-S.maxPitch, Math.min(S.maxPitch, -forward * S.pitchPerAccel * tall));
    const roll = Math.max(-S.maxRoll, Math.min(S.maxRoll, rightward * S.rollPerAccel * tall));
    if (this.sprung === this.root) return; // not sprung: leaning would tilt the wheels into the road
    const k = deltaSeconds <= 0 ? 0 : 1 - Math.exp(-S.rate * deltaSeconds);
    this.sprung.rotation.x += (pitch - this.sprung.rotation.x) * k;
    this.sprung.rotation.z += (roll - this.sprung.rotation.z) * k;
  }

  /** Body lean in radians: positive pitch is nose down, positive roll is right side up. */
  get bodyLean(): { pitch: number; roll: number } {
    return { pitch: this.sprung.rotation.x, roll: this.sprung.rotation.z };
  }

  /**
   * @param heading radians clockwise from north
   * @param distance metres travelled since the last call (negative in reverse); turns the wheels
   * @param steer front-wheel angle in radians
   */
  place(x: number, y: number, z: number, heading: number, distance = 0, steer = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.spin = (this.spin + distance / this.spec.wheelRadius) % (Math.PI * 2);
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]!;
      const left = i % 2 === 1;
      wheel.rotation.x = left ? -this.spin : this.spin;
      if (i < 2) wheel.rotation.y = (left ? Math.PI : 0) + steer;
    }
  }

  /** Rotation of the wheels about their axles, in radians. */
  get wheelSpin(): number {
    return this.spin;
  }

  /** Only has a visible effect on a car created with its own tail lamps. */
  setBraking(on: boolean): void {
    if (on === this.braking) return;
    this.braking = on;
    this.tailLamps.albedoColor.copyFrom(on ? TAIL_BRIGHT : TAIL_DIM);
  }

  get isBraking(): boolean {
    return this.braking;
  }

  setEnabled(on: boolean): void {
    this.root.setEnabled(on);
  }

  /** Removes this car. Shared templates and materials stay; a tail-lamp material made for this car alone goes with it. */
  dispose(): void {
    this.root.dispose(false, false);
    if (this.ownsTailLamps) this.tailLamps.dispose();
  }
}
