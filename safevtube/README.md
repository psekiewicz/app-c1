# SafeVtube

A safe-by-default PNGtuber/VTuber toolkit. Mic-reactive avatar, expression hotkeys, Twitch chat triggers, and an OBS browser-source overlay — with a **fail-closed blackout**: if anything is wrong, the overlay goes black instead of showing a stale or broken frame.

No camera is ever used. Only your mic level is analysed, locally in the browser.

## Quick start

```bash
npm install
npm start        # builds the UI and serves everything on http://127.0.0.1:3939
# for development:
npm run dev      # server :3939 + Vite dev UI :5173 (OBS should still use :3939 after `npm run build`)
```

1. Open the dashboard, click **Enable mic**, upload Idle/Talking PNGs for each expression.
2. In OBS add a **Browser Source** pointing at `http://127.0.0.1:3939/overlay.html`.
3. Press **Go live**. The overlay shows your avatar. It is black before this.

## Desktop app (global hotkeys)

`cd desktop && npm install && npm start` runs the server and dashboard in an Electron window with OS-wide panic/expression hotkeys (`Ctrl/Cmd+Alt+key`). See `desktop/README.md`.

## Dot-cloud face mode (camera, with a face-leak guard)

Switch **Avatar mode** to *Dot-cloud face* in the dashboard. A **tracker** page runs MediaPipe Face Landmarker on the camera device and sends only **abstract numbers** (head angles + ~12 expression weights) — never video, never landmark coordinates. The overlay animates a **generic** dot head from those numbers, so your real face shape is never in the stream. Face not detected or tracker offline = black screen.

- **Same PC:** open `http://127.0.0.1:3939/tracker.html?token=…` (URL shown in the dashboard), click *Start camera*.
- **Second device (recommended — the camera never touches your streaming PC):**
  ```bash
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=safevtube" -keyout key.pem -out cert.pem
  SAFEVTUBE_LAN=1 SAFEVTUBE_TLS_KEY=key.pem SAFEVTUBE_TLS_CERT=cert.pem npm start
  ```
  Open the printed tracker URL on the phone/laptop (accept the self-signed certificate warning; phones only allow camera over HTTPS). On the LAN only `tracker.html` + its static files and the token-protected tracker WebSocket are reachable; the dashboard, API and overlay stay localhost-only. *Reset pairing token* in the dashboard revokes a device.
- The tracker's camera preview is off by default; it shows only the dot face.
- Model: MediaPipe `face_landmarker.task` (Apache-2.0) is bundled in `packages/web/public/models`; the WASM runtime is copied from `@mediapipe/tasks-vision` at build time. No CDN needed.

## 3D models (Blender → .glb)

Pick **3D model** mode and upload a `.glb`. In Blender: *File → Export → glTF 2.0*, format **glTF Binary (.glb)**, enable **Shape Keys** (and *Skinning* if you have bones), disable animation, +Y up, apply modifiers.

| In your rig | What drives it |
|---|---|
| Shape keys named like ARKit blendshapes (`eyeBlinkLeft`, `jawOpen`, `mouthSmileLeft`, … all 52) | Full tracker output (the "perfect sync" convention used by VRoid/VSeeFace-style models) |
| Simple keys: `Blink`, `Blink_L`, `Blink_R`, `aa`/`A`, `ou`, `Smile`, `LookUp/Down/Left/Right` | Simplified parameters |
| Bones containing `Head`, `Neck` (40 % of the rotation), `Jaw`, `LeftEye`/`RightEye` | Head pose, jaw opening and gaze (only used when there is no matching shape key) |

No head bone: the whole model tilts slightly. Use *Zoom* and *Vertical offset* to frame it. Full-body humanoids are framed head-and-shoulders automatically; head-only models are fit whole. Files are loaded from embedded data only (external URLs inside a model are blocked); a model that fails to load means a black screen.

## 2D puppet (layered PNGs)

Pick **2D layered puppet** and add transparent PNG layers that share one canvas size (export aligned layers from Krita/Photoshop/Clip Studio). Roles: `body`, `hair`, `head`, `eyesOpen`, `eyesClosed`, `brows`, `mouthClosed`, `mouthHalf`, `mouthOpen`, `mouthSmile`, `accessory`. Eyes swap on blink, mouth layers swap by jaw opening, and the head layers rotate around the pivot you set. Draw order = list order. (This is not Live2D: its runtime is proprietary and can't be bundled.)

## Safety model

The overlay shows the avatar only when **all** are true; otherwise it is black:

| Condition | Blackout when… |
|---|---|
| Armed | You haven't pressed **Go live** (resets on every page load) |
| Panic | Panic button / hotkey (default `Escape`) is latched |
| Mic healthy (PNG mode) | Track ended/muted or audio context stopped |
| Face tracked (dots / 3D / 2D modes) | Tracker offline/stale (>1 s) or no face detected |
| Dashboard fresh | No frame from the dashboard for 3 s, or its tab closes (instant) |
| Overlay fresh | Overlay hasn't heard from the server for 2.5 s, or its socket drops |

The decision lives in `packages/shared/src/safety.ts` (unit-tested) and is enforced on both server and overlay. The server binds to `127.0.0.1` only, rejects non-local `Host`/`Origin` headers (DNS-rebinding/CSRF), validates uploads by magic bytes (PNG/WebP/GIF, 5 MB), and Twitch chat is anonymous read-only.

## Layout

- `packages/shared` — types, blackout rules, talk detector (tests: `npm test`)
- `packages/server` — Express + WebSocket, settings/assets in `data/` (gitignored), Twitch IRC reader
- `packages/web` — React dashboard (`index.html`) and overlay (`overlay.html`)

## Known limits / roadmap

- In the browser, hotkeys work only while the dashboard window is focused; use the desktop app for global hotkeys.
- Keep the dashboard tab open (not minimised); an active mic keeps it from being throttled in most browsers.
- Tracker→model sign conventions (yaw/pitch/roll direction, *Mirror movement*) are untested with a real camera; flip the mirror toggle if movement is reversed.
- Ideas: blink/bounce presets, multi-layer avatars, Twitch redeems (needs OAuth), OBS WebSocket scene switching.
