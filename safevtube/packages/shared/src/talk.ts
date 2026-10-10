/** Hysteresis gate: opens at `threshold`, closes after `releaseMs` below 70% of it. */
export class TalkDetector {
  private talking = false;
  private quietSince: number | null = null;

  constructor(public threshold: number, public releaseMs: number) {}

  update(level: number, now: number): boolean {
    if (level >= this.threshold) {
      this.talking = true;
      this.quietSince = null;
    } else if (this.talking && level < this.threshold * 0.7) {
      this.quietSince ??= now;
      if (now - this.quietSince >= this.releaseMs) {
        this.talking = false;
        this.quietSince = null;
      }
    } else {
      this.quietSince = null;
    }
    return this.talking;
  }
}
