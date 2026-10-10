import type { FaceParams } from "@safevtube/shared";

/**
 * A generic (not user-derived) dot-cloud head. Only the abstract FaceParams deform it,
 * so the real face geometry never reaches the stream.
 */
type Kind = "shell" | "eyeRing" | "pupil" | "brow" | "nose" | "lipUp" | "lipLow";
interface Dot { k: Kind; a: number; b: number; c: number; side: number }

const RX = 0.75, RY = 1, RZ = 0.8;
const frontZ = (x: number, y: number) => RZ * Math.sqrt(Math.max(0, 1 - (x / RX) ** 2 - (y / RY) ** 2));
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildDots(count: number): Dot[] {
  const r = rng(1234);
  const dots: Dot[] = [];
  const add = (k: Kind, n: number, f: (i: number) => Omit<Dot, "k">) => { for (let i = 0; i < n; i++) dots.push({ k, ...f(i) }); };
  const shell = Math.round(count * 0.5);
  const golden = Math.PI * (3 - Math.sqrt(5));
  add("shell", shell, (i) => ({ a: Math.asin(1 - (2 * (i + 0.5)) / shell), b: i * golden, c: 0, side: 0 }));
  for (const side of [-1, 1]) {
    add("eyeRing", Math.round(count * 0.06), (i) => ({ a: (i / Math.round(count * 0.06)) * Math.PI * 2, b: 0, c: 0, side }));
    add("pupil", Math.round(count * 0.02), () => ({ a: Math.sqrt(r()), b: r() * Math.PI * 2, c: 0, side }));
    add("brow", Math.round(count * 0.04), (i) => ({ a: i / Math.round(count * 0.04), b: 0, c: 0, side }));
  }
  add("nose", Math.round(count * 0.04), (i) => ({ a: i / Math.round(count * 0.04), b: 0, c: 0, side: 0 }));
  add("lipUp", Math.round(count * 0.05), (i) => ({ a: i / Math.round(count * 0.05), b: 0, c: 0, side: 0 }));
  add("lipLow", Math.round(count * 0.05), (i) => ({ a: i / Math.round(count * 0.05), b: 0, c: 0, side: 0 }));
  return dots;
}

function place(d: Dot, f: FaceParams): [number, number, number] {
  switch (d.k) {
    case "shell": {
      // Fibonacci sphere on the head ellipsoid; lower face follows the jaw.
      const x = RX * Math.cos(d.a) * Math.cos(d.b);
      let y = RY * Math.sin(d.a);
      const z = RZ * Math.cos(d.a) * Math.sin(d.b);
      if (z > 0 && y < -0.1) y -= f.jawOpen * 0.22 * smooth(-0.1, -0.7, y) * smooth(0, 0.4, z);
      return [x, y, z];
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
    case "lipUp":
    case "lipLow": {
      const w = 0.2 * (1 + f.smile * 0.25 - f.pucker * 0.45);
      const u = d.a * 2 - 1; // -1..1
      const my = -0.38 + f.pucker * 0.0;
      const corner = f.smile * 0.09 * u * u;
      const x = u * w;
      const curve = 0.03 * Math.cos((u * Math.PI) / 2);
      const open = f.jawOpen * 0.26;
      const y = d.k === "lipUp" ? my + curve + corner : my - curve * 0.4 + corner - open * (1 - u * u * 0.6) - 0.01;
      return [x, y, frontZ(x, y) + 0.02 + f.pucker * 0.05];
    }
  }
}

export function drawDots(
  ctx: CanvasRenderingContext2D,
  dots: Dot[],
  f: FaceParams,
  w: number,
  h: number,
  color: string,
  size: number,
) {
  ctx.clearRect(0, 0, w, h);
  const cy = Math.cos(-f.yaw), sy = Math.sin(-f.yaw);
  const cp = Math.cos(-f.pitch), sp = Math.sin(-f.pitch);
  const cr = Math.cos(f.roll), sr = Math.sin(f.roll);
  const scale = Math.min(w, h) * 0.42;
  ctx.fillStyle = color;
  for (const d of dots) {
    let [x, y, z] = place(d, f);
    // yaw (Y), pitch (X), roll (Z)
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    [x, y] = [x * cr - y * sr, x * sr + y * cr];
    const p = 3 / (3 - z * 0.8);
    const front = d.k !== "shell" ? 1 : 0.25 + 0.5 * Math.max(0, z + 0.3);
    ctx.globalAlpha = Math.min(1, front * (0.5 + 0.5 * p));
    const s = size * p;
    ctx.fillRect(w / 2 + x * scale * p - s / 2, h / 2 - y * scale * p - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
