import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_SETTINGS, type Expression, type Settings } from "@safevtube/shared";

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
      idleAsset: assetName(e?.idleAsset),
      talkAsset: assetName(e?.talkAsset),
      hotkey: str(e?.hotkey, 20) || undefined,
      twitchCommand: str(e?.twitchCommand, 30).toLowerCase().replace(/[^a-z0-9_]/g, "") || undefined,
      durationMs: num(e?.durationMs, 0, 600_000, 0),
    }))
    .filter((e) => e.id);
  if (!expressions.length) expressions.push(...DEFAULT_SETTINGS.expressions);
  const def = str(r.defaultExpressionId, 40);
  return {
    expressions,
    defaultExpressionId: expressions.some((e) => e.id === def) ? def : expressions[0]!.id,
    talkThreshold: num(r.talkThreshold, 0.001, 1, DEFAULT_SETTINGS.talkThreshold),
    releaseMs: num(r.releaseMs, 0, 5000, DEFAULT_SETTINGS.releaseMs),
    panicHotkey: str(r.panicHotkey, 20, DEFAULT_SETTINGS.panicHotkey) || DEFAULT_SETTINGS.panicHotkey,
    twitchChannel: str(r.twitchChannel, 25).toLowerCase().replace(/[^a-z0-9_]/g, ""),
    twitchCooldownMs: num(r.twitchCooldownMs, 0, 600_000, DEFAULT_SETTINGS.twitchCooldownMs),
  };
}

const ASSET_RE = /^[0-9a-f-]{36}\.(png|webp|gif)$/;
function assetName(v: unknown): string | undefined {
  return typeof v === "string" && ASSET_RE.test(v) ? v : undefined;
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
export function sniffImage(b: Buffer): "png" | "webp" | "gif" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "webp";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "gif";
  return null;
}

export function saveAsset(buf: Buffer): string | null {
  const ext = sniffImage(buf);
  if (!ext) return null;
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(ASSET_DIR, name), buf);
  return name;
}
