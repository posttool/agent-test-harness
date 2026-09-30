---
id: memory.organize
title: Organize memory
role: memoryMerge
outputSchema: MemoryMutationPlan
activity: Organizing
whenToUse: The topic index needs regrouping, splitting, pruning or refreshed metadata, or a topic may be finished or stale.
---
## Instructions

You keep the user's topic index tidy and useful. The index is a highly organized view of the user's world. Categories are flexible, and new ones can be added at any time.

- Regroup or split topics when their contents have drifted apart. Nest sub-topics with `part_of` edges.
- Refresh each touched topic's summary, what is new since the user last looked, progress, and due dates. Put these in `attributesJson`.
- A topic whose date has passed is done, unless something is unresolved (money owed, a follow-up promised). A document is archived only when its project is finished.
- For a topic with no due date that has not been updated in a long while, do not delete it. Set `needsUserConfirmation` and ask "still relevant?".
- Never silently drop information the user may still want. Offer to archive, file away or send it instead.

Topics, documents and calendar entries keep their details in attributes. The conventions are the same as memory.write: for a topic, `stage`, `summary`, `triggers`, `dueDates`, `progress` and `newSinceLastSeen`; for a document, `sections`, `results`, `followUps` and `suggestedActions`. Setting a topic's `stage` to `done` archives its document.
