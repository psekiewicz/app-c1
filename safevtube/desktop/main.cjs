// SafeVtube desktop shell. Starts the local server, opens the dashboard in a window,
// and registers OS-wide hotkeys that work even while a game/OBS has focus.
//
// Global hotkeys use the modifier below + the key set in the dashboard:
//   panic            -> Ctrl/Cmd+Alt+<panic key>        (black screen instantly)
//   expression keys  -> Ctrl/Cmd+Alt+<expression key>
// Global hotkeys can only black out or change expression; they can never go live.
const { app, BrowserWindow, globalShortcut, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = process.env.PORT || "3939";
const BASE = `http://127.0.0.1:${PORT}`;
const MOD = process.env.SAFEVTUBE_GLOBAL_MOD || "CommandOrControl+Alt";
const root = path.resolve(__dirname, "..");

let server = null;
let win = null;

function startServer() {
  // Run the TypeScript server with Electron's own Node runtime.
  server = spawn(process.execPath, ["--import", "tsx", path.join(root, "packages/server/src/index.ts")], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT, SAFEVTUBE_DATA: process.env.SAFEVTUBE_DATA || path.join(app.getPath("userData"), "data") },
    stdio: "inherit",
  });
  server.on("exit", (code) => {
    if (!app.isQuitting) console.error(`[desktop] server exited (${code})`);
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/settings`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not start");
}

const post = (body) =>
  fetch(`${BASE}/api/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});

/** KeyboardEvent.key -> Electron accelerator key. Returns null if unsupported. */
function toAccelKey(key) {
  if (!key) return null;
  if (key.length === 1) return key.toUpperCase();
  const map = { Escape: "Escape", " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Return", Backspace: "Backspace", Tab: "Tab" };
  if (map[key]) return map[key];
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? key : null;
}

let registered = "";
async function syncHotkeys() {
  let s;
  try { s = await (await fetch(`${BASE}/api/settings`)).json(); } catch { return; }
  const bindings = [{ key: s.panicHotkey, run: () => post({ action: "panic" }) }];
  for (const e of s.expressions) if (e.hotkey) bindings.push({ key: e.hotkey, run: () => post({ action: "expression", id: e.id }) });
  const sig = JSON.stringify(bindings.map((b) => b.key)) + JSON.stringify(s.expressions.map((e) => e.id));
  if (sig === registered) return;
  registered = sig;
  globalShortcut.unregisterAll();
  for (const b of bindings) {
    const k = toAccelKey(b.key);
    if (!k) continue;
    if (!globalShortcut.register(`${MOD}+${k}`, b.run)) console.warn(`[desktop] could not register ${MOD}+${k}`);
  }
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 900,
    title: "SafeVtube",
    webPreferences: {
      // Keep sending frames while minimised/covered; otherwise throttling could stall the overlay (it would go black).
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(BASE)) e.preventDefault(); });
  // Only microphone access is ever granted, and only to our own dashboard.
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" && wc.getURL().startsWith(BASE)));
  await win.loadURL(BASE);
}

app.whenReady().then(async () => {
  startServer();
  await waitForServer();
  await createWindow();
  await syncHotkeys();
  setInterval(syncHotkeys, 3000);
});

app.on("before-quit", () => { app.isQuitting = true; server?.kill(); });
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
