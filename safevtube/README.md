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

## Safety model

The overlay shows the avatar only when **all** are true; otherwise it is black:

| Condition | Blackout when… |
|---|---|
| Armed | You haven't pressed **Go live** (resets on every page load) |
| Panic | Panic button / hotkey (default `Escape`) is latched |
| Mic healthy | Track ended/muted or audio context stopped |
| Dashboard fresh | No frame from the dashboard for 3 s, or its tab closes (instant) |
| Overlay fresh | Overlay hasn't heard from the server for 2.5 s, or its socket drops |

The decision lives in `packages/shared/src/safety.ts` (unit-tested) and is enforced on both server and overlay. The server binds to `127.0.0.1` only, rejects non-local `Host`/`Origin` headers (DNS-rebinding/CSRF), validates uploads by magic bytes (PNG/WebP/GIF, 5 MB), and Twitch chat is anonymous read-only.

## Layout

- `packages/shared` — types, blackout rules, talk detector (tests: `npm test`)
- `packages/server` — Express + WebSocket, settings/assets in `data/` (gitignored), Twitch IRC reader
- `packages/web` — React dashboard (`index.html`) and overlay (`overlay.html`)

## Known limits / roadmap

- Hotkeys work only while the dashboard window is focused (browser limitation). An Electron/Tauri wrapper would add global hotkeys.
- Keep the dashboard tab open (not minimised); an active mic keeps it from being throttled in most browsers.
- Ideas: blink/bounce presets, multi-layer avatars, Twitch redeems (needs OAuth), OBS WebSocket scene switching.
