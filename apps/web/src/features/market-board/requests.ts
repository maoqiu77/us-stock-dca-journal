/** Aborting is an optimization; generation identity is the correctness boundary. */
export function createRequestGate() {
  let version = 0;
  let controller: AbortController | null = null;
  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      const own = ++version;
      const signal = controller.signal;
      return { signal, isCurrent: () => own === version && !signal.aborted };
    },
    cancel() { version++; controller?.abort(); },
  };
}
