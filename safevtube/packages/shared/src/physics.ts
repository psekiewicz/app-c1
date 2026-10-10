/**
 * Secondary-motion physics for hair and accessories (2D puppet layers).
 *
 * A layer hangs from an anchor as a chain of N segments. Each segment has a cumulative angle Φᵢ (in the head's frame)
 * that is pulled toward its parent's angle by a damped spring, so motion cascades down the chain (follow-through / whip).
 *  - Gravity: the chain's equilibrium counter-rotates against head tilt so it keeps hanging straight down in the world.
 *  - Inertia: forced by the anchor's real on-screen acceleration (head turn, nod, tilt, breathing all contribute).
 *  - Fixed 120 Hz sub-stepping makes the result independent of frame rate and stable after stalls.
 */

export type ChainDirection = "down" | "up" | "left" | "right";

export interface PhysicsParams {
  direction: ChainDirection;
  /** Bend points along the layer (1 = rigid swing like an earring, 6+ = flowing hair). */
  segments: number;
  /** Natural frequency of the springs in Hz: higher = stiffer. */
  stiffness: number;
  /** Damping ratio: 0.05 floppy, 1 = no overshoot. */
  damping: number;
  /** Strength of the push from head movement. */
  inertia: number;
  /** 0 = rigid with the head, 1 = always hangs straight down in the world. */
  gravity: number;
  /** Cumulative angle limit, degrees. */
  maxAngle: number;
  /** Idle breeze amplitude, degrees. */
  sway: number;
  /** Per-segment stiffness multiplier: <1 makes the tip looser than the root. */
  taper: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  direction: "down", segments: 5, stiffness: 3, damping: 0.25, inertia: 1, gravity: 0.8, maxAngle: 55, sway: 1, taper: 0.9,
};

export const PHYSICS_PRESETS: { label: string; params: PhysicsParams }[] = [
  { label: "Long hair", params: { ...DEFAULT_PHYSICS, segments: 7, stiffness: 2.6, damping: 0.3, taper: 0.88, sway: 1.2 } },
  { label: "Short hair", params: { ...DEFAULT_PHYSICS, segments: 3, stiffness: 5, damping: 0.4, maxAngle: 30, taper: 0.95 } },
  { label: "Ponytail", params: { ...DEFAULT_PHYSICS, segments: 6, stiffness: 3.2, damping: 0.22, inertia: 1.3, maxAngle: 70 } },
  { label: "Twin tails", params: { ...DEFAULT_PHYSICS, segments: 6, stiffness: 3, damping: 0.2, inertia: 1.2, maxAngle: 65 } },
  { label: "Ahoge / antenna", params: { ...DEFAULT_PHYSICS, direction: "up", segments: 3, stiffness: 4, damping: 0.12, gravity: 0, maxAngle: 45, sway: 2, taper: 0.8 } },
  { label: "Cat / animal ear", params: { ...DEFAULT_PHYSICS, direction: "up", segments: 2, stiffness: 7, damping: 0.18, gravity: 0, maxAngle: 25, sway: 0, inertia: 1.4 } },
  { label: "Ribbon / bow", params: { ...DEFAULT_PHYSICS, segments: 3, stiffness: 4.5, damping: 0.2, inertia: 1.1, maxAngle: 40 } },
  { label: "Earring / charm", params: { ...DEFAULT_PHYSICS, segments: 1, stiffness: 2.2, damping: 0.08, inertia: 1.6, gravity: 1, maxAngle: 80, sway: 0 } },
  { label: "Scarf / cape", params: { ...DEFAULT_PHYSICS, segments: 8, stiffness: 1.8, damping: 0.35, taper: 0.85, maxAngle: 60 } },
];

const STEP = 1 / 120;
const MAX_FRAME = 0.05;

export class ChainSim {
  /** Cumulative angle of each segment (rad), in the head's frame. */
  angle: number[] = [];
  private vel: number[] = [];

  constructor(public params: PhysicsParams) {
    this.reset();
  }

  reset() {
    const n = Math.max(1, Math.round(this.params.segments));
    this.angle = new Array(n).fill(0);
    this.vel = new Array(n).fill(0);
  }

  /**
   * @param dt     frame time in seconds
   * @param drive  angular acceleration from anchor motion (rad/s²), already scaled by `inertia`
   * @param roll   current head tilt (rad)
   * @param t      time in seconds (for the idle breeze)
   * @param phase  per-layer phase so neighbouring layers don't sway in lockstep
   */
  step(dt: number, drive: number, roll: number, t: number, phase = 0) {
    const p = this.params;
    const n = Math.max(1, Math.round(p.segments));
    if (this.angle.length !== n) this.reset();
    const lim = (p.maxAngle * Math.PI) / 180;
    const sway = ((p.sway * Math.PI) / 180) * (Math.sin(t * 0.9 + phase) * 0.6 + Math.sin(t * 1.7 + phase * 2.3) * 0.4);
    const eq = -p.gravity * roll + sway;
    let left = Math.min(Math.max(dt, 0), MAX_FRAME);
    while (left > 1e-9) {
      const h = Math.min(STEP, left);
      left -= h;
      for (let i = 0; i < n; i++) {
        const w = 2 * Math.PI * Math.max(0.05, p.stiffness) * Math.pow(p.taper, i);
        const target = i === 0 ? eq : this.angle[i - 1]!;
        const acc = -w * w * (this.angle[i]! - target) - 2 * p.damping * w * this.vel[i]! + drive;
        this.vel[i] = this.vel[i]! + acc * h;
        this.angle[i] = this.angle[i]! + this.vel[i]! * h;
        if (this.angle[i]! > lim) { this.angle[i] = lim; if (this.vel[i]! > 0) this.vel[i] = 0; }
        else if (this.angle[i]! < -lim) { this.angle[i] = -lim; if (this.vel[i]! < 0) this.vel[i] = 0; }
      }
    }
  }
}

/** Smooths a moving point and differentiates it twice, giving acceleration (px/s²) without tracker-frame jitter. */
export class AnchorTracker {
  private x = 0; private y = 0; private vx = 0; private vy = 0;
  private primed = 0;

  constructor(private tau = 0.05, private maxAccel = 30000) {}

  reset() { this.primed = 0; }

  update(px: number, py: number, dt: number): { ax: number; ay: number } {
    if (this.primed < 2 || dt <= 0) {
      if (this.primed === 0) { this.x = px; this.y = py; this.vx = this.vy = 0; }
      this.primed++;
      return { ax: 0, ay: 0 };
    }
    const k = 1 - Math.exp(-dt / this.tau);
    const nx = this.x + (px - this.x) * k, ny = this.y + (py - this.y) * k;
    const nvx = (nx - this.x) / dt, nvy = (ny - this.y) / dt;
    const c = (v: number) => Math.max(-this.maxAccel, Math.min(this.maxAccel, v));
    const ax = c((nvx - this.vx) / dt), ay = c((nvy - this.vy) / dt);
    this.x = nx; this.y = ny; this.vx = nvx; this.vy = nvy;
    return { ax, ay };
  }
}
