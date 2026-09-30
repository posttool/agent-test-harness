import { createContext, runInContext } from "node:vm";
import type { CodeSandbox } from "../tools/CodeSandbox.ts";

/**
 * Runs generated tool code in a fresh node:vm context with no require, process, network or
 * timers. Good enough for a harness; a real device needs real isolation (PLAN.md section 13).
 */
export class VmSandbox implements CodeSandbox {
  async run(code: string, functionName: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const context = createContext({ JSON, Math, Date, console: { log: () => undefined } }, { codeGeneration: { strings: false, wasm: false } });
    runInContext(code, context, { timeout: timeoutMs });
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
