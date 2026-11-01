/**
 * The audio clock advances in blocks, which makes a playhead read from it stutter.
 * This glides at the song's speed between readings and steers gently back to them,
 * jumping only when the transport really moved (a seek or a loop wrap).
 */
export class PlayheadSmoother {
  private shown: number | null = null;
  private lastAt = 0;

  reset(): void {
    this.shown = null;
  }

  next(actual: number, nowMs: number, beatsPerSecond: number): number {
    if (this.shown === null) {
      this.shown = actual;
    } else {
      const glided = this.shown + ((nowMs - this.lastAt) / 1000) * beatsPerSecond;
      const error = actual - glided;
      this.shown = Math.abs(error) > 0.25 ? actual : glided + error * 0.12;
    }
    this.lastAt = nowMs;
    return this.shown;
  }
}
