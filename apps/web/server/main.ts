import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeRuntime } from "@harness/runtime/node";
import { createHarnessServer } from "./harnessServer.ts";

// The harness server. Keys come from the environment and never leave this process.
const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..", "..");
const runtime = await createNodeRuntime({ root, dataFile: process.env.HARNESS_DATA ?? join(root, "data", "harness.json") });
const { server } = createHarnessServer({ runtime, staticDir: join(here, "..", "dist"), skinsDir: join(root, "skins") });
runtime.start();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, async () => {
  const snap = await runtime.snapshot();
  console.log(`harness on http://${host}:${port}  (models: ${snap.models.configured.join(", ") || "none"}; personas: ${snap.persona.source})`);
});
