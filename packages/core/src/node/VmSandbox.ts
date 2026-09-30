import { createContext, runInContext, type Context } from "node:vm";
import type { CodeSandbox } from "../tools/CodeSandbox.ts";

/**
 * Runs generated tool code in a fresh node:vm context with no require, process, network or
 * timers. Good enough for a harness; a real device needs real isolation (PLAN.md section 13).
 */
export class VmSandbox implements CodeSandbox {
  /** One context per tool code, so a tool's top-level variables persist between calls. */
  private readonly contexts = new Map<string, Context>();

  private contextFor(code: string, timeoutMs: number, stateKey: string): Context {
    const key = `${stateKey}\u0000${code}`;
    let context = this.contexts.get(key);
    if (!context) {
      context = createContext({ JSON, Math, Date, console: { log: () => undefined } }, { codeGeneration: { strings: false, wasm: false } });
      runInContext(code, context, { timeout: timeoutMs });
      this.contexts.set(key, context);
    }
    return context;
  }

  /** Forgets all tool state (e.g. when the harness clears memory). */
  reset(): void {
    this.contexts.clear();
  }

  async run(code: string, functionName: string, args: Record<string, unknown>, timeoutMs: number, stateKey = ""): Promise<unknown> {
    const context = this.contextFor(code, timeoutMs, stateKey);
    if (typeof (context as Record<string, unknown>)[functionName] !== "function") {
      throw new Error(`The tool code does not define a function named ${functionName}`);
    }
    context.__args = JSON.parse(JSON.stringify(args));
    const pending = runInContext(`${functionName}(__args)`, context, { timeout: timeoutMs }) as unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tool code timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.resolve(pending), timeout]);
      return result === undefined ? null : (JSON.parse(JSON.stringify(result)) as unknown);
    } finally {
      clearTimeout(timer);
    }
  }
}
