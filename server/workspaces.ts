/**
 * Feature: spec/features/fspec-daemon-workspace-guard.feature
 *
 * Which of a multi-workspace fspec daemon's workspaces (list_workspaces,
 * idx 124 — fspec RPC-441..445) a Paseo directory belongs to. Paths are
 * compared by realpath, so a symlinked or trailing-slash spelling of a
 * workspace still matches. Pure apart from the realpath lookups.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Result, WorkspaceEntry } from "./wire.js";

/** Resolves symlinks when the path exists; otherwise normalizes it. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** True when `dir` is `root` or lies inside it. */
export function within(root: string, dir: string): boolean {
  const rel = relative(canonicalPath(root), canonicalPath(dir));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The listed workspace holding `cwd`: the deepest one, so a project opened
 * inside the start workspace wins over it. Null when none holds it.
 */
export function servingWorkspace(entries: readonly WorkspaceEntry[], cwd: string): WorkspaceEntry | null {
  let best: WorkspaceEntry | null = null;
  for (const entry of entries) {
    if (!within(entry.path, cwd)) continue;
    if (best === null || within(best.path, entry.path)) best = entry;
  }
  return best;
}

/**
 * The workspaces list_workspaces (idx 124) answered. Its error, an empty
 * list or a list naming no start workspace is an error (FSPEC-058): no
 * other source stands in for it.
 */
export function servedWorkspaces(result: Result<WorkspaceEntry[]>): WorkspaceEntry[] {
  if (!result.ok) throw new Error(`fspec daemon list_workspaces failed: ${result.error}`);
  if (result.value.length === 0) throw new Error("fspec daemon list_workspaces failed: the daemon lists no workspaces");
  if (!result.value.some((entry) => entry.start)) {
    throw new Error("fspec daemon list_workspaces failed: the daemon lists no start workspace");
  }
  return result.value;
}
