import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import {
  blackoutReason,
  ARKIT_BLENDSHAPES,
  EMPTY_FACE,
  isTrackedMode,
  type FaceParams,
  type FaceRecord,
  type ClientMessage,
  type DashboardFrame,
  type DashboardStatus,
  type FrameRecord,
  type OverlayOutput,
  type Settings,
  type TwitchStatus,
} from "@safevtube/shared";
import { ASSET_DIR, loadSettings, regenerateTrackerToken, sanitizeSettings, saveAsset, saveSettings, trackerToken } from "./store";
import crypto from "node:crypto";
import os from "node:os";
import https from "node:https";
import { isLocalRequest, isTrackerPublicPath } from "./guard";
import { TwitchChat } from "./twitch";

const PORT = Number(process.env.PORT ?? 3939);
// Loopback only: nothing about your avatar or controls is reachable from the network.
// Set SAFEVTUBE_LAN=1 to let a second device (phone/laptop with the camera) pair as a face tracker.
// Only the tracker page and its WebSocket (token-protected) are reachable from the LAN.
const LAN = process.env.SAFEVTUBE_LAN === "1";
const HOST = process.env.HOST ?? (LAN ? "0.0.0.0" : "127.0.0.1");
const TLS_KEY = process.env.SAFEVTUBE_TLS_KEY;
const TLS_CERT = process.env.SAFEVTUBE_TLS_CERT;
let token = trackerToken();

let settings: Settings = loadSettings();
let lastFrame: FrameRecord | null = null;
let lastFace: FaceRecord | null = null;
let twitchOverride: { expressionId: string; until: number } | null = null;
let lastTwitchAt = 0;
let twitchStatus: TwitchStatus = "off";

const dashboards = new Set<WebSocket>();
const overlays = new Set<WebSocket>();
const trackers = new Set<WebSocket>();

const twitch = new TwitchChat(
  (cmd, user) => {
    const now = Date.now();
    if (now - lastTwitchAt < settings.twitchCooldownMs) return;
    const expr = settings.expressions.find((e) => e.twitchCommand === cmd);
    if (!expr) return;
    lastTwitchAt = now;
    twitchOverride = { expressionId: expr.id, until: expr.durationMs ? now + expr.durationMs : Infinity };
    console.log(`[twitch] ${user} -> ${expr.name}`);
    broadcast();
  },
  (s) => {
    twitchStatus = s;
    broadcast();
  },
);
twitch.setChannel(settings.twitchChannel);

function currentExpressionId(now: number, frame: DashboardFrame | undefined): string {
  if (twitchOverride && now < twitchOverride.until) return twitchOverride.expressionId;
  twitchOverride = null;
  return frame?.expressionId ?? settings.defaultExpressionId;
}

function compute(now = Date.now()) {
  const dots = isTrackedMode(settings.mode);
  const reason = blackoutReason(lastFrame, now, dots ? { face: lastFace } : {});
  const live = reason === null;
  const output: OverlayOutput = {
    type: "output",
    // Only expose avatar state while live; otherwise ship a neutral payload.
    live,
    talking: live && !!lastFrame?.frame.talking,
    expressionId: live ? currentExpressionId(now, lastFrame?.frame) : settings.defaultExpressionId,
    face: live && dots ? lastFace!.params : null,
    settings,
  };
  const status: DashboardStatus = { type: "status", live, overlays: overlays.size, tracker: trackers.size > 0, twitch: twitchStatus, reason: reason ?? "Live" };
  return { output, status };
}

const clamp = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const BLEND_NAMES = new Set<string>(ARKIT_BLENDSHAPES);
function cleanBlend(b: unknown): Record<string, number> | undefined {
  if (!b || typeof b !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) if (BLEND_NAMES.has(k)) out[k] = clamp(v, 0, 1);
  return out;
}
function cleanFace(p: Partial<FaceParams> | undefined): FaceParams {
  if (!p || p.faceFound !== true) return EMPTY_FACE;
  const a = Math.PI;
  return {
    faceFound: true,
    yaw: clamp(p.yaw, -a, a), pitch: clamp(p.pitch, -a, a), roll: clamp(p.roll, -a, a),
    jawOpen: clamp(p.jawOpen, 0, 1), blinkL: clamp(p.blinkL, 0, 1), blinkR: clamp(p.blinkR, 0, 1),
    smile: clamp(p.smile, 0, 1), browUp: clamp(p.browUp, 0, 1), browDown: clamp(p.browDown, 0, 1),
    pucker: clamp(p.pucker, 0, 1), lookX: clamp(p.lookX, -1, 1), lookY: clamp(p.lookY, -1, 1),
    blend: cleanBlend(p.blend),
  };
}

const send = (ws: WebSocket, msg: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

function broadcast() {
  const { output, status } = compute();
  overlays.forEach((ws) => send(ws, output));
  dashboards.forEach((ws) => send(ws, status));
}

// Heartbeat: also re-evaluates staleness, so a vanished dashboard blacks the overlay within seconds.
setInterval(broadcast, 1000);

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const trackerPage = LAN && isTrackerPublicPath(req.path) && req.method === "GET";
  if (!trackerPage && !isLocalRequest(req)) return void res.status(403).send("Forbidden");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});

function pairingUrls(): string[] {
  const scheme = TLS_KEY && TLS_CERT ? "https" : "http";
  const hosts = ["127.0.0.1"];
  if (LAN) for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) hosts.push(a.address);
  return hosts.map((h) => `${scheme}://${h}:${PORT}/tracker.html?token=${token}`);
}
app.get("/api/pairing", (_req, res) => res.json({ lan: LAN, secure: !!(TLS_KEY && TLS_CERT), urls: pairingUrls() }));
app.post("/api/pairing/reset", (_req, res) => {
  token = regenerateTrackerToken();
  trackers.forEach((ws) => ws.close());
  res.json({ lan: LAN, secure: !!(TLS_KEY && TLS_CERT), urls: pairingUrls() });
});

// Used by the desktop app's global hotkeys. Only safe actions: panic (black out) and switching expression.
app.post("/api/control", express.json({ limit: "1kb" }), (req, res) => {
  const { action, id } = req.body ?? {};
  if (action === "panic") dashboards.forEach((ws) => send(ws, { type: "control", action: "panic" }));
  else if (action === "expression" && typeof id === "string" && settings.expressions.some((e) => e.id === id))
    dashboards.forEach((ws) => send(ws, { type: "control", action: "expression", id }));
  else return void res.status(400).json({ error: "Unknown action" });
  res.json({ ok: true });
});

app.get("/api/settings", (_req, res) => res.json(settings));
app.put("/api/settings", express.json({ limit: "256kb" }), (req, res) => {
  settings = sanitizeSettings(req.body);
  saveSettings(settings);
  twitch.setChannel(settings.twitchChannel);
  dashboards.forEach((ws) => send(ws, { type: "settings", settings }));
  broadcast();
  res.json(settings);
});

app.post("/api/assets", express.raw({ type: () => true, limit: "50mb" }), (req, res) => {
  const name = Buffer.isBuffer(req.body) ? saveAsset(req.body) : null;
  if (!name) return void res.status(400).json({ error: "Only PNG/WebP/GIF images (up to 5 MB) or GLB models (up to 50 MB)" });
  res.json({ asset: name });
});
app.use("/media", express.static(ASSET_DIR, { index: false, dotfiles: "deny" }));

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (fs.existsSync(webDist)) app.use(express.static(webDist));
else app.get("/", (_req, res) => res.send("Web UI not built. Run `npm run build` (or `npm run dev` and open the Vite URL)."));

const server = TLS_KEY && TLS_CERT
  ? https.createServer({ key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) }, app)
  : http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://x");
  if (url.pathname !== "/ws") return socket.destroy();
  const wantsTracker = url.searchParams.get("role") === "tracker";
  if (wantsTracker) {
    const given = Buffer.from(url.searchParams.get("token") ?? "");
    const want = Buffer.from(token);
    const ok = LAN || isLocalRequest(req);
    if (!ok || given.length !== want.length || !crypto.timingSafeEqual(given, want)) return socket.destroy();
  } else if (!isLocalRequest(req)) {
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    (ws as any).trackerAuthed = wantsTracker;
    wss.emit("connection", ws);
  });
});

wss.on("connection", (ws: WebSocket) => {
  let role: "dashboard" | "overlay" | "tracker" | null = null;
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "hello" && !role) {
      const authed = (ws as any).trackerAuthed === true;
      // Role must match how the socket authenticated: a tracker socket can't act as dashboard and vice versa.
      if (authed !== (msg.role === "tracker")) return ws.close();
      role = msg.role === "dashboard" ? "dashboard" : msg.role === "tracker" ? "tracker" : "overlay";
      (role === "dashboard" ? dashboards : role === "tracker" ? trackers : overlays).add(ws);
      if (role === "dashboard") send(ws, { type: "settings", settings });
      broadcast();
    } else if (msg.type === "track" && role === "tracker") {
      lastFace = { receivedAt: Date.now(), params: cleanFace(msg.params) };
      broadcast();
    } else if (msg.type === "frame" && role === "dashboard") {
      lastFrame = {
        receivedAt: Date.now(),
        frame: {
          type: "frame",
          armed: msg.armed === true,
          micOk: msg.micOk === true,
          panic: msg.panic === true,
          talking: msg.talking === true,
          expressionId: typeof msg.expressionId === "string" ? msg.expressionId.slice(0, 40) : settings.defaultExpressionId,
        },
      };
      broadcast();
    }
  });
  ws.on("close", () => {
    dashboards.delete(ws);
    overlays.delete(ws);
    if (trackers.delete(ws) && trackers.size === 0) lastFace = null; // instant blackout
    if (role === "dashboard" && dashboards.size === 0) lastFrame = null; // instant blackout
    broadcast();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SafeVtube running${LAN ? " (LAN tracker pairing ON)" : ""}`);
  if (LAN) console.log(`  Tracker (open on the camera device): ${pairingUrls().slice(1).join("  ")}`);
  console.log(`  Dashboard: http://127.0.0.1:${PORT}/`);
  console.log(`  OBS overlay (Browser Source): http://127.0.0.1:${PORT}/overlay.html`);
});
