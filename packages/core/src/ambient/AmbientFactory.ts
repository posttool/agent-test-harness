import type { ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import { AmbientScriptSchema, type AmbientScript } from "../types/AmbientScript.ts";
import type { AmbientScriptEvent } from "../types/AmbientScriptEvent.ts";
import type { AmbientSource } from "../types/AmbientSource.ts";
import type { ContextBlock } from "../types/ContextBlock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

/** A template for an ambient source (samples/ambient/*.json). */
export interface AmbientTemplate {
  id: string;
  kind: AmbientSource["kind"];
  name: string;
  description: string;
  /** Roughly how many events per hour of virtual time. */
  ratePerHour: number;
  /** Whether the events should be grounded in the selected persona's life. */
  personaGrounded: boolean;
  prompt: string;
}

const SYSTEM =
  "You simulate the real world for a test harness of a personal agent that lives on a phone. Write a realistic stream of events as the phone and its sensors would observe them. offsetSeconds counts from the start of the stream and increases. Write content as the device would receive it (sender, app, words). Use status info unless the event is progress of a real-world process.";

/** Creates ambient sources from templates or from a plain description ("vibe coding"), via the simulator model. */
export class AmbientFactory {
  private readonly runner: ModelPolicyRunner;
  private readonly ids: IdGenerator;

  constructor(runner: ModelPolicyRunner, ids: IdGenerator = randomIds) {
    this.runner = runner;
    this.ids = ids;
  }

  private async script(instruction: string, persona: string | null): Promise<AmbientScript> {
    const context: ContextBlock[] = [{ kind: "instruction", title: "Stream to simulate", content: instruction }];
    if (persona) context.push({ kind: "note", title: "Whose life this is", content: persona });
    return (await this.runner.run({ role: "simulator", schemaName: "AmbientScript", schema: AmbientScriptSchema, system: SYSTEM, context })).value;
  }

  private source(script: AmbientScript, templateId: string | null, ratePerHour: number, prompt: string): AmbientSource {
    return {
      id: this.ids.next("source"),
      kind: script.kind,
      name: script.name,
      templateId,
      ratePerMinute: ratePerHour / 60,
      speed: 1,
      enabled: true,
      startedAt: null,
      cursor: 0,
      lifecycle: "persistent",
      ownerSubscriptionId: null,
      definition: { description: script.description, prompt, events: script.events },
    };
  }

  async fromTemplate(template: AmbientTemplate, persona: string | null): Promise<AmbientSource> {
    const prompt = `${template.prompt}\nAbout ${template.ratePerHour} events per hour, covering the next hour.`;
    const script = await this.script(prompt, template.personaGrounded ? persona : null);
    return this.source({ ...script, kind: template.kind }, template.id, template.ratePerHour, template.prompt);
  }

  async fromDescription(description: string, persona: string | null): Promise<AmbientSource> {
    const script = await this.script(`${description}\nCover about the next hour.`, persona);
    return this.source(script, null, script.events.length, description);
  }

  /** More events for a persistent source that ran out (AmbientEngine's extender). */
  async extend(source: AmbientSource, persona: string | null): Promise<AmbientScriptEvent[]> {
    const prompt = typeof source.definition.prompt === "string" ? source.definition.prompt : source.name;
    const past = (Array.isArray(source.definition.events) ? source.definition.events : []).slice(-5);
    const script = await this.script(`${prompt}\nContinue the stream for the next hour. The last events were: ${JSON.stringify(past)}`, persona);
    return script.events;
  }
}
