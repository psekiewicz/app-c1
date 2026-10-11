import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EMPTY_FACE, type FaceParams } from "@safevtube/shared";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { connect } from "./ws";
import { buildDots, drawDots } from "./dotface";
import "./style.css";

const token = new URLSearchParams(location.search).get("token") ?? "";
const dots = buildDots(2500);

type Cat = { categoryName: string; score: number }[];
function toParams(blend: Cat, m: ArrayLike<number> | undefined): FaceParams {
  const b = (n: string) => blend.find((c) => c.categoryName === n)?.score ?? 0;
  let yaw = 0, pitch = 0, roll = 0;
  if (m && m.length >= 16) {
    // Column-major 4x4; normalise columns to strip scale.
    const col = (c: number) => {
      const l = Math.hypot(m[c * 4]!, m[c * 4 + 1]!, m[c * 4 + 2]!) || 1;
      return [m[c * 4]! / l, m[c * 4 + 1]! / l, m[c * 4 + 2]! / l] as const;
    };
    const [c0, c1, c2] = [col(0), col(1), col(2)];
    yaw = Math.atan2(c2[0], c2[2]);
    pitch = Math.asin(Math.max(-1, Math.min(1, -c2[1])));
    roll = Math.atan2(c0[1], c1[1]);
  }
  const blendAll: Record<string, number> = {};
  for (const c of blend) if (c.categoryName !== "_neutral") blendAll[c.categoryName] = Math.round(c.score * 1000) / 1000;
  return {
    faceFound: true, yaw, pitch, roll, blend: blendAll,
    jawOpen: b("jawOpen"),
    blinkL: b("eyeBlinkLeft"), blinkR: b("eyeBlinkRight"),
    smile: (b("mouthSmileLeft") + b("mouthSmileRight")) / 2,
    browUp: b("browInnerUp"),
    browDown: (b("browDownLeft") + b("browDownRight")) / 2,
    pucker: b("mouthPucker"),
    lookX: (b("eyeLookOutLeft") + b("eyeLookInRight") - b("eyeLookInLeft") - b("eyeLookOutRight")) / 2,
    lookY: (b("eyeLookUpLeft") + b("eyeLookUpRight") - b("eyeLookDownLeft") - b("eyeLookDownRight")) / 2,
  };
}

function lerpFace(prev: FaceParams, next: FaceParams, k: number): FaceParams {
  if (!prev.faceFound) return next;
  const out: FaceParams = { ...next };
  for (const key of Object.keys(next) as (keyof FaceParams)[]) {
    const n = next[key], p = prev[key];
    if (typeof n === "number" && typeof p === "number") (out as unknown as Record<string, number>)[key] = p + (n - p) * k;
  }
  if (next.blend) {
    out.blend = {};
    for (const [name, v] of Object.entries(next.blend)) out.blend[name] = Math.round(((prev.blend?.[name] ?? v) + (v - (prev.blend?.[name] ?? v)) * k) * 1000) / 1000;
  }
  return out;
}

function Tracker() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const face = useRef<FaceParams>(EMPTY_FACE);
  const conn = useRef<ReturnType<typeof connect> | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [state, setState] = useState("Camera off");
  const [showCam, setShowCam] = useState(false);

  useEffect(() => {
    const c = connect("tracker", () => {}, setWsOpen, `?role=tracker&token=${encodeURIComponent(token)}`);
    conn.current = c;
    // Send at ~30 Hz. Only abstract parameters are ever sent — never video or landmark coordinates.
    const t = setInterval(() => c.send({ type: "track", params: face.current }), 33);
    const draw = setInterval(() => {
      const cv = canvas.current;
      const ctx = cv?.getContext("2d");
      if (cv && ctx) drawDots(ctx, dots, face.current, cv.width, cv.height, "#7df9ff", 2, performance.now() / 1000);
    }, 33);
    return () => (c.close(), clearInterval(t), clearInterval(draw));
  }, []);

  const start = async () => {
    try {
      setState("Loading tracker…");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe");
      const mk = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      const lm = await mk("GPU").catch(() => mk("CPU"));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } });
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      setState("Tracking");
      const stop = () => { face.current = EMPTY_FACE; setState("Camera lost"); };
      stream.getVideoTracks()[0]!.addEventListener("ended", stop);
      let last = -1;
      const loop = () => {
        if (!v.srcObject) return;
        if (v.currentTime !== last && v.readyState >= 2) {
          last = v.currentTime;
          try {
            const r = lm.detectForVideo(v, performance.now());
            if (r.faceBlendshapes?.[0]) {
              face.current = lerpFace(face.current, toParams(r.faceBlendshapes[0].categories, r.facialTransformationMatrixes?.[0]?.data), 0.6);
            } else face.current = EMPTY_FACE;
          } catch {
            face.current = EMPTY_FACE; // any error => face not found => overlay goes black
          }
        }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      face.current = EMPTY_FACE;
      setState(e instanceof Error ? e.message : "Failed to start");
    }
  };

  return (
    <main>
      <h1>SafeVtube Tracker</h1>
      <p className="muted">
        Run this on the device with the camera. Your video stays here: only head angles and expression numbers are sent.
        If the face is lost, the stream goes black.
      </p>
      <div className="row">
        <button className="go" onClick={start}>Start camera</button>
        <span className={wsOpen ? "ok" : "bad"}>{wsOpen ? "paired with SafeVtube" : "not connected (check token / network)"}</span>
        <span>{state}</span>
      </div>
      <label className="row"><input type="checkbox" checked={showCam} onChange={(e) => setShowCam(e.target.checked)} /> Show camera preview on this device (off by default)</label>
      <div className="row">
        <canvas ref={canvas} width={320} height={320} style={{ background: "#000", borderRadius: 8 }} />
        <video ref={video} muted playsInline style={showCam ? { width: 320, borderRadius: 8, transform: "scaleX(-1)" } : { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Tracker /></StrictMode>);
