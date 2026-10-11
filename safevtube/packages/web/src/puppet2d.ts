import { AnchorTracker, ChainSim, bindingValue, pickAsset, pupilPosition, type ChainDirection, type FaceParams, type PuppetLayer } from "@safevtube/shared";

/**
 * Renderer for the 2D puppet rig (see shared/puppet.ts for the rules).
 * Layers are plain transparent PNGs of identical canvas size, except pupils, which can be any size.
 */
export interface LoadedPuppet {
  images: Map<string, HTMLImageElement>;
  w: number;
  h: number;
  /** Mutable per-puppet runtime: physics state and cached opaque bounds. */
  rt: { sims: Map<string, { sim: ChainSim; tracker: AnchorTracker }>; bounds: Map<string, Bounds>; lastT: number };
}
interface Bounds { x0: number; y0: number; x1: number; y1: number }
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
    return { images, w: r.naturalWidth, h: r.naturalHeight, rt: { sims: new Map(), bounds: new Map(), lastT: 0 } };
  } catch {
    return null; // any image missing => nothing drawn => black
  }
}

/** Opaque bounding box of an image (cached): default anchor and length for physics layers. */
function boundsOf(p: LoadedPuppet, asset: string, img: HTMLImageElement): Bounds {
  let b = p.rt.bounds.get(asset);
  if (b) return b;
  const w = img.naturalWidth, h = img.naturalHeight;
  b = { x0: 0, y0: 0, x1: w, y1: h };
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]! > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= x0 && y1 >= y0) b = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  } catch { /* keep full-image bounds */ }
  p.rt.bounds.set(asset, b);
  return b;
}

const DIR: Record<ChainDirection, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 1000) / 159; };
const rot = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/**
 * Draws `img` as a chain of bendable bands hanging from the anchor (hair, ribbons, ears…).
 * Everything before the anchor stays rigid; each band is rotated by its simulated cumulative angle about its start point.
 */
function drawChain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dir: ChainDirection, anchor: [number, number], end: number, angles: number[]) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const [ax, ay] = anchor;
  const [dx, dy] = DIR[dir];
  // Rigid part: everything behind the anchor.
  if (dir === "down" && ay > 0) ctx.drawImage(img, 0, 0, W, ay, 0, 0, W, ay);
  else if (dir === "up" && ay < H) ctx.drawImage(img, 0, ay, W, H - ay, 0, ay, W, H - ay);
  else if (dir === "right" && ax > 0) ctx.drawImage(img, 0, 0, ax, H, 0, 0, ax, H);
  else if (dir === "left" && ax < W) ctx.drawImage(img, ax, 0, W - ax, H, ax, 0, W - ax, H);
  const n = angles.length;
  const len = Math.abs(dx ? end - ax : end - ay);
  const seg = len / n;
  let px = ax, py = ay; // deformed start of the current band
  for (let i = 0; i < n; i++) {
    const s = i * seg, l = seg + (i < n - 1 ? 1.5 : 0); // slight overlap hides seams
    let sx = 0, sy = 0, sw = W, sh = H;
    if (dir === "down") { sy = ay + s; sh = l; }
    else if (dir === "up") { sy = ay - s - l; sh = l; }
    else if (dir === "right") { sx = ax + s; sw = l; }
    else { sx = ax - s - l; sw = l; }
    const rx = ax + dx * s, ry = ay + dy * s; // rest start of this band
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angles[i]!);
    ctx.translate(-rx, -ry);
    ctx.drawImage(img, Math.max(0, sx), Math.max(0, sy), Math.min(W - Math.max(0, sx), sw), Math.min(H - Math.max(0, sy), sh), Math.max(0, sx), Math.max(0, sy), Math.min(W - Math.max(0, sx), sw), Math.min(H - Math.max(0, sy), sh));
    ctx.restore();
    const [vx, vy] = rot(dx * seg, dy * seg, angles[i]!);
    px += vx; py += vy;
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
  const rt = p.rt;
  const dt = rt.lastT ? t - rt.lastT : 0;
  rt.lastT = t;
  if (dt > 0.25 || dt < 0) for (const e of rt.sims.values()) { e.sim.reset(); e.tracker.reset(); } // face was lost: don't inject a spike
  for (const layer of layers) {
    const asset = pickAsset(layer, f, view.mirror);
    const img = asset ? p.images.get(asset) : undefined;
    if (!img) continue;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    const follow = layer.follow === "head";
    const hdx = follow ? -f.yaw * m * layer.depth * p.w * 2.5 : 0;
    const hdy = follow ? -f.pitch * layer.depth * p.h * 2.5 + breathe * 0.002 * p.h : 0;
    const hpx = view.pivotX * p.w, hpy = view.pivotY * p.h;
    if (follow) {
      ctx.translate(hdx + hpx, hdy + hpy);
      ctx.rotate(f.roll * m);
      ctx.translate(-hpx, -hpy);
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
    } else if (layer.physics && asset) {
      const ph = layer.physics;
      const b = boundsOf(p, asset, img);
      const [dxv, dyv] = DIR[ph.direction];
      const defAnchor: [number, number] =
        ph.direction === "down" ? [(b.x0 + b.x1) / 2, b.y0] : ph.direction === "up" ? [(b.x0 + b.x1) / 2, b.y1]
        : ph.direction === "right" ? [b.x0, (b.y0 + b.y1) / 2] : [b.x1, (b.y0 + b.y1) / 2];
      const anchor: [number, number] = [layer.pivotX !== undefined ? layer.pivotX * p.w : defAnchor[0], layer.pivotY !== undefined ? layer.pivotY * p.h : defAnchor[1]];
      const end = ph.direction === "down" ? b.y1 : ph.direction === "up" ? b.y0 : ph.direction === "right" ? b.x1 : b.x0;
      const length = Math.abs(dxv ? end - anchor[0] : end - anchor[1]);
      let entry = rt.sims.get(layer.id);
      if (!entry) rt.sims.set(layer.id, (entry = { sim: new ChainSim(ph), tracker: new AnchorTracker() }));
      entry.sim.params = ph;
      if (length > 2) {
        // Anchor position on the (virtual) screen after the head transform: its real acceleration drives the inertia.
        const roll = f.roll * m;
        const [rx, ry] = rot(anchor[0] - hpx, anchor[1] - hpy, follow ? roll : 0);
        const a = entry.tracker.update(hpx + hdx + rx, hpy + hdy + ry, dt);
        const [vx, vy] = rot(dxv, dyv, follow ? roll : 0);
        const drive = (ph.inertia * (a.ax * -vy + a.ay * vx)) / length;
        entry.sim.step(dt, drive, follow ? roll : 0, t, hash(layer.id));
        drawChain(ctx, img, ph.direction, anchor, end, entry.sim.angle);
      } else ctx.drawImage(img, 0, 0);
    } else {
      ctx.drawImage(img, 0, 0);
    }
    ctx.restore();
  }
}
