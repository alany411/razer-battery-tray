import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delayedRun } from "./delayed-run.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delayedRun", () => {
  it("runs once the delay has passed", () => {
    const run = vi.fn<() => void>();
    const later = delayedRun(5000, run);

    later.schedule();
    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(run).toHaveBeenCalledOnce();
  });

  it("runs once for a burst of events, the delay counted from the last", () => {
    const run = vi.fn<() => void>();
    const later = delayedRun(5000, run);

    later.schedule();
    vi.advanceTimersByTime(3000);
    later.schedule();
    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(10_000);

    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run once cancelled", () => {
    const run = vi.fn<() => void>();
    const later = delayedRun(5000, run);

    later.schedule();
    later.cancel();
    vi.advanceTimersByTime(10_000);

    expect(run).not.toHaveBeenCalled();
  });
});
