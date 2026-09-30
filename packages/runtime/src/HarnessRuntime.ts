import {
  AgentReasoningLoop,
  AmbientEngine,
  AmbientFactory,
  ClientMessageSchema,
  DEFAULT_MODEL_POLICY,
  DeviceTool,
  HarnessSettingsSchema,
  MemoryStore,
  ModelPolicyRunner,
  SessionManager,
  SignalBridge,
  SubscriptionManager,
  ToolExecutor,
  ToolRegistry,
  TraceStore,
  VirtualClock,
  memoryWiring,
  personaBrief,
  personaDaySource,
  randomIds,
  systemClock,
  toolWiring,
  type AmbientTemplate,
  type CapabilitySpec,
  type ClientMessage,
  type CodeSandbox,
  type ContextBlock,
  type ContextProvider,
  type HarnessSettings,
  type HarnessSnapshot,
  type IdGenerator,
  type PersonaSource,
  type PersonaSummary,
  type ProviderClient,
  type ProviderId,
  type ReasoningSession,
  type Signal,
  type StorageAdapter,
  type ToolProposal,
  type TraceEntry,
  type UiFeedback,
  type WebBackend,
} from "@harness/core";

export interface RuntimeOptions {
  storage: StorageAdapter;
  clients: Partial<Record<ProviderId, ProviderClient>>;
  capabilities: CapabilitySpec[];
  prompts: { loop: string; router: string };
  sandbox?: CodeSandbox;
  web?: WebBackend;
  mcp?: (endpoint: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;
  personas?: PersonaSource;
  templates?: AmbientTemplate[];
  toolSuggestions?: ToolProposal[];
  ids?: IdGenerator;
  /** Virtual time the harness starts at (defaults to now). */
  start?: number;
  /** Refresh the device surfaces after sessions end (costs one model call each time). */
  autoRefreshSurfaces?: boolean;
}

type Listener = () => void;

const SETTINGS_ID = "settings";

/**
 * The whole agent OS in one object: loop, memory, tools, ambient data, persona playback and
 * the device. The harness server hosts one and every connected client drives it, so memory
 * and reasoning are available from any device (PLAN.md M9).
 */
export class HarnessRuntime {
  readonly clock: VirtualClock;
  readonly runner: ModelPolicyRunner;
  readonly memory: MemoryStore;
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly subscriptions: SubscriptionManager;
  readonly ambient: AmbientEngine;
  readonly factory: AmbientFactory;
  readonly bridge: SignalBridge;
  readonly device: DeviceTool;
  readonly sessions: SessionManager;
  readonly traces: TraceStore;
  readonly loop: AgentReasoningLoop;

  private settings: HarnessSettings;
  private readonly o: RuntimeOptions;
  private readonly ids: IdGenerator;
  private readonly listeners = new Set<Listener>();
  private readonly traceListeners = new Set<(entries: TraceEntry[], reset: boolean) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private busy = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private persona: { id: string; name: string; date: string; brief: string } | null = null;
  private personaList: PersonaSummary[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  clientCount = 0;

  constructor(options: RuntimeOptions) {
    this.o = options;
    this.ids = options.ids ?? randomIds;
    this.settings = HarnessSettingsSchema.parse({ policy: DEFAULT_MODEL_POLICY });
    this.clock = new VirtualClock(options.start ?? Date.now(), 1);
    this.runner = new ModelPolicyRunner({ clients: options.clients, policy: this.settings.policy, clock: systemClock });
    this.memory = new MemoryStore(options.storage, this.clock, this.ids);
    this.registry = new ToolRegistry(options.storage, this.clock, this.ids);
    this.device = new DeviceTool({ runner: this.runner, memory: this.memory, clock: this.clock, ids: this.ids });
    this.ambient = new AmbientEngine({ storage: options.storage, clock: this.clock, ids: this.ids });
    this.factory = new AmbientFactory(this.runner, this.ids);
    this.ambient.setExtender((source) => this.factory.extend(source, this.persona?.brief ?? null));
    this.subscriptions = new SubscriptionManager({ storage: options.storage, runner: this.runner, ambient: this.ambient, memory: this.memory, clock: this.clock, ids: this.ids });
    this.executor = new ToolExecutor({
      registry: this.registry,
      storage: options.storage,
      runner: this.runner,
      clock: this.clock,
      ids: this.ids,
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      ...(options.mcp ? { mcp: options.mcp } : {}),
      builtins: {
        "web.search": (args) => this.requireWeb().search(String(args.query)),
        "web.fetch": (args) => this.requireWeb().fetch(String(args.url)),
        "device.notify": (args) => ({ shown: this.device.notice(String(args.text)).id }),
        "device.open_space": async (args) => ({ opened: await this.device.openDocument(String(args.documentId)) }),
      },
    });
    this.bridge = new SignalBridge({ clock: this.clock, send: (s) => this.dispatch(s), windowSeconds: this.settings.signalWindowSeconds, ids: this.ids });
    this.ambient.onEvent(async (event, source) => {
      if (event.kind === "tool_progress" && source.ownerSubscriptionId) await this.subscriptions.onEvent(event, source.ownerSubscriptionId);
      this.bridge.accept(event, source);
      if (event.kind === "location") this.device.setLocation(event.content);
    });

    const memory = memoryWiring(this.memory, { now: () => this.now() });
    const tools = toolWiring({ registry: this.registry, executor: this.executor, subscriptions: this.subscriptions, ...(options.web ? { web: options.web } : {}) });
    const providers: Record<string, ContextProvider> = { ...memory.contextProviders };
    for (const [id, provider] of Object.entries(tools.contextProviders)) {
      const first = providers[id];
      providers[id] = first ? async (s, i) => [...(await first(s, i)), ...(await provider(s, i))] : provider;
    }
    this.sessions = new SessionManager(this.clock, this.ids);
    this.traces = new TraceStore(this.clock, this.ids);
    this.loop = new AgentReasoningLoop({
      runner: this.runner,
      capabilities: options.capabilities,
      prompts: options.prompts,
      effects: { ...memory.effects, ...tools.effects },
      contextProviders: providers,
      onResume: tools.onResume,
      onUiRequest: (request, context) => void this.device.show(request, context),
      addressedSession: (signal) => this.subscriptions.sessionFor(signal.subscriptionId),
      sessions: this.sessions,
      traces: this.traces,
      clock: this.clock,
      ids: this.ids,
    });

    const activity = new Map(options.capabilities.map((c) => [c.id, c.activity]));
    this.traces.subscribe((entry) => {
      if (entry.kind === "step_start") this.device.setIsland(true, activity.get(String(entry.data.capability)) ?? "Working");
      if (entry.kind === "decision" || entry.kind === "route") this.device.setIsland(true, "Thinking");
      for (const l of this.traceListeners) l([entry], false);
      this.changed();
    });
    options.storage.subscribe(() => this.changed());
    this.device.onChange(() => this.changed());
  }

  // ---------- lifecycle ----------

  async init(): Promise<void> {
    const stored = await this.o.storage.get<HarnessSettings & { id: string }>("settings", SETTINGS_ID);
    if (stored) {
      const { id: _id, ...rest } = stored;
      this.applySettings(HarnessSettingsSchema.parse(rest));
    }
    this.personaList = (await this.o.personas?.listPersonas().catch(() => [])) ?? [];
  }

  /** Starts the real-time ticker that drives virtual time and ambient emission. */
  start(tickMs = 250): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(tickMs), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Advances virtual time, emits due ambient events and flushes the signal batch. */
  async tick(realMs: number): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.clock.advanceReal(realMs);
      await this.ambient.tick();
      this.bridge.flush();
    } finally {
      this.ticking = false;
    }
  }

  /** Resolves when every signal in flight has been handled (for tests and evals). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  // ---------- commands ----------

  async handle(message: ClientMessage | unknown): Promise<void> {
    const m = ClientMessageSchema.parse(message);
    switch (m.type) {
      case "user_text":
        return void this.sendUserText(m.text, m.source);
      case "ui_feedback":
        return void this.sendFeedback(m.feedback, m.said);
      case "device":
        return this.device.setLocked(m.action === "lock");
      case "seen":
        return this.memory.markSeen(m.topicId);
      case "dismiss": {
        const item = [...this.device.snapshot().brief, ...this.device.snapshot().discover].find((i) => i.id === m.itemId);
        this.device.dismiss(m.itemId);
        // Swipe-to-dismiss (PLAN.md section 5.3): the agent may discreetly ask why and record an override.
        if (item?.topicId) void this.sendSignal("user_text", "brief swipe", `The user swiped away "${item.component.title ?? "an item"}" (topic ${item.topicId}) from the Contextual Brief.`);
        return;
      }
      case "open_document":
        return void (await this.device.openDocument(m.documentId));
      case "clear":
        return this.clear();
      case "settings":
        return this.updateSettings({
          ...(m.policy ? { policy: m.policy } : {}),
          ...(m.theme ? { theme: m.theme } : {}),
          ...(m.signalWindowSeconds !== undefined ? { signalWindowSeconds: m.signalWindowSeconds } : {}),
        });
      case "ambient_global":
        if (m.enabled !== undefined) this.ambient.enabled = m.enabled;
        if (m.speed !== undefined) this.clock.speed = m.speed;
        return this.changed();
      case "ambient_add_template":
        return this.addTemplate(m.templateId);
      case "ambient_vibe":
        return void (await this.ambient.addSource(await this.factory.fromDescription(m.description, this.persona?.brief ?? null)));
      case "ambient_update":
        return this.ambient.updateSource(m.sourceId, { ...(m.enabled !== undefined ? { enabled: m.enabled } : {}), ...(m.speed !== undefined ? { speed: m.speed } : {}) });
      case "ambient_remove":
        return this.ambient.removeSource(m.sourceId);
      case "tool_add":
        return void (await this.registry.registerProposal(m.proposal, null, "harness"));
      case "tool_add_suggestion": {
        const proposal = this.o.toolSuggestions?.find((t) => t.name === m.name);
        if (!proposal) throw new Error(`No tool suggestion named ${m.name}`);
        return void (await this.registry.registerProposal(proposal, null, "suggestion"));
      }
      case "tool_delete":
        return this.registry.delete(m.toolId);
      case "persona_start":
        return this.startPersona(m.personaId);
      case "persona_stop":
        return this.stopPersona();
      case "refresh_surfaces":
        return void (await this.device.refresh(this.now()));
    }
  }

  sendUserText(text: string, source = "home input bar"): Promise<ReasoningSession | null> {
    return this.dispatch(this.signal("user_text", source, text));
  }

  /** Sends any kind of signal (messages, location, vision…), as evals and tests do. */
  sendSignal(kind: Signal["kind"], source: string, content: string): Promise<ReasoningSession | null> {
    return this.dispatch(this.signal(kind, source, content));
  }

  sendFeedback(feedback: UiFeedback, said = ""): Promise<ReasoningSession | null> {
    this.device.resolve(feedback.context.uiRequestId);
    return this.dispatch({
      ...this.signal("ui_feedback", "experience", said || feedback.action),
      data: { feedback },
      sessionId: feedback.context.sessionId,
      uiRequestId: feedback.context.uiRequestId,
    });
  }

  /** Clears memory, tools, data subscriptions, traces and the device. Settings survive. */
  async clear(): Promise<void> {
    this.stopPersonaState();
    await this.ambient.clear();
    this.bridge.clear();
    await this.o.storage.clear();
    await this.saveSettings();
    this.sessions.clear();
    this.traces.clear();
    this.device.reset();
    for (const l of this.traceListeners) l([], true);
    this.changed();
  }

  async startPersona(personaId: string): Promise<void> {
    const source = this.o.personas;
    if (!source) throw new Error("No persona source configured");
    await this.clear();
    const persona = await source.getPersona(personaId);
    const [day] = await source.listDays(personaId);
    if (!day) throw new Error(`Persona ${personaId} has no days`);
    const observations = await source.listObservations(personaId, day.date);
    const name = String(persona.name ?? personaId);
    const { source: stream, startsAt } = personaDaySource({ id: personaId, name }, day.date, observations, this.ids);
    this.clock.set(startsAt);
    this.clock.speed = 60;
    this.persona = { id: personaId, name, date: day.date, brief: personaBrief(persona) };
    await this.ambient.addSource(stream);
    this.settings = { ...this.settings, personaId };
    await this.saveSettings();
    this.device.setLocked(true);
    this.changed();
  }

  async stopPersona(): Promise<void> {
    this.stopPersonaState();
    for (const s of await this.ambient.sources()) if (s.templateId?.startsWith("persona:")) await this.ambient.removeSource(s.id);
    this.changed();
  }

  async updateSettings(patch: Partial<HarnessSettings>): Promise<void> {
    this.applySettings(HarnessSettingsSchema.parse({ ...this.settings, ...patch }));
    await this.saveSettings();
    this.changed();
  }

  // ---------- views ----------

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onTraces(listener: (entries: TraceEntry[], reset: boolean) => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  async snapshot(): Promise<HarnessSnapshot> {
    const [nodes, edges, events, topics, documents, calendar, revisions, schemaExtensions, definitions, calls, approvals, subs, sources] = await Promise.all([
      this.memory.nodes(),
      this.memory.edges(),
      this.memory.events(200),
      this.memory.topics(),
      this.memory.documents(),
      this.memory.calendar(),
      this.memory.revisions(),
      this.memory.schemaExtensions(),
      this.registry.list(),
      this.executor.calls(),
      this.executor.approvals(),
      this.subscriptions.list(),
      this.ambient.sources(),
    ]);
    return {
      settings: this.settings,
      device: this.device.snapshot(),
      memory: { nodes, edges, events, topics, documents, calendar, revisions: revisions.slice(-200), schemaExtensions },
      tools: {
        definitions,
        calls: calls.sort((a, b) => a.at.localeCompare(b.at)).slice(-200),
        approvals,
        subscriptions: subs,
        suggestions: (this.o.toolSuggestions ?? []).map((t) => ({ name: t.name, description: t.description })),
      },
      ambient: { enabled: this.ambient.enabled, speed: this.clock.speed, virtualNow: this.clock.now(), running: this.timer !== null, sources, recentEvents: this.ambient.recentEvents().slice(-100) },
      sessions: this.sessions.list(),
      steps: this.sessions.list().flatMap((s) => this.sessions.stepsOf(s.id)),
      persona: {
        active: this.persona ? { id: this.persona.id, name: this.persona.name, date: this.persona.date } : null,
        source: this.o.personas?.name ?? "none",
        personas: this.personaList,
      },
      templates: (this.o.templates ?? []).map((t) => ({ id: t.id, name: t.name, description: t.description, kind: t.kind })),
      models: { configured: Object.keys(this.o.clients) as ProviderId[], disabled: [...this.runner.disabled], rests: this.runner.rests.snapshot(Date.now()) },
      busySessions: this.busy,
      clients: this.clientCount,
    };
  }

  /** "Now": virtual time and place, for the model. */
  now(): ContextBlock[] {
    const t = new Date(this.clock.now());
    return [
      {
        kind: "note",
        title: "Now",
        content: `${t.toISOString()} (${t.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}). Location: ${this.bridge.location ?? "unknown"}.${this.persona ? ` The user is ${this.persona.name}.` : ""}`,
      },
    ];
  }

  // ---------- internals ----------

  private requireWeb(): WebBackend {
    if (!this.o.web) throw new Error("No web backend is configured");
    return this.o.web;
  }

  private signal(kind: Signal["kind"], source: string, content: string): Signal {
    return { id: this.ids.next("signal"), kind, source, occurredAt: new Date(this.clock.now()).toISOString(), content, data: {}, sessionId: null, uiRequestId: null, subscriptionId: null };
  }

  private dispatch(signal: Signal): Promise<ReasoningSession | null> {
    this.busy++;
    this.changed();
    const run = this.loop
      .handleSignal(signal)
      .catch((error: unknown) => {
        this.traces.append({ kind: "error", data: { message: error instanceof Error ? error.message : String(error), signal } });
        return null;
      })
      .finally(() => {
        this.busy--;
        this.pending.delete(run);
        if (this.busy === 0) this.device.setIsland(false, null);
        if (this.o.autoRefreshSurfaces !== false) this.scheduleRefresh();
        this.changed();
      });
    this.pending.add(run);
    return run;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.busy > 0) return this.scheduleRefresh();
      const run = this.device.refresh(this.now()).catch((error: unknown) => {
        this.traces.append({ kind: "error", data: { message: `Surface refresh failed: ${error instanceof Error ? error.message : String(error)}` } });
      });
      this.pending.add(run);
      void run.finally(() => this.pending.delete(run));
    }, 1500);
  }

  private async addTemplate(templateId: string): Promise<void> {
    const template = this.o.templates?.find((t) => t.id === templateId);
    if (!template) throw new Error(`No ambient template ${templateId}`);
    await this.ambient.addSource(await this.factory.fromTemplate(template, this.persona?.brief ?? null));
  }

  private stopPersonaState(): void {
    this.persona = null;
    this.settings = { ...this.settings, personaId: null };
  }

  private applySettings(settings: HarnessSettings): void {
    this.settings = settings;
    this.runner.setPolicy(settings.policy);
    this.bridge.windowSeconds = settings.signalWindowSeconds;
  }

  private async saveSettings(): Promise<void> {
    await this.o.storage.put("settings", { id: SETTINGS_ID, ...this.settings });
  }

  private changed(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const l of this.listeners) l();
    }, 50);
  }
}
