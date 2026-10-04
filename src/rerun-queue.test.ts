import { describe, expect, it } from "vitest";
import { rerunQueue } from "./rerun-queue.js";

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve?.() };
}

describe("rerunQueue", () => {
  it("runs the task", async () => {
    let runs = 0;
    const run = rerunQueue(async () => {
      runs++;
    });

    await run();

    expect(runs).toBe(1);
  });

  it("runs once more after the current run when asked again mid-run", async () => {
    const gate = deferred();
    let runs = 0;
    const run = rerunQueue(async () => {
      runs++;
      if (runs === 1) await gate.promise;
    });

    const first = run();
    void run();
    void run();
    gate.resolve();
    await first;

    expect(runs).toBe(2);
  });

  it("keeps running after a task throws", async () => {
    let runs = 0;
    const run = rerunQueue(async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
    });

    await expect(run()).rejects.toThrow("boom");
    await run();

    expect(runs).toBe(2);
  });
});
