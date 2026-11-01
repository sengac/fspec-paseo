/** What a settings write answers: the feed's ok/failed/unavailable shapes. */
export type WriteOutput =
  | { ok: true; warning?: string }
  | { ok: false; error: string }
  | { state: "unavailable"; reason: string };

export type WriteOutcome = { ok: true; warning?: string } | { ok: false; error: string };

export interface WriteDeps<T extends WriteOutput> {
  write(): Promise<T>;
  /** Re-reads the provider list. */
  reload(): Promise<void> | void;
  /** Asks Paseo to re-fetch the fspec provider's models. */
  refreshPaseo(): Promise<unknown>;
  /** Runs first after a successful write, e.g. to clear a key field. */
  onSuccess?(): void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one settings write (FSPEC-043). Only a successful write reloads the
 * list and refreshes Paseo's fspec models; a failure changes nothing and
 * comes back as the row's error. A refresh that fails after a successful
 * write is reported as a warning line, never dropped (FSPEC-065).
 */
export async function runWrite<T extends WriteOutput>(deps: WriteDeps<T>): Promise<WriteOutcome> {
  let output: WriteOutput;
  try {
    output = await deps.write();
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  if ("state" in output) return { ok: false, error: output.reason };
  if (!output.ok) return { ok: false, error: output.error };
  deps.onSuccess?.();
  const warnings = output.warning === undefined ? [] : [output.warning];
  try {
    await deps.reload();
  } catch (error) {
    warnings.push(`Saved, but the provider list could not be reloaded: ${message(error)}`);
  }
  try {
    await deps.refreshPaseo();
  } catch (error) {
    warnings.push(`Saved, but Paseo's fspec models could not be refreshed: ${message(error)}`);
  }
  return warnings.length === 0 ? { ok: true } : { ok: true, warning: warnings.join("\n") };
}
