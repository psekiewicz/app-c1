# SafeVtube Desktop

Electron shell around SafeVtube. It starts the local server, opens the dashboard, and adds **global hotkeys** that work while OBS or a game has focus.

```bash
cd desktop
npm install
npm start
```

| Hotkey | Action |
|---|---|
| `Ctrl/Cmd+Alt+<panic key>` (default `Esc`) | Black screen instantly |
| `Ctrl/Cmd+Alt+<expression key>` | Switch expression |

Change the modifier with `SAFEVTUBE_GLOBAL_MOD` (e.g. `Control+Shift`). Global hotkeys can only black out or change expression, never go live or clear panic — arming always needs a deliberate click in the dashboard. Closing the app turns the overlay black immediately.

Packaging an installer (electron-builder) is not set up yet.
