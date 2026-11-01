import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** One fspec work unit as the daemon's WorkUnitsUpdate carries it. */
export const boardUnitSchema = z.object({
  id: z.string(),
  title: z.string(),
  workType: z.string(),
  status: z.string(),
  description: z.string().nullable(),
  estimate: z.number().nullable(),
  epic: z.string().nullable(),
  attachments: z.array(z.string()),
  lastStateChangeAt: z.string().nullable(),
});

/**
 * The board at one revision. `units` keeps the daemon's column order; `focus`
 * maps a work unit id to the fspec sessions focused on it. The revision is
 * opaque ('<instance epoch>:<counter>'), so compare it only for equality.
 */
export const boardSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    revision: z.string(),
    workspace: z.string(),
    units: z.array(boardUnitSchema),
    focus: z.record(z.string(), z.array(z.string())),
  }),
  z.object({
    state: z.literal("unavailable"),
    revision: z.string(),
    reason: z.string(),
  }),
]);

/**
 * Long-poll for the board: answers at once when `sinceRevision` is null or
 * stale, otherwise on the next change or after the server's hold expires.
 */
export const watchBoardRpc = defineRpc({
  name: "fspec.board.watch",
  input: z.object({ cwd: z.string(), sinceRevision: z.string().nullable() }),
  output: boardSchema,
});

export type BoardUnit = z.infer<typeof boardUnitSchema>;
export type BoardWatchInput = z.infer<typeof watchBoardRpc.input>;
export type BoardWatchOutput = z.infer<typeof boardSchema>;

/** One work unit's complete fspec record (get_work_unit_details), or why it is unavailable. */
export const detailsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), id: z.string(), workUnit: z.record(z.string(), z.unknown()) }),
  z.object({ state: z.literal("unavailable"), reason: z.string() }),
]);

export const boardDetailsRpc = defineRpc({
  name: "fspec.board.details",
  input: z.object({ cwd: z.string(), id: z.string() }),
  output: detailsSchema,
});

export type BoardDetailsInput = z.infer<typeof boardDetailsRpc.input>;
export type BoardDetailsOutput = z.infer<typeof detailsSchema>;

/** Moves a card one position within its column (move_work_unit_up / move_work_unit_down). */
export const moveBoardRpc = defineRpc({
  name: "fspec.board.move",
  input: z.object({ cwd: z.string(), id: z.string(), direction: z.enum(["up", "down"]) }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

export type BoardMoveInput = z.infer<typeof moveBoardRpc.input>;
export type BoardMoveOutput = z.infer<typeof moveBoardRpc.output>;

/**
 * Whether the fspec daemon serves a directory, so the client offers the board
 * there (FSPEC-040). FSPEC-066: a check that failed is not "unserved".
 */
export const boardAvailableRpc = defineRpc({
  name: "fspec.board.available",
  input: z.object({ cwd: z.string() }),
  output: z.discriminatedUnion("state", [
    z.object({ state: z.literal("served") }),
    z.object({ state: z.literal("unserved"), reason: z.string() }),
    z.object({ state: z.literal("failed"), error: z.string() }),
  ]),
});

export type BoardAvailability = z.infer<typeof boardAvailableRpc.output>;
