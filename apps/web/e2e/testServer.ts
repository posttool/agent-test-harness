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
    elements: [{ kind: "choice", id: "color", label: "Pick one", text: null, items: ["Blue", "Green"], value: null, url: null, progress: null, fieldType: null }],
  },
};
claude.handler = (req: ProviderRequest): ScriptedReply => {
  const last = req.context.at(-1);
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
      return { value: { islandWords: null, brief: [], discover: [], spaceDocumentIds: [], rationale: "nothing yet" } };
    default:
      throw new Error(`test server has no reply for ${req.schemaName}`);
  }
};

const runtime = await createNodeRuntime({ root, env: {}, clients: { claude } });
const { server } = createHarnessServer({ runtime, staticDir: join(here, "..", "dist") });
runtime.start();
server.listen(Number(process.env.PORT ?? 8790), "127.0.0.1", () => console.log("test harness ready"));
