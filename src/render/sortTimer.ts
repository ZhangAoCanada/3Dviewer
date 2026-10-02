/**
 * Exponential moving average of the gap between Spark sort starts.
 * A gap of 3 s or more clears the average. `ms` is null until two starts
 * land inside that window, and again once the latest start is 3 s old.
 */
export class SortIntervalTracker {
  private ema = 0;
  private primed = false;
  private previous = Number.NaN;
  private now = 0;

  sample(lastSortTime: number | undefined, now: number): void {
    this.now = now;
    if (lastSortTime == null || !Number.isFinite(lastSortTime)) return;
    if (!Number.isFinite(this.previous)) {
      this.previous = lastSortTime;
      return;
    }
    if (lastSortTime === this.previous) return;
    const delta = lastSortTime - this.previous;
    this.previous = lastSortTime;
    if (delta <= 0 || delta >= 3000) {
      this.primed = false;
      this.ema = 0;
      return;
    }
    this.ema = this.primed ? this.ema + (delta - this.ema) * 0.3 : delta;
    this.primed = true;
  }

  reset(): void {
    this.ema = 0;
    this.primed = false;
    this.previous = Number.NaN;
    this.now = 0;
  }

  get ms(): number | null {
    if (!this.primed || !Number.isFinite(this.previous)) return null;
    if (this.now - this.previous >= 3000) return null;
    return this.ema;
  }
}
