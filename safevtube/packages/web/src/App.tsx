import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, TalkDetector, type DashboardStatus, type Expression, type Settings } from "@safevtube/shared";
import { connect } from "./ws";
import { useMic } from "./useMic";

async function uploadAsset(file: File): Promise<string> {
  const r = await fetch("/api/assets", { method: "POST", body: file });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Upload failed");
  return j.asset;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [armed, setArmed] = useState(false); // never persisted: every load starts black
  const [panic, setPanic] = useState(false);
  const [expressionId, setExpressionId] = useState(DEFAULT_SETTINGS.defaultExpressionId);
  const [talking, setTalking] = useState(false);
  const [meter, setMeter] = useState(0);
  const [err, setErr] = useState("");
  const mic = useMic();
  const [pairing, setPairing] = useState<{ lan: boolean; secure: boolean; urls: string[] } | null>(null);
  useEffect(() => { fetch("/api/pairing").then((r) => r.json()).then(setPairing).catch(() => {}); }, []);
  const resetPairing = () => fetch("/api/pairing/reset", { method: "POST" }).then((r) => r.json()).then(setPairing);

  // Latest values for the 10 Hz sender / key handler without re-subscribing.
  const live = useRef({ armed, panic, expressionId, talking, settings });
  live.current = { armed, panic, expressionId, talking, settings };
  const conn = useRef<ReturnType<typeof connect> | null>(null);
  const detector = useRef(new TalkDetector(settings.talkThreshold, settings.releaseMs));
  detector.current.threshold = settings.talkThreshold;
  detector.current.releaseMs = settings.releaseMs;

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s: Settings) => {
      setSettings(s);
      setExpressionId(s.defaultExpressionId);
    }).catch(() => setErr("Cannot reach the SafeVtube server"));
    const c = connect(
      "dashboard",
      (m) => {
        if (m.type === "status") setStatus(m);
        else if (m.type === "settings") setSettings(m.settings);
        else if (m.type === "control") {
          if (m.action === "panic") setPanic(true);
          else setExpressionId(m.id);
        }
      },
      (open) => {
        setWsOpen(open);
        if (!open) setStatus(null);
      },
    );
    conn.current = c;
    return () => c.close();
  }, []);

  // Mic analysis + frame sender.
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      const isTalking = detector.current.update(mic.level.current, now);
      setMeter(mic.level.current);
      setTalking((p) => (p === isTalking ? p : isTalking));
      const l = live.current;
      conn.current?.send({
        type: "frame",
        armed: l.armed,
        micOk: mic.okRef.current,
        panic: l.panic,
        talking: isTalking,
        expressionId: l.expressionId,
      });
    }, 100);
    return () => clearInterval(t);
  }, [mic.level, mic.okRef]);

  // Hotkeys (dashboard window must be focused; see README).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      const s = live.current.settings;
      if (e.key === s.panicHotkey) return setPanic(true);
      const ex = s.expressions.find((x) => x.hotkey && x.hotkey === e.key);
      if (ex) setExpressionId(ex.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      setSettings(await r.json());
    } catch {
      setErr("Failed to save settings");
    }
  }, []);

  const patchExpr = (id: string, p: Partial<Expression>) =>
    save({ ...settings, expressions: settings.expressions.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const upload = async (id: string, key: "idleAsset" | "talkAsset", f?: File) => {
    if (!f) return;
    try {
      setErr("");
      patchExpr(id, { [key]: await uploadAsset(f) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  };
  const addExpr = () => {
    const id = "e" + Math.random().toString(36).slice(2, 8);
    save({ ...settings, expressions: [...settings.expressions, { id, name: "New expression", durationMs: 5000 }] });
  };
  const removeExpr = (id: string) => {
    if (settings.expressions.length < 2) return;
    save({ ...settings, expressions: settings.expressions.filter((e) => e.id !== id) });
    if (expressionId === id) setExpressionId(settings.defaultExpressionId);
  };

  const isLive = status?.live ?? false;
  const reason = !wsOpen ? "Server disconnected" : status?.reason ?? "…";

  return (
    <main>
      <header>
        <h1>SafeVtube</h1>
        <div className={`badge ${isLive ? "live" : "dark"}`}>{isLive ? "● LIVE" : `■ BLACKOUT — ${reason}`}</div>
      </header>
      {err && <p className="err" onClick={() => setErr("")}>{err}</p>}

      <section className="card">
        <h2>Output</h2>
        <p className="muted">
          The overlay stays black until you press <b>Go live</b>, and goes black again on panic, mic loss, or any lost connection.
          Your camera is never used.
        </p>
        <div className="row">
          <button className="go" onClick={() => (panic ? setPanic(false) : setArmed(!armed))}>
            {panic ? "Clear panic" : armed ? "Stop (go black)" : "Go live"}
          </button>
          <button className="panic" onClick={() => setPanic(true)}>PANIC — black now ({settings.panicHotkey})</button>
        </div>
        <p className="muted">
          OBS Browser Source URL: <code>{location.origin}/overlay.html</code> · overlays connected: {status?.overlays ?? 0} · Twitch: {status?.twitch ?? "off"}
        </p>
      </section>

      <section className="card">
        <h2>Avatar mode</h2>
        <div className="row">
          <label>Mode
            <select value={settings.mode} onChange={(e) => save({ ...settings, mode: e.target.value as Settings["mode"] })}>
              <option value="png">PNGtuber (mic-driven image)</option>
              <option value="dots">Dot-cloud face (camera tracker)</option>
            </select>
          </label>
        </div>
        {settings.mode === "dots" && (
          <>
            <p className="muted">
              A generic dot face is animated from head angles and expression numbers sent by the <b>tracker</b>.
              Your video and real face shape never reach OBS or this server. Face lost or tracker offline = black screen.
            </p>
            <div className="row">
              <label>Dots ({settings.dotCount})
                <input type="range" min="500" max="8000" step="250" value={settings.dotCount}
                  onChange={(e) => setSettings({ ...settings, dotCount: Number(e.target.value) })} onMouseUp={() => save(settings)} onKeyUp={() => save(settings)} />
              </label>
              <label>Dot size ({settings.dotSize})
                <input type="range" min="1" max="6" step="0.5" value={settings.dotSize}
                  onChange={(e) => setSettings({ ...settings, dotSize: Number(e.target.value) })} onMouseUp={() => save(settings)} onKeyUp={() => save(settings)} />
              </label>
              <label>Color<input type="color" value={settings.dotColor} onChange={(e) => save({ ...settings, dotColor: e.target.value })} /></label>
            </div>
            <p>Tracker: <span className={status?.tracker ? "ok" : "bad"}>{status?.tracker ? "connected" : "not connected"}</span></p>
            <p className="muted">
              Open one of these on the device with the camera (same PC, or a second device — phone/laptop — so the camera never touches your streaming PC):
            </p>
            {pairing?.urls.map((u) => <p key={u}><code>{u}</code></p>)}
            {pairing && !pairing.lan && (
              <p className="muted">Second device? Start the server with <code>SAFEVTUBE_LAN=1</code> (plus <code>SAFEVTUBE_TLS_KEY</code>/<code>SAFEVTUBE_TLS_CERT</code> — phones only allow camera over HTTPS). See README.</p>
            )}
            {pairing?.lan && !pairing.secure && (
              <p className="err">LAN mode without HTTPS: browsers on other devices will refuse camera access. Set SAFEVTUBE_TLS_KEY / SAFEVTUBE_TLS_CERT.</p>
            )}
            <button onClick={resetPairing}>Reset pairing token</button>
          </>
        )}
      </section>

      <section className="card">
        <h2>Microphone</h2>
        <div className="row">
          <button onClick={() => mic.start()}>{mic.ok ? "Restart mic" : "Enable mic"}</button>
          <select onChange={(e) => mic.start(e.target.value)} defaultValue="">
            <option value="" disabled>Choose device…</option>
            {mic.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
          </select>
          <span className={mic.ok ? "ok" : "bad"}>{mic.ok ? "mic OK" : mic.error || "mic not active"}</span>
        </div>
        <div className="meter">
          <div className="fill" style={{ width: `${Math.min(100, meter * 400)}%` }} />
          <div className="thr" style={{ left: `${Math.min(100, settings.talkThreshold * 400)}%` }} />
        </div>
        <label>
          Talk threshold ({settings.talkThreshold.toFixed(3)}) {talking ? "— talking" : ""}
          <input type="range" min="0.005" max="0.25" step="0.005" value={settings.talkThreshold}
            onChange={(e) => setSettings({ ...settings, talkThreshold: Number(e.target.value) })}
            onMouseUp={() => save(settings)} onKeyUp={() => save(settings)} />
        </label>
        <label>
          Release delay ({settings.releaseMs} ms)
          <input type="range" min="0" max="1000" step="50" value={settings.releaseMs}
            onChange={(e) => setSettings({ ...settings, releaseMs: Number(e.target.value) })}
            onMouseUp={() => save(settings)} onKeyUp={() => save(settings)} />
        </label>
      </section>

      <section className="card">
        <h2>Expressions</h2>
        {settings.expressions.map((e) => (
          <div key={e.id} className={`expr ${e.id === expressionId ? "active" : ""}`}>
            <div className="row">
              <input value={e.name} onChange={(ev) => patchExpr(e.id, { name: ev.target.value })} />
              <button onClick={() => setExpressionId(e.id)}>Use</button>
              <button onClick={() => save({ ...settings, defaultExpressionId: e.id })} disabled={settings.defaultExpressionId === e.id}>
                {settings.defaultExpressionId === e.id ? "Default" : "Make default"}
              </button>
              <button onClick={() => removeExpr(e.id)} disabled={settings.expressions.length < 2}>Delete</button>
            </div>
            <div className="row">
              {(["idleAsset", "talkAsset"] as const).map((k) => (
                <label key={k} className="up">
                  {k === "idleAsset" ? "Idle PNG" : "Talking PNG"}
                  {e[k] && <img src={`/media/${e[k]}`} alt="" />}
                  <input type="file" accept="image/png,image/webp,image/gif" onChange={(ev) => upload(e.id, k, ev.target.files?.[0])} />
                </label>
              ))}
              <label>Hotkey<input maxLength={20} value={e.hotkey ?? ""} placeholder="press a key name, e.g. 1" onChange={(ev) => patchExpr(e.id, { hotkey: ev.target.value })} /></label>
              <label>Twitch !command<input maxLength={30} value={e.twitchCommand ?? ""} onChange={(ev) => patchExpr(e.id, { twitchCommand: ev.target.value })} /></label>
              <label>Twitch duration (ms, 0 = sticky)<input type="number" min={0} value={e.durationMs} onChange={(ev) => patchExpr(e.id, { durationMs: Number(ev.target.value) })} /></label>
            </div>
          </div>
        ))}
        <button onClick={addExpr}>+ Add expression</button>
      </section>

      <section className="card">
        <h2>Twitch (read-only chat)</h2>
        <div className="row">
          <label>Channel<input value={settings.twitchChannel} placeholder="your_channel" onChange={(e) => setSettings({ ...settings, twitchChannel: e.target.value })} onBlur={() => save(settings)} /></label>
          <label>Cooldown (ms)<input type="number" min={0} value={settings.twitchCooldownMs} onChange={(e) => setSettings({ ...settings, twitchCooldownMs: Number(e.target.value) })} onBlur={() => save(settings)} /></label>
        </div>
        <p className="muted">Connects anonymously — it can read chat commands but never post or log in as you.</p>
      </section>
    </main>
  );
}
