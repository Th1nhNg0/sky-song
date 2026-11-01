export interface Ticker {
  stop(): void;
}

const WORKER_SOURCE = `
  let timer = null;
  onmessage = (event) => {
    clearInterval(timer);
    if (event.data > 0) timer = setInterval(() => postMessage(0), event.data);
  };
`;

/**
 * Calls back at a steady rate. A worker keeps the rhythm in background tabs, where
 * browsers slow main-thread timers to one a second or less.
 */
export function createTicker(callback: () => void, intervalMs: number): Ticker {
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = callback;
    worker.postMessage(intervalMs);
    return { stop: () => worker.terminate() };
  } catch {
    const timer = window.setInterval(callback, intervalMs);
    return { stop: () => window.clearInterval(timer) };
  }
}
