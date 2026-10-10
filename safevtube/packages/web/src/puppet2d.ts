import type { FaceParams, PuppetPart, PuppetRole } from "@safevtube/shared";

/**
 * 2D layered puppet: transparent PNG layers of identical canvas size (as exported from Krita/Photoshop/Clip Studio),
 * switched and nudged by the face parameters. Not Live2D (its runtime is proprietary), but the same idea in miniature.
 */
export interface LoadedPuppet {
  layers: { role: PuppetRole; img: HTMLImageElement }[];
  w: number;
  h: number;
}
export interface PuppetView { pivotX: number; pivotY: number; mirror: boolean }

export async function loadPuppet(parts: PuppetPart[]): Promise<LoadedPuppet | null> {
  const withAsset = parts.filter((p) => p.asset);
  if (!withAsset.length) return null;
  try {
    const layers = await Promise.all(
      withAsset.map(
        (p) =>
          new Promise<{ role: PuppetRole; img: HTMLImageElement }>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ role: p.role, img });
            img.onerror = () => reject(new Error("image failed"));
            img.src = `/media/${p.asset}`;
          }),
      ),
    );
    return { layers, w: layers[0]!.img.naturalWidth, h: layers[0]!.img.naturalHeight };
  } catch {
    return null; // any layer missing => no puppet => black
  }
}

const DEPTH: Partial<Record<PuppetRole, number>> = {
  body: 0, hair: 0.022, head: 0.03, eyesOpen: 0.045, eyesClosed: 0.045, brows: 0.05,
  mouthClosed: 0.04, mouthHalf: 0.04, mouthOpen: 0.04, mouthSmile: 0.04, accessory: 0.03,
};

function activeMouth(p: LoadedPuppet, f: FaceParams): PuppetRole | null {
  const has = (r: PuppetRole) => p.layers.some((l) => l.role === r);
  const order: PuppetRole[] =
    f.jawOpen < 0.15 ? (f.smile > 0.45 ? ["mouthSmile", "mouthClosed"] : ["mouthClosed", "mouthSmile"])
    : f.jawOpen < 0.45 ? ["mouthHalf", "mouthOpen", "mouthClosed"]
    : ["mouthOpen", "mouthHalf", "mouthClosed"];
  return order.find(has) ?? null;
}

export function drawPuppet(ctx: CanvasRenderingContext2D, p: LoadedPuppet, f: FaceParams, view: PuppetView, cw: number, ch: number, t: number) {
  ctx.clearRect(0, 0, cw, ch);
  const s = Math.min(cw / p.w, ch / p.h);
  const m = view.mirror ? 1 : -1;
  const blink = (f.blinkL + f.blinkR) / 2 > 0.55;
  const hasClosedEyes = p.layers.some((l) => l.role === "eyesClosed");
  const mouth = activeMouth(p, f);
  const breathe = Math.sin(t * 1.6);
  for (const { role, img } of p.layers) {
    if (role === "eyesOpen" && blink && hasClosedEyes) continue;
    if (role === "eyesClosed" && !(blink || false)) continue;
    if (role.startsWith("mouth") && role !== mouth) continue;
    const depth = DEPTH[role] ?? 0.03;
    const isEye = role === "eyesOpen" || role === "eyesClosed";
    let dx = -f.yaw * m * depth * p.w * 2.5 + (isEye ? f.lookX * m * 0.012 * p.w : 0);
    let dy = -f.pitch * depth * p.h * 2.5 + (isEye ? -f.lookY * 0.01 * p.h : 0);
    if (role === "brows") dy -= (f.browUp - f.browDown) * 0.012 * p.h;
    dy += breathe * (role === "body" ? 0.004 : 0.002) * p.h;
    const rot = role === "body" ? f.roll * m * 0.05 : f.roll * m;
    const px = view.pivotX * p.w, py = view.pivotY * p.h;
    ctx.save();
    ctx.translate((cw - p.w * s) / 2, (ch - p.h * s) / 2);
    ctx.scale(s, s);
    ctx.translate(dx + px, dy + py);
    ctx.rotate(rot);
    ctx.translate(-px, -py);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}
