import type { BoardWatchInput, BoardWatchOutput } from "../shared/board.js";

/** How long the panel waits before re-issuing a watch that failed outright. */
export const BOARD_RETRY_MS = 3_000;

/**
 * Keeps the board live (FSPEC-035): calls fspec.board.watch, hands every
 * answer to `onBoard`, and immediately watches again since that revision.
 * The server holds a watch until the board changes, so this is a long-poll
 * rather than a timer. Returns a stop function.
 */
export function watchBoard(options: {
  cwd: string;
  watch: (input: BoardWatchInput) => Promise<BoardWatchOutput>;
  onBoard: (board: BoardWatchOutput) => void;
  onError?: (error: unknown) => void;
}): () => void {
  let stopped = false;
  let sinceRevision: string | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  async function loop(): Promise<void> {
    while (!stopped) {
      let board: BoardWatchOutput;
      try {
        board = await options.watch({ cwd: options.cwd, sinceRevision });
      } catch (error) {
        if (stopped) return;
        options.onError?.(error);
        retry = setTimeout(() => {
          retry = null;
          void loop();
        }, BOARD_RETRY_MS);
        return;
      }
      if (stopped) return;
      sinceRevision = board.revision;
      options.onBoard(board);
    }
  }

  void loop();
  return () => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
  };
}
