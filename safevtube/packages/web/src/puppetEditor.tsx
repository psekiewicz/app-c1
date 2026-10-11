import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BINDING_PROPS, CONDITION_PRESETS, DEFAULT_PHYSICS, EMPTY_FACE, PARAM_INFO, PHYSICS_PRESETS, PUPPET_PARAMS,
  type ChainDirection, type Condition, type FaceParams, type PhysicsParams, type PuppetBinding, type PuppetLayer, type PuppetParam, type Settings,
} from "@safevtube/shared";
import { uploadAsset } from "./assets";
import { drawPuppet, layoutOf, loadPuppet, type LoadedPuppet } from "./puppet2d";
import "./style.css";

const SIZE = 640;
const uid = (p: string) => p + Math.random().toString(36).slice(2, 8);
const rad = (d: number) => (d * Math.PI) / 180;

const newLayer = (o: Partial<PuppetLayer> = {}): PuppetLayer => ({
  id: uid("l"), name: "New layer", states: [], bindings: [], visibleWhen: [], follow: "head", depth: 0.03, ...o,
});

/** Slider values (as shown to the user) -> FaceParams, undoing the mirror so paramValue() returns the slider value. */
function toFace(p: Record<PuppetParam, number>, mirror: boolean): FaceParams {
  const m = mirror ? 1 : -1;
  return {
    ...EMPTY_FACE, faceFound: true,
    yaw: rad(p.yaw) * m, pitch: rad(p.pitch), roll: rad(p.roll) * m,
    jawOpen: p.jawOpen, blinkL: p.blinkL, blinkR: p.blinkR, smile: p.smile, browUp: p.browUp, browDown: p.browDown,
    pucker: p.pucker, lookX: p.lookX * m, lookY: p.lookY,
  };
}

const NEUTRAL = Object.fromEntries(PUPPET_PARAMS.map((k) => [k, 0])) as Record<PuppetParam, number>;

function ImagePicker({ asset, onChange, label }: { asset?: string; onChange: (a: string) => void; label?: string }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: "center" }}>
      {label}
      {asset ? <img className="thumb" src={`/media/${asset}`} alt="" /> : <span className="muted">no image</span>}
      <input type="file" accept="image/png,image/webp,image/gif" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) onChange(await uploadAsset(f).catch((err) => (alert(err.message), asset ?? "")));
      }} />
    </label>
  );
}

function ParamSelect({ value, onChange }: { value: PuppetParam; onChange: (p: PuppetParam) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PuppetParam)}>
      {PUPPET_PARAMS.map((p) => <option key={p} value={p}>{PARAM_INFO[p].label}</option>)}
    </select>
  );
}

function Conditions({ value, onChange }: { value: Condition[]; onChange: (c: Condition[]) => void }) {
  return (
    <div>
      {value.map((c, i) => (
        <div className="row" key={i} style={{ margin: "2px 0" }}>
          <ParamSelect value={c.param} onChange={(param) => onChange(value.map((x, j) => (j === i ? { ...x, param } : x)))} />
          <select value={c.op} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, op: e.target.value as ">" | "<" } : x)))}>
            <option value=">">&gt;</option><option value="<">&lt;</option>
          </select>
          <input className="num" type="number" step="0.05" value={c.value} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
          <button className="small" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="row" style={{ margin: "2px 0" }}>
        <button className="small" onClick={() => onChange([...value, { param: "blinkR", op: ">", value: 0.5 }])}>+ condition</button>
        <select value="" onChange={(e) => { const p = CONDITION_PRESETS[Number(e.target.value)]; if (p) onChange(p.when.map((c) => ({ ...c }))); }}>
          <option value="" disabled>Preset…</option>
          {CONDITION_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      </div>
    </div>
  );
}

function PuppetEditor() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [test, setTest] = useState(NEUTRAL);
  const [demo, setDemo] = useState(false);
  const [tool, setTool] = useState<"none" | "pivot" | "area">("none");
  const [puppet, setPuppet] = useState<LoadedPuppet | null>(null);
  const [saved, setSaved] = useState("");
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<number>();
  const shake = useRef(0);

  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then((s: Settings) => { setSettings(s); setSel(s.puppet[0]?.id ?? null); }); }, []);

  const layers = settings?.puppet ?? [];
  const layer = layers.find((l) => l.id === sel) ?? null;
  const assetKey = useMemo(() => JSON.stringify(layers.map((l) => [l.asset, l.states.map((s) => s.asset)])), [layers]);
  useEffect(() => { let dead = false; loadPuppet(layers).then((p) => { if (!dead) setPuppet(p); }); return () => { dead = true; }; /* eslint-disable-next-line */ }, [assetKey]);

  const save = useCallback((next: Settings) => {
    setSettings(next);
    clearTimeout(timer.current);
    setSaved("saving…");
    timer.current = window.setTimeout(async () => {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      setSaved(r.ok ? "saved" : "save failed");
    }, 400);
  }, []);
  const setLayers = (ls: PuppetLayer[]) => settings && save({ ...settings, puppet: ls });
  const update = (id: string, patch: Partial<PuppetLayer>) => setLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const live = useRef({ settings, puppet, layers, test, demo, sel, tool });
  live.current = { settings, puppet, layers, test, demo, sel, tool };

  // Preview loop (same renderer as the real overlay).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = cv.current, ctx = c?.getContext("2d");
      const { settings: s, puppet: p, layers: ls, test: t0, demo: d, sel: selected } = live.current;
      if (c && ctx && s) {
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, SIZE, SIZE);
        if (p) {
          const now = performance.now() / 1000;
          let tv = t0;
          const sk = now - shake.current;
          if (sk >= 0 && sk < 1.8) {
            const decay = 1 - sk / 1.8;
            tv = { ...t0, yaw: 28 * Math.sin(sk * 15) * decay, roll: 12 * Math.sin(sk * 11) * decay, pitch: 8 * Math.sin(sk * 9) * decay };
          }
          if (d && !(sk >= 0 && sk < 1.8)) {
            const blink = (now % 4) < 0.18 ? 1 : 0;
            tv = { ...NEUTRAL, yaw: 15 * Math.sin(now * 0.8), roll: 6 * Math.sin(now * 0.6), jawOpen: Math.max(0, Math.sin(now * 3)) * 0.7,
              blinkL: blinkOf(now, 0, blink), blinkR: blinkOf(now, 1, blink), lookX: Math.sin(now * 1.1), lookY: Math.cos(now * 0.9) * 0.6, smile: (Math.sin(now * 0.5) + 1) / 2 };
          }
          drawPuppet(ctx, p, ls, toFace(tv, s.modelMirror), { pivotX: s.puppetPivotX, pivotY: s.puppetPivotY, mirror: s.modelMirror }, SIZE, SIZE, now);
          const { s: sc, ox, oy } = layoutOf(p, SIZE, SIZE);
          const L = ls.find((l) => l.id === selected);
          ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.lineWidth = 2 / sc; ctx.strokeStyle = "#ffd54a"; ctx.setLineDash([6 / sc, 4 / sc]);
          if (L?.pupil) { const a = L.pupil.area; ctx.strokeRect(a.x, a.y, a.w, a.h); ctx.beginPath(); ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2, 0, 0, 7); ctx.stroke(); }
          if (L) { const px = (L.pivotX ?? s.puppetPivotX) * p.w, py = (L.pivotY ?? s.puppetPivotY) * p.h; ctx.setLineDash([]); ctx.strokeStyle = "#ff5a5a"; ctx.beginPath(); ctx.moveTo(px - 10 / sc, py); ctx.lineTo(px + 10 / sc, py); ctx.moveTo(px, py - 10 / sc); ctx.lineTo(px, py + 10 / sc); ctx.stroke(); }
          ctx.restore();
        } else {
          ctx.fillStyle = "#666"; ctx.font = "16px system-ui"; ctx.fillText("Add a layer and upload an image", 20, 30);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const toDesign = (e: React.MouseEvent) => {
    const c = cv.current!, r = c.getBoundingClientRect(), p = live.current.puppet;
    if (!p) return null;
    const { s, ox, oy } = layoutOf(p, SIZE, SIZE);
    return { x: ((e.clientX - r.left) * (SIZE / r.width) - ox) / s, y: ((e.clientY - r.top) * (SIZE / r.height) - oy) / s, w: p.w, h: p.h };
  };
  const onDown = (e: React.MouseEvent) => {
    const d = toDesign(e);
    if (!d || !layer) return;
    if (tool === "pivot") { update(layer.id, { pivotX: +(d.x / d.w).toFixed(3), pivotY: +(d.y / d.h).toFixed(3) }); setTool("none"); }
    else if (tool === "area") drag.current = { x: d.x, y: d.y };
  };
  const onMove = (e: React.MouseEvent) => {
    const d = toDesign(e), s = drag.current;
    if (!d || !s || !layer) return;
    update(layer.id, { pupil: { clip: true, scale: 1, ...layer.pupil, area: { x: Math.round(Math.min(s.x, d.x)), y: Math.round(Math.min(s.y, d.y)), w: Math.max(2, Math.round(Math.abs(d.x - s.x))), h: Math.max(2, Math.round(Math.abs(d.y - s.y))) } } });
  };
  const onUp = () => { if (drag.current) { drag.current = null; setTool("none"); } };

  if (!settings) return <main><p>Loading…</p></main>;
  const dw = puppet?.w ?? 400, dh = puppet?.h ?? 400;
  const move = (id: string, dir: -1 | 1) => {
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const n = [...layers]; [n[i], n[j]] = [n[j]!, n[i]!]; setLayers(n);
  };
  const addLayer = (l: PuppetLayer) => { setLayers([...layers, l]); setSel(l.id); };

  return (
    <div className="editor">
      <div className="panel layers">
        <h2>Layers</h2>
        <p className="muted">Bottom of the list is drawn on top.</p>
        {layers.map((l) => (
          <div key={l.id} className={`item ${l.id === sel ? "sel" : ""}`} onClick={() => setSel(l.id)}>
            <span>{l.pupil ? "◉ " : ""}{l.name}</span>
            <button className="small" onClick={(e) => { e.stopPropagation(); move(l.id, -1); }}>↑</button>
            <button className="small" onClick={(e) => { e.stopPropagation(); move(l.id, 1); }}>↓</button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => addLayer(newLayer())}>+ Layer</button>
          <button onClick={() => addLayer(newLayer({ name: "Pupil", pupil: { area: { x: dw * 0.4, y: dh * 0.4, w: 60, h: 30 }, clip: true, scale: 1 } }))}>+ Pupil</button>
        </div>
        {layer && (
          <div className="row">
            <button onClick={() => addLayer({ ...layer, id: uid("l"), name: layer.name + " copy", states: layer.states.map((s) => ({ ...s, id: uid("s") })) })}>Duplicate</button>
            <button onClick={() => { setLayers(layers.filter((l) => l.id !== layer.id)); setSel(null); }}>Delete</button>
          </div>
        )}
        <p className="muted"><a href="/">← Dashboard</a> · {saved}</p>
      </div>

      <div className="panel">
        <canvas ref={cv} className={`stage ${tool !== "none" ? "draw" : ""}`} width={SIZE} height={SIZE} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
        {tool !== "none" && <p className="muted">{tool === "pivot" ? "Click the canvas to set the pivot." : "Drag on the canvas to draw the pupil's movement area."}</p>}
        <div className="row"><button onClick={() => { shake.current = performance.now() / 1000; }}>Shake head (test physics)</button></div>
        <label className="row"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Auto demo (blink, talk, look around)</label>
        <label className="row"><input type="checkbox" checked={settings.modelMirror} onChange={(e) => save({ ...settings, modelMirror: e.target.checked })} /> Mirror movement (selfie-style)</label>
        <h3>Test parameters</h3>
        {PUPPET_PARAMS.map((p) => (
          <label key={p}>{PARAM_INFO[p].label}: {test[p].toFixed(2)}
            <input type="range" min={PARAM_INFO[p].min} max={PARAM_INFO[p].max} step={(PARAM_INFO[p].max - PARAM_INFO[p].min) / 100} value={test[p]} onChange={(e) => setTest({ ...test, [p]: Number(e.target.value) })} />
          </label>
        ))}
        <button onClick={() => setTest(NEUTRAL)}>Reset</button>
      </div>

      <div className="panel">
        {!layer ? <p className="muted">Select or add a layer.</p> : (
          <>
            <h2>{layer.name}</h2>
            <label>Name<input value={layer.name} onChange={(e) => update(layer.id, { name: e.target.value })} /></label>
            <ImagePicker label={layer.pupil ? "Pupil image" : "Base image"} asset={layer.asset} onChange={(asset) => update(layer.id, { asset })} />

            <h3>Movement</h3>
            <label className="row"><input type="checkbox" checked={layer.follow === "head"} onChange={(e) => update(layer.id, { follow: e.target.checked ? "head" : "none" })} /> Follows the head (turn / nod / tilt)</label>
            {layer.follow === "head" && (
              <label>Depth (parallax) {layer.depth.toFixed(3)}
                <input type="range" min="0" max="0.12" step="0.002" value={layer.depth} onChange={(e) => update(layer.id, { depth: Number(e.target.value) })} />
              </label>
            )}
            <div className="row">
              <button onClick={() => setTool("pivot")}>{layer.physics ? "Set anchor (click)" : "Set pivot (click)"}</button>
              <span className="muted">{layer.pivotX === undefined ? "head pivot" : `${layer.pivotX.toFixed(2)}, ${layer.pivotY?.toFixed(2)}`}</span>
              {layer.pivotX !== undefined && <button className="small" onClick={() => update(layer.id, { pivotX: undefined, pivotY: undefined })}>reset</button>}
            </div>
            {!layer.pupil && (
              <div className="row">
                <label>Head pivot X {settings.puppetPivotX.toFixed(2)}<input type="range" min="0" max="1" step="0.01" value={settings.puppetPivotX} onChange={(e) => save({ ...settings, puppetPivotX: Number(e.target.value) })} /></label>
                <label>Head pivot Y {settings.puppetPivotY.toFixed(2)}<input type="range" min="0" max="1" step="0.01" value={settings.puppetPivotY} onChange={(e) => save({ ...settings, puppetPivotY: Number(e.target.value) })} /></label>
              </div>
            )}

            {layer.pupil && (
              <>
                <h3>Pupil movement area</h3>
                <p className="muted">The pupil image slides inside this ellipse following your gaze.</p>
                <div className="row">
                  <button onClick={() => setTool("area")}>Draw area (drag)</button>
                  <label className="row"><input type="checkbox" checked={layer.pupil.clip} onChange={(e) => update(layer.id, { pupil: { ...layer.pupil!, clip: e.target.checked } })} /> Clip to area</label>
                </div>
                <div className="row">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <label key={k}>{k}<input className="num" type="number" value={Math.round(layer.pupil!.area[k])} onChange={(e) => update(layer.id, { pupil: { ...layer.pupil!, area: { ...layer.pupil!.area, [k]: Number(e.target.value) } } })} /></label>
                  ))}
                  <label>scale<input className="num" type="number" step="0.1" value={layer.pupil.scale} onChange={(e) => update(layer.id, { pupil: { ...layer.pupil!, scale: Number(e.target.value) || 1 } })} /></label>
                </div>
              </>
            )}

            <h3>Physics (hair / accessories)</h3>
            {!layer.pupil && (
              <label className="row"><input type="checkbox" checked={!!layer.physics} onChange={(e) => update(layer.id, { physics: e.target.checked ? { ...DEFAULT_PHYSICS } : undefined, follow: e.target.checked ? "head" : layer.follow })} /> Sway with head movement</label>
            )}
            {layer.physics && (() => {
              const ph = layer.physics;
              const up = (patch: Partial<PhysicsParams>) => update(layer.id, { physics: { ...ph, ...patch } });
              const sl = (k: keyof PhysicsParams, label: string, min: number, max: number, step: number) => (
                <label>{label} {(ph[k] as number).toFixed(2)}<input type="range" min={min} max={max} step={step} value={ph[k] as number} onChange={(e) => up({ [k]: Number(e.target.value) })} /></label>
              );
              return (
                <>
                  <p className="muted">Hangs from the anchor (red cross; default = the edge of the image). Click <i>Set pivot</i> above to place the anchor yourself, then press <i>Shake head</i> to test.</p>
                  <div className="row">
                    <select value="" onChange={(e) => { const p = PHYSICS_PRESETS[Number(e.target.value)]; if (p) up({ ...p.params }); }}>
                      <option value="" disabled>Preset…</option>
                      {PHYSICS_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                    </select>
                    <label>Hangs toward
                      <select value={ph.direction} onChange={(e) => up({ direction: e.target.value as ChainDirection })}>
                        <option value="down">down (hair, tails)</option><option value="up">up (ahoge, ears)</option><option value="left">left</option><option value="right">right</option>
                      </select>
                    </label>
                  </div>
                  {sl("segments", "Bend points", 1, 12, 1)}
                  {sl("stiffness", "Stiffness (Hz)", 0.3, 12, 0.1)}
                  {sl("damping", "Damping", 0.03, 1.2, 0.01)}
                  {sl("inertia", "Reaction to movement", 0, 3, 0.05)}
                  {sl("gravity", "Gravity (0 = rigid, 1 = hangs down)", 0, 1, 0.05)}
                  {sl("maxAngle", "Max swing (°)", 5, 120, 1)}
                  {sl("sway", "Idle breeze (°)", 0, 8, 0.1)}
                  {sl("taper", "Looser toward the tip", 0.6, 1.2, 0.01)}
                </>
              );
            })()}

            <h3>Visible only when…</h3>
            <p className="muted">Empty = always visible. E.g. a pupil that hides while that eye is closed.</p>
            <Conditions value={layer.visibleWhen} onChange={(visibleWhen) => update(layer.id, { visibleWhen })} />

            <h3>Actions: swap image when…</h3>
            <p className="muted">First matching action wins. No image = hide the layer. E.g. <i>Right eye closed → image 3</i>.</p>
            {layer.states.map((s, i) => (
              <div className="sub" key={s.id}>
                <div className="row">
                  <ImagePicker label={`Image ${i + 1}`} asset={s.asset} onChange={(asset) => update(layer.id, { states: layer.states.map((x) => (x.id === s.id ? { ...x, asset } : x)) })} />
                  <button className="small" onClick={() => update(layer.id, { states: layer.states.filter((x) => x.id !== s.id) })}>Remove</button>
                </div>
                <Conditions value={s.when} onChange={(when) => update(layer.id, { states: layer.states.map((x) => (x.id === s.id ? { ...x, when } : x)) })} />
              </div>
            ))}
            <button onClick={() => update(layer.id, { states: [...layer.states, { id: uid("s"), when: [{ param: "blinkR", op: ">", value: 0.5 }] }] })}>+ Action</button>

            <h3>Bindings: parameter → transform</h3>
            {layer.bindings.map((b, i) => {
              const upd = (patch: Partial<PuppetBinding>) => update(layer.id, { bindings: layer.bindings.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div className="sub" key={i}>
                  <div className="row">
                    <ParamSelect value={b.param} onChange={(param) => upd({ param, inMin: PARAM_INFO[param].min, inMax: PARAM_INFO[param].max })} />
                    →
                    <select value={b.prop} onChange={(e) => upd({ prop: e.target.value as PuppetBinding["prop"] })}>{BINDING_PROPS.map((p) => <option key={p}>{p}</option>)}</select>
                    <button className="small" onClick={() => update(layer.id, { bindings: layer.bindings.filter((_, j) => j !== i) })}>×</button>
                  </div>
                  <div className="row">
                    {(["inMin", "inMax", "outMin", "outMax"] as const).map((k) => (
                      <label key={k}>{k}<input className="num" type="number" step="0.1" value={b[k]} onChange={(e) => upd({ [k]: Number(e.target.value) })} /></label>
                    ))}
                  </div>
                </div>
              );
            })}
            <button onClick={() => update(layer.id, { bindings: [...layer.bindings, { param: "jawOpen", prop: "y", inMin: 0, inMax: 1, outMin: 0, outMax: 20 }] })}>+ Binding</button>
            <p className="muted">x/y in canvas px, rotate in degrees, scale/opacity as factors (1 = normal).</p>
          </>
        )}
      </div>
    </div>
  );
}

// Demo blinking, slightly different timing per eye so winks are visible in the preview.
function blinkOf(now: number, eye: 0 | 1, base: number) {
  return eye === 0 ? base : (now % 7) < 0.4 ? 1 : base;
}

createRoot(document.getElementById("root")!).render(<StrictMode><PuppetEditor /></StrictMode>);
