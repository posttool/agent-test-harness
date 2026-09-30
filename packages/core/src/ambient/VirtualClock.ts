import type { Clock } from "../util/clock.ts";

/**
 * Simulated time for ambient data (PLAN.md section 7). It advances `speed` virtual
 * milliseconds per real millisecond while running. It also implements Clock, so memory and
 * traces can be stamped in virtual time.
 */
export class VirtualClock implements Clock {
  private virtual: number;
  speed: number;
  running = true;

  constructor(start: number, speed = 1) {
    this.virtual = start;
    this.speed = speed;
  }

  now(): number {
    return this.virtual;
  }

  /** Real time passed; advances virtual time by `realMs * speed` while running. */
  advanceReal(realMs: number): void {
    if (this.running) this.virtual += realMs * this.speed;
  }

  set(ms: number): void {
    this.virtual = ms;
  }

  /** Model calls wait in real time; virtual time does not jump for them. */
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
    });
  }
}
