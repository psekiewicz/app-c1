import type { DashboardFrame, FaceParams } from "./types";

/** Server treats the dashboard as gone if no frame arrived within this window. */
export const DASHBOARD_STALE_MS = 3000;
/** Overlay goes black if the server stops talking to it for this long. */
export const OVERLAY_STALE_MS = 2500;
/** Face tracker must deliver fresh data this often in dots mode. */
export const FACE_STALE_MS = 1000;

export interface FrameRecord {
  frame: DashboardFrame;
  receivedAt: number;
}

export interface FaceRecord {
  params: FaceParams;
  receivedAt: number;
}

/** `face` is passed (possibly null) only in dots mode; omitted in png mode. */
export interface BlackoutOptions {
  face?: FaceRecord | null;
}

/**
 * Fail-closed decision: the avatar is shown only when EVERY condition holds.
 * Returns null when live, otherwise a human-readable reason for the blackout.
 */
export function blackoutReason(rec: FrameRecord | null, now: number, opts: BlackoutOptions = {}): string | null {
  if (!rec) return "Dashboard not connected";
  if (now - rec.receivedAt > DASHBOARD_STALE_MS) return "Dashboard connection lost";
  if (rec.frame.panic) return "Panic engaged";
  if (!rec.frame.armed) return "Not live yet (press Go live)";
  if ("face" in opts) {
    if (!opts.face || now - opts.face.receivedAt > FACE_STALE_MS) return "Face tracker disconnected";
    if (!opts.face.params.faceFound) return "Face not detected";
  } else if (!rec.frame.micOk) {
    return "Microphone unavailable";
  }
  return null;
}

/** Overlay-side watchdog: any doubt about freshness means black. */
export function overlayShouldShow(live: boolean, lastMessageAt: number, now: number): boolean {
  return live && now - lastMessageAt <= OVERLAY_STALE_MS;
}
