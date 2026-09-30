import type { SkinCommand, SkinViewModel } from "@harness/core/skin";

/** Host (harness page) to skin: skin contract v1. */
export interface SkinStateMessage {
  type: "state";
  view: SkinViewModel;
}

/** Skin to host: a skin command; the host checks it and maps it to runtime messages. */
export interface SkinCommandMessage {
  type: "command";
  command: SkinCommand;
}
