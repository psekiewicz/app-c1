import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BINDING_PROPS, DEFAULT_PHYSICS, DEFAULT_SETTINGS, PUPPET_PARAMS, type BindingProp, type Condition, type Expression, type PuppetBinding, type PuppetLayer, type PuppetParam, type PhysicsParams, type PuppetState, type Settings } from "@safevtube/shared";

export const DATA_DIR = path.resolve(process.env.SAFEVTUBE_DATA ?? "data");
export const ASSET_DIR = path.join(DATA_DIR, "assets");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
fs.mkdirSync(ASSET_DIR, { recursive: true });

const num = (v: unknown, min: number, max: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const str = (v: unknown, max: number, d = "") => (typeof v === "string" ? v.slice(0, max) : d);

/** Never trust persisted or client-supplied settings; rebuild from known fields. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const exprs = Array.isArray(r.expressions) ? r.expressions.slice(0, 50) : [];
  const expressions = exprs
    .map((e: any): Expression => ({
      id: str(e?.id, 40).replace(/[^\w-]/g, ""),
      name: str(e?.name, 40, "Expression"),
      idleAsset: assetName(e?.idleAsset, IMG_RE),
      talkAsset: assetName(e?.talkAsset, IMG_RE),
      hotkey: str(e?.hotkey, 20) || undefined,
      twitchCommand: str(e?.twitchCommand, 30).toLowerCase().replace(/[^a-z0-9_]/g, "") || undefined,
      durationMs: num(e?.durationMs, 0, 600_000, 0),
    }))
    .filter((e) => e.id);
  if (!expressions.length) expressions.push(...DEFAULT_SETTINGS.expressions);
  const def = str(r.defaultExpressionId, 40);
  return {
    mode: r.mode === "dots" || r.mode === "model3d" || r.mode === "puppet2d" ? r.mode : "png",
    model3dAsset: assetName(r.model3dAsset, GLB_RE),
    modelZoom: num(r.modelZoom, 0.2, 5, DEFAULT_SETTINGS.modelZoom),
    modelY: num(r.modelY, -3, 3, DEFAULT_SETTINGS.modelY),
    modelMirror: r.modelMirror !== false,
    puppet: (Array.isArray(r.puppet) ? r.puppet.slice(0, 60) : []).map(sanitizeLayer).filter((l): l is PuppetLayer => !!l),
    puppetPivotX: num(r.puppetPivotX, 0, 1, DEFAULT_SETTINGS.puppetPivotX),
    puppetPivotY: num(r.puppetPivotY, 0, 1, DEFAULT_SETTINGS.puppetPivotY),
    dotCount: Math.round(num(r.dotCount, 500, 8000, DEFAULT_SETTINGS.dotCount)),
    dotSize: num(r.dotSize, 0.5, 8, DEFAULT_SETTINGS.dotSize),
    dotColor: typeof r.dotColor === "string" && /^#[0-9a-fA-F]{6}$/.test(r.dotColor) ? r.dotColor : DEFAULT_SETTINGS.dotColor,
    expressions,
    defaultExpressionId: expressions.some((e) => e.id === def) ? def : expressions[0]!.id,
    talkThreshold: num(r.talkThreshold, 0.001, 1, DEFAULT_SETTINGS.talkThreshold),
    releaseMs: num(r.releaseMs, 0, 5000, DEFAULT_SETTINGS.releaseMs),
    panicHotkey: str(r.panicHotkey, 20, DEFAULT_SETTINGS.panicHotkey) || DEFAULT_SETTINGS.panicHotkey,
    twitchChannel: str(r.twitchChannel, 25).toLowerCase().replace(/[^a-z0-9_]/g, ""),
    twitchCooldownMs: num(r.twitchCooldownMs, 0, 600_000, DEFAULT_SETTINGS.twitchCooldownMs),
  };
}

const arr = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);
const safeId = (v: unknown) => str(v, 40).replace(/[^\w-]/g, "");

function sanitizeConditions(v: unknown): Condition[] {
  return arr(v, 6)
    .filter((c) => (PUPPET_PARAMS as readonly string[]).includes(c?.param) && (c?.op === ">" || c?.op === "<"))
    .map((c) => ({ param: c.param as PuppetParam, op: c.op as ">" | "<", value: num(c.value, -1000, 1000, 0) }));
}

function sanitizePhysics(p: any): PhysicsParams {
  const d = DEFAULT_PHYSICS;
  return {
    direction: ["down", "up", "left", "right"].includes(p?.direction) ? p.direction : d.direction,
    segments: Math.round(num(p?.segments, 1, 12, d.segments)),
    stiffness: num(p?.stiffness, 0.2, 15, d.stiffness),
    damping: num(p?.damping, 0.02, 1.5, d.damping),
    inertia: num(p?.inertia, 0, 4, d.inertia),
    gravity: num(p?.gravity, 0, 1, d.gravity),
    maxAngle: num(p?.maxAngle, 1, 120, d.maxAngle),
    sway: num(p?.sway, 0, 15, d.sway),
    taper: num(p?.taper, 0.5, 1.3, d.taper),
  };
}

function sanitizeLayer(l: any): PuppetLayer | null {
  const id = safeId(l?.id);
  if (!id) return null;
  const area = l?.pupil?.area;
  return {
    id,
    name: str(l?.name, 60, "Layer"),
    asset: assetName(l?.asset, IMG_RE),
    states: arr(l?.states, 16).map((s): PuppetState => ({ id: safeId(s?.id) || "s", asset: assetName(s?.asset, IMG_RE), when: sanitizeConditions(s?.when) })),
    bindings: arr(l?.bindings, 10)
      .filter((b) => (PUPPET_PARAMS as readonly string[]).includes(b?.param) && (BINDING_PROPS as readonly string[]).includes(b?.prop))
      .map((b): PuppetBinding => ({
        param: b.param as PuppetParam, prop: b.prop as BindingProp,
        inMin: num(b.inMin, -1000, 1000, 0), inMax: num(b.inMax, -1000, 1000, 1),
        outMin: num(b.outMin, -5000, 5000, 0), outMax: num(b.outMax, -5000, 5000, 0),
      })),
    visibleWhen: sanitizeConditions(l?.visibleWhen),
    physics: l?.physics ? sanitizePhysics(l.physics) : undefined,
    follow: l?.follow === "head" ? "head" : "none",
    depth: num(l?.depth, 0, 0.3, 0.03),
    pivotX: typeof l?.pivotX === "number" ? num(l.pivotX, 0, 1, 0.5) : undefined,
    pivotY: typeof l?.pivotY === "number" ? num(l.pivotY, 0, 1, 0.5) : undefined,
    pupil: area
      ? {
          area: { x: num(area.x, -10000, 10000, 0), y: num(area.y, -10000, 10000, 0), w: num(area.w, 1, 10000, 40), h: num(area.h, 1, 10000, 40) },
          clip: l.pupil.clip !== false,
          scale: num(l.pupil.scale, 0.1, 5, 1),
        }
      : undefined,
  };
}

const IMG_RE = /^[0-9a-f-]{36}\.(png|webp|gif)$/;
const GLB_RE = /^[0-9a-f-]{36}\.glb$/;
function assetName(v: unknown, re: RegExp = IMG_RE): string | undefined {
  return typeof v === "string" && re.test(v) ? v : undefined;
}

export function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")));
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

/** Detect type from magic bytes; the Content-Type header is not trusted. */
export function sniffImage(b: Buffer): "png" | "webp" | "gif" | "glb" | null {
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "glTF" && b.readUInt32LE(4) === 2) return "glb";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  return null;
}

const MAX_IMAGE = 5 * 1024 * 1024;
export function saveAsset(buf: Buffer): string | null {
  const ext = sniffImage(buf);
  if (!ext || (ext !== "glb" && buf.length > MAX_IMAGE)) return null;
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(ASSET_DIR, name), buf);
  return name;
}

const TOKEN_FILE = path.join(DATA_DIR, "tracker-token");
/** Pairing secret for a remote tracker device. Persisted so pairing survives restarts. */
export function trackerToken(): string {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (/^[0-9a-f]{32}$/.test(t)) return t;
  } catch {}
  const t = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}

export function regenerateTrackerToken(): string {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  return trackerToken();
}
