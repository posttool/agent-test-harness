import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryStorage,
  ManualClock,
  MemoryStore,
  SequentialIds,
  memoryWiring,
  renderMemory,
  type MemoryMutation,
  type MemoryMutationPlan,
} from "../src/index.ts";

const op = (o: Partial<MemoryMutation> & Pick<MemoryMutation, "op">): MemoryMutation => ({
  nodeId: null,
  ref: null,
  type: null,
  title: null,
  summary: null,
  attributesJson: null,
  edgeType: null,
  from: null,
  to: null,
  reason: "test",
  ...o,
});
const plan = (...operations: MemoryMutation[]): MemoryMutationPlan => ({ rationale: "test plan", operations, needsUserConfirmation: false, question: null });
const ctx = { sessionId: "session_1" };

let clock: ManualClock;
let store: MemoryStore;
beforeEach(() => {
  clock = new ManualClock(Date.parse("2026-05-20T08:00:00Z"));
  store = new MemoryStore(new InMemoryStorage(), clock, new SequentialIds());
});

/** The "Math test prep" page from the brief (PLAN.md section 5.4). */
const mathTestPrep = plan(
  op({ op: "create_node", ref: "academics", type: "topic", title: "Academics", attributesJson: JSON.stringify({ category: "Academics", stage: "active", triggers: [{ kind: "time", qualifier: "during", value: "mornings", rationale: "school days" }] }) }),
  op({
    op: "create_node",
    ref: "math",
    type: "topic",
    title: "Math test prep",
    summary: "Get proficient on Algebra 4 before the quiz",
    attributesJson: JSON.stringify({
      category: "Academics",
      stage: "active",
      dueDates: [{ kind: "exact", value: "2026-05-26", label: "Test date" }],
      progress: {
        milestones: [
          { title: "Equations and inequalities", status: "done" },
          { title: "Graphing", status: "not_started" },
          { title: "Substitution", status: "in_progress" },
          { title: "Elimination", status: "not_started" },
        ],
        next: "Graphing",
        stalled: false,
      },
      newSinceLastSeen: { summary: "Dr. Song posted Chapter 6", novelty: 0.6 },
    }),
  }),
  op({ op: "link", edgeType: "part_of", from: "math", to: "academics" }),
  op({
    op: "create_node",
    ref: "doc",
    type: "document",
    title: "Math test prep",
    attributesJson: JSON.stringify({
      description: "User wants proficiency on the topics for the upcoming quiz.",
      sections: [
        { title: "Topic: Algebra 4", kind: "list", body: "Equations and inequalities; Graphing; Substitution; Elimination" },
        { title: "Agentic actions", kind: "actions", body: "Generate practice questions; Test me on my knowledge" },
        { title: "Relevant observations", kind: "observations", body: "Message from Jerry: Did you finish the homework?" },
      ],
      suggestedActions: [{ label: "Generate practice questions" }],
    }),
  }),
  op({ op: "link", edgeType: "part_of", from: "doc", to: "math" }),
  op({ op: "create_node", type: "calendar_entry", title: "Math test", attributesJson: JSON.stringify({ start: "2026-05-26T09:00:00", location: "school", status: "confirmed" }) }),
);

describe("MemoryStore.applyPlan", () => {
  it("builds the Math test prep topic, document and calendar from one plan", async () => {
    const result = await store.applyPlan(mathTestPrep, ctx);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.refs)).toEqual(["academics", "math", "doc"]);

    const topics = await store.topics();
    const math = topics.find((t) => t.title === "Math test prep")!;
    expect(math.parentId).toBe(result.refs.academics);
    expect(math.documentId).toBe(result.refs.doc);
    expect(math.meta.dueDates[0]).toMatchObject({ kind: "exact", value: "2026-05-26", source: "agent" });
    expect(math.meta.progress!.next).toBe("Graphing");
    expect(math.meta.newSinceLastSeen!.novelty).toBe(0.6);
    expect(topics.find((t) => t.title === "Academics")!.meta.triggers[0]!.value).toBe("mornings");

    const [doc] = await store.documents();
    expect(doc).toMatchObject({ topicId: result.refs.math, title: "Math test prep", archivedAt: null });
    expect(doc!.sections.map((s) => s.title)).toEqual(["Topic: Algebra 4", "Agentic actions", "Relevant observations"]);
    expect(doc!.suggestedActions).toEqual([{ label: "Generate practice questions", toolId: null, functionName: null }]);
    expect(doc!.revisionIds.length).toBeGreaterThanOrEqual(2);

    expect(await store.calendar()).toMatchObject([{ title: "Math test", status: "confirmed", location: "school" }]);
    const nodes = await store.nodes();
    expect(nodes.every((n) => n.sourceEventIds.includes(result.eventId))).toBe(true);
    expect((await store.events()).map((e) => e.description)).toEqual(["test plan"]);
  });

  it("archives the document when its project is finished", async () => {
    const { refs } = await store.applyPlan(mathTestPrep, ctx);
    clock.advance(86_400_000);
    await store.applyPlan(plan(op({ op: "update_node", nodeId: refs.math!, attributesJson: JSON.stringify({ stage: "done" }) })), ctx);
    const [doc] = await store.documents();
    expect(doc!.archivedAt).toBe("2026-05-21T08:00:00.000Z");
    expect((await store.revisions(doc!.id)).at(-1)!.action).toContain("Archived");
  });

  it("merges attributes on update and removes keys set to null", async () => {
    const { refs } = await store.applyPlan(plan(op({ op: "create_node", ref: "p", type: "personal_preference", title: "Dinner", attributesJson: '{"food":"sushi","app":"DoorDash"}' })), ctx);
    await store.applyPlan(plan(op({ op: "update_node", nodeId: refs.p!, summary: "Prefers sushi", attributesJson: '{"app":null,"place":"Zuni"}' })), ctx);
    const node = await store.node(refs.p!);
    expect(node).toMatchObject({ summary: "Prefers sushi", attributes: { food: "sushi", place: "Zuni" }, version: 2 });
  });

  it("marks stale, archives, unlinks and deletes", async () => {
    const { refs } = await store.applyPlan(mathTestPrep, ctx);
    const r = await store.applyPlan(
      plan(
        op({ op: "mark_stale", nodeId: refs.doc! }),
        op({ op: "archive", nodeId: refs.academics! }),
        op({ op: "unlink", from: refs.math!, to: refs.academics!, edgeType: "part_of" }),
        op({ op: "delete", nodeId: refs.doc! }),
      ),
      ctx,
    );
    expect(r.errors).toEqual([]);
    const topics = await store.topics();
    expect(topics.find((t) => t.id === refs.academics)!.stage).toBe("archived");
    expect(topics.find((t) => t.id === refs.math)!.parentId).toBeNull();
    expect(await store.node(refs.doc!)).toBeUndefined();
    expect((await store.edges()).some((e) => e.from === refs.doc || e.to === refs.doc)).toBe(false);
  });

  it("skips invalid operations and reports them", async () => {
    const r = await store.applyPlan(
      plan(
        op({ op: "update_node", nodeId: "node_404" }),
        op({ op: "create_node", type: "topic" }),
        op({ op: "create_node", type: "person", title: "Jane", attributesJson: "[1,2]" }),
        op({ op: "link", edgeType: "relates_to", from: "x", to: "y" }),
        op({ op: "create_node", type: "person", title: "Sam" }),
      ),
      ctx,
    );
    expect(r.changes).toHaveLength(1);
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toContain("unknown node node_404");
    expect(r.errors[2]).toContain("attributesJson must be a JSON object");
  });

  it("records schema extensions for new node and edge types", async () => {
    await store.applyPlan(plan(op({ op: "create_node", ref: "a", type: "recipe", title: "Kimchi" }), op({ op: "create_node", ref: "b", type: "person", title: "Shira" }), op({ op: "link", edgeType: "taught_by", from: "a", to: "b" })), ctx);
    expect((await store.schemaExtensions()).map((e) => e.id).sort()).toEqual(["edge_type:taught_by", "node_type:recipe"]);
  });

  it("does not duplicate identical links", async () => {
    const { refs } = await store.applyPlan(mathTestPrep, ctx);
    await store.applyPlan(plan(op({ op: "link", edgeType: "part_of", from: refs.math!, to: refs.academics! })), ctx);
    expect((await store.edges()).filter((e) => e.from === refs.math && e.to === refs.academics)).toHaveLength(1);
  });

  it("retries concurrent writers so no update is lost", async () => {
    const { refs } = await store.applyPlan(plan(op({ op: "create_node", ref: "t", type: "topic", title: "Groceries" })), ctx);
    const id = refs.t!;
    const event = await store.recordEvent("mutation", "concurrent", ctx);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.updateNode(id, { attributes: { [`item${i}`]: true } }, event.id, ctx)),
    );
    const node = await store.node(id);
    expect(Object.keys(node!.attributes).sort()).toEqual(["item0", "item1", "item2", "item3", "item4"]);
    expect(node!.version).toBe(6);
  });

  it("resets new-since-last-seen when the user looks at a topic", async () => {
    const { refs } = await store.applyPlan(mathTestPrep, ctx);
    await store.markSeen(refs.math!);
    const math = (await store.topics()).find((t) => t.id === refs.math)!;
    expect(math.meta.newSinceLastSeen).toBeNull();
    expect(math.meta.lastSeenAt).toBe("2026-05-20T08:00:00.000Z");
  });
});

describe("memory view and wiring", () => {
  it("renders the topic tree, documents, calendar and other nodes with ids", async () => {
    expect(await renderMemory(store)).toBe("Memory is empty.");
    const { refs } = await store.applyPlan(mathTestPrep, ctx);
    const view = await renderMemory(store);
    expect(view).toContain(`- [${refs.academics}] Academics`);
    expect(view).toContain(`  - [${refs.math}] Math test prep`);
    expect(view).toContain("progress: 1/4 done, next: Graphing");
    expect(view).toContain("new since last seen: Dr. Song posted Chapter 6");
    expect(view).toContain("  - Topic: Algebra 4 (list)");
    expect(view).toContain("Math test (confirmed) at school");
  });

  it("applies memory.write plans and reports what changed", async () => {
    const wiring = memoryWiring(store, { now: () => [{ kind: "note", title: "Now", content: "2026-05-20 08:00 at home" }] });
    const blocks = await wiring.contextProviders["memory.write"]!({} as never, "");
    expect(blocks.map((b) => b.title)).toEqual(["Memory graph", "Now"]);
    const effect = await wiring.effects["memory.write"]!(
      { ...mathTestPrep, needsUserConfirmation: true, question: "Is the test on the 26th?" },
      { session: { id: "session_1" } } as never,
    );
    expect(effect && effect.note).toContain("Applied 6 change(s)");
    expect(effect && effect.note).toContain("Needs the user's confirmation first: Is the test on the 26th?");
  });
});
