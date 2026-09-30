/**
 * Skin contract v1 as bindable paths, for the analyzer's prompt and for checking its plans.
 * Lists end in `[]`; their item fields follow. Keep in step with SkinViewModel.
 */
export const CONTRACT_PATHS: Record<string, string> = {
  "now.time": "virtual time, HH:MM",
  "now.date": "e.g. 'Wednesday, September 30'",
  "now.weekday": "e.g. 'Wednesday'",
  locked: "boolean",
  location: "where the user is, or empty",
  "island.active": "boolean: the agent is working",
  "island.words": "one or two words while the agent works",
  "island.process": "the newest running process (a ride, a delivery), or null",
  "island.process.label": "e.g. 'Ride to Studio 4'",
  "island.process.status": "e.g. 'driver arriving'",
  "island.process.detail": "e.g. 'Grey sedan · 7KXW219'",
  "island.process.progress": "0..1, or null",
  "island.process.eta": "e.g. '4 min'",
  "brief.headline": "the day in a few words",
  "brief.summary": "one or two sentences on the day",
  "brief.updatedAt": "ISO time of the last brief update",
  "brief.items[]": "the Contextual Brief, most important first",
  "brief.items[].title": "",
  "brief.items[].line": "one line of detail",
  "brief.items[].cta": "call to action, e.g. 'See list'",
  "brief.items[].reason": "why it is here now",
  "brief.items[].icon": "one of event, message, task, travel, place, shopping, school, health, money, weather, info, alert",
  "brief.items[].badge": "short trailing value, e.g. 'in 49m'",
  "brief.items[].kind": "item, notice or question",
  "questions[]": "blocking questions from the agent (Spaces)",
  "questions[].title": "",
  "questions[].question": "",
  "questions[].component": "a UI component spec the skin renders as a form",
  "documents[]": "project documents (Spaces tabs)",
  "documents[].title": "",
  "documents[].description": "",
  "documents[].sections[]": "",
  "documents[].sections[].title": "",
  "documents[].sections[].body": "",
  "documents[].sections[].items[]": "list lines",
  "documents[].processes[]": "running processes for the document",
  "documents[].processes[].label": "",
  "documents[].processes[].status": "",
  "documents[].processes[].detail": "",
  "documents[].results[]": "",
  "documents[].followUps[]": "",
  "documents[].actions[]": "suggested actions",
  "documents[].actions[].label": "",
  "discover[]": "related topics the user did not ask for",
  "discover[].title": "",
  "discover[].line": "",
  "discover[].cta": "",
  "discover[].icon": "",
  "discover[].badge": "",
  "today[]": "today's calendar, in time order",
  "today[].time": "HH:MM",
  "today[].title": "",
  "today[].detail": "place or note",
  "today[].kind": "event or penciled",
  "waiting[]": "messages and asks waiting on the user",
  "waiting[].who": "",
  "waiting[].when": "",
  "waiting[].text": "",
  "waiting[].cta": "",
  "apps[]": "installed tools",
  "apps[].name": "",
  "apps[].icon": "one letter",
  "needs.<id>.values.<field>": "data the skin asked the agent for (declare it under needs)",
  "needs.<id>.summary": "",
  "needs.<id>.status": "asked, ready or failed",
};

export function contractText(): string {
  return Object.entries(CONTRACT_PATHS)
    .map(([p, d]) => `- ${p}${d ? `: ${d}` : ""}`)
    .join("\n");
}

/** Normalizes `brief.items[0].title` and `brief.items.title` to `brief.items[].title`. */
function canonical(path: string): string {
  let out = "";
  let i = 0;
  while (i < path.length) {
    if (path[i] === "[") {
      const close = path.indexOf("]", i);
      out += "[]";
      i = close < 0 ? path.length : close + 1;
      continue;
    }
    out += path[i];
    i++;
  }
  return out;
}

const LISTS = Object.keys(CONTRACT_PATHS)
  .filter((p) => p.endsWith("[]"))
  .map((p) => p.slice(0, -2));

/** Whether a (slot, field) pair names a real contract path. Needs are checked against the plan's own needs. */
export function isContractPath(path: string, needIds: string[] = []): boolean {
  let p = canonical(path.trim());
  if (!p) return true;
  // Lists may be written without brackets: `brief.items.title`.
  for (const list of LISTS) if (p.startsWith(`${list}.`) && !p.startsWith(`${list}[]`)) p = `${list}[].${p.slice(list.length + 1)}`;
  if (p.startsWith("needs.")) {
    const [, id, part, field] = p.split(".");
    // An object slot (`needs.weather`, `needs.weather.values`) or one of its values.
    return !!id && needIds.includes(id) && (part === undefined || part === "summary" || part === "status" || part === "values") && (part === "values" || field === undefined);
  }
  // A path, or an object slot some paths sit under (`now`, `island.process`).
  return Object.keys(CONTRACT_PATHS).some((k) => k === p || k === `${p}[]` || k.startsWith(`${p}.`));
}

export function joinPath(slot: string, field: string): string {
  if (!slot) return field;
  if (!field) return slot;
  return LISTS.includes(canonical(slot).replace("[]", "")) || slot.endsWith("[]") ? `${slot.endsWith("[]") ? slot : `${slot}[]`}.${field}` : `${slot}.${field}`;
}
