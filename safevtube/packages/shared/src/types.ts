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

import type { PuppetLayer } from "./puppet";

export type Mode = "png" | "dots" | "model3d" | "puppet2d";

/** Modes driven by the face tracker (everything except the mic-driven PNG avatar). */
export const isTrackedMode = (m: Mode): boolean => m !== "png";

/** The 52 ARKit blendshape names (MediaPipe emits the same set). Used by 3D models with matching shape keys. */
export const ARKIT_BLENDSHAPES = [
  "browDownLeft","browDownRight","browInnerUp","browOuterUpLeft","browOuterUpRight","cheekPuff","cheekSquintLeft","cheekSquintRight",
  "eyeBlinkLeft","eyeBlinkRight","eyeLookDownLeft","eyeLookDownRight","eyeLookInLeft","eyeLookInRight","eyeLookOutLeft","eyeLookOutRight",
  "eyeLookUpLeft","eyeLookUpRight","eyeSquintLeft","eyeSquintRight","eyeWideLeft","eyeWideRight","jawForward","jawLeft","jawOpen","jawRight",
  "mouthClose","mouthDimpleLeft","mouthDimpleRight","mouthFrownLeft","mouthFrownRight","mouthFunnel","mouthLeft","mouthLowerDownLeft",
  "mouthLowerDownRight","mouthPressLeft","mouthPressRight","mouthPucker","mouthRight","mouthRollLower","mouthRollUpper","mouthShrugLower",
  "mouthShrugUpper","mouthSmileLeft","mouthSmileRight","mouthStretchLeft","mouthStretchRight","mouthUpperUpLeft","mouthUpperUpRight",
  "noseSneerLeft","noseSneerRight","tongueOut",
] as const;

export interface Settings {
  /** "png": mic-driven PNG avatar. "dots": generic dot-cloud face driven by the face tracker. */
  mode: Mode;
  dotCount: number;
  dotSize: number;
  dotColor: string;
  /** 3D model: asset id of an uploaded .glb (glTF binary). */
  model3dAsset?: string;
  modelZoom: number;
  /** Vertical framing offset, in head-heights. */
  modelY: number;
  /** Mirror yaw/roll/gaze (like a selfie camera). */
  modelMirror: boolean;
  puppet: PuppetLayer[];
  /** Rotation pivot of the 2D puppet's head layers, as a fraction of the layer canvas. */
  puppetPivotX: number;
  puppetPivotY: number;
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
  mode: "png",
  dotCount: 4000,
  dotSize: 2,
  dotColor: "#7df9ff",
  modelZoom: 1,
  modelY: 0,
  modelMirror: true,
  puppet: [],
  puppetPivotX: 0.5,
  puppetPivotY: 0.7,
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

/**
 * Abstract face parameters (all that ever leaves the tracker device).
 * No video, no landmark coordinates: just head angles (radians) and 0..1 expression weights,
 * so the user's real facial geometry cannot be reconstructed from it.
 */
export interface FaceParams {
  faceFound: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  jawOpen: number;
  blinkL: number;
  blinkR: number;
  smile: number;
  browUp: number;
  browDown: number;
  pucker: number;
  lookX: number;
  lookY: number;
  /** Full ARKit blendshape weights (0..1), for 3D models. Optional. */
  blend?: Record<string, number>;
}

export const EMPTY_FACE: FaceParams = {
  faceFound: false, yaw: 0, pitch: 0, roll: 0, jawOpen: 0, blinkL: 0, blinkR: 0,
  smile: 0, browUp: 0, browDown: 0, pucker: 0, lookX: 0, lookY: 0,
};

export interface TrackerFrame {
  type: "track";
  params: FaceParams;
}

export interface OverlayOutput {
  type: "output";
  live: boolean;
  talking: boolean;
  expressionId: string;
  /** Present only while live in dots mode. */
  face: FaceParams | null;
  settings: Settings;
}

export type TwitchStatus = "off" | "connecting" | "connected";

export interface DashboardStatus {
  type: "status";
  live: boolean;
  overlays: number;
  tracker: boolean;
  twitch: TwitchStatus;
  /** Why the output is black, for the UI. */
  reason: string;
}

export type ClientHello = { type: "hello"; role: "dashboard" | "overlay" | "tracker" };
export type ClientMessage = ClientHello | DashboardFrame | TrackerFrame;
/** Remote control from the desktop app (global hotkeys). Deliberately cannot "go live" or clear panic. */
export type ControlMessage = { type: "control"; action: "panic" } | { type: "control"; action: "expression"; id: string };
export type ServerMessage = OverlayOutput | DashboardStatus | ControlMessage | { type: "settings"; settings: Settings };
