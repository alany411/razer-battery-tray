export interface CachedValue<T> {
  get(): T;
  /** Reads the value again. A failed read keeps the last value. */
  refresh(): Promise<void>;
  /** Sets the value now, e.g. after the user changed it, so reads already running are ignored. */
  set(value: T): void;
}

/**
 * A value read in the background, so whoever needs it, e.g. a tray menu as it opens, takes the
 * last known value at once instead of waiting on a slow read.
 */
export function cachedValue<T>(initial: T, read: () => Promise<T>): CachedValue<T> {
  let value = initial;
  // Bumped by every refresh and set; a read only lands if nothing came after it.
  let generation = 0;

  return {
    get: () => value,
    refresh: async () => {
      const started = ++generation;
      try {
        const next = await read();
        if (started === generation) value = next;
      } catch {
        // Keep the last value.
      }
    },
    set: (next) => {
      generation++;
      value = next;
    },
  };
}
