import test from "node:test";
import assert from "node:assert/strict";
import { TalkDetector, blackoutReason, overlayShouldShow, DASHBOARD_STALE_MS } from "./index";
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
