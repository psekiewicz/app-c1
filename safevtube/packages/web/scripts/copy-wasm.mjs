// Copies MediaPipe's WASM runtime next to the app so the tracker works offline (no CDN).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = "node_modules/@mediapipe/tasks-vision/wasm";
const src = [join(root, pkg), join(root, "../..", pkg)].find(existsSync);
if (!src) throw new Error("MediaPipe wasm not found; run npm install");
mkdirSync(join(root, "public/mediapipe"), { recursive: true });
cpSync(src, join(root, "public/mediapipe"), { recursive: true });
