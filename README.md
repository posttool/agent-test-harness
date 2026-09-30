# agent-test-harness

A harness for designing and testing a next-generation personal agent. It contains an LLM reasoning loop (Claude Opus 5.5 first, with Gemini as a fallback), graph memory, tools the agent can discover, simulated ambient data, and a simulated phone Experience with Memory, Tools, Data and Traces panels for inspecting it.

- **[PLAN.md](PLAN.md)**: the full build plan (architecture, data model, testing strategy, milestones)
- **[docs/brief.md](docs/brief.md)**: the original "Agent OS - Quintessa" brief

## Layout

| Path | What it holds |
|---|---|
| `packages/core` | Types (one per file in `src/types/`), output-schema registry, provider JSON Schema conversion, and later the loop, memory and tools |
| `packages/capabilities` | Capability Markdown files (`capabilities/*.md`), system prompts (`prompts/*.md`) and their loader |

## Commands

```bash
npm install
npm run check      # typecheck + lint + tests (what CI runs)
npm test           # unit tests only, no network
npm run test:live  # live model calls; needs ANTHROPIC_API_KEY / GEMINI_API_KEY and costs money
```

Copy `.env.example` to `.env` for local keys. Never commit keys.

## Status

M0 (scaffold) and M1 (data model) are done. See PLAN.md section 12 for the milestones.
