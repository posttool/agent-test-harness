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
