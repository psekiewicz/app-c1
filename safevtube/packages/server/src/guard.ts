import type { IncomingMessage } from "node:http";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostname(hostHeader: string): string {
  // "[::1]:3939" -> "[::1]", "localhost:3939" -> "localhost"
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0]!;
}

/**
 * Blocks DNS-rebinding (Host check) and cross-site requests from random web pages
 * (Origin check). Everything this app serves is meant for the local machine only.
 */
export function isLocalRequest(req: Pick<IncomingMessage, "headers">): boolean {
  const host = req.headers.host;
  if (!host || !LOCAL_HOSTS.has(hostname(host))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!LOCAL_HOSTS.has(hostname(new URL(origin).host))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Pages/assets a remote tracker device needs. None of these contain user data. */
export function isTrackerPublicPath(p: string): boolean {
  return p === "/tracker.html" || p.startsWith("/assets/") || p.startsWith("/mediapipe/") || p.startsWith("/models/");
}
