import { useCallback, useEffect, useRef, useState } from "react";

/** Mic level meter. `ok` is true only while the track is live, unmuted, and the context is running. */
export function useMic() {
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const level = useRef(0);
  const okRef = useRef(false);
  const cleanup = useRef<() => void>(() => {});

  const start = useCallback(async (deviceId?: string) => {
    cleanup.current();
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const track = stream.getAudioTracks()[0]!;
      const tick = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        level.current = Math.sqrt(sum / buf.length);
        const healthy = track.readyState === "live" && !track.muted && ctx.state === "running";
        okRef.current = healthy;
        setOk((p) => (p === healthy ? p : healthy));
      }, 50);
      cleanup.current = () => {
        clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        level.current = 0;
        okRef.current = false;
        setOk(false);
      };
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
    } catch (e) {
      okRef.current = false;
      setOk(false);
      setError(e instanceof Error ? e.message : "Microphone access failed");
    }
  }, []);

  useEffect(() => () => cleanup.current(), []);
  return { ok, okRef, level, error, devices, start };
}
