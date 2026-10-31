import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { type BoardWatchOutput, watchBoardRpc } from "../shared/board.js";
import { watchBoard } from "./board-watch.js";

/**
 * The live board for one workspace directory: the latest watch answer, plus
 * the last RPC failure while the watch is being retried.
 */
export function useBoard(cwd: string | null): { board: BoardWatchOutput | null; error: string | null } {
  const watch = useRpc(watchBoardRpc);
  // The loop must not restart when the host hands out a new rpc function.
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const [board, setBoard] = useState<BoardWatchOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cwd === null) return undefined;
    setBoard(null);
    setError(null);
    return watchBoard({
      cwd,
      watch: (input) => watchRef.current(input),
      onBoard(next) {
        setBoard(next);
        setError(null);
      },
      onError(failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    });
  }, [cwd]);

  return { board, error };
}
