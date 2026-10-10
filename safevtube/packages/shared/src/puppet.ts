import type { PhysicsParams } from "./physics";
import type { FaceParams } from "./types";

/**
 * Data model + pure logic of the 2D puppet rig (Live2D-style, but built from plain PNG layers).
 *  - Conditions: show a layer / swap its image when face parameters cross thresholds
 *    (e.g. "blinkR > 0.5 -> image 3").
 *  - Bindings: map a parameter range onto a layer transform (x, y, rotate, scale, opacity).
 *  - Pupil: an image that slides inside an elliptical area following the gaze.
 */

export const PUPPET_PARAMS = [
  "yaw", "pitch", "roll", "jawOpen", "blinkL", "blinkR", "smile", "browUp", "browDown", "pucker", "lookX", "lookY",
] as const;
export type PuppetParam = (typeof PUPPET_PARAMS)[number];

export const PARAM_INFO: Record<PuppetParam, { label: string; min: number; max: number }> = {
  yaw: { label: "Head turn (°)", min: -45, max: 45 },
  pitch: { label: "Head nod (°)", min: -35, max: 35 },
  roll: { label: "Head tilt (°)", min: -35, max: 35 },
  jawOpen: { label: "Mouth open", min: 0, max: 1 },
  blinkL: { label: "Blink: your left eye", min: 0, max: 1 },
  blinkR: { label: "Blink: your right eye", min: 0, max: 1 },
  smile: { label: "Smile", min: 0, max: 1 },
  browUp: { label: "Brows up", min: 0, max: 1 },
  browDown: { label: "Brows down", min: 0, max: 1 },
  pucker: { label: "Lips pucker", min: 0, max: 1 },
  lookX: { label: "Gaze left/right", min: -1, max: 1 },
  lookY: { label: "Gaze up/down", min: -1, max: 1 },
};

export interface Condition { param: PuppetParam; op: ">" | "<"; value: number }
/** Image swap: the first state whose conditions all hold replaces the layer's base image. No asset = hide. */
export interface PuppetState { id: string; asset?: string; when: Condition[] }

export const BINDING_PROPS = ["x", "y", "rotate", "scale", "opacity"] as const;
export type BindingProp = (typeof BINDING_PROPS)[number];
/** x/y in canvas px, rotate in degrees, scale/opacity as factors. */
export interface PuppetBinding { param: PuppetParam; prop: BindingProp; inMin: number; inMax: number; outMin: number; outMax: number }

/** Elliptical area, in canvas px, inside which the pupil image moves. */
export interface PupilArea { x: number; y: number; w: number; h: number }

export interface PuppetLayer {
  id: string;
  name: string;
  asset?: string;
  states: PuppetState[];
  bindings: PuppetBinding[];
  /** Layer is drawn only while all conditions hold (empty = always). */
  visibleWhen: Condition[];
  /** "head": rotates around the head pivot and gets parallax by `depth`. */
  follow: "none" | "head";
  depth: number;
  /** Rotation/scale pivot for bindings, as a fraction of the canvas. Default: the head pivot. */
  pivotX?: number;
  pivotY?: number;
  /** Hair/accessory physics: the layer sways with head movement. */
  physics?: PhysicsParams;
  /** When set, the layer's image is a pupil positioned inside `area` by the gaze. */
  pupil?: { area: PupilArea; clip: boolean; scale: number };
}

/** Param value as the user sees it: angles in degrees; `mirror` flips turn/tilt/gaze like a selfie camera. */
export function paramValue(f: FaceParams, p: PuppetParam, mirror: boolean): number {
  const m = mirror ? 1 : -1;
  const deg = (r: number) => (r * 180) / Math.PI;
  switch (p) {
    case "yaw": return deg(f.yaw) * m;
    case "pitch": return deg(f.pitch);
    case "roll": return deg(f.roll) * m;
    case "jawOpen": return f.jawOpen;
    case "blinkL": return f.blinkL;
    case "blinkR": return f.blinkR;
    case "smile": return f.smile;
    case "browUp": return f.browUp;
    case "browDown": return f.browDown;
    case "pucker": return f.pucker;
    case "lookX": return f.lookX * m;
    case "lookY": return f.lookY;
  }
}

export const holds = (c: Condition, f: FaceParams, mirror: boolean): boolean => {
  const v = paramValue(f, c.param, mirror);
  return c.op === ">" ? v > c.value : v < c.value;
};
export const allHold = (cs: Condition[], f: FaceParams, mirror: boolean): boolean => cs.every((c) => holds(c, f, mirror));

/** Which image to draw for the layer right now (null = nothing). */
export function pickAsset(layer: PuppetLayer, f: FaceParams, mirror: boolean): string | null {
  if (!allHold(layer.visibleWhen, f, mirror)) return null;
  for (const s of layer.states) if (allHold(s.when, f, mirror)) return s.asset ?? null;
  return layer.asset ?? null;
}

export function bindingValue(b: PuppetBinding, f: FaceParams, mirror: boolean): number {
  const v = paramValue(f, b.param, mirror);
  const span = b.inMax - b.inMin;
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, (v - b.inMin) / span));
  return b.outMin + (b.outMax - b.outMin) * t;
}

/** Pupil centre: gaze (-1..1) scaled into the ellipse, never leaving it. */
export function pupilPosition(a: PupilArea, lookX: number, lookY: number): { x: number; y: number } {
  let dx = Math.max(-1, Math.min(1, lookX)), dy = Math.max(-1, Math.min(1, -lookY));
  const r = Math.hypot(dx, dy);
  if (r > 1) { dx /= r; dy /= r; }
  return { x: a.x + a.w / 2 + dx * (a.w / 2), y: a.y + a.h / 2 + dy * (a.h / 2) };
}

export const CONDITION_PRESETS: { label: string; when: Condition[] }[] = [
  { label: "Right eye closed", when: [{ param: "blinkR", op: ">", value: 0.5 }] },
  { label: "Left eye closed", when: [{ param: "blinkL", op: ">", value: 0.5 }] },
  { label: "Both eyes closed", when: [{ param: "blinkL", op: ">", value: 0.5 }, { param: "blinkR", op: ">", value: 0.5 }] },
  { label: "Both eyes open", when: [{ param: "blinkL", op: "<", value: 0.5 }, { param: "blinkR", op: "<", value: 0.5 }] },
  { label: "Mouth closed", when: [{ param: "jawOpen", op: "<", value: 0.15 }] },
  { label: "Mouth half open", when: [{ param: "jawOpen", op: ">", value: 0.15 }, { param: "jawOpen", op: "<", value: 0.45 }] },
  { label: "Mouth wide open", when: [{ param: "jawOpen", op: ">", value: 0.45 }] },
  { label: "Smiling", when: [{ param: "smile", op: ">", value: 0.45 }] },
  { label: "Brows raised", when: [{ param: "browUp", op: ">", value: 0.4 }] },
  { label: "Looking left", when: [{ param: "lookX", op: "<", value: -0.4 }] },
  { label: "Looking right", when: [{ param: "lookX", op: ">", value: 0.4 }] },
  { label: "Head turned left", when: [{ param: "yaw", op: "<", value: -15 }] },
  { label: "Head turned right", when: [{ param: "yaw", op: ">", value: 15 }] },
];
