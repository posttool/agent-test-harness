/**
 * Runs generated tool code with no ambient permissions (PLAN.md section 6.4). The code
 * defines one async function per tool function; the sandbox calls one by name with the
 * arguments and returns its JSON-serializable result.
 */
export interface CodeSandbox {
  /** `stateKey` (the tool id) keeps the tool's top-level state between calls. */
  run(code: string, functionName: string, args: Record<string, unknown>, timeoutMs: number, stateKey?: string): Promise<unknown>;
}
