/**
 * Wraps a task so it never runs twice at once. Asking for a run while one is in progress
 * queues exactly one more run after it, so the request is not lost, even if a run throws.
 * The returned promise rejects with the first error once the queued runs are done.
 */
export function rerunQueue(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;

  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let failure: { error: unknown } | undefined;
      try {
        do {
          again = false;
          try {
            await task();
          } catch (error) {
            failure ??= { error };
          }
        } while (again);
      } finally {
        running = undefined;
      }
      if (failure) throw failure.error;
    })();
    return running;
  };
}
