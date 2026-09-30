# Agent OS Test Harness: Build Plan

**Codename:** Quintessa
**Status:** Plan v1. Nothing is built yet.
**Source:** "Agent OS - Quintessa" brief. This plan restates it as a buildable spec.

---

## 1. What we are building

We are building a harness for designing and testing a next-generation personal agent. It has two halves:

1. **The agent runtime.** It is a platform-neutral core and has no UI. An LLM reasoning loop takes in signals (text, speech, messages, location, camera events). It keeps a graph memory of the user's world, finds and uses tools, and asks the user for input through generated UI when it is unsure.
2. **The web harness.** This is a minimal web app that wraps a simulated phone (the **Experience** panel). It has four side panels for inspecting and driving the agent: **Memory**, **Tools**, **Data** and **Traces**. Personas from the Aura persona simulator can play through a "day in the life" against it.

**Build order (set by the brief):** data structures and tests first, then the reasoning loop, then the web app.

### Goals
- A reasoning loop that is reliable, observable and replayable, and in which the LLM makes every decision.
- A memory model organized by topic and lifecycle, where documents grow as a project moves forward.
- Tools that are data: typed function signatures with oversight levels for each function. The agent can discover them, create them and subscribe to their progress.
- A complete trace of every reasoning step, grouped by the trigger that started it.
- Memory and reasoning that can run on any device. The phone skin is one consumer of them, not the owner.

### Non-goals (v1)
- Production security, multi-tenant auth or real payments.
- Real device sensors. All of these are simulated through ambient data streams.
- Choosing the final cross-device sync backend. We define the interface and ship two adapters.

---

## 2. Rules that hold everywhere

| # | Rule | What it means in practice |
|---|------|---------------------------|
| P1 | **The LLM does the reasoning.** | No regex, keyword matching or hard-coded branching decides what the agent does. Every decision comes from a model call. Model output is **structured JSON checked against a schema** (Gemini `responseSchema` / Claude `output_config.format`), so code handles transport and validation but never interpretation. |
| P2 | **One type per file.** | Every data type (the brief's "dataclass") has its own file under `packages/core/src/types/`. No grab-bag `types.ts`. |
| P3 | **Sample data lives in separate files.** | Tool suggestions, ambient-source templates and fixtures live under `samples/` and `fixtures/` as JSON/MD, never inline in code. |
| P4 | **Memory is separate from presentation.** | `core` has no dependency on any UI or design system. The device skin reads memory only through the Device tool contract. |
| P5 | **Runs anywhere.** | `core` is pure TypeScript with no DOM and no Node-only APIs. Storage, clock and model access are injected. |
| P6 | **Start blank.** | The harness boots with empty memory, no traces, no tools beyond the built-ins and no ambient streams. Samples load only when the user asks. |
| P7 | **Survives LLM failures.** | Every model call goes through a policy layer that retries with backoff and then falls back through a configurable chain of models. |
| P8 | **Capabilities are Markdown.** | Each reasoning capability is a `.md` file (instructions plus metadata front-matter). The loop is configured with a list of capability files. |

**Model providers:** the prototype runs on **both Gemini and Claude**, and both are fully supported.
- **Claude** (Anthropic Messages API, `@anthropic-ai/sdk`): **Claude Opus 5.5 (`claude-opus-5-5`) is the primary default** for every role.
- **Gemini** (https://ai.google.dev/gemini-api/docs): Gemini 3.8 Flash (`gemini-3.8-flash`) is the first model on the other provider in the fallback chain, and can be picked for any role.

Calls use the resting strategy (§4.5): back off and retry the same model, rest a model that keeps failing, then fall back through a chain that crosses providers. A setting can change the provider and model for each role (the loop, the router, the memory merge, the Device tool, the eval judge).

---

## 3. Architecture

```
┌──────────────────────────── Web Harness (apps/web) ────────────────────────────┐
│  ┌───────────┐  ┌────────────── Experience (isolated skin, iframe) ──────────┐ │
│  │ Memory    │  │  Lock · Discover · Home · Spaces                           │ │
│  │ Tools     │  │  Dynamic Island · Contextual Brief · Intent Space          │ │
│  │ Data      │  └──────────────────────▲─────────────────┬───────────────────┘ │
│  │ Traces    │           UI render ops │                 │ UI feedback         │
│  └─────▲─────┘                         │                 ▼                     │
└────────┼───────────────────────────────┼─────────────────────────────────────────┘
         │ observe                        │
┌────────┴──────────────────── Agent Runtime (packages/core) ─────────────────────┐
│                                                                                 │
│  Signals ──► TriggerRouter ──► AgentReasoningLoop (N concurrent sessions)       │
│  (ambient,                          │  pick capability → run step → next/end    │
│   input,                            ▼                                           │
│   tool progress,          ┌─────────────────────┐   ┌──────────────────────┐    │
│   UI feedback)            │ Capabilities (.md)  │   │ ModelClient + Policy │    │
│                           │ memory.* tools.*    │──►│ retry · fallback     │    │
│                           │ ui.disambiguate     │   │ Gemini | Claude      │    │
│                           │                     │   └──────────────────────┘    │
│                           └─────────┬───────────┘                               │
│              ┌──────────────────────┼─────────────────────────┐                 │
│              ▼                      ▼                         ▼                 │
│     MemoryStore (graph)      ToolRegistry + Executor   SubscriptionManager      │
│     topics · docs · index    web · device · custom     (long-running tools)     │
│     events (audit)           oversight gates                                    │
│              │                                                                  │
│      StorageAdapter  (InMemory | IndexedDB | Firestore)                         │
└─────────────────────────────────────────────────────────────────────────────────┘
         ▲
         │ persona days / observations
   Aura persona adapter (packages/persona-sim)
```

### Packages

| Package | Responsibility |
|---------|---------------|
| `packages/core` | Types, reasoning loop, memory graph, tool registry, subscriptions, traces, model policy. No UI. |
| `packages/capabilities` | The Markdown capability files plus a loader that checks their front-matter. |
| `packages/ambient` | Ambient source definitions, the emission engine (a scheduler with speed control for each source), and templates. |
| `packages/device` | The Device tool: the render-op protocol, surface model and feedback channel. It is independent of any skin. |
| `packages/persona-sim` | Adapter for the Aura persona service (`listPersona1`, `getPersona1`, `listDaysForPersona1`, `listObservations1`). It turns persona days and observations into ambient events and makes fixtures. |
| `apps/web` | The harness UI: side panels, settings and the host for the Experience iframe. |
| `skins/default` | The default phone skin. Its CSS and markup are isolated and can be swapped out. |

**Stack:** TypeScript on Node 20+ with npm workspaces. Vitest for tests, Zod for the schemas behind every type and every LLM output, `@google/genai` for Gemini, `@anthropic-ai/sdk` for Claude, and Vite + React for `apps/web`. The Firestore adapter matches the persona project's existing Firebase setup.

---

## 4. The reasoning loop

### 4.1 Concepts

- **Signal:** anything that starts or continues reasoning, such as a user utterance, an incoming message, a location change, a vision event, a tool progress event, or UI feedback.
- **Trigger:** a signal that the `TriggerRouter` has either sent to a waiting session or used to start a new one.
- **ReasoningSession:** one chain of thought started by one trigger. It holds working context and the ordered steps.
- **ReasoningStep:** one capability run. Its input is session context plus retrieved memory. Its output is a structured result plus a `next` decision (`{capability, rationale}` or `{end: true, summary}`).
- **Capability:** a Markdown file that tells the model how to carry out one kind of step and which structured output to return.

### 4.2 Control flow

```
onSignal(signal):
  session = router.route(signal)          # LLM decides: continue a paused/active session, or start one
  loop.run(session)

loop.run(session):
  while not session.ended:
    decision = model.decide(               # structured output: NextStepDecision
        capabilities = config.capabilities,
        context      = session.context,
        memory       = memory.retrieve(session.context))   # retrieval is itself a capability call
    trace.record(decision)
    if decision.end: session.end(decision.summary); break
    result = capabilities[decision.capability].execute(session, decision.args)
    trace.record(result)
    session.context.append(result)
    if result.awaiting == "ui":            # disambiguation
        session.pause(result.uiRequestId)  # resumes when matching UiFeedback arrives
        return
```

- **Choosing the next step is always a model call** that returns a `NextStepDecision`. No code path hard-wires the order of capabilities.
- **Session memory:** every step's inputs and outputs are added to `session.context` and saved as `TraceEntry` records. Active sessions are themselves memory nodes (`active_process`), so other loops can see what is in flight.
- **Concurrency:** many sessions run at once over one shared `MemoryStore`. Writes go through the store's transaction API with optimistic versioning. Nodes carry a `version`, and a conflicting write is retried after a re-read, with the model re-merging if needed.
- **Pause and resume:** a paused session keeps its full context. The `UiFeedback` signal carries `sessionId`, `uiRequestId`, the document or UI context that was showing, and the collected form values. The loop resumes *the same session* with that feedback appended, so the answer continues the original chain rather than starting a new one.

### 4.3 Initial capabilities (`packages/capabilities/*.md`)

| File | Purpose | Structured output |
|------|---------|-------------------|
| `memory.read.md` | Pull the nodes relevant to the current context (preferences, people, routines, active documents). | `MemoryReadResult` |
| `memory.write.md` | Decide whether and how to merge new information into the graph: create, update, link, or mark stale. | `MemoryMutationPlan` |
| `memory.organize.md` | Restructure topics: regroup, split, archive, prune, recompute index metadata. | `MemoryMutationPlan` |
| `tools.discover.md` | Find tools for the need: recall existing ones, search the web, wrap an API or MCP server, or write code. | `ToolDiscoveryResult` |
| `tools.use.md` | Call a tool function subject to its oversight gate, and subscribe to progress if the call is long-running. | `ToolInvocationPlan` |
| `ui.generate.md` | Produce UI for the Experience: disambiguation, document views, brief items. | `UiRequest` |

**Capability file format:**

```markdown
---
id: memory.write
title: Write to memory
outputSchema: MemoryMutationPlan
whenToUse: New information arrived that may change what we know about the user's world.
---
## Instructions
…
## Examples
…
```

The loader checks the front-matter against a Zod schema and matches `outputSchema` to a registered type. Adding a capability means adding a file and listing it in config. No code change is needed.

### 4.4 Disambiguation rules (enforced in `ui.generate.md` and by the loop)

The agent **must** ask through UI before continuing when any of these is true:
- it is about to commit uncertain information to memory;
- it has to choose between options and memory holds no preference (for example two colors with no stored color preference);
- a tool function's oversight level requires confirmation (see §6.2), which always includes spending money.

The question is asked *before* the next step, and the session pauses until feedback arrives.

### 4.5 Model policy

`ModelPolicy` (a type) contains:
- `primary`: a `ModelRef` (`{provider: "claude" | "gemini", model, options}`). **The default is Claude Opus 5.5 (`claude-opus-5-5`).**
- `fallbacks`: an ordered list of `ModelRef`s that can cross providers. The default chain is:
  1. `claude-opus-5-5`, the primary
  2. `claude-opus-5`, the previous Claude Opus
  3. `gemini-3.8-flash`, the other provider
  4. `gemini-3.7-flash`, the previous Gemini Flash
- `roles`: optional overrides for each role (`router`, `loop`, `memoryMerge`, `device`, `judge`). Each role inherits the primary and the chain unless it is overridden.
- `effort`: Claude effort for each role. Opus 5.5 defaults to `medium`, so we always set it. Starting values: `loop: high`, `router: low`, `memoryMerge: medium`, `device: medium`, `judge: high`. M8 tunes them.
- `resting`: the retry-and-rest strategy described below.
- `timeoutMs`

#### Resting strategy (retry, rest, fall back)

"Resting" means backing off between retries, and letting a model that keeps failing rest for a while so calls skip it.

| Failure | What the runner does |
|---|---|
| 429 rate limit, 529 overloaded, 5xx, timeout, network error | Retry **the same model** with exponential backoff and full jitter: base 1 s, factor 2, cap 30 s, at most 4 attempts. A `retry-after` header takes priority over the computed delay. Each request times out after 120 s. |
| Output fails schema validation | Retry once on the same model, adding the validation error to the prompt. If that fails, go to the next model. |
| `refusal` stop reason | Don't retry. Go straight to the next model. On Claude, the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is on by default, so many refusals are handled inside the same call. |
| 400 / 404 (bad request, unknown model) | Don't retry. Go to the next model and log a config error. |
| 401 / 403 (bad or missing key) | Don't retry. Skip **every** model from that provider for the rest of the session and show the error in the UI. |

**Resting a model (circuit breaker).** After 3 failures in a row that exhausted retries on one model within 2 minutes, the model **rests** for a 60 s cooldown. During the cooldown, calls skip it and go down the chain. After the cooldown, one probe call is allowed. If the probe succeeds the model is back in rotation; if it fails, the cooldown doubles, up to 10 min. Rest state is shared by all concurrent sessions, so one struggling model doesn't slow every loop.

**Budget.** Each structured model call has a total time budget (`stepBudgetMs`, default 180 s; raised from 90 s after a live persona run where a large memory merge needed more than 60 s) across all of its retries and fallbacks, and each request's timeout is capped at whatever budget remains. When the budget runs out, the call fails, the session records the error with every attempt, and the session is marked failed.

**Switching models mid-session is safe.** Each step is a fresh request built from the session context. No provider's conversation state (Claude thinking blocks, for example) is carried from one step to the next, so falling back to a different model or provider doesn't break anything.

Every attempt, rest and fallback is traced with its provider, model, token usage, delay and cost. The web UI shows each model's rest state and can change the policy at runtime.

### 4.6 Provider adapters

`ModelClient` is the single interface the loop sees:

```ts
interface ModelClient {
  generateStructured<T>(req: {
    system: string; context: ContextBlock[]; schema: ZodType<T>;
    tools?: ToolFunction[]; images?: ImageRef[];
  }): Promise<ModelResult<T>>;   // {value, usage, provider, model, raw, stopReason}
}
```

Each provider has an adapter that turns this call into that provider's native API. **No provider-specific type leaks into `core`.**

| Concern | `GeminiClient` (`@google/genai`) | `ClaudeClient` (`@anthropic-ai/sdk`) |
|---|---|---|
| Role in the default policy | fallback (`gemini-3.8-flash`, then `gemini-3.7-flash`) | **primary** (`claude-opus-5-5`, then `claude-opus-5`) |
| Structured output | `responseMimeType: "application/json"` + `responseSchema` | `output_config.format` with a JSON schema, or `client.messages.parse()` with the Zod schema |
| Reasoning depth | model thinking config | Adaptive thinking is always on for Opus 5.5. Depth is set with `output_config.effort`, whose default is `medium`, so we set it explicitly for each role. |
| Tool calls | function declarations | `tools` with `strict: true`, and `tool_choice: auto`. Opus 5.5 rejects forced tool choice, so we use structured output when we need a guaranteed shape. |
| Prompt caching | context caching | Capability `.md` files and the system prompt go first and never change. They are marked with `cache_control`, while per-session context goes after them. `usage.cache_read_input_tokens` is traced. |
| Web built-in | Google Search grounding | The `web_search` / `web_fetch` server tools, as an alternative backend for the Web tool |
| Refusals | safety block → `refusal` | `stop_reason: "refusal"` → `refusal`. Server-side `fallbacks: "default"` is on by default. If the whole chain still refuses, the policy moves to the next model. |
| Errors | map to `timeout`, `429`, `5xx` | Typed SDK errors (`RateLimitError`, `APIError` with status 429, 529 or 5xx) mapped to the same retry classes. SDK auto-retry is turned off (`maxRetries: 0`) so that `ModelPolicyRunner` owns retries and resting. |
| Keys | `GEMINI_API_KEY` | `ANTHROPIC_API_KEY` |

In the browser, calls go through a small proxy (`apps/web/server`) so that API keys never reach the client. **Keys are never committed.** Local development reads a gitignored `.env`, whose shape is shown in `.env.example`. Cloud sessions and CI read them from environment secrets.

**Provider parity is a test requirement.** Every capability's output schema must work under both providers' structured-output modes. Some features exist on only one side (a JSON-schema keyword, image input). In those cases the Zod schema is limited to what both support. A CI check converts each schema for both providers and fails if either one rejects it.

---

## 5. Memory

### 5.1 Graph model

**Node types:** `personal_preference`, `project_context`, `ambient_state`, `tool_knowledge`, `active_process`, `document`, `topic`, `person`, `place`, `calendar_entry`.

**Edge types:** `relates_to`, `executing_for`, `part_of` (for sub-topics), `supersedes`, `mentions`, `located_at`, `scheduled_for`, `depends_on`, `conflicts_with`.

The type lists are open-ended. The model can suggest new ones, and new ones are recorded as `SchemaExtension` entries so they stay auditable.

**Raw events** (`MemoryEvent`) are stored in an append-only log for auditing. The graph is built *from* events but is not a copy of them. Each node lists the event IDs that justify it.

### 5.2 Topics and lifecycle

Topics are the top level. Each topic has sub-topics and a **lifecycle stage**: `seeded → active → waiting → completing → done → archived`. The index example from the brief is the target shape:

```
Academics            [Show mornings, at school; highlight due dates]
  History essay      [Due 6/12/2026]
  Math test prep     [In class 6/14/2026]
Dinner Plans         [New info: Jane wants to go to Zuni]
  Pick a place       [WhatsApp Jane: …]
Party Planning  ·  New Sofa  ·  Health  ·  To dos (Grocery list, Submit paperwork)  ·  Weather
```

Users or the agent can add categories at any time.

### 5.3 Index metadata (per topic, type `TopicMeta`)

| Field | Content |
|-------|---------|
| `triggers` | A list of `TriggerRule` defaults the agent reasons out. The kinds are `time`, `semantic_location`, `activity` and `observation`. Qualifiers: before, after, during; near, far, leaving, arriving; when I reach, if I don't; when X arrives. |
| `userOverrides` | A list of `TriggerOverride` rules for priority and context, such as "Top priority, 7am to midnight M-F" or "never on weekends". Overrides always beat defaults. |
| `summary` | The current summary of the topic. |
| `newSinceLastSeen` | A summary of what arrived since `lastSeenAt`, plus a novelty score used for ranking. |
| `progress` | A `Progress` record: milestones, what is done, what is next, and a "stalled" flag (the sofa case). |
| `dueDates` | `DueDate` entries, taken from signals or set by the user. Values can be exact, relative ("next week") or conditional ("before Mom arrives"). |
| `lastUpdatedAt`, `lastSeenAt` | Used for "still relevant?" prompts and pruning. |

The brief separates **keeping the index up to date** (the `memory.write` and `memory.organize` capabilities) from **reducing it to what matters now** (the contextual brief, in §8). We keep those as separate capabilities.

### 5.4 Documents

A `Document` is a set of memory nodes nested under one root, and it records a project's lifecycle (dinner delivery, a trip, the fall semester's homework, building an ADU). It holds:

- a title, a description and the topic it belongs to;
- structured sections (the "Math test prep" page is the reference: topics, per-skill progress, agentic actions, generated practice app, links, test date, relevant observations);
- **live process status** for any running tool process, updated by subscriptions;
- **results and follow-up actions** once a process finishes;
- a **history** where each action taken or completed is recorded as a `DocumentRevision`. The document itself is **archived when the project is finished**, meaning its topic reaches `done`. Until then it stays live and keeps growing.
- a **suggested actions** list, filled in by asking the tool layer "given this context, what help is available?".

Documents can be recalled on request or brought forward by the agent when something relevant changes. For example, a flight change surfaces the whole trip.

### 5.5 Calendar

The agent always keeps its own calendar (`CalendarEntry` nodes) even if the user has none. Its job is to know where the user *will* be. Dates that come in tentatively are shown as **penciled in** until the user approves them. Conflicts become `conflicts_with` edges and show up in the affected topics, for example "Dinner Plans: Jane wants Tuesday; conflicts with history test prep". An external calendar can be attached later as a tool.

### 5.6 Pruning

The `memory.organize` capability runs in the background (on a schedule and when there is spare capacity). It:
- archives topics whose dates have passed, unless something is still unresolved (such as money owed);
- offers archive, transform, file or send options through UI rather than deleting silently;
- asks "still relevant?" about stale topics that have no due date;
- marks nodes the model judges outdated with `supersedes`, then removes them once they are no longer referenced.

---

## 6. Tools

### 6.1 Definition

```ts
// packages/core/src/types/ToolDefinition.ts
ToolDefinition {
  id, name, description,
  source: "builtin" | "web_api" | "mcp" | "llm" | "generated_code",
  functions: ToolFunction[],
  provenance: { discoveredVia, createdAt, createdBySessionId },
}

// packages/core/src/types/ToolFunction.ts
ToolFunction {
  name, description,
  params: JsonSchema, returns: JsonSchema,
  oversight: OversightLevel,
  longRunning: boolean,       // if true, calls must create a Subscription
}
```

### 6.2 Oversight levels (`OversightLevel`)

1. `auto_from_memory`: the agent may fill in the arguments from memory and run the function.
2. `auto_notify`: runs automatically and tells the user afterwards.
3. `confirm`: the agent fills in the arguments, and the user confirms through UI before it runs.
4. `always_ask`: the user supplies or approves each argument.

Oversight is set per function. For example, a cart tool can have `add_to_cart` at level 1 and `checkout` at level 4. Anything that spends money is at least `confirm`.

### 6.3 Built-in tools
- **Web:** search, fetch, and download to the device. There are two interchangeable backends: Google Search grounding (Gemini) and the Claude `web_search` / `web_fetch` server tools.
- **Device:** read and write the Experience surfaces and read the simulated sensors (see §8).

### 6.4 Discovery and creation

`tools.discover` works through these options in order: recall a tool from `tool_knowledge` memory, search the web for an API or MCP server, wrap it, set up an LLM with a specific grounding, or **write code** for a new tool. Generated code runs in a sandbox (a Web Worker in the browser, `vm`/isolate on Node) and has no ambient permissions.

### 6.5 Long-running work and subscriptions

If a function is `longRunning` (ordering a ride, a delivery, a build), calling it creates a `Subscription` to a progress stream. In the harness this is an ambient source (§7). Progress events are signals that get routed back to the session that started the process, or to the document it belongs to. A snag becomes a disambiguation. When the process completes, the subscription is archived. Related controls (such as "cancel ride") appear next to the process in its document.

---

## 7. Ambient data

- **`AmbientSource`** fields: `id`, `kind` (email, sms, location, home_security, drive, vision, calendar, tool_progress, custom), `template`, emission `rate`, `enabled`, `lifecycle`.
- **Emission engine:** a virtual clock that can be sped up. Each source has its own speed setting. A global on/off switch is **on** by default, but **no streams are set up** by default.
- **Templates** (under `samples/ambient/`): incoming email, incoming SMS (grounded in an Aura persona), home security stream, drive from home to office, location changes. Each is a JSON or MD file.
- **Vibe-coded sources:** the user describes a stream, and the LLM writes a source definition that is checked against a schema and run in the same sandbox as generated tools.
- **Tool-owned sources:** the tool layer creates and deletes sources for long-running processes (§6.5).

### Persona service contract

These are the HTTP GET endpoints (CORS enabled) under `PERSONA_BASE_URL` (`https://us-central1-aura-persona.cloudfunctions.net/`), as defined in `posttool/persona` `functions/index.js`:

| Endpoint | Query | Returns |
|---|---|---|
| `listPersona1` | none | `[{id, name, occupation, city, age, image, hobbies, goals_this_week, family, apps}]` |
| `getPersona1` | `id` | the full persona document plus `id` and `days: [{id, date}]` |
| `listDaysForPersona1` | `id` | `[{id, date}]`, ordered by date |
| `listObservations1` | `id`, `date` | `[{id, date, time, device, type, senderApp, data}]`, ordered by `time` (**see the bug below**) |

**Known bug (persona repo):** `listObservations1` calls the async `_getObservations(...)` without `await`, so it sends `JSON.stringify(<Promise>)` and **always returns `{}`**. The fix is one word, `let response = await _getObservations(...)`, and then the function needs redeploying. Until that ships, `persona-sim` treats a non-array response as an error and uses exported fixtures.

`persona-sim` validates each response with a Zod schema (P1: the responses are data, not instructions) and turns observations into `AmbientEvent`s on the virtual clock, using `date` + `time`.

### Persona simulation
Choosing an Aura persona clears memory, tools and subscriptions. The `persona-sim` adapter then pulls that persona's days and observations and plays them back in order as ambient events on the virtual clock. "Clear memory" stops the simulation and resets everything. Personas also produce **test fixtures** (§10).

---

## 8. Device tool and the Experience

The Device tool is an LLM-backed tool that reasons about the device it is running on: its surfaces, screens and sensors. It receives memory state and loop output and decides how to update the surfaces. It emits **render ops**:

```ts
RenderOp = { surface: SurfaceId, op: "set" | "patch" | "remove", component: UiComponentSpec, context: UiContext }
```

`UiComponentSpec` is a small declarative component vocabulary (text, list, card, form, choice, button, progress, map, QR, link) that the skin renders. Anything the user does in the Experience comes back as `UiFeedback` carrying the original `UiContext`, so the result returns to the session that asked (§4.2).

### Surfaces
- **Dynamic Island:** always visible at the top. It shows a pulsing, glowing dot while any session is reasoning and one or two words about the current activity, and shrinks when idle.
- **Contextual Brief:** a short, glanceable list of what matters now: items relevant to time and place (the grocery list at the store, a QR code at a venue), high-priority changes, and disambiguations waiting on the user. Each item is a call to action. Tapping it opens the Intent Space.
- **Intent Space ("Spaces"):** the persistent documents and projects, shown as tabs. Disambiguations and documents appear here.

### Screens (left to right after unlock)
- **Lock:** a large time and date, the Dynamic Island and the Contextual Brief.
- **Discover:** topics the agent fills in from the user's interests and projects without being asked.
- **Home:** the Dynamic Island, the Contextual Brief, apps and tools, and a multimodal input bar.
- **Spaces:** the active projects, documents and disambiguations.

### Skin isolation
The Experience renders inside an **iframe** so its styles are fully separate from the harness. Skins (`skins/*`) implement one renderer interface for the `UiComponentSpec` vocabulary and can be swapped at runtime.

---

## 9. Web harness

The layout is a persistent Experience panel in the center with four side panels. The look is modern and minimal, and nothing distracts from the phone.

| Panel | Contents |
|-------|----------|
| **Memory** | A full view of the graph (visual graph plus a topic tree), node inspector, event audit log, and index metadata. |
| **Tools** | The tool registry: create, inspect, edit and delete tools. Shows oversight per function and active subscriptions. |
| **Data** | Ambient sources: add from a template, vibe-code a new one, per-source on/off and speed, global on/off, and an event log. |
| **Traces** | Every reasoning session, grouped by trigger, with each step expanded: prompt, model, attempts and fallbacks, structured output, timing and cost. |

**Global controls:**
- **Clear memory:** wipes memory, traces, subscriptions, the dashboard and the Experience, and stops any simulation.
- **Dark/light mode.**
- **Model settings:** provider and model for each role (default Claude Opus 5.5), Claude effort for each role, the fallback chain (which can mix providers), the resting settings (backoff, cooldown, step budget), and a live rest-state indicator for each model. A quick **A/B switch** replays the current persona day on the other provider so the two can be compared side by side in Traces.
- **Persona picker:** picks an Aura persona, clears everything, and starts the day-in-the-life simulation.
- The harness **starts blank**, with no sample data.

---

## 10. Testing strategy (built first)

1. **Schema tests.** Every type in `types/` has a Zod schema and round-trip tests. Every capability file loads and has a valid `outputSchema`.
2. **Deterministic loop tests.** `ModelClient` is an interface. The `ScriptedModelClient` returns recorded structured outputs, so we can test routing, pause and resume, concurrency conflicts, retries, fallbacks and subscriptions without network calls.
3. **Recorded fixtures.** A `RecordingModelClient` saves live Gemini and Claude responses, with the provider in the fixture key, into `fixtures/recordings/` so that tests replay real behavior.
4. **Persona fixtures.** `persona-sim` exports persona days and observations into `fixtures/personas/<id>/` for scenario tests.
5. **Scenario evals (live, opt-in).** These run whole scenarios against the real model and check outcomes with an LLM judge plus graph assertions. The scenarios are: grocery list shows at the store, test-prep document grows, dinner conflict found, sofa progress nudge, ride ordered with progress and cancel. They run with `npm run eval` and are kept out of the unit test suite. Every scenario runs on **both providers**, and results are reported side by side (pass rate, steps, latency, cost). The judge model is set separately from the model under test.
7. **Provider parity tests.** Every capability schema is converted and accepted by both providers (§4.6). Error, refusal and overload responses from each SDK map to the same retry classes.
8. **UI tests.** Playwright tests that the harness starts blank, that clear memory works, that disambiguation round-trips through the iframe, and that theme toggling works.

---

## 11. Repository layout

```
agent-test-harness/
├── PLAN.md
├── README.md
├── package.json                    # npm workspaces
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── types/              # ONE FILE PER TYPE (P2)
│   │       │   ├── Signal.ts  Trigger.ts  ReasoningSession.ts  ReasoningStep.ts
│   │       │   ├── NextStepDecision.ts  CapabilitySpec.ts  TraceEntry.ts  ModelPolicy.ts
│   │       │   ├── MemoryNode.ts  MemoryEdge.ts  MemoryEvent.ts  NodeType.ts  EdgeType.ts
│   │       │   ├── Topic.ts  TopicMeta.ts  LifecycleStage.ts  TriggerRule.ts  TriggerOverride.ts
│   │       │   ├── Progress.ts  DueDate.ts  Document.ts  DocumentRevision.ts  CalendarEntry.ts
│   │       │   ├── MemoryMutationPlan.ts  MemoryReadResult.ts  SchemaExtension.ts
│   │       │   ├── ToolDefinition.ts  ToolFunction.ts  OversightLevel.ts  ToolInvocationPlan.ts
│   │       │   ├── ToolDiscoveryResult.ts  Subscription.ts
│   │       │   ├── AmbientSource.ts  AmbientEvent.ts
│   │       │   └── UiRequest.ts  UiComponentSpec.ts  UiContext.ts  UiFeedback.ts  RenderOp.ts
│   │       ├── loop/               # AgentReasoningLoop, TriggerRouter, SessionManager
│   │       ├── memory/             # MemoryStore, StorageAdapter + InMemory/IndexedDB/Firestore
│   │       ├── tools/              # ToolRegistry, ToolExecutor, OversightGate, Sandbox
│   │       ├── model/              # ModelClient, ModelPolicyRunner, Scripted/Recording clients
│   │       │   └── providers/      # GeminiClient.ts, ClaudeClient.ts (the only files importing provider SDKs)
│   │       └── trace/              # TraceStore
│   ├── capabilities/               # *.md capability files + loader
│   ├── ambient/                    # emission engine, virtual clock
│   ├── device/                     # Device tool, render-op protocol
│   └── persona-sim/                # Aura persona adapter
├── samples/                        # P3: tool suggestions, ambient templates (JSON/MD)
├── fixtures/                       # recordings, persona exports
├── skins/default/                  # isolated phone skin
└── apps/web/                       # harness UI
```

---

## 12. Milestones

| # | Milestone | Deliverables | Done when |
|---|-----------|-------------|-----------|
| **M0** | Scaffold | Workspaces, TS config, Vitest, lint, CI, this plan | `npm test` passes in CI on an empty suite |
| **M1** | Data model | All types in `types/` with Zod schemas; capability file format and loader; the six capability `.md` files | Schema and loader tests pass |
| **M2** | Loop core | `ModelClient` interface, `GeminiClient` **and** `ClaudeClient`, `ModelPolicyRunner` (resting strategy and cross-provider fallback), `AgentReasoningLoop`, `TriggerRouter`, `TraceStore`, `ScriptedModelClient`, API-key proxy | Deterministic tests cover step selection, end, backoff, `retry-after`, resting (cooldown, probe, doubling), auth-skip, fallback, step budget and pause/resume; the parity check passes; one live smoke test per provider passes |
| **M3** | Memory | `MemoryStore` with versioned transactions, in-memory and IndexedDB adapters, topic lifecycle, `TopicMeta`, documents, calendar, pruning | Concurrent-write and merge tests pass; recorded-fixture scenario builds the Math test prep document |
| **M4** | Tools | Registry, oversight gate, web built-in, sandboxed generated tools, subscriptions | Oversight gate triggers disambiguation; a long-running tool streams progress into its document |
| **M5** | Ambient and persona | Emission engine, templates, vibe-coded sources, `persona-sim` adapter and fixtures | A persona day plays through the loop headless and produces sensible topics |
| **M6** | Device and Experience | Render-op protocol, default skin in an iframe, the four screens, Island, Brief, Spaces | Disambiguation round-trips UI to loop to UI in a Playwright test |
| **M7** | Web harness | Memory, Tools, Data and Traces panels; global controls; blank start | Every control in §9 works, with UI tests |
| **M8** | Evals | Live scenario suite, LLM judge, Gemini-vs-Claude comparison report | All §10.5 scenarios pass on both providers, with results tracked over time |
| **M9** | Cross-device | Firestore adapter so memory and reasoning are reachable from other surfaces | Two browser clients share one memory live |

---

## 13. Decisions and open questions

### Decided (2026-09-30)

| Topic | Decision |
|---|---|
| Primary model | **Claude Opus 5.5** (`claude-opus-5-5`) for every role, using the resting strategy in §4.5 |
| Fallback chain | `claude-opus-5` → `gemini-3.8-flash` → `gemini-3.7-flash`. The Gemini IDs were checked against the live Gemini models list on 2026-09-30. |
| API keys | Both are provided and both checked OK on 2026-09-30. They are stored as environment secrets or a gitignored `.env`, never in the repo. |
| Persona service | Base URL `https://us-central1-aura-persona.cloudfunctions.net/`, using the HTTP endpoints `listPersona1`, `getPersona1`, `listDaysForPersona1` and `listObservations1` |
| "The document is archived" | A document is archived when its project is finished. Until then, each action is recorded as a `DocumentRevision`. |

### Still open

1. **Network access to the persona service.** The cloud dev environment's network policy blocks `us-central1-aura-persona.cloudfunctions.net`; this was checked again on 2026-09-30 from both the container and the web fetcher. It needs to be added to the allowed domains before `persona-sim` can run live. Until then it runs against exported fixtures.
2. **`listObservations1` always returns `{}`** because of a missing `await` (§7). This needs a fix and a redeploy in `posttool/persona` before live persona playback will work.
3. **Cheaper roles.** Opus 5.5 is the default everywhere. M8 will measure whether any role (router, judge) should move to a cheaper model. That is a decision for you, not something we change automatically.
4. **Cross-device backend.** Firestore is the working choice because it matches the persona stack. Confirm, or name another.
5. **Sandbox for generated code.** Web Worker plus `vm` is enough for a harness. A real device build would need proper isolation.
6. **Swipe-to-dismiss "why?".** When the user swipes a topic away, the agent may quietly ask why and store the answer as a `TriggerOverride`. This UX pattern is in scope for M6 and M7.
7. **"Nadav's drawing" and Loom.** Those references are outside this repo. Any visual spec from them should be added under `docs/`.
