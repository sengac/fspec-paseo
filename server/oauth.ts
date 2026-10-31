/**
 * Feature: spec/features/fspec-provider-oauth.feature
 *
 * OAuth sign-ins started from Paseo (FSPEC-044), run the way the fspec TUI
 * runs them (rust/fspec-tui/src/app/dispatch_provider_settings_oauth.rs):
 * browser login and device-code polling wait on the user, so they run here as
 * background tasks with a long daemon deadline while the client long-polls
 * their status under Paseo's 30 s RPC limit. The PKCE verifier and every token
 * stay on this side.
 */
import { randomUUID } from "node:crypto";
import type { OAuthStartInput, OAuthStartOutput, OAuthStatusOutput, WriteOutput } from "../shared/settings.js";
import type { DecodedResponse, FspecServiceRequest, Result } from "./wire.js";

/** How long the daemon may take on a call that waits for the user. */
export const OAUTH_DEADLINE_MS = 15 * 60 * 1000;

/** A status request with nothing new is held this long (under Paseo's 30 s RPC limit). */
export const OAUTH_HOLD_MS = 20_000;

type Call = <M extends FspecServiceRequest["method"]>(
  request: Extract<FspecServiceRequest, { method: M }>,
  options?: { deadlineMs?: number },
) => Promise<Extract<DecodedResponse, { ok: true; method: M }>>;

type Login =
  | { state: "pending"; providerId: string; pkceVerifier?: string }
  | { state: "succeeded" }
  | { state: "failed"; error: string };

export interface OAuthLogins {
  start(input: OAuthStartInput): Promise<OAuthStartOutput>;
  complete(input: { loginId: string; code: string }): Promise<WriteOutput>;
  status(input: { loginId: string }): Promise<OAuthStatusOutput>;
  cancel(input: { loginId: string }): { ok: true };
  logout(input: { providerId: string }): Promise<WriteOutput>;
  close(): void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOAuthLogins(call: Call, holdMs = OAUTH_HOLD_MS): OAuthLogins {
  const logins = new Map<string, Login>();
  const waiters = new Map<string, Set<() => void>>();

  function settle(loginId: string, login: Login): void {
    // A cancelled sign-in is gone: its late result is ignored.
    if (!logins.has(loginId)) return;
    logins.set(loginId, login);
    for (const wake of waiters.get(loginId) ?? []) wake();
  }

  /** Runs a call that ends the sign-in, in the background. */
  function finish(loginId: string, run: () => Promise<Result<void>>): void {
    run().then(
      (result) => settle(loginId, result.ok ? { state: "succeeded" } : { state: "failed", error: result.error }),
      (error: unknown) => settle(loginId, { state: "failed", error: message(error) }),
    );
  }

  function hold(loginId: string): Promise<void> {
    return new Promise((resolve) => {
      const set = waiters.get(loginId) ?? new Set();
      waiters.set(loginId, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, holdMs);
      set.add(done);
    });
  }

  function answer(login: Login | undefined): OAuthStatusOutput {
    if (login === undefined) return { state: "unknown" };
    if (login.state === "pending") return { state: "pending" };
    return login.state === "succeeded" ? { state: "succeeded" } : { state: "failed", error: login.error };
  }

  return {
    async start({ providerId, method, enterpriseHost }) {
      const loginId = randomUUID();
      const long = { deadlineMs: OAUTH_DEADLINE_MS };
      if (method === "browser") {
        logins.set(loginId, { state: "pending", providerId });
        finish(loginId, async () => (await call({ method: "oauthBrowserLogin", providerId }, long)).result);
        return { ok: true, loginId, step: { kind: "browser" } };
      }
      if (method === "code") {
        const { result } = await call({ method: "oauthHeadlessStart", providerId });
        if (!result.ok) return { ok: false, error: result.error };
        logins.set(loginId, { state: "pending", providerId, pkceVerifier: result.value.pkceVerifier });
        return { ok: true, loginId, step: { kind: "code", authorizeUrl: result.value.authorizeUrl } };
      }
      const { result } =
        providerId === "github-copilot"
          ? await call({ method: "oauthCopilotDeviceStart", enterpriseHost })
          : await call({ method: "oauthDeviceStart", providerId });
      if (!result.ok) return { ok: false, error: result.error };
      const { deviceAuthId, interval, userCode, verificationUrl } = result.value;
      logins.set(loginId, { state: "pending", providerId });
      finish(loginId, async () =>
        (await call({ method: "oauthDevicePoll", providerId, deviceAuthId, interval }, long)).result,
      );
      return { ok: true, loginId, step: { kind: "device", userCode, verificationUrl } };
    },

    async complete({ loginId, code }) {
      const login = logins.get(loginId);
      if (login?.state !== "pending" || login.pkceVerifier === undefined) {
        return { ok: false, error: "This sign-in is no longer waiting for a code. Start it again." };
      }
      const { result } = await call({
        method: "oauthHeadlessComplete",
        providerId: login.providerId,
        codeWithState: code.trim(),
        pkceVerifier: login.pkceVerifier,
      });
      settle(loginId, result.ok ? { state: "succeeded" } : { state: "failed", error: result.error });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },

    async status({ loginId }) {
      if (logins.get(loginId)?.state === "pending") await hold(loginId);
      return answer(logins.get(loginId));
    },

    cancel({ loginId }) {
      logins.delete(loginId);
      for (const wake of waiters.get(loginId) ?? []) wake();
      waiters.delete(loginId);
      return { ok: true };
    },

    async logout({ providerId }) {
      const { result } = await call({ method: "oauthClearTokens", providerId });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },

    close() {
      for (const loginId of [...logins.keys()]) this.cancel({ loginId });
    },
  };
}
