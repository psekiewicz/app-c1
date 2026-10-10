import test from "node:test";
import assert from "node:assert/strict";
import { TalkDetector, blackoutReason, overlayShouldShow, DASHBOARD_STALE_MS, FACE_STALE_MS, EMPTY_FACE } from "./index";
import type { DashboardFrame } from "./index";

const frame = (o: Partial<DashboardFrame> = {}): DashboardFrame => ({
  type: "frame", armed: true, micOk: true, panic: false, talking: false, expressionId: "neutral", ...o,
});

test("live only when every condition holds", () => {
  assert.equal(blackoutReason({ frame: frame(), receivedAt: 1000 }, 1100), null);
});

test("fails closed on every missing condition", () => {
  const at = 1000;
  assert.ok(blackoutReason(null, at));
  assert.ok(blackoutReason({ frame: frame(), receivedAt: at }, at + DASHBOARD_STALE_MS + 1));
  assert.ok(blackoutReason({ frame: frame({ panic: true }), receivedAt: at }, at));
  assert.ok(blackoutReason({ frame: frame({ armed: false }), receivedAt: at }, at));
  assert.ok(blackoutReason({ frame: frame({ micOk: false }), receivedAt: at }, at));
});

test("overlay watchdog blacks out on stale data", () => {
  assert.equal(overlayShouldShow(true, 0, 1000), true);
  assert.equal(overlayShouldShow(true, 0, 10_000), false);
  assert.equal(overlayShouldShow(false, 0, 100), false);
});

test("talk detector has attack and release hysteresis", () => {
  const d = new TalkDetector(0.1, 200);
  assert.equal(d.update(0.05, 0), false);
  assert.equal(d.update(0.2, 10), true);
  assert.equal(d.update(0.0, 20), true); // quiet started, not released yet
  assert.equal(d.update(0.0, 150), true);
  assert.equal(d.update(0.0, 230), false);
  d.update(0.2, 300);
  assert.equal(d.update(0.09, 310), true); // between 70% and 100%: stays open
});

test("dots mode requires a fresh tracker with a detected face, not a mic", () => {
  const rec = { frame: frame({ micOk: false }), receivedAt: 1000 };
  const face = (found: boolean, at: number) => ({ params: { ...EMPTY_FACE, faceFound: found }, receivedAt: at });
  assert.equal(blackoutReason(rec, 1100, { face: face(true, 1050) }), null);
  assert.ok(blackoutReason(rec, 1100, { face: null }));
  assert.ok(blackoutReason(rec, 1100, { face: face(false, 1050) }));
  assert.ok(blackoutReason(rec, 1000 + FACE_STALE_MS + 1, { face: face(true, 1000) }));
});

import { pickAsset, bindingValue, pupilPosition, type PuppetLayer } from "./index";
const layer = (o: Partial<PuppetLayer> = {}): PuppetLayer => ({
  id: "l", name: "eyes", asset: "open.png", states: [], bindings: [], visibleWhen: [], follow: "none", depth: 0, ...o,
});
const face = (o: object = {}) => ({ ...EMPTY_FACE, faceFound: true, ...o });

test("state swaps image when its conditions hold (right eye closed -> image 3)", () => {
  const l = layer({ states: [{ id: "s", asset: "img3.png", when: [{ param: "blinkR", op: ">", value: 0.5 }] }] });
  assert.equal(pickAsset(l, face({ blinkR: 0.2 }), true), "open.png");
  assert.equal(pickAsset(l, face({ blinkR: 0.9 }), true), "img3.png");
});

test("visibleWhen hides the layer, a state without asset hides it too", () => {
  const l = layer({ visibleWhen: [{ param: "smile", op: ">", value: 0.5 }] });
  assert.equal(pickAsset(l, face({ smile: 0.1 }), true), null);
  assert.equal(pickAsset(l, face({ smile: 0.8 }), true), "open.png");
  const h = layer({ states: [{ id: "s", when: [{ param: "blinkL", op: ">", value: 0.5 }] }] });
  assert.equal(pickAsset(h, face({ blinkL: 1 }), true), null);
});

test("mirror flips head turn and gaze, not blink sides", () => {
  const l = layer({ states: [{ id: "s", asset: "turn.png", when: [{ param: "yaw", op: ">", value: 10 }] }] });
  const f = face({ yaw: (20 * Math.PI) / 180 });
  assert.equal(pickAsset(l, f, true), "turn.png");
  assert.equal(pickAsset(l, f, false), "open.png");
});

test("binding maps and clamps parameter ranges", () => {
  const b = { param: "jawOpen" as const, prop: "y" as const, inMin: 0, inMax: 1, outMin: 0, outMax: 40 };
  assert.equal(bindingValue(b, face({ jawOpen: 0.5 }), true), 20);
  assert.equal(bindingValue(b, face({ jawOpen: 2 }), true), 40);
});

test("pupil stays inside its elliptical area", () => {
  const a = { x: 100, y: 100, w: 40, h: 20 };
  assert.deepEqual(pupilPosition(a, 0, 0), { x: 120, y: 110 });
  assert.deepEqual(pupilPosition(a, 1, 0), { x: 140, y: 110 });
  const p = pupilPosition(a, 1, 1); // corner of the box is outside the ellipse -> pulled in
  assert.ok(((p.x - 120) / 20) ** 2 + ((p.y - 110) / 10) ** 2 <= 1.0001);
});
