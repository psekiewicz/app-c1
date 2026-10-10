import type { ClientMessage, ServerMessage } from "@safevtube/shared";

/** Auto-reconnecting WebSocket. Callers must treat "disconnected" as unsafe. */
export function connect(
  role: "dashboard" | "overlay" | "tracker",
  onMessage: (m: ServerMessage) => void,
  onOpen: (open: boolean) => void,
  query = "",
) {
  let ws: WebSocket | null = null;
  let closed = false;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws${query}`);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: "hello", role } satisfies ClientMessage));
      onOpen(true);
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      onOpen(false);
      if (!closed) setTimeout(open, 1000);
    };
  };
  open();
  return {
    send: (m: ClientMessage) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
    close: () => {
      closed = true;
      ws?.close();
    },
  };
}
