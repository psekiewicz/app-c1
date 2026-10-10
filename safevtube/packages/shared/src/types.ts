export interface Expression {
  id: string;
  name: string;
  /** Asset id (file name served from /assets/:id). */
  idleAsset?: string;
  talkAsset?: string;
  /** KeyboardEvent.key, pressed while the dashboard window is focused. */
  hotkey?: string;
  /** Twitch chat command without the "!" (e.g. "happy"). */
  twitchCommand?: string;
  /** How long a Twitch-triggered expression lasts. 0 = until replaced. */
  durationMs: number;
}

export interface Settings {
  expressions: Expression[];
  defaultExpressionId: string;
  /** Mic level (0..1 RMS) that opens the "talking" state. */
  talkThreshold: number;
  /** Mic must stay quiet this long before "talking" closes. */
  releaseMs: number;
  /** KeyboardEvent.key that instantly blacks out the overlay. */
  panicHotkey: string;
  twitchChannel: string;
  twitchCooldownMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  expressions: [{ id: "neutral", name: "Neutral", durationMs: 0 }],
  defaultExpressionId: "neutral",
  talkThreshold: 0.04,
  releaseMs: 250,
  panicHotkey: "Escape",
  twitchChannel: "",
  twitchCooldownMs: 3000,
};

/** Sent by the dashboard ~10x/second. It is the only source of "live" intent. */
export interface DashboardFrame {
  type: "frame";
  /** User explicitly pressed "Go live". Resets to false on every page load. */
  armed: boolean;
  /** Mic track is live, unmuted and the audio context is running. */
  micOk: boolean;
  /** Panic hotkey / button latched. */
  panic: boolean;
  talking: boolean;
  expressionId: string;
}

export interface OverlayOutput {
  type: "output";
  live: boolean;
  talking: boolean;
  expressionId: string;
  settings: Settings;
}

export type TwitchStatus = "off" | "connecting" | "connected";

export interface DashboardStatus {
  type: "status";
  live: boolean;
  overlays: number;
  twitch: TwitchStatus;
  /** Why the output is black, for the UI. */
  reason: string;
}

export type ClientHello = { type: "hello"; role: "dashboard" | "overlay" };
export type ClientMessage = ClientHello | DashboardFrame;
export type ServerMessage = OverlayOutput | DashboardStatus | { type: "settings"; settings: Settings };
