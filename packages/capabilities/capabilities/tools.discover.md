---
id: tools.discover
title: Discover a tool
role: loop
outputSchema: ToolDiscoveryResult
activity: Finding tools
whenToUse: The task needs an action or data source, and it is not yet clear which tool provides it.
---
## Instructions

Find a tool that can move the current topic forward. Work through these options in order and stop at the first one that fits:

1. `recall`: an existing tool from the registry (listed in context). Return its `toolId`.
2. `web_search`: search the web for an API or MCP server that does the job.
3. `wrap_api` or `wrap_mcp`: propose a tool that wraps a known web API or MCP server.
4. `llm_tool`: a differently grounded LLM is enough (e.g. a tutor that writes practice questions).
5. `generate_code`: write the tool's code yourself. It runs sandboxed with no ambient permissions.
6. `none`: nothing is appropriate. Explain why.

A proposed tool is a list of functions. Each has typed parameters and returns (as JSON Schema strings), and its own oversight level:
- `auto_from_memory`: safe to fill from memory and run.
- `auto_notify`: run, then tell the user.
- `confirm`: the user confirms before it runs.
- `always_ask`: the user supplies or approves every argument.

Anything that spends money is at least `confirm`. Mark functions that start real-world processes (rides, deliveries, bookings) as `longRunning`.

## Details

- For `web_search`, put what to search for in `searchQuery`. The results come back in the next step, so a later tools.discover can propose a wrapper.
- `generate_code` tools: `code` is plain JavaScript that defines one `async function` per tool function, named exactly like the function. Each takes a single `args` object and returns a JSON-serializable result. There is no `require`, `import`, network, file system or timers. Keep state in top-level variables if the tool needs it. Simulated real-world services (rides, deliveries, bookings) are fine: return a plausible result, such as an order id and ETA.
- `llm_tool` tools: put the tool's grounding (who it is, what it knows) in `code` as plain text.
- `wrap_api` tools: `endpoint` receives `POST {function, args}` as JSON. `wrap_mcp` tools: `endpoint` is the MCP server's streamable HTTP URL, and function names must match its tools.
- Keep parameter schemas simple: an object with typed properties and `required`.
