import { allHold, bindingValue, pickAsset, pupilPosition, type FaceParams, type PuppetLayer } from "@safevtube/shared";

/**
 * Renderer for the 2D puppet rig (see shared/puppet.ts for the rules).
 * Layers are plain transparent PNGs of identical canvas size, except pupils, which can be any size.
 */
export interface LoadedPuppet {
  images: Map<string, HTMLImageElement>;
  w: number;
  h: number;
}
export interface PuppetView { pivotX: number; pivotY: number; mirror: boolean }

const assetsOf = (layers: PuppetLayer[]): string[] => [
  ...new Set(layers.flatMap((l) => [l.asset, ...l.states.map((s) => s.asset)]).filter((a): a is string => !!a)),
];

export async function loadPuppet(layers: PuppetLayer[]): Promise<LoadedPuppet | null> {
  const names = assetsOf(layers);
  if (!names.length) return null;
  try {
    const entries = await Promise.all(
      names.map(
        (n) =>
          new Promise<[string, HTMLImageElement]>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve([n, img]);
            img.onerror = () => reject(new Error("image failed"));
            img.src = `/media/${n}`;
          }),
      ),
    );
    const images = new Map(entries);
    // Canvas size = first non-pupil layer image (all full-size layers share it).
    const ref = layers.filter((l) => !l.pupil).flatMap((l) => [l.asset, ...l.states.map((s) => s.asset)]).find((a) => a && images.get(a)) ?? names[0]!;
    const r = images.get(ref)!;
    return { images, w: r.naturalWidth, h: r.naturalHeight };
  } catch {
    return null; // any image missing => nothing drawn => black
  }
}

export function layoutOf(p: { w: number; h: number }, cw: number, ch: number) {
  const s = Math.min(cw / p.w, ch / p.h);
  return { s, ox: (cw - p.w * s) / 2, oy: (ch - p.h * s) / 2 };
}

export function drawPuppet(ctx: CanvasRenderingContext2D, p: LoadedPuppet, layers: PuppetLayer[], f: FaceParams, view: PuppetView, cw: number, ch: number, t: number) {
  ctx.clearRect(0, 0, cw, ch);
  const { s, ox, oy } = layoutOf(p, cw, ch);
  const m = view.mirror ? 1 : -1;
  const breathe = Math.sin(t * 1.6);
  for (const layer of layers) {
    const asset = pickAsset(layer, f, view.mirror);
    const img = asset ? p.images.get(asset) : undefined;
    if (!img) continue;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    if (layer.follow === "head") {
      const dx = -f.yaw * m * layer.depth * p.w * 2.5;
      const dy = -f.pitch * layer.depth * p.h * 2.5 + breathe * 0.002 * p.h;
      const px = view.pivotX * p.w, py = view.pivotY * p.h;
      ctx.translate(dx + px, dy + py);
      ctx.rotate(f.roll * m);
      ctx.translate(-px, -py);
    }
    let bx = 0, by = 0, brot = 0, bscale = 1, bop = 1;
    for (const b of layer.bindings) {
      const v = bindingValue(b, f, view.mirror);
      if (b.prop === "x") bx += v; else if (b.prop === "y") by += v;
      else if (b.prop === "rotate") brot += v; else if (b.prop === "scale") bscale *= v; else bop *= v;
    }
    const lx = (layer.pivotX ?? view.pivotX) * p.w, ly = (layer.pivotY ?? view.pivotY) * p.h;
    ctx.translate(bx, by);
    if (brot || bscale !== 1) {
      ctx.translate(lx, ly);
      ctx.rotate((brot * Math.PI) / 180);
      ctx.scale(bscale, bscale);
      ctx.translate(-lx, -ly);
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, bop));
    if (layer.pupil) {
      const { area, clip, scale } = layer.pupil;
      if (clip) {
        ctx.beginPath();
        ctx.ellipse(area.x + area.w / 2, area.y + area.h / 2, area.w / 2, area.h / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      const lookX = Math.max(-1, Math.min(1, f.lookX * m));
      const c = pupilPosition(area, lookX, f.lookY);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h);
    } else {
      ctx.drawImage(img, 0, 0);
    }
    ctx.restore();
  }
}
