import type { ClientMessage, DeviceState } from "@harness/core/types";

/** Host (harness page) to skin. */
export interface SkinStateMessage {
  type: "state";
  device: DeviceState;
  apps: { id: string; name: string }[];
  theme: "light" | "dark";
}

/** Skin to host: a command for the runtime. */
export interface SkinCommandMessage {
  type: "command";
  command: ClientMessage;
}
