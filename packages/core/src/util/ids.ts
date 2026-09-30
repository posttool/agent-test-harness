export interface IdGenerator {
  next(prefix: string): string;
}

export const randomIds: IdGenerator = {
  next: (prefix) => `${prefix}_${crypto.randomUUID()}`,
};

/** Predictable ids (`step_1`, `step_2`, ...) for tests. */
export class SequentialIds implements IdGenerator {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}
