/**
 * Feature: spec/features/fspec-hitl-questions.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";
import { interactionSnapshot } from "./support/fake-daemon.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
const ENV: wire.HitlRequest = {
  questions: [
    {
      id: "q1",
      header: "Env",
      question: "Which environment?",
      options: [
        { label: "dev", description: "local" },
        { label: "prod", description: "live" },
      ],
    },
  ],
};

async function asking(request: wire.HitlRequest = ENV) {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "deploy it"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  h.daemon.handlers.getInteractionSnapshot = () => interactionSnapshot({ hitl: { requestId: "h-1", questions: request.questions } });
  await h.stream(DAEMON, { type: "sessionStateChange", state: "paused" });
  const permission = await h.waitFor("session.permission");
  return { h, permission };
}

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  return text.split("\n").find((line) => line.startsWith(`${name} `))!.slice(name.length + 1).trim();
}

describe("Feature: Answer fspec HITL questions from Paseo", () => {
  describe("Scenario: A HITL pause becomes a Paseo question", () => {
    it("emits a question permission", async () => {
      // @step Given an fspec session whose running turn pauses for a HITL question
      // @step When the interaction snapshot holds HITL question "q1" with header "Env", question "Which environment?" and options "dev" (local) and "prod" (live)
      const { h, permission } = await asking();
      expect(h.daemon.sent("getInteractionSnapshot")).toEqual([{ method: "getInteractionSnapshot", sessionId: DAEMON }]);
      // @step Then the provider emitted one session.permission with kind question and input questions [{ header "Env", question "Which environment?", options dev and prod, multiSelect false, allowOther true }]
      expect(h.ofType("session.permission")).toHaveLength(1);
      expect(permission.request).toMatchObject({
        kind: "question",
        name: "question",
        title: "Env",
        input: {
          questions: [
            {
              header: "Env",
              question: "Which environment?",
              options: [
                { label: "dev", description: "local" },
                { label: "prod", description: "live" },
              ],
              multiSelect: false,
              allowOther: true,
              allowEmpty: false,
            },
          ],
        },
      });
    });
  });

  describe("Scenario: Choosing an option answers the question", () => {
    it("sends the selected label", async () => {
      // @step Given an open Paseo question for HITL question "q1" with header "Env"
      const { h, permission } = await asking();
      // @step When Paseo answers with updatedInput answers { "Env": "dev" }
      await h.send({
        type: "session.permission",
        sessionId: "paseo-1",
        permissionId: permission.request.id,
        response: { behavior: "allow", updatedInput: { ...permission.request.input, answers: { Env: "dev" } } },
      });
      // @step Then the provider answered with send_hitl_response through reply_interaction_checked with cancelled false and answers [{ id "q1", selected ["dev"], other null }]
      const resolved = await h.waitFor("session.permission_resolved");
      const sent = h.daemon.sent("replyInteractionChecked");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ interaction: "send_hitl_response", requestId: "h-1" });
      expect(JSON.parse(sent[0]!.arguments)).toEqual({
        response: { cancelled: false, answers: [{ id: "q1", selected: ["dev"], other: null }] },
      });
      // @step And it emitted session.permission_resolved for the question
      expect(resolved.permissionId).toBe(permission.request.id);
    });
  });

  describe("Scenario: Free text answers the question as other", () => {
    it("sends custom text as other", async () => {
      // @step Given an open Paseo question for HITL question "q1" with header "Env"
      const { h, permission } = await asking();
      // @step When Paseo answers with updatedInput answers { "Env": "staging" }
      await h.send({
        type: "session.permission",
        sessionId: "paseo-1",
        permissionId: permission.request.id,
        response: { behavior: "allow", updatedInput: { answers: { Env: "staging" } } },
      });
      await h.waitFor("session.permission_resolved");
      // @step Then the provider answered with send_hitl_response through reply_interaction_checked with answers [{ id "q1", selected [], other "staging" }]
      expect(JSON.parse(h.daemon.sent("replyInteractionChecked")[0]!.arguments).response).toEqual({
        cancelled: false,
        answers: [{ id: "q1", selected: [], other: "staging" }],
      });
    });
  });

  describe("Scenario: Dismissing the question cancels it", () => {
    it("sends cancelled true", async () => {
      // @step Given an open Paseo question for HITL question "q1"
      const { h, permission } = await asking();
      // @step When Paseo answers with behavior deny
      await h.send({
        type: "session.permission",
        sessionId: "paseo-1",
        permissionId: permission.request.id,
        response: { behavior: "deny", message: "Dismissed by user" },
      });
      // @step Then the provider answered with send_hitl_response through reply_interaction_checked with cancelled true and no answers and emitted session.permission_resolved
      await h.waitFor("session.permission_resolved");
      expect(JSON.parse(h.daemon.sent("replyInteractionChecked")[0]!.arguments).response).toEqual({ cancelled: true, answers: [] });
    });
  });

  describe("Scenario: HITL RPCs match the daemon's encoding", () => {
    it("byte-matches the Rust golden vectors", () => {
      // @step Given Rust golden vectors for Option<HitlRequest> and the send_hitl_response arguments
      const frame = new Uint8Array(Buffer.from("0000000000000000" + "00000000" + "51000000" + vector("hitl_request_some"), "hex"));
      // @step When the codec encodes and decodes those values
      const decoded = wire.decodeResponseFrame(frame);
      const reencoded = wire.encodeResponseFrame({
        requestId: 0,
        message: "getHitlRequest",
        value: (decoded as { request: wire.HitlRequest | null }).request,
      });
      const request = wire.encodeRequestFrame({
        id: 0,
        message: {
          method: "sendHitlResponse",
          sessionId: "s",
          response: {
            cancelled: false,
            answers: [
              { id: "q1", selected: ["dev"], other: null },
              { id: "q2", selected: [], other: "x" },
            ],
          },
        },
      });
      // @step Then the bytes match the golden vectors exactly
      expect(decoded).toMatchObject({
        method: "getHitlRequest",
        request: { questions: [{ id: "q1", header: "Env", question: "Which?", options: [{ label: "dev", description: "local" }] }] },
      });
      expect(Buffer.from(reencoded.subarray(16)).toString("hex")).toBe(vector("hitl_request_some"));
      expect(Buffer.from(request).toString("hex").endsWith("4f000000" + vector("hitl_response_args"))).toBe(true);
    });
  });
});
