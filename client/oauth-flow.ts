/**
 * Feature: spec/features/fspec-provider-oauth.feature
 *
 * The OAuth sheet's side effects (FSPEC-065), pure so every failure path is
 * testable: the status watch ends on a status it cannot read, a failed copy
 * becomes the sheet's message, and a failed cancel after the sheet closed
 * goes to the console (the sheet is gone).
 */
import type { OAuthStatusOutput } from "../shared/settings.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type SignInOutcome = { kind: "succeeded" } | { kind: "failed"; error: string } | { kind: "stopped" };

/**
 * Long-polls one sign-in until it ends, `current()` turns false (the sheet
 * closed or moved on), or a status cannot be read.
 */
export async function watchSignIn(
  status: (input: { loginId: string }) => Promise<OAuthStatusOutput>,
  loginId: string,
  current: () => boolean,
): Promise<SignInOutcome> {
  while (current()) {
    let answer: OAuthStatusOutput;
    try {
      answer = await status({ loginId });
    } catch (error) {
      return { kind: "failed", error: `The sign-in status could not be read: ${message(error)}` };
    }
    if (!current()) return { kind: "stopped" };
    if (answer.state === "pending") continue;
    if (answer.state === "succeeded") return { kind: "succeeded" };
    return { kind: "failed", error: answer.state === "failed" ? answer.error : "The sign-in was abandoned" };
  }
  return { kind: "stopped" };
}

/** Copies the device code; the message to show when that fails, else null. */
export async function copyCode(copy: (text: string) => Promise<void>, code: string): Promise<string | null> {
  try {
    await copy(code);
    return null;
  } catch (error) {
    return `The code could not be copied: ${message(error)}`;
  }
}

/** Abandons a sign-in when its sheet closes; nothing is left to show a failure on. */
export async function cancelOnClose(cancel: (input: { loginId: string }) => Promise<unknown>, loginId: string): Promise<void> {
  try {
    await cancel({ loginId });
  } catch (error) {
    console.error(`[fspec] cancelling the sign-in ${loginId} failed: ${message(error)}`);
  }
}
