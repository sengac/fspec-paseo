/**
 * Feature: spec/features/fspec-session-list.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import type * as wire from "../server/wire.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

function info(id: string, name: string, messageCount: number, updatedAtMs: number | null): wire.SessionInfo {
  return {
    id,
    name,
    status: "idle",
    project: "/work",
    messageCount,
    providerId: "anthropic",
    modelId: "claude",
    isIsolated: false,
    worktreePath: null,
    role: null,
    updatedAtMs,
    workUnitFocus: { revision: 0, context: null, source: "none" },
  };
}

const FIX = info("fspec-old-1", "Fix login", 12, Date.UTC(2026, 9, 30, 8));
const SPIKE = info("fspec-old-2", "Spike", 3, Date.UTC(2026, 9, 29, 8));

describe("Feature: List and import fspec sessions in Paseo", () => {
  describe("Scenario: Paseo lists the daemon's fspec sessions newest first", () => {
    it("replies with one sessions event", async () => {
      // @step Given list_sessions for the daemon workspace returns "Fix login" (12 messages, updated 2026-10-30) and "Spike" (3 messages, updated 2026-10-29)
      const h = await harness();
      h.daemon.handlers.listSessions = () => [SPIKE, FIX];
      // @step When Paseo sends a sessions request
      const reply = await h.send({ type: "sessions", requestId: "s-1" });
      // @step Then the provider replied with one sessions event listing "Fix login" then "Spike" with their persistence, cwd, description and updatedAt
      expect(h.daemon.sent("listSessions")).toEqual([{ method: "listSessions", projectPath: "/work" }]);
      expect(reply).toEqual({
        type: "sessions",
        requestId: "s-1",
        sessions: [
          { persistence: { version: 1, data: { sessionId: "fspec-old-1" } }, cwd: "/work", title: "Fix login", description: "12 messages · anthropic/claude", updatedAt: "2026-10-30T08:00:00.000Z" },
          { persistence: { version: 1, data: { sessionId: "fspec-old-2" } }, cwd: "/work", title: "Spike", description: "3 messages · anthropic/claude", updatedAt: "2026-10-29T08:00:00.000Z" },
        ],
      });
      expect(h.ofType("sessions")).toHaveLength(1);
    });
  });

  describe("Scenario: Query, limit and open sessions narrow the list", () => {
    it("filters by query, open sessions and limit", async () => {
      // @step Given list_sessions returns "Fix login", "Spike" and the session already open as "paseo-1"
      const h = await harness();
      await h.open("paseo-1");
      h.daemon.handlers.listSessions = () => [FIX, SPIKE, info("fspec-sess-42", "Open login work", 1, Date.UTC(2026, 9, 31))];
      // @step When Paseo sends a sessions request with query "login" and limit 1
      const reply = (await h.send({ type: "sessions", requestId: "s-2", query: "LOGIN", limit: 1 })) as { sessions: Array<{ title?: string }> };
      // @step Then the reply lists only "Fix login"
      expect(reply.sessions.map((session) => session.title)).toEqual(["Fix login"]);
    });
  });

  describe("Scenario: A directory the daemon does not serve lists nothing", () => {
    it("returns an empty list without listing", async () => {
      // @step Given the daemon serves workspace "/work"
      const h = await harness();
      // @step When Paseo sends a sessions request with cwd "/elsewhere"
      const reply = await h.send({ type: "sessions", requestId: "s-3", cwd: "/elsewhere" });
      // @step Then the reply lists no sessions and list_sessions was not called
      expect(reply).toEqual({ type: "sessions", requestId: "s-3", sessions: [] });
      expect(h.daemon.sent("listSessions")).toEqual([]);
    });
  });

  describe("Scenario: Importing a listed session resumes it", () => {
    it("opens with the listed persistence", async () => {
      // @step Given a listed session with persistence data.sessionId "fspec-old-1"
      const h = await harness();
      h.daemon.handlers.listSessions = () => [FIX];
      const reply = (await h.send({ type: "sessions", requestId: "s-4" })) as { sessions: Array<{ persistence: { version: number; data: unknown } }> };
      // @step When Paseo opens it with that persistence
      const opened = await h.open("paseo-9", {}, reply.sessions[0]!.persistence as never);
      // @step Then the provider resumed "fspec-old-1" and reached session.ready
      expect(h.daemon.sent("resumeSession")).toEqual([{ method: "resumeSession", sessionId: "fspec-old-1" }]);
      expect(opened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-9" });
    });
  });
});
