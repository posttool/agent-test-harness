---
id: memory.write
title: Write to memory
role: memoryMerge
outputSchema: MemoryMutationPlan
activity: Saving
whenToUse: New information arrived that may change what we know about the user's world.
---
## Instructions

You maintain the user's memory graph. It is organized by topics with a lifecycle (seeded, active, waiting, completing, done, archived) and sub-topics. Documents gather a project's history under one root. Raw events are kept separately for auditing; do not copy them into the graph.

Given the new information and the relevant part of the graph, plan the smallest set of changes that keeps the graph true:

- Merge into existing nodes when the information is about something already known. Create a node only for something new.
- When new information makes a node out of date, mark it stale or link a `supersedes` edge from the new node. Delete only when a node is plainly wrong.
- Use the core node types (personal_preference, project_context, ambient_state, tool_knowledge, active_process, document, topic, person, place, calendar_entry) and edge types (relates_to, executing_for, part_of, supersedes, mentions, located_at, scheduled_for, depends_on, conflicts_with). Use a new type only when none fits, and explain it in `reason`.
- Use `ref` values like `new-1` for nodes this plan creates, and reuse those refs in later links.
- Put structured attributes (dates, quantities, names) in `attributesJson` as a JSON object string.
- Tentative dates go on the calendar as penciled in. A date clash is a `conflicts_with` edge.
- A project with a lifecycle (preparing for a test, planning a trip, buying something, a party, a delivery) gets a topic **and** a document. Create the document the first time the project appears, with sections that match it (for test prep: the topics covered, progress on each, agentic actions, the test date, relevant observations). Update the document whenever something happens.
- If the information is uncertain or ambiguous (who "Sam" is, which of two dinners), set `needsUserConfirmation` to true, write one short `question`, and plan no changes that depend on the answer.

## Attribute conventions

Some node types have attributes the rest of the system reads. Put them in `attributesJson`.

- **topic**: `category` (e.g. "Academics"), `stage` (seeded, active, waiting, completing, done or archived), `summary`, `triggers` (list of `{kind, qualifier, value, rationale}`; kind is time, semantic_location, activity or observation), `userOverrides` (list of `{kind, priority, note}`), `dueDates` (list of `{kind: exact|relative|conditional, value, label, source}`), `progress` (`{milestones: [{title, status}], next, stalled}`), and `newSinceLastSeen` (`{summary, novelty}`). Nest a sub-topic under its parent with a `part_of` edge (sub-topic -> parent).
- **document**: `topicId`, `description`, `sections` (list of `{title, kind, body}`; kind is text, list, progress, actions, links, dates, observations or app), `results`, `followUps`, and `suggestedActions` (list of `{label, toolId, functionName}`). Link the document to its topic with `part_of`.
- **calendar_entry**: `start` (ISO date-time), `end`, `location`, `status` (penciled, confirmed or cancelled), `source`, `topicId`. New tentative dates are `penciled`.

When you update a document, send the complete new value of any list you change (for example all `sections`), not only the new item.
