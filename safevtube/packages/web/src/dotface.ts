import type { FaceParams } from "@safevtube/shared";

/**
 * A generic (not user-derived) dot-cloud avatar: head, hair, ears, neck and shoulders.
 * Only the abstract FaceParams deform it, so the real face shape never reaches the stream.
 */
type Kind = "shell" | "eyeRing" | "pupil" | "brow" | "nose" | "nostril" | "lipUp" | "lipLow" | "hair" | "ear" | "neck" | "shoulder";
export interface Dot { k: Kind; a: number; b: number; c: number; side: number }

const RX = 0.75, RY = 1, RZ = 0.8;
const frontZ = (x: number, y: number) => RZ * Math.sqrt(Math.max(0, 1 - (x / RX) ** 2 - (y / RY) ** 2));
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const NECK_BASE = -0.95; // pivot for neck/shoulders
const HEAD_PIVOT = -0.6; // the head nods around the top of the neck

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildDots(count: number): Dot[] {
  const r = rng(1234);
  const dots: Dot[] = [];
  const n = (f: number) => Math.max(8, Math.round(count * f));
  const add = (k: Kind, num: number, f: (i: number, num: number) => Omit<Dot, "k">) => { for (let i = 0; i < num; i++) dots.push({ k, ...f(i, num) }); };
  const golden = Math.PI * (3 - Math.sqrt(5));

  add("shell", n(0.36), (i, m) => ({ a: Math.asin(1 - (2 * (i + 0.5)) / m), b: i * golden, c: 0, side: 0 }));
  // Hair: a slightly larger cap over the top/back of the head (rejection-sampled on a Fibonacci sphere).
  const hairTarget = n(0.14);
  for (let i = 0, got = 0; got < hairTarget && i < hairTarget * 8; i++) {
    const m = hairTarget * 8;
    const a = Math.asin(1 - (2 * (i + 0.5)) / m), b = i * golden;
    const y = RY * Math.sin(a), z = RZ * Math.cos(a) * Math.sin(b);
    const hairline = z > 0 ? 0.58 : -0.35; // fringe in front, low at the back
    if (y > hairline) { dots.push({ k: "hair", a, b, c: r(), side: 0 }); got++; }
  }
  for (const side of [-1, 1]) {
    add("eyeRing", n(0.045), (i, m) => ({ a: (i / m) * Math.PI * 2, b: 0, c: 0, side }));
    add("pupil", n(0.018), () => ({ a: Math.sqrt(r()), b: r() * Math.PI * 2, c: 0, side }));
    add("brow", n(0.03), (i, m) => ({ a: i / m, b: 0, c: 0, side }));
    add("ear", n(0.015), (i, m) => ({ a: (i / m) * Math.PI * 2, b: 0, c: 0, side }));
    add("nostril", n(0.006), () => ({ a: r(), b: r() * Math.PI * 2, c: 0, side }));
  }
  add("nose", n(0.03), (i, m) => ({ a: i / m, b: 0, c: 0, side: 0 }));
  add("lipUp", n(0.04), (i, m) => ({ a: i / m, b: 0, c: 0, side: 0 }));
  add("lipLow", n(0.04), (i, m) => ({ a: i / m, b: 0, c: 0, side: 0 }));
  add("neck", n(0.05), (i, m) => ({ a: r() * Math.PI * 2, b: i / m, c: 0, side: 0 }));
  add("shoulder", n(0.14), (i, m) => ({ a: (i / m) * 2 - 1, b: r(), c: r(), side: 0 }));
  return dots;
}

function place(d: Dot, f: FaceParams, t: number): [number, number, number] {
  switch (d.k) {
    case "shell": {
      const x = RX * Math.cos(d.a) * Math.cos(d.b);
      let y = RY * Math.sin(d.a);
      const z = RZ * Math.cos(d.a) * Math.sin(d.b);
      if (z > 0 && y < -0.1) y -= f.jawOpen * 0.22 * smooth(-0.1, -0.7, y) * smooth(0, 0.4, z);
      return [x, y, z];
    }
    case "hair": {
      const k = 1.07 + 0.05 * d.c; // uneven length gives a fluffy edge
      const sway = 0.012 * Math.sin(t * 1.7 + d.b * 3) * d.c;
      return [RX * k * Math.cos(d.a) * Math.cos(d.b) + sway, RY * k * Math.sin(d.a), RZ * k * Math.cos(d.a) * Math.sin(d.b)];
    }
    case "ear": {
      const x = d.side * (RX - 0.01), y = 0.08 + 0.1 * Math.sin(d.a), z = 0.0 + 0.06 * Math.cos(d.a);
      return [x + d.side * 0.04 * (1 + Math.cos(d.a)) * 0.5, y, z];
    }
    case "eyeRing": {
      const cx = d.side * 0.28, cy = 0.2, blink = d.side < 0 ? f.blinkL : f.blinkR;
      const x = cx + 0.11 * Math.cos(d.a);
      const y = cy + 0.06 * Math.sin(d.a) * (1 - 0.92 * blink);
      return [x, y, frontZ(x, y) + 0.015];
    }
    case "pupil": {
      const blink = d.side < 0 ? f.blinkL : f.blinkR;
      const x = d.side * 0.28 + f.lookX * 0.05 + 0.03 * d.a * Math.cos(d.b);
      const y = 0.2 + f.lookY * 0.03 + 0.03 * d.a * Math.sin(d.b) * (1 - 0.92 * blink);
      return [x, y, frontZ(x, y) + 0.02];
    }
    case "brow": {
      const x = d.side * (0.16 + 0.24 * d.a);
      const inner = 1 - d.a;
      const y = 0.42 + f.browUp * 0.08 * (0.5 + inner) - f.browDown * 0.07 * (0.4 + inner) + 0.02 * Math.sin(d.a * Math.PI);
      return [x, y, frontZ(x, y) + 0.015];
    }
    case "nose": {
      const y = 0.25 - 0.4 * d.a;
      return [0, y, frontZ(0, y) + 0.05 + 0.1 * smooth(0.5, 1, d.a)];
    }
    case "nostril": {
      const x = d.side * (0.07 + 0.025 * d.a * Math.cos(d.b)), y = -0.17 + 0.015 * d.a * Math.sin(d.b);
      return [x, y, frontZ(x, y) + 0.07];
    }
    case "lipUp":
    case "lipLow": {
      const w = 0.2 * (1 + f.smile * 0.25 - f.pucker * 0.45);
      const u = d.a * 2 - 1; // -1..1
      const my = -0.38;
      const corner = f.smile * 0.09 * u * u;
      const x = u * w;
      const curve = 0.03 * Math.cos((u * Math.PI) / 2);
      const open = f.jawOpen * 0.26;
      const y = d.k === "lipUp" ? my + curve + corner : my - curve * 0.4 + corner - open * (1 - u * u * 0.6) - 0.01;
      return [x, y, frontZ(x, y) + 0.02 + f.pucker * 0.05];
    }
    case "neck": {
      const y = -0.8 - 0.75 * d.b; // from under the jaw to the shoulders
      const rad = 0.27 + 0.03 * d.b;
      return [rad * Math.cos(d.a), y - f.jawOpen * 0.02, rad * 0.9 * Math.sin(d.a)];
    }
    case "shoulder": {
      // A broad arch: top surface of the shoulders and chest, gently breathing.
      const x = d.a * 1.45;
      const arch = -1.32 - 0.3 * Math.pow(Math.abs(d.a), 2.2) - 0.55 * d.b * d.b;
      const z = (d.c - 0.5) * 0.7 * (1 - 0.5 * Math.abs(d.a));
      return [x, arch + 0.012 * Math.sin(t * 1.6), z];
    }
  }
}

interface Rot { cy: number; sy: number; cp: number; sp: number; cr: number; sr: number }
const rot = (yaw: number, pitch: number, roll: number): Rot => ({
  cy: Math.cos(-yaw), sy: Math.sin(-yaw), cp: Math.cos(-pitch), sp: Math.sin(-pitch), cr: Math.cos(roll), sr: Math.sin(roll),
});
function rotate(R: Rot, x: number, y: number, z: number): [number, number, number] {
  [x, z] = [x * R.cy + z * R.sy, -x * R.sy + z * R.cy];
  [y, z] = [y * R.cp - z * R.sp, y * R.sp + z * R.cp];
  [x, y] = [x * R.cr - y * R.sr, x * R.sr + y * R.cr];
  return [x, y, z];
}

export function drawDots(
  ctx: CanvasRenderingContext2D,
  dots: Dot[],
  f: FaceParams,
  w: number,
  h: number,
  color: string,
  size: number,
  t = 0,
) {
  ctx.clearRect(0, 0, w, h);
  const head = rot(f.yaw, f.pitch, f.roll);
  const neck = rot(f.yaw * 0.5, f.pitch * 0.4, f.roll * 0.4);
  const body = rot(f.yaw * 0.12, 0, f.roll * 0.08);
  const scale = Math.min(w, h) * 0.27;
  const cyOff = 0.28; // shift up so the shoulders fit in frame
  const bob = 0.006 * Math.sin(t * 1.6);
  ctx.fillStyle = color;
  for (const d of dots) {
    let [x, y, z] = place(d, f, t);
    if (d.k === "shoulder") [x, y, z] = rotate(body, x, y - NECK_BASE, z), y += NECK_BASE;
    else if (d.k === "neck") [x, y, z] = rotate(neck, x, y - NECK_BASE, z), y += NECK_BASE;
    else [x, y, z] = rotate(head, x, y - HEAD_PIVOT, z), (y += HEAD_PIVOT + bob);
    const p = 3 / (3 - z * 0.8);
    const sheet = d.k === "shell" || d.k === "ear" || d.k === "hair" || d.k === "neck" || d.k === "shoulder";
    const dim = d.k === "shoulder" ? 0.75 : d.k === "neck" ? 0.6 : d.k === "hair" ? 0.9 : d.k === "shell" ? 0.7 : 1;
    const front = sheet ? dim * (0.3 + 0.7 * Math.max(0, (z + 0.35) / 1.1)) : 1;
    ctx.globalAlpha = Math.min(1, front * (0.5 + 0.5 * p));
    const s = size * p * (d.k === "shoulder" ? 0.9 : 1);
    ctx.fillRect(w / 2 + x * scale * p - s / 2, h / 2 - (y + cyOff) * scale * p - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
