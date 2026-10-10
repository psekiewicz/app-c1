import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { overlayShouldShow, type OverlayOutput } from "@safevtube/shared";
import { connect } from "./ws";
import { buildDots, drawDots } from "./dotface";
import { drawPuppet, loadPuppet, type LoadedPuppet } from "./puppet2d";
import type { ModelStage } from "./model3d";

function DotFace({ out }: { out: OverlayOutput }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const latest = useRef(out);
  latest.current = out;
  const dots = useMemo(() => buildDots(out.settings.dotCount), [out.settings.dotCount]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = cv.current, ctx = c?.getContext("2d");
      const o = latest.current;
      if (c && ctx && o.face) {
        if (c.width !== c.clientWidth || c.height !== c.clientHeight) { c.width = c.clientWidth; c.height = c.clientHeight; }
        drawDots(ctx, dots, o.face, c.width, c.height, o.settings.dotColor, o.settings.dotSize, performance.now() / 1000);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [dots]);
  return <canvas ref={cv} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function ModelFace({ out }: { out: OverlayOutput }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const latest = useRef(out);
  latest.current = out;
  const asset = out.settings.model3dAsset;
  useEffect(() => {
    if (!asset || !cv.current) return;
    let raf = 0, dead = false, stage: ModelStage | null = null;
    const canvas = cv.current;
    // three.js is loaded lazily: only streams using a 3D model pay for it.
    import("./model3d").then(async ({ ModelStage }) => {
      if (dead) return;
      stage = new ModelStage(canvas);
      await stage.load(`/media/${asset}`);
      const loop = () => {
        const o = latest.current;
        if (o.face) {
          const w = canvas.clientWidth, h = canvas.clientHeight;
          stage!.render(o.face, { zoom: o.settings.modelZoom, y: o.settings.modelY, mirror: o.settings.modelMirror }, w, h);
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
    });
    return () => { dead = true; cancelAnimationFrame(raf); stage?.dispose(); };
  }, [asset]);
  return <canvas ref={cv} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function PuppetFace({ out }: { out: OverlayOutput }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const latest = useRef(out);
  latest.current = out;
  const key = JSON.stringify(out.settings.puppet);
  useEffect(() => {
    let raf = 0, dead = false;
    let puppet: LoadedPuppet | null = null;
    loadPuppet(out.settings.puppet).then((p) => { if (!dead) puppet = p; });
    const loop = () => {
      const c = cv.current, ctx = c?.getContext("2d");
      const o = latest.current;
      if (c && ctx) {
        if (c.width !== c.clientWidth || c.height !== c.clientHeight) { c.width = c.clientWidth; c.height = c.clientHeight; }
        if (puppet && o.face) drawPuppet(ctx, puppet, o.settings.puppet, o.face, { pivotX: o.settings.puppetPivotX, pivotY: o.settings.puppetPivotY, mirror: o.settings.modelMirror }, c.width, c.height, performance.now() / 1000);
        else ctx.clearRect(0, 0, c.width, c.height);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { dead = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={cv} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function Overlay() {
  const [out, setOut] = useState<OverlayOutput | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastAt = useRef(0);
  const connected = useRef(false);

  useEffect(() => {
    const c = connect(
      "overlay",
      (m) => {
        if (m.type === "output") {
          lastAt.current = Date.now();
          setOut(m);
        }
      },
      (open) => {
        connected.current = open;
        if (!open) setOut(null); // drop avatar state immediately on disconnect
      },
    );
    // Watchdog tick: re-evaluate freshness even if no message ever arrives.
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => (c.close(), clearInterval(t));
  }, []);

  // Fail closed: black unless connected, live and fresh.
  const visible = !!out && connected.current && overlayShouldShow(out.live, lastAt.current, now);
  if (out && out.settings.mode !== "png") {
    // Tracked modes stay mounted while black so a 3D model isn't reloaded after every blackout; hidden + no face = nothing drawn.
    const show = visible && !!out.face?.faceFound;
    const Avatar = out.settings.mode === "dots" ? DotFace : out.settings.mode === "model3d" ? ModelFace : PuppetFace;
    return <div style={{ height: "100%", visibility: show ? "visible" : "hidden" }}><Avatar out={out} /></div>;
  }
  if (!out || !visible) return null;

  const expr = out.settings.expressions.find((e) => e.id === out.expressionId) ?? out.settings.expressions[0];
  const asset = (out.talking ? expr?.talkAsset ?? expr?.idleAsset : expr?.idleAsset ?? expr?.talkAsset) ?? null;
  if (!asset) return null;
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <img
        src={`/media/${asset}`}
        alt=""
        style={{
          maxHeight: "100%",
          maxWidth: "100%",
          transform: out.talking && !expr?.talkAsset ? "translateY(-8px)" : "none",
          transition: "transform 80ms",
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
