/** The parts of a Paseo workspace that locate it on disk. */
export interface WorkspaceEntry {
  id: string;
  projectRootPath: string;
  workspaceDirectory?: string;
}

export type WorkspaceEvent =
  | { kind: "snapshot"; entries: readonly WorkspaceEntry[] }
  | { kind: "upsert"; workspace: WorkspaceEntry }
  | { kind: "remove"; id: string };

export interface BoardButtonDeps {
  /** Starts observing Paseo's workspaces; returns the release function. */
  watchWorkspaces(onEvent: (event: WorkspaceEvent) => void): () => void;
  available(cwd: string): Promise<boolean>;
  addHeaderButton(contribution: {
    id: string;
    workspaceId: string;
    button: { title: string; icon: { svg: string }; behavior: { kind: "action"; onPress(): void } };
  }): { remove(): void };
  openPanel(workspaceId: string): void;
}

export const BOARD_BUTTON_ID = "fspec-board";

/**
 * Paseo's phone layout offers no plugin panels in its tab menu, so every
 * workspace the fspec daemon serves gets an 'fspec board' header button,
 * which phones show as a row of the workspace ··· menu (FSPEC-040).
 */
export function syncBoardButtons(deps: BoardButtonDeps, icon: { svg: string } = { svg: "" }): () => void {
  let stopped = false;
  const buttons = new Map<string, { remove(): void }>();
  /** Bumped per workspace so a slow availability answer never outlives a newer event. */
  const generation = new Map<string, number>();
  /** The directory each workspace was last checked for, so status-only updates cost no RPC. */
  const checked = new Map<string, string>();

  function drop(id: string): void {
    generation.set(id, (generation.get(id) ?? 0) + 1);
    checked.delete(id);
    buttons.get(id)?.remove();
    buttons.delete(id);
  }

  async function consider(workspace: WorkspaceEntry): Promise<void> {
    const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
    if (checked.get(workspace.id) === directory) return;
    checked.set(workspace.id, directory);
    const ticket = (generation.get(workspace.id) ?? 0) + 1;
    generation.set(workspace.id, ticket);
    const served = await deps.available(directory).catch(() => false);
    if (stopped || generation.get(workspace.id) !== ticket) return;
    if (!served) {
      buttons.get(workspace.id)?.remove();
      buttons.delete(workspace.id);
      return;
    }
    if (buttons.has(workspace.id)) return;
    buttons.set(
      workspace.id,
      deps.addHeaderButton({
        id: BOARD_BUTTON_ID,
        workspaceId: workspace.id,
        button: {
          title: "fspec board",
          icon,
          behavior: { kind: "action", onPress: () => deps.openPanel(workspace.id) },
        },
      }),
    );
  }

  const release = deps.watchWorkspaces((event) => {
    if (stopped) return;
    if (event.kind === "remove") {
      drop(event.id);
      return;
    }
    const entries = event.kind === "snapshot" ? event.entries : [event.workspace];
    if (event.kind === "snapshot") {
      const keep = new Set(entries.map((entry) => entry.id));
      for (const id of [...buttons.keys()]) if (!keep.has(id)) drop(id);
    }
    for (const workspace of entries) void consider(workspace);
  });

  return () => {
    stopped = true;
    release();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
