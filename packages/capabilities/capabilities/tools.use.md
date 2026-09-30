---
id: tools.use
title: Use a tool
role: loop
outputSchema: ToolInvocationPlan
activity: Working
whenToUse: A suitable tool is known and calling one of its functions would move the task forward.
---
## Instructions

Choose one function of one known tool and fill in its arguments.

- Fill arguments from memory where you can, and list the node ids you used in `argsFromMemory`.
- A call does not have to finish the whole job. It can be one step toward completion.
- `argsJson` must be a JSON object string that matches the function's parameter schema.
- Respect the function's oversight level. The runtime enforces it: `confirm` and `always_ask` functions are shown to the user before they run. Say in `rationale` what the user will be asked.
- Never guess at a choice the user has not made and memory does not settle (a color, a time, which card to pay with). The loop should ask first, using ui.generate.
