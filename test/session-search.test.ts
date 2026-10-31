/**
 * Feature: spec/features/fspec-session-search.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import type * as wire from "../server/wire.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const REFACTOR: wire.SessionInfo = {
  id: "sess-7",
  name: "Refactor terminal",
  status: "idle",
  project: "/work",
  messageCount: 4,
  providerId: "anthropic",
  modelId: "claude",
  isIsolated: false,
  worktreePath: null,
  role: null,
  updatedAtMs: Date.UTC(2026, 9, 30, 8),
  workUnitFocus: { revision: 0, context: null, source: "none" },
};

const match = (sessionId: string, text: string): wire.HistoryMatch => ({
  sessionId,
  text,
  timestampIso: "2026-10-30T08:00:00Z",
});

type Listed = { sessions: Array<{ persistence: { data: { sessionId: string } }; description?: string }> };

async function search(query: string, history: () => wire.Result<wire.HistoryMatch[]>, listed = [REFACTOR]) {
  const h = await harness();
  h.daemon.handlers.listSessions = () => listed;
  h.daemon.handlers.persistenceSearchHistory = history;
  const reply = (await h.send({ type: "sessions", requestId: "s-1", query })) as unknown as Listed;
  const sessions = reply.sessions.map((session) => ({ id: session.persistence.data.sessionId, description: session.description }));
  return { h, sessions };
}

describe("Feature: Find fspec sessions in Paseo's import list by their conversation text", () => {
  describe("Scenario: A session is found by text from one of its prompts", () => {
    it("lists the session with the matching prompt as its description", async () => {
      // @step Given a persisted fspec session "sess-7" named "Refactor terminal" whose prompt history includes "port the VTCode diff view"
      const history = () => ({ ok: true as const, value: [match("sess-7", "port the VTCode diff view")] });
      // @step When Paseo lists importable sessions with query "vtcode"
      const { h, sessions } = await search("vtcode", history);
      // @step Then the provider called persistence_search_history with "vtcode"
      expect(h.daemon.sent("persistenceSearchHistory")).toEqual([{ method: "persistenceSearchHistory", query: "vtcode" }]);
      // @step And it listed "sess-7" with description "port the VTCode diff view"
      expect(sessions).toEqual([{ id: "sess-7", description: "port the VTCode diff view" }]);
    });
  });

  describe("Scenario: A session is still found by its name", () => {
    it("keeps the message-count description for a name match", async () => {
      // @step Given a persisted fspec session "sess-7" named "Refactor terminal" with 4 messages
      const history = () => ({ ok: true as const, value: [] });
      // @step When Paseo lists importable sessions with query "refactor"
      const { sessions } = await search("refactor", history);
      // @step Then it listed "sess-7" with the usual description "4 messages · anthropic/claude"
      expect(sessions).toEqual([{ id: "sess-7", description: "4 messages · anthropic/claude" }]);
    });
  });

  describe("Scenario: A failed history search falls back to name matching", () => {
    it("lists name matches when the search errors", async () => {
      // @step Given a persisted fspec session "sess-7" named "Refactor terminal" and persistence_search_history fails
      const history = () => ({ ok: false as const, error: "history unavailable" });
      // @step When Paseo lists importable sessions with query "refactor"
      const { sessions } = await search("refactor", history);
      // @step Then it listed "sess-7"
      expect(sessions.map((session) => session.id)).toEqual(["sess-7"]);
    });
  });

  describe("Scenario: History matches for sessions no longer listed are ignored", () => {
    it("drops matches for unknown sessions", async () => {
      // @step Given persistence_search_history matches deleted session "sess-99" that listSessions does not return
      const history = () => ({ ok: true as const, value: [match("sess-99", "VTCode spike")] });
      // @step When Paseo lists importable sessions with query "vtcode"
      const { sessions } = await search("vtcode", history);
      // @step Then it listed no sessions
      expect(sessions).toEqual([]);
    });
  });
});
