import { DcPlayer } from "@harness/dc-runtime";
import type { SkinCommand, SkinManifest, SkinViewModel } from "@harness/core/skin";

/**
 * Plays a Claude Design skin inside a sandboxed iframe (docs/SKINS_FROM_CLAUDE_DESIGN.md
 * section 4). The host posts the skin package, tweaks and the view model; the skin posts back
 * skin commands, which the host checks before they reach the runtime.
 */
type HostMessage =
  | { type: "package"; manifest: SkinManifest; canvas: unknown; artboards: Record<string, string>; tweaks: Record<string, unknown> }
  | { type: "state"; view: SkinViewModel }
  | { type: "tweaks"; tweaks: Record<string, unknown> };

const stage = document.getElementById("stage")!;
const root = document.getElementById("root")!;
let player: DcPlayer | null = null;
let manifest: SkinManifest | null = null;
let view: SkinViewModel | null = null;
let size = { w: 390, h: 844 };

const post = (command: SkinCommand) => window.parent.postMessage({ type: "command", command }, "*");

/** Scales the artboard to fit the phone frame, keeping its aspect. */
function fit(): void {
  const scale = Math.min(window.innerWidth / size.w, window.innerHeight / size.h);
  stage.style.width = `${size.w}px`;
  stage.style.height = `${size.h}px`;
  stage.style.transform = `scale(${scale}) translate(-50%, -50%)`;
}
window.addEventListener("resize", fit);

function screenFor(v: SkinViewModel | null): string | null {
  const s = manifest?.screens ?? {};
  return (v && !v.locked ? s.home : s.lock) ?? s.lock ?? s.home ?? null;
}

function start(m: Extract<HostMessage, { type: "package" }>): void {
  manifest = m.manifest;
  const first = screenFor(view) ?? Object.keys(m.artboards)[0];
  const board = (m.canvas as { boards?: Record<string, { w?: number; h?: number }> } | null)?.boards?.[first ?? ""];
  size = { w: board?.w ?? 390, h: board?.h ?? 844 };
  fit();
  player = new DcPlayer(root, {
    artboards: m.artboards,
    tweaks: m.tweaks,
    // Bound artboards read `skin` (the view model) and send taps through `send`.
    extraProps: { skin: view, send: post },
    // Moving between the lock and home screens in the design locks or unlocks the phone.
    onNavigate: (_from, to) => {
      const s = manifest?.screens ?? {};
      if (to === s.home && view?.locked) post({ type: "unlock" });
      if (to === s.lock && view && !view.locked) post({ type: "lock" });
    },
    onError: (file, error) => {
      const box = document.createElement("div");
      box.className = "dc-error";
      box.textContent = `${file}: ${error instanceof Error ? error.message : String(error)}`;
      root.replaceChildren(box);
    },
  });
  if (first) player.show(first);
}

window.addEventListener("message", (e: MessageEvent<HostMessage>) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.type === "package") return start(m);
  if (m?.type === "tweaks") return player?.setProps(m.tweaks);
  if (m?.type === "state" && m.view?.contract === 1) {
    const wasLocked = view?.locked;
    view = m.view;
    document.documentElement.dataset.theme = view.theme;
    if (!player) return;
    const s = manifest?.screens ?? {};
    if (wasLocked !== view.locked) {
      const want = screenFor(view);
      // Unlocking only leaves the lock screen; it doesn't pull the user off another screen.
      if (want && (view.locked ? player.file !== want : player.file === s.lock)) player.show(want);
    }
    player.setProps(null, { skin: view, send: post });
  }
});
window.parent.postMessage({ type: "ready" }, "*");
