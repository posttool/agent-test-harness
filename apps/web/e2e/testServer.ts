import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptedProviderClient, type ProviderRequest, type ScriptedReply } from "@harness/core";
import { createNodeRuntime } from "@harness/runtime/node";
import { createHarnessServer } from "../server/harnessServer.ts";

// A harness server on scripted models, for deterministic UI tests.
const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..", "..");
const claude = new ScriptedProviderClient("claude");
const choice = {
  purpose: "disambiguation",
  surface: "intent_space",
  blocking: true,
  question: "Which color should the sweater be?",
  rationale: "No stored color preference",
  component: {
    kind: "choice_group",
    id: "color",
    title: "Sweater color",
    primaryActionLabel: null,
    elements: [
      { kind: "choice", id: "color", label: "Pick one", text: null, items: ["Blue", "Green"], value: null, url: null, progress: null, fieldType: null },
      { kind: "form_field", id: "note", label: "Anything else?", text: null, items: [], value: null, url: null, progress: null, fieldType: "text" },
    ],
  },
};
claude.handler = (req: ProviderRequest): ScriptedReply => {
  const last = req.context.filter((b) => !b.title?.startsWith("Tools you can use")).at(-1);
  // The skin asks for the weather when Home opens: answer it with device.fulfill_need.
  if (req.context.some((b) => b.title?.startsWith("skin_need"))) {
    switch (req.schemaName) {
      case "RouteDecision":
        return { value: { action: "new", sessionId: null, title: "Weather for the phone", rationale: "skin need" } };
      case "NextStepDecision":
        return last?.kind === "step"
          ? { value: { action: "end", capability: null, instruction: null, rationale: "filled", summary: "Filled the weather" } }
          : { value: { action: "step", capability: "tools.use", instruction: "fill the weather need", rationale: "skin asked", summary: null } };
      case "ToolInvocationPlan":
        return { value: { toolId: "device", functionName: "fulfill_need", argsJson: JSON.stringify({ needId: "weather", values: { now: "14°C", high: "17°C", low: "9°C", summary: "Rain from 6pm" }, summary: "Rain from 6pm" }), argsFromMemory: [], documentId: null, rationale: "r" } };
    }
  }
  switch (req.schemaName) {
    case "RouteDecision":
      return { value: { action: "new", sessionId: null, title: "Sweater for my sister", rationale: "new request" }, latencyMs: 0 };
    case "NextStepDecision":
      return last?.kind === "feedback"
        ? { value: { action: "end", capability: null, instruction: null, rationale: "answered", summary: `Ordering the ${last.content.includes("Blue") ? "blue" : "green"} sweater` } }
        : last?.kind === "step"
          ? { value: { action: "end", capability: null, instruction: null, rationale: "waiting", summary: "asked" } }
          : { value: { action: "step", capability: "ui.generate", instruction: "ask for the color", rationale: "no preference", summary: null } };
    case "UiRequest":
      return { value: choice };
    case "SurfacePlan":
      return { value: { islandWords: "", headline: "", summary: "", brief: [], discover: [], waiting: [], spaceDocumentIds: [], rationale: "nothing yet" } };
    default:
      throw new Error(`test server has no reply for ${req.schemaName}`);
  }
};

const runtime = await createNodeRuntime({ root, env: {}, clients: { claude } });
const { server } = createHarnessServer({ runtime, staticDir: join(here, "..", "dist") });
runtime.start();
server.listen(Number(process.env.PORT ?? 8790), "127.0.0.1", () => console.log("test harness ready"));
