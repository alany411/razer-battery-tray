/**
 * Wraps a task so it never runs twice at once. Asking for a run while one is in progress
 * queues exactly one more run after it, so the request is not lost.
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
      try {
        do {
          again = false;
          await task();
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
}
