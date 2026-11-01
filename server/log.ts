/**
 * The plugin log (FSPEC-063..067): Paseo captures a plugin process's stderr
 * into the plugin's log (paseo packages/server/src/server/plugins/runtime.ts),
 * so a failure nobody else reports is written there, never dropped.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Logs `[fspec] <what>: <reason>`. */
export function logFailure(what: string, error: unknown): void {
  console.error(`[fspec] ${what}: ${describeError(error)}`);
}

/** Logs `[fspec] <message>` for an event that is not a failure of ours. */
export function logWarning(message: string): void {
  console.warn(`[fspec] ${message}`);
}
