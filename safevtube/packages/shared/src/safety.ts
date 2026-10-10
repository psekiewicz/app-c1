import type { DashboardFrame } from "./types";

/** Server treats the dashboard as gone if no frame arrived within this window. */
export const DASHBOARD_STALE_MS = 3000;
/** Overlay goes black if the server stops talking to it for this long. */
export const OVERLAY_STALE_MS = 2500;

export interface FrameRecord {
  frame: DashboardFrame;
  receivedAt: number;
}

/**
 * Fail-closed decision: the avatar is shown only when EVERY condition holds.
 * Returns null when live, otherwise a human-readable reason for the blackout.
 */
export function blackoutReason(rec: FrameRecord | null, now: number): string | null {
  if (!rec) return "Dashboard not connected";
  if (now - rec.receivedAt > DASHBOARD_STALE_MS) return "Dashboard connection lost";
  if (rec.frame.panic) return "Panic engaged";
  if (!rec.frame.armed) return "Not live yet (press Go live)";
  if (!rec.frame.micOk) return "Microphone unavailable";
  return null;
}

/** Overlay-side watchdog: any doubt about freshness means black. */
export function overlayShouldShow(live: boolean, lastMessageAt: number, now: number): boolean {
  return live && now - lastMessageAt <= OVERLAY_STALE_MS;
}
