import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FaceParams } from "@safevtube/shared";

/**
 * Renders a user-supplied .glb (e.g. exported from a Blender rig) driven by FaceParams.
 *  - Shape keys named like ARKit blendshapes (eyeBlinkLeft, jawOpen, …) get the full 52-weight tracker output.
 *    A few common aliases (blink, aa, Blink_L, …) are driven from the simplified parameters.
 *  - Bones named Head / Neck / Jaw / LeftEye / RightEye get head pose, jaw opening and gaze.
 *    Without a head bone the whole model tilts slightly instead.
 * Models are loaded from embedded data only: any external URL inside the file is blocked.
 */

export interface ModelView { zoom: number; y: number; mirror: boolean }

type Driver = (f: FaceParams) => number;
interface MorphBinding { mesh: THREE.Mesh; index: number; drive: Driver }

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const avg = (a: number, b: number) => (a + b) / 2;
const blendOf = (f: FaceParams, k: string, fallback: number) => f.blend?.[k] ?? fallback;

/** Simplified-parameter fallbacks for the ARKit names, used when the tracker sent no full blend map. */
const ARKIT_FALLBACK: Record<string, Driver> = {
  eyeblinkleft: (f) => f.blinkL, eyeblinkright: (f) => f.blinkR, jawopen: (f) => f.jawOpen,
  mouthsmileleft: (f) => f.smile, mouthsmileright: (f) => f.smile, browinnerup: (f) => f.browUp,
  browdownleft: (f) => f.browDown, browdownright: (f) => f.browDown, mouthpucker: (f) => f.pucker,
};

const ALIASES: Record<string, Driver> = {
  blink: (f) => avg(f.blinkL, f.blinkR), eyes_closed: (f) => avg(f.blinkL, f.blinkR),
  blinkleft: (f) => f.blinkL, blink_l: (f) => f.blinkL, blink_left: (f) => f.blinkL, eyeblink_l: (f) => f.blinkL,
  blinkright: (f) => f.blinkR, blink_r: (f) => f.blinkR, blink_right: (f) => f.blinkR, eyeblink_r: (f) => f.blinkR,
  aa: (f) => f.jawOpen, a: (f) => f.jawOpen, viseme_aa: (f) => f.jawOpen, mouthopen: (f) => f.jawOpen, mouth_open: (f) => f.jawOpen,
  ou: (f) => f.pucker, u: (f) => f.pucker, viseme_u: (f) => f.pucker, o: (f) => f.pucker,
  joy: (f) => f.smile, smile: (f) => f.smile, happy: (f) => f.smile, mouthsmile: (f) => f.smile,
  lookup: (f) => Math.max(0, f.lookY), lookdown: (f) => Math.max(0, -f.lookY),
  lookleft: (f) => Math.max(0, -f.lookX), lookright: (f) => Math.max(0, f.lookX),
};

function driverFor(name: string): Driver | null {
  const key = name.toLowerCase();
  const arkit = Object.keys(ARKIT_FALLBACK).includes(key) || /^(brow|cheek|eye|jaw|mouth|nose|tongue)[a-z]+$/.test(key);
  if (arkit) {
    // Case-insensitive match against the tracker's ARKit map, falling back to the simplified value.
    return (f) => {
      if (f.blend) for (const k in f.blend) if (k.toLowerCase() === key) return f.blend[k]!;
      return ARKIT_FALLBACK[key]?.(f) ?? 0;
    };
  }
  return ALIASES[key] ?? null;
}

const findBone = (root: THREE.Object3D, include: RegExp, exclude?: RegExp): THREE.Object3D | null => {
  let best: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (best || !include.test(o.name) || (exclude && exclude.test(o.name))) return;
    if ((o as THREE.Bone).isBone || o.type === "Object3D" || o.type === "Group") best = o;
  });
  return best;
};

interface BoneRig { bone: THREE.Object3D; restWorld: THREE.Quaternion }

export class ModelStage {
  ready = false;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  private model: THREE.Object3D | null = null;
  private morphs: MorphBinding[] = [];
  private head: BoneRig | null = null;
  private neck: BoneRig | null = null;
  private jaw: BoneRig | null = null;
  private eyeL: BoneRig | null = null;
  private eyeR: BoneRig | null = null;
  private hasJawMorph = false;
  private hasLookMorph = false;
  private frame = { cx: 0, cy: 0, viewH: 1 };

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x000000, 1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, 2, 3);
    this.scene.add(sun);
  }

  async load(url: string): Promise<boolean> {
    this.ready = false;
    this.clear();
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      const manager = new THREE.LoadingManager();
      // Block anything that is not embedded in the .glb (no network fetches from a model file).
      manager.setURLModifier((u) => (u.startsWith("blob:") || u.startsWith("data:") ? u : PIXEL));
      const gltf = await new GLTFLoader(manager).parseAsync(buf, "");
      this.model = gltf.scene;
      this.scene.add(this.model);
      this.model.updateMatrixWorld(true);
      this.bind();
      this.computeFrame();
      this.ready = true;
      return true;
    } catch {
      this.clear();
      return false; // load failure => nothing drawn => black
    }
  }

  private rig(b: THREE.Object3D | null): BoneRig | null {
    return b ? { bone: b, restWorld: b.getWorldQuaternion(new THREE.Quaternion()) } : null;
  }

  private bind() {
    const m = this.model!;
    this.morphs = [];
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const dict = mesh.morphTargetDictionary;
      if (!mesh.isMesh || !dict) return;
      for (const [name, index] of Object.entries(dict)) {
        const drive = driverFor(name);
        if (!drive) continue;
        this.morphs.push({ mesh, index, drive });
        if (/jaw|mouthopen|^aa?$|viseme_aa/i.test(name)) this.hasJawMorph = true;
        if (/look/i.test(name)) this.hasLookMorph = true;
      }
    });
    const eye = (side: RegExp) => findBone(m, side, /lash|brow|lid|ball_?tear/i);
    this.head = this.rig(findBone(m, /^(.*[:_.])?head$/i, /top|end|hair/i) ?? findBone(m, /head/i, /top|end|hair|neck/i));
    this.neck = this.rig(findBone(m, /neck/i, /twist|end/i));
    this.jaw = this.rig(findBone(m, /jaw/i, /end/i));
    this.eyeL = this.rig(eye(/(^|[^a-z])(l|left)[_.:]?eye|eye[_.:]?(l|left)($|[^a-z])/i));
    this.eyeR = this.rig(eye(/(^|[^a-z])(r|right)[_.:]?eye|eye[_.:]?(r|right)($|[^a-z])/i));
  }

  private computeFrame() {
    const box = new THREE.Box3().setFromObject(this.model!);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const p = this.head?.bone.getWorldPosition(new THREE.Vector3());
    // Full-body humanoid (head near the top of the bounding box): frame head and shoulders.
    // Head-only or bust models: fit the whole thing.
    if (p && size.y > 0 && (p.y - box.min.y) / size.y > 0.7) {
      this.frame = { cx: p.x, cy: p.y + size.y * 0.03, viewH: size.y * 0.3 };
    } else {
      this.frame = { cx: center.x, cy: center.y, viewH: size.y * 1.15 };
    }
  }

  private clear() {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    }
    this.model = null;
    this.morphs = [];
    this.head = this.neck = this.jaw = this.eyeL = this.eyeR = null;
    this.hasJawMorph = this.hasLookMorph = false;
  }

  /** Rotate `r.bone` so its world rotation becomes delta * rest, expressed in the parent's current space. */
  private pose(r: BoneRig, delta: THREE.Quaternion) {
    const parentQ = r.bone.parent ? r.bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    r.bone.quaternion.copy(parentQ.invert().multiply(delta.clone().multiply(r.restWorld)));
    r.bone.updateMatrixWorld(true);
  }

  render(face: FaceParams, view: ModelView, w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.ready || !this.model) {
      this.renderer.clear();
      return;
    }
    const m = view.mirror ? 1 : -1; // mirror = selfie-style yaw/roll/gaze
    const euler = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "YXZ"));
    // Same convention as the dot avatar: (-pitch, -yaw, roll).
    const full = euler(-face.pitch, -face.yaw * m, face.roll * m);

    for (const b of this.morphs) b.mesh.morphTargetInfluences![b.index] = Math.min(1, Math.max(0, b.drive(face)));

    if (this.head) {
      if (this.neck) this.pose(this.neck, euler(-face.pitch * 0.4, -face.yaw * m * 0.4, face.roll * m * 0.4));
      this.pose(this.head, full);
    } else {
      this.model.quaternion.copy(euler(-face.pitch * 0.5, -face.yaw * m * 0.5, face.roll * m * 0.5));
    }
    if (this.jaw && !this.hasJawMorph) this.pose(this.jaw, full.clone().multiply(euler(blendOf(face, "jawOpen", face.jawOpen) * 0.35, 0, 0)));
    if (!this.hasLookMorph) {
      const look = full.clone().multiply(euler(-face.lookY * 0.35, face.lookX * m * 0.45, 0));
      if (this.eyeL) this.pose(this.eyeL, look);
      if (this.eyeR) this.pose(this.eyeR, look);
    }

    const { cx, cy, viewH } = this.frame;
    const vh = viewH / Math.max(0.05, view.zoom);
    const dist = vh / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(cx, cy + view.y * vh * 0.5, dist + (this.head ? this.head.bone.getWorldPosition(new THREE.Vector3()).z : 0));
    this.camera.lookAt(cx, cy + view.y * vh * 0.5, this.camera.position.z - dist);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.renderer.dispose();
  }
}
