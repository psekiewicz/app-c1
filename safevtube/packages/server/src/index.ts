import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import {
  blackoutReason,
  type ClientMessage,
  type DashboardFrame,
  type DashboardStatus,
  type FrameRecord,
  type OverlayOutput,
  type Settings,
  type TwitchStatus,
} from "@safevtube/shared";
import { ASSET_DIR, loadSettings, sanitizeSettings, saveAsset, saveSettings } from "./store";
import { isLocalRequest } from "./guard";
import { TwitchChat } from "./twitch";

const PORT = Number(process.env.PORT ?? 3939);
// Loopback only: nothing about your avatar or controls is reachable from the network.
const HOST = process.env.HOST ?? "127.0.0.1";

let settings: Settings = loadSettings();
let lastFrame: FrameRecord | null = null;
let twitchOverride: { expressionId: string; until: number } | null = null;
let lastTwitchAt = 0;
let twitchStatus: TwitchStatus = "off";

const dashboards = new Set<WebSocket>();
const overlays = new Set<WebSocket>();

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
  const reason = blackoutReason(lastFrame, now);
  const live = reason === null;
  const output: OverlayOutput = {
    type: "output",
    // Only expose avatar state while live; otherwise ship a neutral payload.
    live,
    talking: live && !!lastFrame?.frame.talking,
    expressionId: live ? currentExpressionId(now, lastFrame?.frame) : settings.defaultExpressionId,
    settings,
  };
  const status: DashboardStatus = { type: "status", live, overlays: overlays.size, twitch: twitchStatus, reason: reason ?? "Live" };
  return { output, status };
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
  if (!isLocalRequest(req)) return void res.status(403).send("Forbidden");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
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

app.post("/api/assets", express.raw({ type: () => true, limit: "5mb" }), (req, res) => {
  const name = Buffer.isBuffer(req.body) ? saveAsset(req.body) : null;
  if (!name) return void res.status(400).json({ error: "Only PNG, WebP or GIF images up to 5 MB" });
  res.json({ asset: name });
});
app.use("/media", express.static(ASSET_DIR, { index: false, dotfiles: "deny" }));

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (fs.existsSync(webDist)) app.use(express.static(webDist));
else app.get("/", (_req, res) => res.send("Web UI not built. Run `npm run build` (or `npm run dev` and open the Vite URL)."));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws" || !isLocalRequest(req)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws: WebSocket) => {
  let role: "dashboard" | "overlay" | null = null;
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "hello" && !role) {
      role = msg.role === "dashboard" ? "dashboard" : "overlay";
      (role === "dashboard" ? dashboards : overlays).add(ws);
      if (role === "dashboard") send(ws, { type: "settings", settings });
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
    if (role === "dashboard" && dashboards.size === 0) lastFrame = null; // instant blackout
    broadcast();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SafeVtube running`);
  console.log(`  Dashboard: http://${HOST}:${PORT}/`);
  console.log(`  OBS overlay (Browser Source): http://${HOST}:${PORT}/overlay.html`);
});
