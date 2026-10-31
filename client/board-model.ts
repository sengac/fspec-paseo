import type { BoardUnit } from "../shared/board.js";

/** The fspec board's columns, in the order `fspec board` and the TUI show them. */
export const BOARD_COLUMNS = [
  "backlog",
  "specifying",
  "testing",
  "implementing",
  "validating",
  "done",
  "blocked",
] as const;

export type BoardColumnStatus = (typeof BOARD_COLUMNS)[number];

export interface BoardColumn {
  status: BoardColumnStatus;
  units: BoardUnit[];
}

export type SearchMode = "id" | "title" | "description";

export function isBoardColumn(value: unknown): value is BoardColumnStatus {
  return (BOARD_COLUMNS as readonly unknown[]).includes(value);
}

/** Units grouped by status; each column keeps the daemon's order. */
export function groupColumns(units: readonly BoardUnit[]): BoardColumn[] {
  const columns = BOARD_COLUMNS.map((status) => ({ status, units: [] as BoardUnit[] }));
  const byStatus = new Map(columns.map((column) => [column.status as string, column]));
  for (const unit of units) byStatus.get(unit.status)?.units.push(unit);
  return columns;
}

/** `fspec board`'s footer: done estimates are completed, all others in progress. */
export function pointsSummary(units: readonly BoardUnit[]): string {
  let inProgress = 0;
  let completed = 0;
  for (const unit of units) {
    if (unit.estimate === null) continue;
    if (unit.status === "done") completed += unit.estimate;
    else inProgress += unit.estimate;
  }
  return `${inProgress} points in progress, ${completed} points completed`;
}

/** The TUI cell: 'ID [pts]', with a green dot when an fspec session is focused on it. */
export function cardLabel(unit: BoardUnit, focus: Readonly<Record<string, readonly string[]>>): string {
  const points = unit.estimate === null ? "" : ` [${unit.estimate}]`;
  const focused = (focus[unit.id]?.length ?? 0) > 0 ? "🟢 " : "";
  return `${focused}${unit.id}${points}`;
}

/** The single unit with the latest lastStateChangeAt, or null when none has one. */
export function latestChange(units: readonly BoardUnit[]): string | null {
  let latest: { id: string; at: number } | null = null;
  for (const unit of units) {
    if (unit.lastStateChangeAt === null) continue;
    const at = Date.parse(unit.lastStateChangeAt);
    if (Number.isNaN(at)) continue;
    if (latest === null || at > latest.at) latest = { id: unit.id, at };
  }
  return latest?.id ?? null;
}

/**
 * The TUI search dialog's filter: case-insensitive substring over the mode's
 * field, in board order. Description mode never matches units without one.
 */
export function searchUnits(units: readonly BoardUnit[], mode: SearchMode, query: string): BoardUnit[] {
  const q = query.toLowerCase();
  return units.filter((unit) => {
    const field = mode === "id" ? unit.id : mode === "title" ? unit.title : unit.description;
    return field !== null && field.toLowerCase().includes(q);
  });
}

/** The column a compact layout shows: the user's choice, else the first non-empty one. */
export function compactColumn(chosen: BoardColumnStatus | null, columns: readonly BoardColumn[]): BoardColumnStatus {
  if (chosen !== null) return chosen;
  return columns.find((column) => column.units.length > 0)?.status ?? "backlog";
}

/** Where a chosen search result lives, so the panel can show and select it. */
export function revealCard(unit: BoardUnit): { column: BoardColumnStatus | null; selected: string } {
  return { column: isBoardColumn(unit.status) ? unit.status : null, selected: unit.id };
}
