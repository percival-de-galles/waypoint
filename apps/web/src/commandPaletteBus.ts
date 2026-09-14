import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@waypoint/contracts";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

// Tiny event bus allowing components to programmatically open the command palette
// without owning its React state.
const COMMAND_PALETTE_OPEN_EVENT = "waypoint:open-command-palette";
const WORKSPACE_VIEW_OPEN_EVENT = "waypoint:open-workspace-view";

export type WorkspaceViewIntent = "chat" | "board";

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
}

/** Lets global surfaces such as the command palette switch the current chat workspace. */
export function openWorkspaceView(view: WorkspaceViewIntent): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceViewIntent>(WORKSPACE_VIEW_OPEN_EVENT, { detail: view }),
  );
}

export function onOpenWorkspaceView(listener: (view: WorkspaceViewIntent) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<WorkspaceViewIntent>).detail);
  window.addEventListener(WORKSPACE_VIEW_OPEN_EVENT, handler);
  return () => window.removeEventListener(WORKSPACE_VIEW_OPEN_EVENT, handler);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
