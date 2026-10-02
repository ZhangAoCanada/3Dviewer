import { describe, expect, it } from 'vitest';
import { SortIntervalTracker } from '../src/render/sortTimer';

describe('SortIntervalTracker', () => {
  it('averages a steady sort interval and resets after a 5 s gap', () => {
    const tracker = new SortIntervalTracker();
    tracker.sample(0, 0);
    tracker.sample(400, 400);
    tracker.sample(800, 800);
    tracker.sample(1200, 1200);
    expect(tracker.ms).toBeCloseTo(400);
    tracker.sample(6200, 6200);
    expect(tracker.ms).toBeNull();
  });
});
