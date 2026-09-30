import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ClaudeClient,
  ClaudeWebBackend,
  FallbackPersonaSource,
  GeminiClient,
  GeminiWebBackend,
  HttpPersonaSource,
  InMemoryStorage,
  StaticPersonaSource,
  ToolProposalSchema,
  mcpCall,
  type PersonaSource,
  type ProviderClient,
  type ProviderId,
  type StorageAdapter,
  type ToolProposal,
} from "@harness/core";
import { loadAmbientTemplates, loadPersonaFixtures, VmSandbox } from "@harness/core/node";
import { loadCapabilities, loadPrompt } from "@harness/capabilities";
import { FileStorage } from "./FileStorage.ts";
import { HarnessRuntime, type RuntimeOptions } from "./HarnessRuntime.ts";

export { FileStorage };

export interface NodeRuntimeOptions {
  /** Repository root (for samples/ and fixtures/). */
  root: string;
  /** JSON file to persist to; omit for in-memory only. */
  dataFile?: string;
  env?: Record<string, string | undefined>;
  /** Replace the provider clients (tests, recordings). */
  clients?: Partial<Record<ProviderId, ProviderClient>>;
  overrides?: Partial<RuntimeOptions>;
}

export function loadToolSuggestions(dir: string): ToolProposal[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ToolProposalSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** Builds a runtime with real keys from the environment, fixtures, templates and the VM sandbox. */
export async function createNodeRuntime(options: NodeRuntimeOptions): Promise<HarnessRuntime> {
  const env = options.env ?? process.env;
  const clients: Partial<Record<ProviderId, ProviderClient>> = options.clients ?? {};
  if (!options.clients) {
    if (env.ANTHROPIC_API_KEY) clients.claude = new ClaudeClient({ apiKey: env.ANTHROPIC_API_KEY });
    if (env.GEMINI_API_KEY) clients.gemini = new GeminiClient({ apiKey: env.GEMINI_API_KEY });
  }
  const web = env.ANTHROPIC_API_KEY
    ? new ClaudeWebBackend({ apiKey: env.ANTHROPIC_API_KEY })
    : env.GEMINI_API_KEY
      ? new GeminiWebBackend({ apiKey: env.GEMINI_API_KEY })
      : undefined;
  const fixtures = new StaticPersonaSource(loadPersonaFixtures(join(options.root, "fixtures", "personas")));
  const personas: PersonaSource = env.PERSONA_BASE_URL ? new FallbackPersonaSource(new HttpPersonaSource(env.PERSONA_BASE_URL), fixtures) : fixtures;
  const storage: StorageAdapter = options.dataFile ? new FileStorage(options.dataFile) : new InMemoryStorage();
  const runtime = new HarnessRuntime({
    storage,
    clients,
    capabilities: await loadCapabilities(),
    prompts: { loop: await loadPrompt("loop"), router: await loadPrompt("router") },
    sandbox: new VmSandbox(),
    mcp: mcpCall,
    personas,
    templates: loadAmbientTemplates(join(options.root, "samples", "ambient")),
    toolSuggestions: loadToolSuggestions(join(options.root, "samples", "tools")),
    ...(web ? { web } : {}),
    ...options.overrides,
  });
  await runtime.init();
  return runtime;
}
