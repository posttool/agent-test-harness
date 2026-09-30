import type { SkinManifest } from "@harness/core";

interface ScreenSpec {
  title: string;
  purpose: string;
  shows: string[];
  taps: string[];
  states: string[];
}

const SCREENS: Record<string, ScreenSpec> = {
  lock: {
    title: "Lock Screen",
    purpose: "The phone while locked: the time, anything running, and the top of the Contextual Brief.",
    shows: ["now.time, now.date", "island.process (label, status, eta, progress) while something runs", "the first brief item or brief.summary"],
    taps: ["a way to unlock (link to the home artboard)", "a brief item opens it (open)"],
    states: ["nothing running (island.process is empty)", "no brief items"],
  },
  home: {
    title: "Home Screen",
    purpose: "The unlocked home: the day at a glance, the brief, and apps.",
    shows: ["brief.headline, brief.summary", "brief.items rows: title, line, badge, icon", "apps: name, icon", "a text or voice input to talk to the agent"],
    taps: ["a brief row opens it (open)", "the input sends what the user typed (say)"],
    states: ["an empty brief", "ten brief items with long titles"],
  },
  spaces: {
    title: "Spaces",
    purpose: "The user's active projects as documents, and questions the agent is waiting on. The agent pauses until a question is answered.",
    shows: [
      "questions: title, question, and a form built from the question's elements: choice chips, text/number/date fields, and Approve / Deny buttons for tool approvals",
      "documents as tabs: title, description, sections (title, body or list items), processes (label, status, detail), results, follow-ups, suggested actions",
    ],
    taps: ["answering a question (answer), with the chosen chip or typed values", "switching tabs between questions and documents"],
    states: ["no documents and no questions", "one question waiting over three documents", "a long document that scrolls"],
  },
  discover: {
    title: "Discover",
    purpose: "Topics related to the user's interests and projects that they did not ask for.",
    shows: ["discover rows: title, line, call to action, icon, badge"],
    taps: ["a row opens it (open)", "a row can be dismissed (dismiss)"],
    states: ["nothing to discover", "eight items"],
  },
};

/**
 * A design brief for a screen the skin lacks (decided: missing screens get designed in Claude
 * Design, in the skin's own style, then re-installed). Paste it into the canvas.
 */
export function missingScreenBrief(screen: string, manifest: SkinManifest): string {
  const spec = SCREENS[screen];
  if (!spec) return `Design a "${screen}" screen for ${manifest.name}.`;
  const style = Object.values(manifest.screens)[0];
  return [
    `Add a "${spec.title}" artboard to this canvas, in the same style as the existing screens${style ? ` (match ${style}: same size, wallpaper, glass, type and tweaks)` : ""}.`,
    "",
    spec.purpose,
    "",
    "It shows (use realistic sample copy; the harness replaces it with live data):",
    ...spec.shows.map((s) => `- ${s}`),
    "",
    "Taps:",
    ...spec.taps.map((t) => `- ${t}`),
    "",
    "Make sure it still reads well with:",
    ...spec.states.map((t) => `- ${t}`),
    "",
    "Repeated rows should be drawn as several real rows (three or four), each built the same way. Link it to the other artboards where a real phone would.",
  ].join("\n");
}

/** Briefs for every missing screen, as one markdown file. */
export function missingScreensMarkdown(manifest: SkinManifest): string {
  if (!manifest.missingScreens.length) return `# ${manifest.name}: no missing screens\n`;
  return `# ${manifest.name}: screens to design\n\n${manifest.missingScreens.map((s) => `## ${SCREENS[s]?.title ?? s}\n\n${missingScreenBrief(s, manifest)}\n`).join("\n")}`;
}
