/**
 * Feature: spec/features/fspec-provider-oauth.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { logoutPrompt, oauthIntro } from "../client/settings-model.js";
import { createSettingsFeed } from "../server/settings.js";
import type * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const ok = { ok: true, value: undefined };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup() {
  const home = tempHome();
  home.writeDaemonJson();
  const daemon = new FakeDaemon();
  const feed = createSettingsFeed(daemonOptions(home, daemon), { oauthHoldMs: 30 });
  disposers.push(home.dispose, () => feed.close());
  return { daemon, feed };
}

const device: wire.OAuthDeviceStart = {
  userCode: "ABCD-1234",
  verificationUrl: "https://auth.openai.com/device",
  deviceAuthId: "dev-1",
  interval: 5,
};

async function started(answer: Awaited<ReturnType<ReturnType<typeof setup>["feed"]["oauthStart"]>>) {
  if (!("ok" in answer) || !answer.ok) throw new Error(JSON.stringify(answer));
  return answer;
}

describe("Feature: Sign in to OAuth providers for fspec from Paseo", () => {
  describe("Scenario: Signing in with a code keeps the verifier on the server", () => {
    it("completes with the server-held verifier", async () => {
      // @step Given the daemon answers oauth_headless_start for anthropic with an authorize URL and the verifier "verifier-123"
      const { daemon, feed } = setup();
      daemon.handlers.oauthHeadlessStart = () => ({
        ok: true,
        value: { authorizeUrl: "https://claude.ai/oauth/authorize?state=x", pkceVerifier: "verifier-123" },
      });
      daemon.handlers.oauthHeadlessComplete = () => ok;
      // @step When the user starts "Sign in with code" for anthropic and submits the code "abc#state"
      const start = await started(await feed.oauthStart({ providerId: "anthropic", method: "code", enterpriseHost: null }));
      const complete = await feed.oauthComplete({ loginId: start.loginId, code: "abc#state" });
      // @step Then the client receives a login id and the authorize URL but not "verifier-123"
      expect(start.step).toEqual({ kind: "code", authorizeUrl: "https://claude.ai/oauth/authorize?state=x" });
      expect(JSON.stringify(start)).not.toContain("verifier-123");
      // @step And the daemon receives oauth_headless_complete(anthropic, "abc#state", "verifier-123")
      expect(daemon.sent("oauthHeadlessComplete")).toEqual([
        { method: "oauthHeadlessComplete", providerId: "anthropic", codeWithState: "abc#state", pkceVerifier: "verifier-123" },
      ]);
      expect(complete).toEqual({ ok: true });
      // @step And the login's status is succeeded
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "succeeded" });
    });
  });

  describe("Scenario: A device-code sign-in waits past Paseo's RPC limit", () => {
    it("polls in the background with a long deadline", async () => {
      // @step Given the daemon answers oauth_device_start for codex with code "ABCD-1234" and holds oauth_device_poll
      const { daemon, feed } = setup();
      const poll = deferred<unknown>();
      daemon.handlers.oauthDeviceStart = () => ({ ok: true, value: device });
      daemon.handlers.oauthDevicePoll = () => poll.promise;
      // @step When the user starts "Sign in with device code" for codex and the client asks for its status
      const start = await started(await feed.oauthStart({ providerId: "codex", method: "device", enterpriseHost: null }));
      // @step Then the client receives the code "ABCD-1234" and the verification link
      expect(start.step).toEqual({ kind: "device", userCode: "ABCD-1234", verificationUrl: "https://auth.openai.com/device" });
      // @step And a status request answers pending once the hold expires
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "pending" });
      // @step And oauth_device_poll was sent with a 15-minute deadline
      const index = daemon.requests.findIndex((request) => request.method === "oauthDevicePoll");
      expect(daemon.requests[index]).toEqual({ method: "oauthDevicePoll", providerId: "codex", deviceAuthId: "dev-1", interval: 5 });
      expect(daemon.deadlines[index]).toBe(15 * 60 * 1000);
      // @step And when the poll returns, the next status answers succeeded
      const status = feed.oauthStatus({ loginId: start.loginId });
      poll.resolve(ok);
      expect(await status).toEqual({ state: "succeeded" });
    });
  });

  describe("Scenario: GitHub Copilot sends the optional enterprise host", () => {
    it("passes the host through", async () => {
      // @step Given the daemon answers oauth_copilot_device_start
      const { daemon, feed } = setup();
      daemon.handlers.oauthCopilotDeviceStart = () => ({ ok: true, value: device });
      daemon.handlers.oauthDevicePoll = () => new Promise(() => {});
      // @step When the user starts a GitHub Copilot sign-in without a host and then with "ghe.example.com"
      await started(await feed.oauthStart({ providerId: "github-copilot", method: "device", enterpriseHost: null }));
      await started(await feed.oauthStart({ providerId: "github-copilot", method: "device", enterpriseHost: "ghe.example.com" }));
      // @step Then the daemon receives oauth_copilot_device_start with no host and then with "ghe.example.com"
      expect(daemon.sent("oauthCopilotDeviceStart").map((request) => request.enterpriseHost)).toEqual([null, "ghe.example.com"]);
      expect(daemon.sent("oauthDevicePoll")[0]).toMatchObject({ providerId: "github-copilot" });
    });
  });

  describe("Scenario: Browser sign-in opens a browser on the daemon's computer", () => {
    it("waits for the browser login", async () => {
      // @step Given the daemon holds oauth_browser_login for anthropic
      const { daemon, feed } = setup();
      const login = deferred<unknown>();
      daemon.handlers.oauthBrowserLogin = () => login.promise;
      // @step When the user starts "Sign in with browser" for anthropic
      const start = await started(await feed.oauthStart({ providerId: "anthropic", method: "browser", enterpriseHost: null }));
      // @step Then the sheet says "A browser opens on the computer running fspec. Finish signing in there."
      expect(oauthIntro(start.step)).toBe("A browser opens on the computer running fspec. Finish signing in there.");
      // @step And the login stays pending until oauth_browser_login returns
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "pending" });
      const index = daemon.requests.findIndex((request) => request.method === "oauthBrowserLogin");
      expect(daemon.deadlines[index]).toBe(15 * 60 * 1000);
      login.resolve(ok);
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "succeeded" });
    });
  });

  describe("Scenario: An abandoned sign-in ignores its late result", () => {
    it("forgets a cancelled login", async () => {
      // @step Given a codex device-code sign-in is waiting
      const { daemon, feed } = setup();
      const poll = deferred<unknown>();
      daemon.handlers.oauthDeviceStart = () => ({ ok: true, value: device });
      daemon.handlers.oauthDevicePoll = () => poll.promise;
      const start = await started(await feed.oauthStart({ providerId: "codex", method: "device", enterpriseHost: null }));
      // @step When the user cancels it and the daemon's poll then succeeds
      expect(await feed.oauthCancel({ loginId: start.loginId })).toEqual({ ok: true });
      poll.resolve(ok);
      await new Promise((resolve) => setTimeout(resolve, 10));
      // @step Then its status answers unknown
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "unknown" });
    });
  });

  describe("Scenario: A failed sign-in reports the daemon's message", () => {
    it("answers failed", async () => {
      // @step Given the daemon answers oauth_device_poll for codex with Err("device code expired")
      const { daemon, feed } = setup();
      daemon.handlers.oauthDeviceStart = () => ({ ok: true, value: device });
      daemon.handlers.oauthDevicePoll = () => ({ ok: false, error: "device code expired" });
      // @step When the user starts "Sign in with device code" for codex
      const start = await started(await feed.oauthStart({ providerId: "codex", method: "device", enterpriseHost: null }));
      // @step Then its status answers failed with "device code expired"
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await feed.oauthStatus({ loginId: start.loginId })).toEqual({ state: "failed", error: "device code expired" });
      daemon.handlers.oauthDeviceStart = () => ({ ok: false, error: "codex auth unavailable" });
      expect(await feed.oauthStart({ providerId: "codex", method: "device", enterpriseHost: null })).toEqual({
        ok: false,
        error: "codex auth unavailable",
      });
    });
  });

  describe("Scenario: Logging out asks first and clears the tokens", () => {
    it("confirms and clears", async () => {
      // @step Given codex is signed in
      const { daemon, feed } = setup();
      daemon.handlers.oauthClearTokens = () => ok;
      // @step When the user opens "✓ Logged in [ChatGPT]" and confirms
      const prompt = logoutPrompt("codex");
      const answer = await feed.oauthLogout({ providerId: "codex" });
      // @step Then the confirmation reads "Log out of ChatGPT in fspec?"
      expect(prompt).toBe("Log out of ChatGPT in fspec?");
      // @step And the daemon receives oauth_clear_tokens(codex)
      expect(daemon.sent("oauthClearTokens")).toEqual([{ method: "oauthClearTokens", providerId: "codex" }]);
      expect(answer).toEqual({ ok: true });
    });
  });
});
