import WebSocket from "ws";
import type { TwitchStatus } from "@safevtube/shared";

/**
 * Minimal anonymous, read-only Twitch chat client (justinfan login, no token).
 * It can only read chat — it can never post or act as the streamer.
 */
export class TwitchChat {
  private ws: WebSocket | null = null;
  private channel = "";
  private retry: NodeJS.Timeout | null = null;
  private backoff = 1000;
  status: TwitchStatus = "off";

  constructor(private onCommand: (cmd: string, user: string) => void, private onStatus: (s: TwitchStatus) => void) {}

  setChannel(channel: string): void {
    if (channel === this.channel) return;
    this.channel = channel;
    this.stop();
    if (channel) this.connect();
  }

  private setStatus(s: TwitchStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private stop() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.removeAllListeners();
    this.ws?.terminate();
    this.ws = null;
    this.setStatus("off");
  }

  private connect() {
    this.setStatus("connecting");
    const ws = (this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443"));
    ws.on("open", () => {
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
      ws.send(`JOIN #${this.channel}`);
    });
    ws.on("message", (data) => {
      for (const line of data.toString().split("\r\n")) this.handle(line, ws);
    });
    const lost = () => {
      if (this.ws !== ws) return;
      this.setStatus("connecting");
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    ws.on("close", lost);
    ws.on("error", () => ws.terminate());
  }

  private handle(line: string, ws: WebSocket) {
    if (line.startsWith("PING")) return ws.send("PONG :tmi.twitch.tv");
    if (line.includes(" 366 ")) {
      this.backoff = 1000;
      return this.setStatus("connected");
    }
    const m = /^:(\w+)!\S+ PRIVMSG #\S+ :!(\w+)/.exec(line);
    if (m) this.onCommand(m[2]!.toLowerCase(), m[1]!);
  }
}
