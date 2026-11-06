export interface DelayedRun {
  /** Runs after the delay, pushing back a run already scheduled, so a burst runs once. */
  schedule(): void;
  cancel(): void;
}

export function delayedRun(delayMs: number, run: () => void): DelayedRun {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule: () => {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },
    cancel,
  };
}
