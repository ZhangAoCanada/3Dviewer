import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStallWatchdog } from '../src/core/watchdog';

afterEach(() => {
  vi.useRealTimers();
});

describe('createStallWatchdog', () => {
  it('fires once when nothing kicks it', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    createStallWatchdog(90_000, onStall);
    vi.advanceTimersByTime(89_999);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(90_000);
    expect(onStall).toHaveBeenCalledOnce();
  });

  it('postpones the stall when kicked', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const watchdog = createStallWatchdog(1_000, onStall);
    vi.advanceTimersByTime(900);
    watchdog.kick();
    vi.advanceTimersByTime(900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onStall).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(onStall).toHaveBeenCalledOnce();
  });
});
