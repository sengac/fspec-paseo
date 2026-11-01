/**
 * Feature: spec/features/fspec-subordinate-permissions.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as wire from "../server/wire.js";
import { interactionSnapshot, type SnapshotHitl, type SnapshotPause } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, text } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const PARENT = "fspec-sess-42";
const CHILD = "paseo-1:sub:sub-9";
const BASH: SnapshotPause = { requestId: "p-7", kind: "Triple", toolName: "Bash", message: "risky" };
const paused: wire.StreamChunk = { type: "sessionStateChange", state: "paused" };

/** paseo-1 with sub-agent sub-9 (and sub-10 under sub-9) open as children. */
async function withChildren(nested = false) {
  const h = await harness();
  await h.open("paseo-1");
  const supervisors: Record<string, string[]> = { "sub-9": [PARENT], "sub-10": ["sub-9"] };
  h.daemon.handlers.getSupervisors = (request) =>
    request.method === "getSupervisors" ? (supervisors[request.sessionId] ?? []) : [];
  await h.stream("sub-9", text("working"));
  await h.waitFor("session.opened", (event) => event.sessionId === CHILD);
  if (nested) {
    await h.stream("sub-10", text("digging"));
    await h.waitFor("session.opened", (event) => event.sessionId === `${CHILD}:sub:sub-10`);
  }
  return h;
}

/** A daemon sub-agent pauses with the given snapshot; returns the request Paseo saw. */
async function pause(h: Awaited<ReturnType<typeof harness>>, daemonSessionId: string, parts: { pause?: SnapshotPause; hitl?: SnapshotHitl }) {
  h.daemon.handlers.getInteractionSnapshot = (request) =>
    request.method === "getInteractionSnapshot" && request.sessionId === daemonSessionId ? interactionSnapshot(parts) : interactionSnapshot({});
  await h.stream(daemonSessionId, paused);
  return h.waitFor("session.permission");
}

describe("Feature: Answer fspec sub-agent approvals and questions from the parent agent in Paseo", () => {
  describe("Scenario: A sub-agent's approval is shown and answered on the parent agent", () => {
    it("raises the approval on the parent and replies to the sub-agent", async () => {
      // @step Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
      const h = await withChildren();
      // @step When sub-agent "sub-9" pauses for approval of Bash with snapshot request "p-7"
      const permission = await pause(h, "sub-9", { pause: BASH });
      // @step Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Allow Bash?"
      expect(permission).toMatchObject({ sessionId: "paseo-1", request: { title: "Sub-agent sub-9: Allow Bash?" } });
      // @step And when Paseo allows it on "paseo-1" the provider called reply_interaction_checked for daemon session "sub-9" and request "p-7"
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: permission.request.id, response: { behavior: "allow", selectedActionId: "approve" } });
      await vi.waitFor(() => expect(h.daemon.sent("replyInteractionChecked")).toMatchObject([{ sessionId: "sub-9", requestId: "p-7" }]));
      // @step And it emitted session.permission_resolved on "paseo-1"
      const resolved = await h.waitFor("session.permission_resolved");
      expect(resolved).toMatchObject({ sessionId: "paseo-1", permissionId: permission.request.id });
    });
  });

  describe("Scenario: A sub-agent's question is answered from the parent agent", () => {
    it("raises the question on the parent and replies to the sub-agent", async () => {
      // @step Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
      const h = await withChildren();
      // @step When sub-agent "sub-9" asks HITL question "Which branch?" with header "Branch" as snapshot request "h-2"
      const permission = await pause(h, "sub-9", {
        hitl: { requestId: "h-2", questions: [{ id: "q1", header: "Branch", question: "Which branch?", options: null }] },
      });
      // @step Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Branch"
      expect(permission).toMatchObject({ sessionId: "paseo-1", request: { title: "Sub-agent sub-9: Branch" } });
      // @step And when Paseo answers "main" on "paseo-1" the provider called reply_interaction_checked for daemon session "sub-9" and request "h-2"
      await h.send({
        type: "session.permission",
        sessionId: "paseo-1",
        permissionId: permission.request.id,
        response: { behavior: "allow", updatedInput: { ...permission.request.input, answers: { Branch: "main" } } },
      });
      await vi.waitFor(() => expect(h.daemon.sent("replyInteractionChecked")).toMatchObject([{ sessionId: "sub-9", requestId: "h-2" }]));
    });
  });

  describe("Scenario: A sub-agent's input prompt is answered from the parent agent", () => {
    it("raises the stdin prompt on the parent and writes to the sub-agent", async () => {
      // @step Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
      const h = await withChildren();
      // @step When sub-agent "sub-9" streams an exec stdin request for "python3 -c input()"
      await h.stream("sub-9", {
        type: "execStdinRequest",
        request: { execSessionId: "exec-3", command: "python3 -c input()", quietSeconds: 5, tsMs: 1793315114548 },
      });
      const permission = await h.waitFor("session.permission");
      // @step Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Input for python3 -c input()"
      expect(permission).toMatchObject({ sessionId: "paseo-1", request: { title: "Sub-agent sub-9: Input for python3 -c input()" } });
      // @step And when Paseo answers "hello" on "paseo-1" the provider called write_exec_stdin for daemon session "sub-9" with "hello"
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: permission.request.id, response: { behavior: "allow", updatedInput: { answers: { Input: "hello" } } } });
      await vi.waitFor(() =>
        expect(h.daemon.sent("writeExecStdin")).toEqual([{ method: "writeExecStdin", sessionId: "sub-9", execSessionId: "exec-3", text: "hello" }]),
      );
    });
  });

  describe("Scenario: A sub-agent's request resolves on the parent when the sub-agent resumes", () => {
    it("resolves the parent's request", async () => {
      // @step Given sub-agent "sub-9" of "paseo-1" has an approval request shown on "paseo-1"
      const h = await withChildren();
      const permission = await pause(h, "sub-9", { pause: BASH });
      // @step When the daemon reports "sub-9" running again
      await h.stream("sub-9", { type: "sessionStateChange", state: "running" });
      // @step Then the provider emitted session.permission_resolved on "paseo-1" for that request
      const resolved = await h.waitFor("session.permission_resolved");
      expect(resolved).toMatchObject({ sessionId: "paseo-1", permissionId: permission.request.id });
    });
  });

  describe("Scenario: A nested sub-agent's request shows on the top-level agent", () => {
    it("routes past the direct parent to the root", async () => {
      // @step Given an open Paseo session "paseo-1" with sub-agent "sub-9" whose own sub-agent "sub-10" is open as a child
      const h = await withChildren(true);
      // @step When sub-agent "sub-10" pauses for approval of Bash
      const permission = await pause(h, "sub-10", { pause: BASH });
      // @step Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-10: Allow Bash?"
      expect(permission).toMatchObject({ sessionId: "paseo-1", request: { title: "Sub-agent sub-10: Allow Bash?" } });
    });
  });
});
