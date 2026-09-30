/** Time source, injected so the runtime can run anywhere and tests are deterministic (P5). */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    }),
};

/** A clock whose sleep advances virtual time instantly. For tests and simulations. */
export class ManualClock implements Clock {
  private time: number;
  readonly sleeps: number[] = [];

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

export function isoAt(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}
