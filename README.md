# agent-test-harness

A harness for designing and testing a next-generation personal agent (the "Agent OS" brief). An LLM reasoning loop, Claude Opus 5.5 first with Gemini as a fallback, maintains graph memory of the user's world, finds and uses tools, and asks the user through generated UI when it is unsure. A simulated phone (the Experience) and four inspection panels (Memory, Tools, Data, Traces) sit around it. Aura personas can play through a day in the life.

- **[PLAN.md](PLAN.md)**: the full build plan (architecture, data model, testing strategy, milestones)
- **[docs/brief.md](docs/brief.md)**: the original "Agent OS - Quintessa" brief

## Run it

```bash
npm install
cp .env.example .env         # add ANTHROPIC_API_KEY and GEMINI_API_KEY
set -a; . ./.env; set +a
npm run build -w @harness/web
npm run server -w @harness/web   # http://127.0.0.1:8787
```

Open http://127.0.0.1:8787 in one or more browsers or devices. Every client shares the same live agent and memory, which persist to `data/harness.json` (set `HARNESS_DATA` to move it). For UI development, run `npm run dev -w @harness/web` (Vite on :5173, proxying to the server).

- **Experience**: unlock the phone, then type (or speak) to the agent from Home. Questions appear in Spaces with a pointer on the Brief.
- **Persona**: pick an Aura persona in the top bar and press *Start day*. Memory is cleared, and the day's real observations stream in at 60× speed (change it in Data).
- **Clear memory** wipes memory, tools, data streams, traces and the phone. Settings survive.
- **Model settings** (the model button) sets the primary model, the fallback chain, the model and Claude effort for each role, and the resting strategy.

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | Everything platform-neutral: types (one per file), model adapters and the resting runner, the reasoning loop, memory, tools, ambient engine, persona sources, Device tool. `@harness/core/node` adds the VM sandbox and fixture loaders. |
| `packages/capabilities` | Capability Markdown files, the loop and router prompts, the loader, and the recorded-scenario runner |
| `packages/runtime` | `HarnessRuntime`, which composes everything, plus `createNodeRuntime` and `FileStorage` |
| `packages/evals` | Scenario evals on both providers with a user simulator and an LLM judge |
| `apps/web` | The React harness, the harness server (WebSocket + model proxy) and Playwright UI tests |
| `skins/default` | The phone skin, rendered in an iframe (plan for Claude Design skins: [docs/SKINS_FROM_CLAUDE_DESIGN.md](docs/SKINS_FROM_CLAUDE_DESIGN.md)) |
| `packages/dc-runtime` | Plays Claude Design `.dc.html` artboards (holes, `sc-if`, `sc-for`, `dc-import`, logic classes, tweaks, links) |
| `skins/liquid-glass` | The Liquid Glass design from Claude Design, played by the DC runtime in a sandboxed frame. Pick it under the phone. |
| `samples/` | Ambient templates, tool suggestions and eval scenarios (JSON) |
| `fixtures/` | Exported Aura personas and recorded model runs |
| `scripts/` | Persona export extractor, scenario recorder, headless persona run |

## Commands

```bash
npm run check          # typecheck + lint + unit tests (CI)
npm run test:ui        # Playwright UI tests on scripted models (CI)
npm run test:live      # live model smoke tests (costs money)
npm run eval           # live scenario evals on Claude and Gemini (costs money)
node scripts/run-persona.ts "Jamie Lee" 2        # two virtual hours of a persona's day, no UI
node scripts/record-scenario.ts math-test-prep   # re-record the replayed fixture
node scripts/extract-persona-export.ts <persona-repo>/exported-data5 fixtures/personas 3 2
```

Node runs the TypeScript sources directly (type stripping), so `tsconfig.json` sets `erasableSyntaxOnly`. Never commit keys. The persona service (`PERSONA_BASE_URL`) is used when it is reachable, with the exported fixtures as a fallback.
