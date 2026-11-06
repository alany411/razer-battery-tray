import { describe, expect, it } from "vitest";
import { cachedValue } from "./cached-value.js";

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: (value: T) => resolve?.(value), reject: (e: Error) => reject?.(e) };
}

describe("cachedValue", () => {
  it("holds the initial value until a read returns", () => {
    const cache = cachedValue(false, () => new Promise<boolean>(() => {}));

    void cache.refresh();

    expect(cache.get()).toBe(false);
  });

  it("holds what the last read returned", async () => {
    const cache = cachedValue(false, async () => true);

    await cache.refresh();

    expect(cache.get()).toBe(true);
  });

  it("keeps the last value when a read fails", async () => {
    let fail = false;
    const cache = cachedValue(0, async () => {
      if (fail) throw new Error("reg failed");
      return 7;
    });
    await cache.refresh();
    fail = true;

    await cache.refresh();

    expect(cache.get()).toBe(7);
  });

  it("ignores a read that started before the value was set", async () => {
    const read = deferred<boolean>();
    const cache = cachedValue(false, () => read.promise);

    const refreshing = cache.refresh();
    cache.set(true);
    read.resolve(false);
    await refreshing;

    expect(cache.get()).toBe(true);
  });

  it("ignores a read that returns after a later one", async () => {
    const reads = [deferred<number>(), deferred<number>()];
    let next = 0;
    const cache = cachedValue(0, () => reads[next++]!.promise);

    const older = cache.refresh();
    const newer = cache.refresh();
    reads[1]!.resolve(2);
    await newer;
    reads[0]!.resolve(1);
    await older;

    expect(cache.get()).toBe(2);
  });
});
