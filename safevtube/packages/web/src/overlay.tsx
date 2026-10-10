import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { overlayShouldShow, type OverlayOutput } from "@safevtube/shared";
import { connect } from "./ws";
import { buildDots, drawDots } from "./dotface";

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
  if (!out || !connected.current || !overlayShouldShow(out.live, lastAt.current, now)) return null;
  if (out.settings.mode === "dots") return out.face?.faceFound ? <DotFace out={out} /> : null;

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
