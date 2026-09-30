# agent-test-harness

A harness for designing and testing a next-generation personal agent. It contains an LLM reasoning loop (Claude Opus 5.5 first, with Gemini as a fallback), graph memory, tools the agent can discover, simulated ambient data, and a simulated phone Experience with Memory, Tools, Data and Traces panels for inspecting it.

- **[PLAN.md](PLAN.md)**: the full build plan (architecture, data model, testing strategy, milestones)
- **[docs/brief.md](docs/brief.md)**: the original "Agent OS - Quintessa" brief

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | Types (one per file in `src/types/`), output-schema registry, provider JSON Schema conversion, and later the loop, memory and tools |
| `packages/capabilities` | Capability Markdown files (`capabilities/*.md`), system prompts (`prompts/*.md`) and their loader |
| `apps/web/server` | Dev server with the model proxy (`POST /api/model/:provider`), so API keys never reach the browser |

## Commands

```bash
npm install
npm run check      # typecheck + lint + tests (what CI runs)
npm test           # unit tests only, no network
npm run test:live  # live model calls; needs ANTHROPIC_API_KEY / GEMINI_API_KEY and costs money
npm run server -w @harness/web   # model proxy on http://127.0.0.1:8787
```

Node runs the TypeScript sources directly (type stripping), so `tsconfig.json` sets `erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties.

Copy `.env.example` to `.env` for local keys. Never commit keys.

## Status

M0 (scaffold), M1 (data model) and M2 (loop core) are done. See PLAN.md section 12 for the milestones.

M2 includes:
- the Claude and Gemini adapters
- the resting runner (backoff, retry-after, resting and probing, auth skip, cross-provider fallback, and a time budget per call)
- the trigger router
- the reasoning loop, with pause and resume for UI questions
- the trace store
- the model proxy

Live checks: all seven output schemas are accepted by both Claude Opus 5.5 and Gemini 3.8 Flash, and an end-to-end loop on Claude reads memory, asks the user, and pauses.
