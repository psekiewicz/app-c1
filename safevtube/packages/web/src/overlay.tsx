import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { overlayShouldShow, type OverlayOutput } from "@safevtube/shared";
import { connect } from "./ws";

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
