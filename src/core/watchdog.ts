export interface StallWatchdog {
  /** Push the deadline back by another full interval. */
  kick(): void;
  clear(): void;
}

/**
 * Fires `onStall` once if `kick` is not called for `ms`.
 * Constructing the watchdog arms the timer.
 */
export function createStallWatchdog(ms: number, onStall: () => void): StallWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;

  const schedule = () => {
    if (fired) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (fired) return;
      fired = true;
      onStall();
    }, ms);
  };

  schedule();
  return {
    kick: schedule,
    clear() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
